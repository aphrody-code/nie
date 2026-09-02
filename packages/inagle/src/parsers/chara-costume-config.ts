/**
 * @file chara-costume-config.ts
 * @description Parser for character costume model configuration
 *
 * Data source: character/chara_costume_1.02.28.00.cfg.bin.json
 *
 * Structure (entries format):
 * - CHARA_COSTUME_MODEL_LIST_BEG_0: 576 costume entries
 *   Each child has 4 Int variables: [type, modelRefCrc, flag1, flag2]
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { DATA_ROOT, resolveGameDataFile } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface CharaCostume {
	index: number;
	type: number;
	modelRef: string;
	flag1: number;
	flag2: number;
}

export interface CharaCostumeDatabase {
	costumes: CharaCostume[];
	byIndex: Map<number, CharaCostume>;
}

// ============================================================================
// Parser
// ============================================================================

function parseEntries(entries: ConfigNode[]): CharaCostume[] {
	const costumes: CharaCostume[] = [];

	for (const entry of entries) {
		if (!entry.name.startsWith("CHARA_COSTUME_MODEL_LIST_BEG")) continue;
		const children = entry.children || [];

		for (let i = 0; i < children.length; i++) {
			const child = children[i];
			if (!child.name.startsWith("CHARA_COSTUME_MODEL_")) continue;
			const vars = child.variables;
			if (vars.length < 4) continue;

			const type = Number.parseInt(vars[0].value, 10);
			const modelRef = toHex(Number.parseInt(vars[1].value, 10));
			const flag1 = Number.parseInt(vars[2].value, 10);
			const flag2 = Number.parseInt(vars[3].value, 10);

			costumes.push({ index: i, type, modelRef, flag1, flag2 });
		}
	}
	return costumes;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadCharaCostumeConfigAsync(dataPath: string = DATA_ROOT) {
	// Résolution version-agnostique (repli sur le chemin versionné historique si introuvable)
	const path =
		resolveGameDataFile("character", "chara_costume") ??
		join(dataPath, "common/gamedata/character", "chara_costume_1.02.28.00.cfg.bin.json");
	const content = await loadJsonAsync<{ entries: ConfigNode[] }>(path);
	if (!content?.entries) return null;
	return parseEntries(content.entries);
}

export async function buildCharaCostumeDatabase(
	dataPath: string = DATA_ROOT
): Promise<CharaCostumeDatabase> {
	const costumes = (await loadCharaCostumeConfigAsync(dataPath)) || [];
	const byIndex = new Map<number, CharaCostume>();
	for (const c of costumes) byIndex.set(c.index, c);

	return { costumes, byIndex };
}
