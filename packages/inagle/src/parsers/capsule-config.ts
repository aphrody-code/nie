/**
 * @file capsule-config.ts
 * @description Parser for gacha capsule configuration (218K lines)
 *
 * Data source: capsule/capsule_config_0.00.00.cfg.bin.json
 *
 * Structure (entries format, deeply nested):
 * - CPSL_LOT_WEAPON_COLOR_TABLE_INFO_LIST_BEG_0: Color table
 *   → children: INFO entries with nested DATA lists
 * - CPSL_PRIZE_INFO_LIST_BEG_0: Prize entries (740+)
 * - CPSL_PRIZE_TABLE_LIST_BEG_0: Prize table entries (20+)
 * - CPSL_LOT_RANK_RATE_LIST_BEG_0: Lot rank rates (4 entries)
 * - CPSL_CONFIG_INFO_LIST_BEG_0: Config info (4 entries)
 *
 * Uses streaming JSON loader for files >5MB.
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface CapsuleWeaponColorEntry {
	tableId: string;
	data: Array<{ colorType: number; weight: number }>;
}

export interface CapsulePrizeInfo {
	id: string;
	vars: number[];
}

export interface CapsulePrizeTable {
	id: string;
	vars: number[];
	children: any[];
}

export interface CapsuleLotRankRate {
	vars: number[];
}

export interface CapsuleConfigInfo {
	vars: number[];
}

export interface CapsuleDatabase {
	weaponColorTables: CapsuleWeaponColorEntry[];
	prizes: CapsulePrizeInfo[];
	prizeTables: CapsulePrizeTable[];
	lotRankRates: CapsuleLotRankRate[];
	configs: CapsuleConfigInfo[];
}

// ============================================================================
// Parser
// ============================================================================

function parseIntVar(v: { type: string; value: string }): number {
	return Number.parseInt(v.value, 10);
}

function parseEntries(entries: ConfigNode[]): CapsuleDatabase {
	const weaponColorTables: CapsuleWeaponColorEntry[] = [];
	const prizes: CapsulePrizeInfo[] = [];
	const prizeTables: CapsulePrizeTable[] = [];
	const lotRankRates: CapsuleLotRankRate[] = [];
	const configs: CapsuleConfigInfo[] = [];

	for (const entry of entries) {
		const children = entry.children || [];

		if (entry.name.startsWith("CPSL_LOT_WEAPON_COLOR_TABLE_INFO_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("CPSL_LOT_WEAPON_COLOR_TABLE_INFO_")) continue;
				const tableId =
					child.variables.length > 0 ? toHex(parseIntVar(child.variables[0])) : "0x00000000";

				const data: Array<{ colorType: number; weight: number }> = [];
				for (const dataList of child.children || []) {
					if (!dataList.name.includes("DATA_LIST_BEG")) continue;
					for (const dataChild of dataList.children || []) {
						if (!dataChild.name.includes("DATA_")) continue;
						const vars = dataChild.variables;
						if (vars.length >= 2) {
							data.push({
								colorType: parseIntVar(vars[0]),
								weight: parseIntVar(vars[1]),
							});
						}
					}
				}
				weaponColorTables.push({ tableId, data });
			}
		} else if (entry.name.startsWith("CPSL_PRIZE_INFO_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("CPSL_PRIZE_INFO_")) continue;
				const vars = child.variables.map((v: any) => parseIntVar(v));
				prizes.push({
					id: vars.length > 0 ? toHex(vars[0]) : "0x00000000",
					vars,
				});
			}
		} else if (entry.name.startsWith("CPSL_PRIZE_TABLE_INFO_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("CPSL_PRIZE_TABLE_INFO_")) continue;
				const vars = child.variables.map((v: any) => parseIntVar(v));
				prizeTables.push({
					id: vars.length > 0 ? toHex(vars[0]) : "0x00000000",
					vars,
					children: child.children || [],
				});
			}
		} else if (entry.name.startsWith("CPSL_LOT_RANK_RATE_INFO_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("CPSL_LOT_RANK_RATE_INFO_")) continue;
				lotRankRates.push({
					vars: child.variables.map((v: any) => parseIntVar(v)),
				});
			}
		} else if (entry.name.startsWith("CPSL_CONFIG_INFO_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.match(/^CPSL_CONFIG_INFO_\d/)) continue;
				configs.push({
					vars: child.variables.map((v: any) => parseIntVar(v)),
				});
			}
		}
	}
	return { weaponColorTables, prizes, prizeTables, lotRankRates, configs };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadCapsuleConfigAsync(dataPath: string = DATA_ROOT) {
	const path = join(dataPath, "common/gamedata/capsule", "capsule_config_0.00.00.cfg.bin.json");
	const content = await loadJsonAsync<{ entries: ConfigNode[] }>(path);
	if (!content?.entries) return null;
	return parseEntries(content.entries);
}

export async function buildCapsuleDatabase(dataPath: string = DATA_ROOT): Promise<CapsuleDatabase> {
	const result = await loadCapsuleConfigAsync(dataPath);
	return {
		weaponColorTables: result?.weaponColorTables || [],
		prizes: result?.prizes || [],
		prizeTables: result?.prizeTables || [],
		lotRankRates: result?.lotRankRates || [],
		configs: result?.configs || [],
	};
}
