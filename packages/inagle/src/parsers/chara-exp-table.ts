/**
 * @file chara-exp-table.ts
 * @description Parser for character EXP table configuration
 *
 * Data source: character/chara_exp_table_config_0.00.00.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_charaExpTableList: XP required per level (100 entries)
 *   Fields: level (int), needExp (int)
 * - m_expRarityRateList: Multiplicateur XP par rang de rareté (9 entries)
 *   Fields: rarity (0-8 = growthRank), rate (1 ou 3)
 *   Raretés 0-3 → ×1, raretés 4-8 → ×3 (UR/LR/Legend/BASARA)
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface CharaExpEntry {
	/** Character level (1-99) */
	level: number;
	/** XP required to reach this level */
	needExp: number;
}

/** Multiplicateur XP par growthRank (index = growthRank 0-8) */
export interface ExpRarityRate {
	rarity: number;
	rate: number;
}

export interface CharaExpTableDatabase {
	expTable: CharaExpEntry[];
	/** Multiplicateurs XP par growthRank */
	rarityRates: ExpRarityRate[];
	/** Get XP needed for a specific level */
	getExpForLevel: (level: number) => number | null;
	/** Get cumulative XP needed to reach a level from level 1 */
	getCumulativeExp: (level: number) => number;
	/** Get XP multiplier for a given growthRank (0-8) */
	getRarityRate: (growthRank: number) => number;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): { expTable: CharaExpEntry[]; rarityRates: ExpRarityRate[] } {
	const expTable: CharaExpEntry[] = [];
	const rarityRates: ExpRarityRate[] = [];
	if (!content?.lists) return { expTable, rarityRates };

	for (const list of content.lists) {
		if (list.name === "m_charaExpTableList") {
			for (const val of list.values) {
				expTable.push({ level: val.level, needExp: val.needExp });
			}
		} else if (list.name === "m_expRarityRateList") {
			for (const val of list.values) {
				rarityRates.push({ rarity: val.rarity, rate: val.rate });
			}
		}
	}
	return { expTable, rarityRates };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadCharaExpTableAsync(
	dataPath: string = DATA_ROOT
): Promise<{ expTable: CharaExpEntry[]; rarityRates: ExpRarityRate[] } | null> {
	const filename = findConfigFile("character", "chara_exp_table_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/character", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildCharaExpTableDatabase(
	dataPath: string = DATA_ROOT
): Promise<CharaExpTableDatabase> {
	const parsed = await loadCharaExpTableAsync(dataPath);
	const expTable = parsed?.expTable ?? [];
	const rarityRates = parsed?.rarityRates ?? [];

	const byLevel = new Map<number, number>();
	for (const entry of expTable) {
		byLevel.set(entry.level, entry.needExp);
	}

	const byRarity = new Map<number, number>();
	for (const r of rarityRates) {
		byRarity.set(r.rarity, r.rate);
	}

	return {
		expTable,
		rarityRates,
		getExpForLevel: (level: number) => byLevel.get(level) ?? null,
		getRarityRate: (growthRank: number) => byRarity.get(growthRank) ?? 1,
		getCumulativeExp: (targetLevel: number) => {
			let total = 0;
			for (const entry of expTable) {
				if (entry.level >= targetLevel) break;
				total += entry.needExp;
			}
			return total;
		},
	};
}
