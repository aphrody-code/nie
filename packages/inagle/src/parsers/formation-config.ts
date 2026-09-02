/**
 * @file formation-config.ts
 * @description Parser for formation_config files
 */

import { Buffer } from "node:buffer";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { toHex } from "../core/data-loader.js";
import { loadTextFile } from "./text-parser.js";

export interface FormationPosition {
	positionNo: number; // 0-10
	positionId: number; // Role/Zone ID?
	passNo: number;
	bKickoff: boolean;
	bFollow: boolean;
	coordinates: {
		defense: [number, number];
		offense: [number, number];
		start: [number, number];
		ckDefenseLeft: [number, number];
		ckDefenseRight: [number, number];
		ckOffenseLeft: [number, number];
		ckOffenseRight: [number, number];
		pkDefense: [number, number];
		pkOffense: [number, number];
		bustup: [number, number];
	};
}

export interface ParsedFormation {
	formationId: string; // Hex
	names: { en?: string; fr?: string; ja?: string };
	descriptions: { en?: string; fr?: string; ja?: string };
	powerOffense: number;
	powerDefense: number;
	positions: FormationPosition[];
}

function findFormationConfigFile(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir);
	// formation_config_0.02.16.cfg.bin.json
	const configFile = files
		.filter((f) => f.startsWith("formation_config_") && f.endsWith(".cfg.bin.json"))
		.sort()
		.pop();
	return configFile ? join(dir, configFile) : null;
}

function hexToFloats(hex: string): [number, number] {
	// 8 bytes -> 2 interleaved Float32
	if (hex.length < 16) return [0, 0];
	const first = hex.substring(0, 8);
	const second = hex.substring(8, 16);
	const buf1 = Buffer.from(first, "hex");
	const buf2 = Buffer.from(second, "hex");
	return [buf1.readFloatLE(0), buf2.readFloatLE(0)];
}

export function buildFormationDatabase(dataPath: string) {
	const formationDir = join(dataPath, "common", "gamedata", "formation");
	const configPath = findFormationConfigFile(formationDir);

	const formations: ParsedFormation[] = [];
	const byId = new Map<string, ParsedFormation>();

	if (!configPath) {
		console.warn("[formation-config] Config not found in", formationDir);
		return { formations, byId };
	}

	const textEn = loadTextFile("formation", "en");
	const textFr = loadTextFile("formation", "fr");
	const textJa = loadTextFile("formation", "ja");

	try {
		const content = JSON.parse(readFileSync(configPath, "utf-8"));

		if (content.lists) {
			const infoList = content.lists.find((l: any) => l.name === "m_SoccerFormationInfoList");
			const placementList = content.lists.find(
				(l: any) => l.name === "m_SoccerFormPlacementInfoList"
			);

			const allPlacements: any[] = placementList?.values || [];

			if (infoList?.values) {
				for (const entry of infoList.values) {
					const formId = entry.formId;
					const nounId = entry.nounId;
					const descId = entry.descId;
					const [startIdx, count] = entry.placementInfo || [0, 0];

					const formIdHex = toHex(Number(formId));
					const nounIdHex = toHex(Number(nounId));
					const descIdHex = toHex(Number(descId));

					// Extract positions
					const formPlacements = allPlacements.slice(startIdx, startIdx + count);
					const positions: FormationPosition[] = formPlacements.map((p: any) => ({
						positionNo: p.positionNo,
						positionId: p.positionId,
						passNo: p.passNo,
						bKickoff: p.bKickoff,
						bFollow: p.bFollow,
						coordinates: {
							defense: hexToFloats(p.defensePos),
							offense: hexToFloats(p.offensePos),
							start: hexToFloats(p.startPos),
							ckDefenseLeft: hexToFloats(p.ckDefenseLeftPos),
							ckDefenseRight: hexToFloats(p.ckDefenseRightPos),
							ckOffenseLeft: hexToFloats(p.ckOffenseLeftPos),
							ckOffenseRight: hexToFloats(p.ckOffenseRightPos),
							pkDefense: hexToFloats(p.pkDefensePos),
							pkOffense: hexToFloats(p.pkOffensePos),
							bustup: hexToFloats(p.bustupPos),
						},
					}));

					const formation: ParsedFormation = {
						formationId: formIdHex,
						names: {
							en: textEn.get(nounIdHex),
							fr: textFr.get(nounIdHex),
							ja: textJa.get(nounIdHex),
						},
						descriptions: {
							en: textEn.get(descIdHex),
							fr: textFr.get(descIdHex),
							ja: textJa.get(descIdHex),
						},
						powerOffense: entry.powerOffense || 0,
						powerDefense: entry.powerDefense || 0,
						positions,
					};

					formations.push(formation);
					byId.set(formIdHex, formation);
				}
			}
		}

		console.log(`[FormationParser] Loaded ${formations.length} formations.`);
	} catch (e) {
		console.error("[formation-config] Build failed", e);
	}

	return { formations, byId };
}
