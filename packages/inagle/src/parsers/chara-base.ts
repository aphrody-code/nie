/**
 * @file chara-base.ts
 * @description Parser for character base config files
 *
 * Parses chara_base_*.cfg.bin.json to extract:
 * - Character hash ID
 * - Internal code (c01000100, npc0010, etc.)
 * - Name text hash (links to chara_text)
 * - Description text hash
 * - Series ID (links to charaSeriesInfo)
 * - Team ID (links to belongTeamInfo)
 *
 * Structure discovered:
 * [0] = unique character hash
 * [1] = internal code (string)
 * [3] = name hash -> links to chara_text
 * [11] = gender (1=male, 2=female)
 * [15] = series ID -> links to charaSeriesInfo
 * [16] = belong team ID -> links to belongTeamInfo
 * [19] = description hash -> links to chara_description_text
 */

import type { ConfigNode } from "../core/config-parser.js";
import { loadCharaBase, toHex } from "../core/data-loader.js";

/**
 * Parsed character base entry
 */
export interface ParsedCharaBase {
	/** Unique character ID (hex string) */
	charaId: string;
	/** Internal code (c01000100, npc0010, etc.) */
	internalCode: string;
	/** Name text hash (hex string) - links to chara_text (first name) */
	nameHash: string;
	/** Last name text hash (hex string) - field[4] links to chara_text (family name) */
	lastNameHash?: string;
	/** Description text hash (hex string) */
	descriptionHash?: string;
	/** Gender (1=male, 2=female) */
	gender: number;
	/** Series ID (hex string) - links to charaSeriesInfo */
	seriesId?: string;
	/** Belong team ID (hex string) - links to belongTeamInfo */
	belongTeamId?: string;
	/** Raw variable values */
	rawVariables: (string | number)[];
}

/**
 * Parse a single CHARA_BASE_INFO node
 */
function parseBaseNode(node: ConfigNode): ParsedCharaBase | null {
	const vars = node.variables;
	if (vars.length < 4) return null;

	// [0] = unique character hash (Int)
	const charaIdVar = vars[0];
	if (charaIdVar.type !== "Int") return null;
	const charaId = toHex(Number.parseInt(charaIdVar.value, 10));

	// [1] = internal code (String)
	const codeVar = vars[1];
	if (codeVar.type !== "String") return null;
	const internalCode = codeVar.value;

	// [3] = name hash (Int) — first name / display name
	const nameHashVar = vars[3];
	if (!nameHashVar || nameHashVar.type !== "Int") return null;
	const nameHash = toHex(Number.parseInt(nameHashVar.value, 10));

	// [4] = last name hash (Int) — family name
	let lastNameHash: string | undefined;
	if (vars.length > 4) {
		const lastNameVar = vars[4];
		if (lastNameVar && lastNameVar.type === "Int" && Number.parseInt(lastNameVar.value, 10) !== 0) {
			lastNameHash = toHex(Number.parseInt(lastNameVar.value, 10));
		}
	}

	// [11] = gender (1=male, 2=female)
	let gender = 1; // Default to male
	if (vars.length > 11) {
		const genderVar = vars[11];
		if (genderVar && genderVar.type === "Int") {
			gender = Number.parseInt(genderVar.value, 10);
		}
	}

	// [15] = series ID (Int) - links to charaSeriesInfo
	let seriesId: string | undefined;
	if (vars.length > 15) {
		const seriesVar = vars[15];
		if (seriesVar && seriesVar.type === "Int" && Number.parseInt(seriesVar.value, 10) !== 0) {
			seriesId = toHex(Number.parseInt(seriesVar.value, 10));
		}
	}

	// [16] = belong team ID (Int) - links to belongTeamInfo
	let belongTeamId: string | undefined;
	if (vars.length > 16) {
		const teamVar = vars[16];
		if (teamVar && teamVar.type === "Int" && Number.parseInt(teamVar.value, 10) !== 0) {
			belongTeamId = toHex(Number.parseInt(teamVar.value, 10));
		}
	}

	// [19] = description hash (Int) - optional
	let descriptionHash: string | undefined;
	if (vars.length > 19) {
		const descVar = vars[19];
		if (descVar && descVar.type === "Int" && Number.parseInt(descVar.value, 10) !== 0) {
			descriptionHash = toHex(Number.parseInt(descVar.value, 10));
		}
	}

	// Collect raw values
	const rawVariables: (string | number)[] = [];
	for (const v of vars) {
		if (v.type === "Int") {
			rawVariables.push(Number.parseInt(v.value, 10));
		} else if (v.type === "String") {
			rawVariables.push(v.value);
		}
	}

	return {
		charaId,
		internalCode,
		nameHash,
		lastNameHash,
		descriptionHash,
		gender,
		seriesId,
		belongTeamId,
		rawVariables,
	};
}

/**
 * Parse all character base entries from config
 */
export function parseAllCharaBase(): ParsedCharaBase[] {
	const config = loadCharaBase();
	const results: ParsedCharaBase[] = [];

	function traverse(node: ConfigNode) {
		// Match CHARA_BASE_INFO_0, CHARA_BASE_INFO_1, etc.
		// Also match CHARA_BASE_BATTLE_0, etc.
		if (/^CHARA_BASE_(INFO|BATTLE)_\d+$/.test(node.name)) {
			const parsed = parseBaseNode(node);
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
 * Build a map of charaId -> ParsedCharaBase
 */
export function buildCharaBaseMap(): Map<string, ParsedCharaBase> {
	const bases = parseAllCharaBase();
	const map = new Map<string, ParsedCharaBase>();

	for (const base of bases) {
		map.set(base.charaId, base);
	}

	return map;
}

/**
 * Build a map of nameHash -> ParsedCharaBase[]
 * (multiple characters can share the same name, like variants)
 */
export function buildNameHashToBaseMap(): Map<string, ParsedCharaBase[]> {
	const bases = parseAllCharaBase();
	const map = new Map<string, ParsedCharaBase[]>();

	for (const base of bases) {
		const existing = map.get(base.nameHash) ?? [];
		existing.push(base);
		map.set(base.nameHash, existing);
	}

	return map;
}

/**
 * Build a map of internalCode -> ParsedCharaBase
 */
export function buildCodeToBaseMap(): Map<string, ParsedCharaBase> {
	const bases = parseAllCharaBase();
	const map = new Map<string, ParsedCharaBase>();

	for (const base of bases) {
		map.set(base.internalCode, base);
	}

	return map;
}
