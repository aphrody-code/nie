/**
 * @file boost-player-group-config.ts
 * @description Parser for boost player group configuration
 *
 * Data source: boost_grp/boost_player_group_config_0.00.00.cfg.bin.json
 *
 * Structure (entries format):
 * - BOOST_PLAYER_GRP_SPRIT_TABLE_INFO_LIST_BEG_0: 4 spirit table entries
 *   Each child: 2 Ints [index, spiritCrc]
 * - BOOST_PLAYER_GRP_CONFIG_LIST_BEG_0: 5 config entries
 *   Each child: 6 Ints [duration, spiritIndices...]
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface BoostSpiritTableEntry {
	index: number;
	spiritId: string;
}

export interface BoostPlayerGroupConfig {
	duration: number;
	spiritIndices: number[];
}

export interface BoostPlayerGroupDatabase {
	spiritTable: BoostSpiritTableEntry[];
	configs: BoostPlayerGroupConfig[];
	bySpiritId: Map<string, BoostSpiritTableEntry>;
}

// ============================================================================
// Parser
// ============================================================================

function parseIntVar(v: { type: string; value: string }): number {
	return Number.parseInt(v.value, 10);
}

function parseEntries(entries: ConfigNode[]) {
	const spiritTable: BoostSpiritTableEntry[] = [];
	const configs: BoostPlayerGroupConfig[] = [];

	for (const entry of entries) {
		const children = entry.children || [];

		if (entry.name.startsWith("BOOST_PLAYER_GRP_SPRIT_TABLE_INFO_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("BOOST_PLAYER_GRP_SPRIT_TABLE_INFO_")) continue;
				const vars = child.variables;
				if (vars.length < 2) continue;
				spiritTable.push({
					index: parseIntVar(vars[0]),
					spiritId: toHex(parseIntVar(vars[1])),
				});
			}
		} else if (entry.name.startsWith("BOOST_PLAYER_GRP_CONFIG_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("BOOST_PLAYER_GRP_CONFIG_")) continue;
				const vars = child.variables;
				if (vars.length < 2) continue;
				const duration = parseIntVar(vars[0]);
				const spiritIndices: number[] = [];
				for (let i = 1; i < vars.length; i++) {
					spiritIndices.push(parseIntVar(vars[i]));
				}
				configs.push({ duration, spiritIndices });
			}
		}
	}
	return { spiritTable, configs };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadBoostPlayerGroupConfigAsync(dataPath: string = DATA_ROOT) {
	const path = join(
		dataPath,
		"common/gamedata/boost_grp",
		"boost_player_group_config_0.00.00.cfg.bin.json"
	);
	const content = await loadJsonAsync<{ entries: ConfigNode[] }>(path);
	if (!content?.entries) return null;
	return parseEntries(content.entries);
}

export async function buildBoostPlayerGroupDatabase(
	dataPath: string = DATA_ROOT
): Promise<BoostPlayerGroupDatabase> {
	const result = await loadBoostPlayerGroupConfigAsync(dataPath);
	const spiritTable = result?.spiritTable || [];
	const configs = result?.configs || [];

	const bySpiritId = new Map<string, BoostSpiritTableEntry>();
	for (const s of spiritTable) bySpiritId.set(s.spiritId, s);

	return { spiritTable, configs, bySpiritId };
}
