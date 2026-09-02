/**
 * @file chara-param.ts
 * @description Parser for character param config files
 *
 * Parses chara_param_*.cfg.bin.json to extract:
 * - Character param ID (unique variant ID)
 * - Base character ID
 * - Position (main/sub)
 * - Element
 * - Rarity/rank
 * - Growth pattern for stat calculation
 */

import type { ConfigNode } from "../core/config-parser.js";
import { loadCharaParam, toHex } from "../core/data-loader.js";

/**
 * Parsed character param entry
 */
export interface ParsedCharaParam {
	/** Unique param ID (hex string) */
	charaParamId: string;
	/** Base character ID (hex string) */
	charaBaseId: string;
	/** Main position (1=GK, 2=FW, 3=MF, 4=DF) */
	mainPosition: number;
	/** Sub position */
	subPosition: number;
	/** Element (1=Wind, 2=Forest, 3=Fire, 4=Mountain) */
	element: number;
	/** Gender (0=male, 1=female) */
	gender: number;
	/** Character rank/rarity */
	charaRank: number;
	/** Growth pattern for stats */
	growthPattern: number;
	/** Body type */
	bodyType: number;
	/** Extracted skill slots (Level, SkillID) */
	skills: { learnLevel: number; skillId: string }[];
	/** Raw variable values */
	rawVariables: number[];
}

/**
 * Parse a single CHARA_PARAM_INFO node
 *
 * Variable indices (validated against known characters):
 * [0] = charaParamId hash (unique variant ID)
 * [1] = charaId hash (base character)
 * [2] = element (1=Wind, 2=Forest, 3=Fire, 4=Mountain)
 * [3] = mainPosition (1=GK, 2=FW, 3=MF, 4=DF)
 *
 * Evidence:
 * - Mark Evans: [2]=4 (Mountain), [3]=1 (GK) ✓
 * - Axel Blaze: [2]=3 (Fire), [3]=2 (FW) ✓
 * - Nathan Swift: [2]=1 (Wind) ✓
 * [4] = subPosition (1-4)
 * [5] = unknown (often 5)
 * [6] = growth related?
 * [7] = growth related?
 * [8] = growthPattern (0 or 1)
 * [9] = Skill 1 hash
 * [10] = Level 1
 * [11] = Skill 2 hash
 * [12] = Level 2
 * ... pairs of [SkillHash, LearnLevel]
 *
 * NOTE: charaRank is NOT stored here - it comes from starSignCharaInfo
 */
function parseParamNode(node: ConfigNode): ParsedCharaParam | null {
	const vars = node.variables;
	// if (vars.length < 10) return null

	// Extract all int values
	const values: number[] = [];
	for (const v of vars) {
		if (v.type === "Int") {
			values.push(Number.parseInt(v.value, 10));
		}
	}

	if (values.length < 8) return null;

	// Defaults
	const charaParamId = toHex(values[0]);
	let charaBaseId = toHex(values[1]);
	const element = values[2];
	const mainPosition = values[3];
	const subPosition = values[4] || 0;
	const growthPattern = values[8] || 0;

	// Extract skills — 9 slots, LEVEL-FIRST, starting at index 10.
	// Layout réel (vérifié sur le dump chara_param) : niveaux aux index PAIRS 10,12,…,26
	// (0..99) et hash de technique aux index IMPAIRS 11,13,…,27.
	//   [10] Level 1, [11] Skill 1 hash
	//   [12] Level 2, [13] Skill 2 hash … jusqu'à 9 slots.
	// (L'ancienne lecture 6 slots hash-first @9 tronquait/désalignait les techniques
	//  pour TOUTES les versions — normal, héros et basara — qui sont des entrées
	//  chara_param distinctes partageant ce parseur.)
	const skills: { learnLevel: number; skillId: string }[] = [];
	for (let slot = 0; slot < 9; slot++) {
		const levelIdx = 10 + slot * 2;
		const hashIdx = 11 + slot * 2;
		if (hashIdx >= values.length) break;

		const skillIdNum = values[hashIdx];
		const learnLevel = values[levelIdx];

		// Le hash peut être n'importe quelle valeur 32 bits (signée/non signée) ≠ 0 ;
		// on valide le NIVEAU (0..99) plutôt que le hash.
		if (skillIdNum !== 0 && learnLevel >= 0 && learnLevel <= 99) {
			skills.push({
				skillId: toHex(skillIdNum),
				learnLevel: learnLevel,
			});
		}
	}

	// V2 format detection (8 variables)
	// [0] = Hash
	// [1] = 2 (Fixed?)
	// [2] = 0 (Fixed?)
	// [3] = 1 (Fixed?)
	// [6] = Hash (Duplicate)
	if (values.length === 8 && values[6] === values[0]) {
		// In this format, [0] seems to be the ID.
		// [1] is NOT charaBaseId (it's 2).
		// so we map baseId = paramId
		charaBaseId = charaParamId;

		// Element/Position are likely not in [2]/[3] as they are 0/1 constant.
		// We keep them as is or default to 0 to avoid misinformation?
		// But existing logic expects them.
		// For now, let's pass them through, but correct the baseId so names resolve.
		// Warn: Stats will be generic.
	}

	return {
		charaParamId,
		charaBaseId,
		mainPosition, // [3]
		subPosition, // [4]
		element, // [2]
		gender: 0,
		charaRank: 0,
		growthPattern,
		bodyType: 0,
		skills,
		rawVariables: values,
	};
}

/**
 * Parse all character params from config
 */
export function parseAllCharaParams(): ParsedCharaParam[] {
	const config = loadCharaParam();
	const results: ParsedCharaParam[] = [];

	function traverse(node: ConfigNode) {
		if (
			node.name.startsWith("CHARA_PARAM_INFO_") &&
			!node.name.includes("LIST") &&
			!node.name.includes("BEG")
		) {
			const parsed = parseParamNode(node);
			if (parsed) {
				results.push(parsed);
			}
		}

		if (node.children) {
			for (const child of node.children) {
				traverse(child);
			}
		}
	}

	for (const entry of config.children) {
		traverse(entry);
	}

	return results;
}

/**
 * Build a map of charaParamId -> ParsedCharaParam
 */
export function buildCharaParamMap(): Map<string, ParsedCharaParam> {
	const params = parseAllCharaParams();
	const map = new Map<string, ParsedCharaParam>();

	for (const param of params) {
		map.set(param.charaParamId, param);
	}

	return map;
}

/**
 * Build a map of charaBaseId -> ParsedCharaParam[]
 * (one base character can have multiple variants)
 */
export function buildCharaBaseToParamsMap(): Map<string, ParsedCharaParam[]> {
	const params = parseAllCharaParams();
	const map = new Map<string, ParsedCharaParam[]>();

	for (const param of params) {
		const existing = map.get(param.charaBaseId) ?? [];
		existing.push(param);
		map.set(param.charaBaseId, existing);
	}

	return map;
}

/**
 * Position ID to code
 */
export function positionIdToCode(id: number): "Coach" | "GK" | "FW" | "MF" | "DF" | undefined {
	switch (id) {
		case 0:
			return "Coach";
		case 1:
			return "GK";
		case 2:
			return "FW";
		case 3:
			return "MF";
		case 4:
			return "DF";
		default:
			return undefined;
	}
}

/**
 * Element ID to names (validated against known characters)
 * 1=Wind, 2=Forest/Wood, 3=Fire, 4=Mountain
 *
 * Evidence:
 * - Mark Evans: raw[2]=4 → Mountain ✓
 * - Axel Blaze: raw[2]=3 → Fire ✓
 * - Nathan Swift/Shawn Froste: raw[2]=1 → Wind ✓
 */
export function elementIdToNames(id: number): { ja: string; en: string; fr: string } | undefined {
	switch (id) {
		case 1:
			return { ja: "風", en: "Wind", fr: "Vent" };
		case 2:
			return { ja: "林", en: "Forest", fr: "Forêt" };
		case 3:
			return { ja: "火", en: "Fire", fr: "Feu" };
		case 4:
			return { ja: "山", en: "Mountain", fr: "Montagne" };
		default:
			return undefined;
	}
}

// Source unique : voir src/lib/rarity.ts. Réexporté ici pour préserver l'API
// publique de chara-param (réexporté via parsers/index.ts).
export { rarityCodeToName } from "../lib/rarity.js";
