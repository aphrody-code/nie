/**
 * @file ctrl-chara-config.ts
 * @description Parser for controllable character configuration
 *
 * Data source: party/ctrl_chara_config_1.04.17.00.cfg.bin.json
 *
 * Structure (entries format):
 * - CTRL_CHR_DATA_LIST_BEG_0: 155 character entries
 *   Each child has 3 Int variables: [charaParamId(CRC), controlType, flags]
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { DATA_ROOT, resolveGameDataFile } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface CtrlCharaData {
	charaParamId: string;
	controlType: number;
	flags: number;
}

export interface CtrlCharaDatabase {
	characters: CtrlCharaData[];
	byParamId: Map<string, CtrlCharaData>;
	/** Check if a character is controllable */
	isControllable: (charaParamId: string) => boolean;
}

// ============================================================================
// Parser
// ============================================================================

function parseEntries(entries: ConfigNode[]): CtrlCharaData[] {
	const characters: CtrlCharaData[] = [];

	for (const entry of entries) {
		if (!entry.name.startsWith("CTRL_CHR_DATA_LIST_BEG")) continue;
		const children = entry.children || [];

		for (const child of children) {
			if (!child.name.startsWith("CTRL_CHR_DATA_")) continue;
			const vars = child.variables;
			if (vars.length < 3) continue;

			characters.push({
				charaParamId: toHex(Number.parseInt(vars[0].value, 10)),
				controlType: Number.parseInt(vars[1].value, 10),
				flags: Number.parseInt(vars[2].value, 10),
			});
		}
	}
	return characters;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadCtrlCharaConfigAsync(dataPath: string = DATA_ROOT) {
	// Résolution version-agnostique (repli sur le chemin versionné historique si introuvable)
	const path =
		resolveGameDataFile("party", "ctrl_chara_config") ??
		join(dataPath, "common/gamedata/party", "ctrl_chara_config_1.04.17.00.cfg.bin.json");
	const content = await loadJsonAsync<{ entries: ConfigNode[] }>(path);
	if (!content?.entries) return null;
	return parseEntries(content.entries);
}

export async function buildCtrlCharaDatabase(
	dataPath: string = DATA_ROOT
): Promise<CtrlCharaDatabase> {
	const characters = (await loadCtrlCharaConfigAsync(dataPath)) || [];
	const byParamId = new Map<string, CtrlCharaData>();
	for (const c of characters) byParamId.set(c.charaParamId, c);

	return {
		characters,
		byParamId,
		isControllable: (charaParamId: string) => byParamId.has(charaParamId),
	};
}
