/**
 * @file mission-config.ts
 * @description Parser for mission_config files
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { loadTextFile } from "./text-parser.js";

export interface ParsedMission {
	missionId: string; // Hex
	code: string; // e.g. "msa999999"
	nameId: string;
	names: { en?: string; fr?: string; ja?: string };
}

function findMissionConfigFile(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir);
	const configFile = files
		.filter((f) => f.startsWith("mission_config_") && f.endsWith(".cfg.bin.json"))
		.sort()
		.pop();
	return configFile ? join(dir, configFile) : null;
}

export function buildMissionDatabase(dataPath: string) {
	const missionDir = join(dataPath, "common", "gamedata", "mission");
	const configPath = findMissionConfigFile(missionDir);

	const missions: ParsedMission[] = [];
	const byId = new Map<string, ParsedMission>();

	if (!configPath) {
		console.warn("[mission-config] Config not found in", missionDir);
		return { missions, byId };
	}

	// Text file is likely 'mission_text' or 'quest_text'
	const textEn = loadTextFile("mission", "en");
	const textFr = loadTextFile("mission", "fr");
	const textJa = loadTextFile("mission", "ja");

	try {
		const content = JSON.parse(readFileSync(configPath, "utf-8"));
		const entries = content.entries as ConfigNode[];

		function traverse(node: ConfigNode) {
			// MISSION_CONFIG_INFO_0
			// Variables: [ID, Code, NameID, ...]
			if (node.name.startsWith("MISSION_CONFIG_INFO_")) {
				const vars = node.variables;
				if (vars.length >= 3) {
					const idInt = Number.parseInt(vars[0].value, 10) >>> 0;
					const code = vars[1].value;
					const nameIdInt = Number.parseInt(vars[2].value, 10) >>> 0;

					const idHex = toHex(idInt);
					const nameIdHex = toHex(nameIdInt);

					const mission: ParsedMission = {
						missionId: idHex,
						code,
						nameId: nameIdHex,
						names: {
							en: textEn.get(nameIdHex),
							fr: textFr.get(nameIdHex),
							ja: textJa.get(nameIdHex),
						},
					};

					missions.push(mission);
					byId.set(idHex, mission);
				}
			}
			if (node.children) node.children.forEach(traverse);
		}

		entries.forEach(traverse);
		console.log(`[MissionParser] Loaded ${missions.length} missions.`);
	} catch (e) {
		console.error("[mission-config] Build failed", e);
	}

	return { missions, byId };
}
