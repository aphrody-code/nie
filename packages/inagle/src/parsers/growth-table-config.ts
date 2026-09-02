/**
 * @file growth-table-config.ts
 * @description Parser for character stat growth tables
 *
 * Data source: character/growth_table_config_0.00.00.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_growthTableLv1List: Base stats at level 1 (by position/playstyle)
 * - m_growthTableLv30List: Stats at level 30 (by position/growthPattern/charaRank)
 * - m_growthTableMainList: Main growth curve lv50/99
 * - m_growthTableSubList: Sub growth curve lv50/99
 *
 * Stats: Kc=Kick, Cr=Control, Tc=Technique, Pr=Pressure, Ps=Physical, Ag=Agility, It=Intelligence
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface GrowthTableLv1 {
	mainPosition: number;
	subPosition: number;
	playStyle: number;
	Kc_1: number;
	Cr_1: number;
	Tc_1: number;
	Pr_1: number;
	Ps_1: number;
	Ag_1: number;
	It_1: number;
}

export interface GrowthTableLv30 {
	mainPosition: number;
	subPosition: number;
	growthPattern: number;
	charaRank: number;
	Kc_30: number;
	Cr_30: number;
	Tc_30: number;
	Pr_30: number;
	Ps_30: number;
	Ag_30: number;
	It_30: number;
}

export interface GrowthTableMain {
	mainPosition: number;
	growthPattern: number;
	charaRank: number;
	[key: string]: number;
}

export interface GrowthTableSub {
	subPosition: number;
	growthPattern: number;
	charaRank: number;
	[key: string]: number;
}

export interface GrowthTableDatabase {
	lv1: GrowthTableLv1[];
	lv30: GrowthTableLv30[];
	main: GrowthTableMain[];
	sub: GrowthTableSub[];
	/** Lookup base lv1 stats for a position combo */
	getLv1Stats: (mainPos: number, subPos: number, playStyle: number) => GrowthTableLv1 | null;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any) {
	const lv1: GrowthTableLv1[] = [];
	const lv30: GrowthTableLv30[] = [];
	const main: GrowthTableMain[] = [];
	const sub: GrowthTableSub[] = [];

	if (!content?.lists) return { lv1, lv30, main, sub };

	for (const list of content.lists) {
		if (list.name === "m_growthTableLv1List") {
			for (const val of list.values) {
				lv1.push({
					mainPosition: val.mainPosition,
					subPosition: val.subPosition,
					playStyle: val.playStyle,
					Kc_1: val.Kc_1,
					Cr_1: val.Cr_1,
					Tc_1: val.Tc_1,
					Pr_1: val.Pr_1,
					Ps_1: val.Ps_1,
					Ag_1: val.Ag_1,
					It_1: val.It_1,
				});
			}
		} else if (list.name === "m_growthTableLv30List") {
			for (const val of list.values) {
				lv30.push({
					mainPosition: val.mainPosition,
					subPosition: val.subPosition,
					growthPattern: val.growthPattern,
					charaRank: val.charaRank,
					Kc_30: val.Kc_30,
					Cr_30: val.Cr_30,
					Tc_30: val.Tc_30,
					Pr_30: val.Pr_30,
					Ps_30: val.Ps_30,
					Ag_30: val.Ag_30,
					It_30: val.It_30,
				});
			}
		} else if (list.name === "m_growthTableMainList") {
			for (const val of list.values) {
				main.push(val);
			}
		} else if (list.name === "m_growthTableSubList") {
			for (const val of list.values) {
				sub.push(val);
			}
		}
	}
	return { lv1, lv30, main, sub };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadGrowthTableConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("character", "growth_table_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/character", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildGrowthTableDatabase(
	dataPath: string = DATA_ROOT
): Promise<GrowthTableDatabase> {
	const result = await loadGrowthTableConfigAsync(dataPath);
	const lv1 = result?.lv1 || [];
	const lv30 = result?.lv30 || [];
	const main = result?.main || [];
	const sub = result?.sub || [];

	return {
		lv1,
		lv30,
		main,
		sub,
		getLv1Stats: (mainPos, subPos, playStyle) =>
			lv1.find(
				(e) => e.mainPosition === mainPos && e.subPosition === subPos && e.playStyle === playStyle
			) ?? null,
	};
}
