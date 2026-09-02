/**
 * @file special-tactics-config.ts
 * @description Parser for special_tactics_config files (Tactiques Speciales)
 *
 * Data source: skill/special_tactics_config_1.04.09.10.cfg.bin.json
 *
 * Structure (entries format with named children):
 * - SPECIAL_TACTICS_EFFECT: Effect data (effectId, power, conditions)
 * - SPECIAL_TACTICS_COND_ID: Condition IDs for activation (condId + base64 data)
 * - SPECIAL_TACTICS_SUCCESS_COND_ID: Success conditions (condId + base64 data)
 * - SPECIAL_TACTICS_INFO: Main tactic entries with refs to effects, conditions, success conditions
 *
 * Special tactics are team-wide abilities activated during matches.
 * Fields per tactic:
 *   [0] tacticsId (CRC hash)
 *   [1] internalCode (string, e.g. "wht10010")
 *   [2] nameTextId (CRC hash)
 *   [3] descTextId (CRC hash)
 *   [4] power
 *   [5] recastTime
 *   [6] element (0-4)
 *   [7..9] partner IDs (CRC hashes, or 0 = none)
 *   [10..16] reserved/flags
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { loadTextFileAsync } from "./text-parser.js";

// ============================================================================
// Types
// ============================================================================

/** Special tactics effect entry */
export interface SpecialTacticsEffect {
	/** Effect ID (CRC hash) */
	effectId: string;
	/** Effect power value */
	power: number;
	/** Condition values (up to 7, null sentinel = -992181094) */
	conditions: string[];
}

/** Condition ID entry */
export interface SpecialTacticsCondId {
	/** Condition ID number */
	condId: number;
	/** Base64-encoded condition data */
	condData: string;
}

/** Parsed special tactic entry */
export interface ParsedSpecialTactic extends ExportableEntity {
	/** Tactic ID (hex CRC hash) */
	tacticsId: string;
	/** Internal code (e.g., "wht10010") */
	internalCode: string;
	/** Localized names */
	names: { en?: string; fr?: string; ja?: string };
	/** Localized descriptions */
	descriptions: { en?: string; fr?: string; ja?: string };
	/** Power value */
	power: number;
	/** Recast time (in game ticks) */
	recastTime: number;
	/** Element (0=Void, 1=Wind, 2=Forest, 3=Fire, 4=Mountain) */
	element: number;
	/** Element name (French) */
	elementName: string;
	/** Partner character IDs (CRC hashes, empty if solo) */
	partnerIds: string[];
	/** Effect references [startIndex, count] */
	effectRef?: [number, number];
	/** Condition references [startIndex, count] */
	condRef?: [number, number];
	/** Success condition references [startIndex, count] */
	successCondRef?: [number, number];
}

/** Complete special tactics database */
export interface SpecialTacticsDatabase {
	tactics: ParsedSpecialTactic[];
	byId: Map<string, ParsedSpecialTactic>;
	effects: SpecialTacticsEffect[];
	conditionIds: SpecialTacticsCondId[];
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Constants
// ============================================================================

const NULL_SENTINEL = -992181094;
const ZERO_HASH = "0x00000000";

const ELEMENT_MAP: Record<number, string> = {
	0: "Neant",
	1: "Vent",
	2: "Foret",
	3: "Feu",
	4: "Montagne",
};

// ============================================================================
// Parser
// ============================================================================

function parseIntVar(v: { type: string; value: string }): number {
	return Number.parseInt(v.value, 10);
}

function parseStringVar(v: { type: string; value: string }): string {
	return v.value;
}

function parseEntries(entries: ConfigNode[]) {
	const effects: SpecialTacticsEffect[] = [];
	const conditionIds: SpecialTacticsCondId[] = [];
	const successCondIds: SpecialTacticsCondId[] = [];

	// Raw tactic info before text resolution
	const rawTactics: Array<{
		tacticsId: string;
		internalCode: string;
		nameTextId: string;
		descTextId: string;
		power: number;
		recastTime: number;
		element: number;
		partnerIds: string[];
		effectRef?: [number, number];
		condRef?: [number, number];
		successCondRef?: [number, number];
	}> = [];

	for (const entry of entries) {
		const children = entry.children || [];

		if (entry.name.startsWith("SPECIAL_TACTICS_EFFECT_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("SPECIAL_TACTICS_EFFECT_")) continue;
				const vars = child.variables;
				if (vars.length < 9) continue;

				const effectId = toHex(parseIntVar(vars[0]));
				const power = parseIntVar(vars[1]);
				const conditions: string[] = [];
				for (let i = 2; i < 9; i++) {
					const val = parseIntVar(vars[i]);
					if (val !== NULL_SENTINEL) {
						conditions.push(toHex(val));
					}
				}

				effects.push({ effectId, power, conditions });
			}
		} else if (entry.name.startsWith("SPECIAL_TACTICS_COND_ID_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("SPECIAL_TACTICS_COND_ID_")) continue;
				const vars = child.variables;
				if (vars.length < 2) continue;

				conditionIds.push({
					condId: parseIntVar(vars[0]),
					condData: parseStringVar(vars[1]),
				});
			}
		} else if (entry.name.startsWith("SPECIAL_TACTICS_SUCCESS_COND_ID_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("SPECIAL_TACTICS_SUCCESS_COND_ID_")) continue;
				const vars = child.variables;
				if (vars.length < 2) continue;

				successCondIds.push({
					condId: parseIntVar(vars[0]),
					condData: parseStringVar(vars[1]),
				});
			}
		} else if (entry.name.startsWith("SPECIAL_TACTICS_INFO_LIST_BEG")) {
			let currentTactic: (typeof rawTactics)[number] | null = null;

			for (const child of children) {
				if (child.name.match(/^SPECIAL_TACTICS_INFO_\d+$/)) {
					if (currentTactic) rawTactics.push(currentTactic);
					const vars = child.variables;
					if (vars.length < 10) continue;

					const tacticsId = toHex(parseIntVar(vars[0]));
					const internalCode = parseStringVar(vars[1]);
					const nameTextId = toHex(parseIntVar(vars[2]));
					const descTextId = toHex(parseIntVar(vars[3]));
					const power = parseIntVar(vars[4]);
					const recastTime = parseIntVar(vars[5]);
					const element = parseIntVar(vars[6]);

					// Partners (vars 7, 8, 9)
					const partnerIds: string[] = [];
					for (let i = 7; i <= 9 && i < vars.length; i++) {
						const val = parseIntVar(vars[i]);
						const hex = toHex(val);
						if (hex !== ZERO_HASH && val !== NULL_SENTINEL) {
							partnerIds.push(hex);
						}
					}

					currentTactic = {
						tacticsId,
						internalCode,
						nameTextId,
						descTextId,
						power,
						recastTime,
						element,
						partnerIds,
					};
				} else if (child.name.startsWith("SPECIAL_TACTICS_INFO_REF_EFFECT_")) {
					if (currentTactic && child.variables.length >= 2) {
						currentTactic.effectRef = [
							parseIntVar(child.variables[0]),
							parseIntVar(child.variables[1]),
						];
					}
				} else if (child.name.startsWith("SPECIAL_TACTICS_INFO_REF_COND_ID_")) {
					if (currentTactic && child.variables.length >= 2) {
						currentTactic.condRef = [
							parseIntVar(child.variables[0]),
							parseIntVar(child.variables[1]),
						];
					}
				} else if (child.name.startsWith("SPECIAL_TACTICS_INFO_REF_SUCCESS_COND_ID_")) {
					if (currentTactic && child.variables.length >= 2) {
						currentTactic.successCondRef = [
							parseIntVar(child.variables[0]),
							parseIntVar(child.variables[1]),
						];
					}
				}
			}
			if (currentTactic) rawTactics.push(currentTactic);
		}
	}

	return { effects, conditionIds, successCondIds, rawTactics };
}

// ============================================================================
// Loaders
// ============================================================================

function findSpecialTacticsConfigFile(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir);
	const configFile = files
		.filter((f) => f.startsWith("special_tactics_config_") && f.endsWith(".cfg.bin.json"))
		.sort()
		.pop();
	return configFile ? join(dir, configFile) : null;
}

export async function buildSpecialTacticsDatabase(
	dataPath: string
): Promise<SpecialTacticsDatabase> {
	const skillDir = join(dataPath, "common", "gamedata", "skill");
	const configPath = findSpecialTacticsConfigFile(skillDir);

	const tactics: ParsedSpecialTactic[] = [];
	const byId = new Map<string, ParsedSpecialTactic>();
	const emptyResult: SpecialTacticsDatabase = {
		tactics,
		byId,
		effects: [],
		conditionIds: [],
		toMarkdown: () => null,
		toReact: () => null,
	};

	if (!configPath) {
		console.warn("[special-tactics-config] Config not found in", skillDir);
		return emptyResult;
	}

	// Load texts in parallel — tactic names are stored in "item" text files
	const [textEn, textFr, textJa] = await Promise.all([
		loadTextFileAsync("item", "en"),
		loadTextFileAsync("item", "fr"),
		loadTextFileAsync("item", "ja"),
	]);

	try {
		const content = await loadJsonAsync<{ entries: ConfigNode[] }>(configPath);
		if (!content?.entries) return emptyResult;

		const { effects, conditionIds, rawTactics } = parseEntries(content.entries);

		for (const raw of rawTactics) {
			const nameFr = textFr.get(raw.nameTextId);
			const nameEn = textEn.get(raw.nameTextId);
			const nameJa = textJa.get(raw.nameTextId);
			const descFr = textFr.get(raw.descTextId);

			const elementName = ELEMENT_MAP[raw.element] || "Neant";
			const displayName = nameFr || nameEn || `Tactic_${raw.tacticsId}`;

			const tactic: ParsedSpecialTactic = {
				id: raw.tacticsId,
				name: displayName,
				description: descFr,
				tacticsId: raw.tacticsId,
				internalCode: raw.internalCode,
				names: { en: nameEn, fr: nameFr, ja: nameJa },
				descriptions: {
					en: textEn.get(raw.descTextId),
					fr: descFr,
					ja: textJa.get(raw.descTextId),
				},
				power: raw.power,
				recastTime: raw.recastTime,
				element: raw.element,
				elementName,
				partnerIds: raw.partnerIds,
				effectRef: raw.effectRef,
				condRef: raw.condRef,
				successCondRef: raw.successCondRef,
				attributes: {
					Puissance: raw.power,
					Element: elementName,
					"Temps de recharge": raw.recastTime,
					Partenaires: raw.partnerIds.length || 0,
				},
			};

			tactics.push(tactic);
			byId.set(raw.tacticsId, tactic);
		}

		console.log(
			`[SpecialTacticsParser] Loaded ${tactics.length} special tactics, ` +
				`${effects.length} effects, ${conditionIds.length} conditions.`
		);

		return {
			tactics,
			byId,
			effects,
			conditionIds,
			toMarkdown: (id: string) => {
				const t = byId.get(id);
				return t ? EntityExporters.toMarkdown(t, "Tactique Speciale") : null;
			},
			toReact: (id: string) => {
				const t = byId.get(id);
				return t ? EntityExporters.toReact(t) : null;
			},
		};
	} catch (e) {
		console.error("[special-tactics-config] Build failed", e);
		return emptyResult;
	}
}
