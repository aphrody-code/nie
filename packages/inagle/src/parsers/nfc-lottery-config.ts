/**
 * @file nfc-lottery-config.ts
 * @description Parser for NFC lottery configuration (72K lines)
 *
 * Data source: nfc/nfc_lottery_config.cfg.bin.json
 *
 * Structure (entries format, 3-level nesting):
 * - NFC_LOTTERY_INFO_LIST_BEG_0 (3 lotteries)
 *   → NFC_LOTTERY_INFO_N (lotteryId)
 *     → NFC_LOTTERY_INFO_TABLE_LIST_BEG_0 (34 tables per lottery)
 *       → NFC_LOTTERY_INFO_TABLE_N (tableId CRC)
 *         → NFC_LOTTERY_INFO_TABLE_ITEM_LIST_BEG_0 (15 items per table)
 *           → NFC_LOTTERY_INFO_TABLE_ITEM_N: [itemId(CRC), type, weight]
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface NfcLotteryItem {
	itemId: string;
	type: number;
	weight: number;
}

export interface NfcLotteryTable {
	tableId: string;
	items: NfcLotteryItem[];
}

export interface NfcLottery {
	lotteryId: number;
	tables: NfcLotteryTable[];
}

export interface NfcLotteryDatabase {
	lotteries: NfcLottery[];
	byLotteryId: Map<number, NfcLottery>;
}

// ============================================================================
// Parser
// ============================================================================

function parseIntVar(v: { type: string; value: string }): number {
	return Number.parseInt(v.value, 10);
}

function parseEntries(entries: ConfigNode[]): NfcLottery[] {
	const lotteries: NfcLottery[] = [];

	for (const entry of entries) {
		if (!entry.name.startsWith("NFC_LOTTERY_INFO_LIST_BEG")) continue;
		const children = entry.children || [];

		for (const lotteryNode of children) {
			if (!lotteryNode.name.match(/^NFC_LOTTERY_INFO_\d+$/)) continue;
			const lotteryId =
				lotteryNode.variables.length > 0 ? parseIntVar(lotteryNode.variables[0]) : 0;

			const tables: NfcLotteryTable[] = [];

			for (const tableListNode of lotteryNode.children || []) {
				if (!tableListNode.name.startsWith("NFC_LOTTERY_INFO_TABLE_LIST_BEG")) continue;

				for (const tableNode of tableListNode.children || []) {
					if (!tableNode.name.match(/^NFC_LOTTERY_INFO_TABLE_\d+$/)) continue;
					const tableId =
						tableNode.variables.length > 0
							? toHex(parseIntVar(tableNode.variables[0]))
							: "0x00000000";

					const items: NfcLotteryItem[] = [];

					for (const itemListNode of tableNode.children || []) {
						if (!itemListNode.name.startsWith("NFC_LOTTERY_INFO_TABLE_ITEM_LIST_BEG")) continue;

						for (const itemNode of itemListNode.children || []) {
							if (!itemNode.name.startsWith("NFC_LOTTERY_INFO_TABLE_ITEM_")) continue;
							const vars = itemNode.variables;
							if (vars.length < 3) continue;

							items.push({
								itemId: toHex(parseIntVar(vars[0])),
								type: parseIntVar(vars[1]),
								weight: parseIntVar(vars[2]),
							});
						}
					}
					tables.push({ tableId, items });
				}
			}
			lotteries.push({ lotteryId, tables });
		}
	}
	return lotteries;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadNfcLotteryConfigAsync(dataPath: string = DATA_ROOT) {
	const path = join(dataPath, "common/gamedata/nfc", "nfc_lottery_config.cfg.bin.json");
	const content = await loadJsonAsync<{ entries: ConfigNode[] }>(path);
	if (!content?.entries) return null;
	return parseEntries(content.entries);
}

export async function buildNfcLotteryDatabase(
	dataPath: string = DATA_ROOT
): Promise<NfcLotteryDatabase> {
	const lotteries = (await loadNfcLotteryConfigAsync(dataPath)) || [];
	const byLotteryId = new Map<number, NfcLottery>();
	for (const l of lotteries) byLotteryId.set(l.lotteryId, l);

	return { lotteries, byLotteryId };
}
