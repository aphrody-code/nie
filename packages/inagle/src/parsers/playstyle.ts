/**
 * @file playstyle.ts
 * @description Parser for character playstyle from chara_param (T2B[5])
 *
 * The playStyle field is stored at T2B variable index 5 in chara_param,
 * right after mainPosition (index 3) and subPosition (index 4).
 * Source: nie.c RDBN field registration — mainPosition=offset 0, subPosition=offset 1, playStyle=offset 2
 * (byte offsets map directly to T2B indices as: T2B[3+offset])
 *
 * Values (from menu_text.cfg.bin.json TEXT_INFO_1812-1817):
 *   0 = Counter  / Contre
 *   1 = Bond     / Lien
 *   2 = Tension  / Tension
 *   3 = Rough Play / Jeu violent
 *   4 = Justice  / Justice
 *   5 = Freedom  / Liberté
 */

import type { ConfigNode } from "../core/config-parser.js";
import { loadCharaParam, toHex } from "../core/data-loader.js";

export interface PlaystyleEntry {
	charaParamId: string;
	playStyle: number;
	playStyleEn: string;
	playStyleFr: string;
}

const PLAYSTYLE_EN: Record<number, string> = {
	0: "Counter",
	1: "Bond",
	2: "Tension",
	3: "Rough Play",
	4: "Justice",
	5: "Freedom",
};

const PLAYSTYLE_FR: Record<number, string> = {
	0: "Contre",
	1: "Lien",
	2: "Tension",
	3: "Jeu violent",
	4: "Justice",
	5: "Liberté",
};

export function playstyleIdToEn(id: number): string {
	return PLAYSTYLE_EN[id] ?? `PlayStyle${id}`;
}

export function playstyleIdToFr(id: number): string {
	return PLAYSTYLE_FR[id] ?? `PlayStyle${id}`;
}

function parsePlaystyleNode(node: ConfigNode): PlaystyleEntry | null {
	const vars = node.variables;
	const values: number[] = [];
	for (const v of vars) {
		if (v.type === "Int") values.push(Number.parseInt(v.value, 10));
	}
	if (values.length < 6) return null;

	const playStyle = values[5] ?? 0;
	return {
		charaParamId: toHex(values[0]),
		playStyle,
		playStyleEn: playstyleIdToEn(playStyle),
		playStyleFr: playstyleIdToFr(playStyle),
	};
}

/**
 * Parse all playstyle entries from chara_param
 */
export function parseAllPlaystyles(): PlaystyleEntry[] {
	const config = loadCharaParam();
	const results: PlaystyleEntry[] = [];

	function traverse(node: ConfigNode) {
		if (
			node.name.startsWith("CHARA_PARAM_INFO_") &&
			!node.name.includes("LIST") &&
			!node.name.includes("BEG")
		) {
			const parsed = parsePlaystyleNode(node);
			if (parsed) results.push(parsed);
		}
		if (node.children) {
			for (const child of node.children) traverse(child);
		}
	}

	for (const entry of config.children) traverse(entry);
	return results;
}

/**
 * Build a map of charaParamId → PlaystyleEntry
 */
export function buildPlaystyleMap(): Map<string, PlaystyleEntry> {
	const map = new Map<string, PlaystyleEntry>();
	for (const entry of parseAllPlaystyles()) {
		map.set(entry.charaParamId, entry);
	}
	return map;
}
