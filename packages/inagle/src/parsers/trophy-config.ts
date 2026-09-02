/**
 * @file trophy-config.ts
 * @description Parser for trophy_config files (Achievements)
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { loadTextFile } from "./text-parser.js";

export interface ParsedTrophy {
	trophyId: string;
	code: string;
	names: { en?: string; fr?: string; ja?: string };
	descriptions: { en?: string; fr?: string; ja?: string };
}

function findTrophyConfigFile(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir);
	const configFile = files
		.filter((f) => f.startsWith("trophy_config_") && f.endsWith(".cfg.bin.json"))
		.sort()
		.pop();
	return configFile ? join(dir, configFile) : null;
}

export function buildTrophyDatabase(dataPath: string) {
	const dir = join(dataPath, "common", "gamedata", "trophy");
	const configPath = findTrophyConfigFile(dir);

	const trophies: ParsedTrophy[] = [];

	if (!configPath) {
		console.warn("[trophy-config] Config not found in", dir);
		return { trophies };
	}

	// Texts
	const textEn = loadTextFile("trophy", "en");
	const textFr = loadTextFile("trophy", "fr");
	const textJa = loadTextFile("trophy", "ja");

	const validHashes = new Set(textFr.keys());

	try {
		const content = JSON.parse(readFileSync(configPath, "utf-8"));
		const entries = content.entries as ConfigNode[];

		function traverse(node: ConfigNode) {
			// TROPHY_INFO_0
			if (
				node.name.startsWith("TROPHY_INFO_") &&
				!node.name.includes("_LIST_") &&
				!node.name.includes("_REF_")
			) {
				const vars = node.variables;

				let idHex = "";
				let code = "";
				let nameHash = "";
				let descHash = "";

				if (vars.length > 0 && vars[0].type === "Int") {
					idHex = toHex(Number.parseInt(vars[0].value, 10));
				}

				// Find Code
				const strVar = vars.find((v) => v.type === "String");
				if (strVar) code = strVar.value;

				// Find Hashes
				const matches: string[] = [];
				for (const v of vars) {
					if (v.type === "Int") {
						const hex = toHex(Number.parseInt(v.value, 10));
						if (validHashes.has(hex)) matches.push(hex);
					}
				}

				if (matches.length > 0) {
					nameHash = matches[0];
					if (matches.length > 1) descHash = matches[1];

					const trophy: ParsedTrophy = {
						trophyId: code || nameHash || idHex,
						code,
						names: {
							en: textEn.get(nameHash),
							fr: textFr.get(nameHash),
							ja: textJa.get(nameHash),
						},
						descriptions: {
							en: textEn.get(descHash),
							fr: textFr.get(descHash),
							ja: textJa.get(descHash),
						},
					};

					trophies.push(trophy);
				}
			}
			if (node.children) node.children.forEach(traverse);
		}

		entries.forEach(traverse);
		console.log(`[TrophyParser] Loaded ${trophies.length} trophies.`);
	} catch (e) {
		console.error("[trophy-config] Build failed", e);
	}

	return { trophies };
}
