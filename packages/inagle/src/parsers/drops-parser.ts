import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

export interface DropEntry {
	itemId: string;
	rate: number;
	count: number;
}

export interface DropTable {
	tableId: string;
	entries: DropEntry[];
}

interface ConfigFile {
	entries: ConfigNode[];
}

function parseDropTable(node: ConfigNode): DropEntry | null {
	// ITBL_ITEMS_0 structure:
	// [0]: Item Hash (Int)
	// [1]: Rate/Weight (Int)
	// [2]: Count? (Int)
	const vars = node.variables;
	if (vars.length < 3) return null;

	const itemIdInt = parseInt(vars[0].value, 10);
	const itemId = toHex(itemIdInt);
	const rate = parseInt(vars[1].value, 10);
	const count = parseInt(vars[2].value, 10);

	return { itemId, rate, count };
}

export function loadDropTablesFromConfig(
	filename: string,
	category: string = "item"
): Map<string, DropEntry[]> {
	const map = new Map<string, DropEntry[]>();
	const filePath = join(DATA_ROOT, "common", "gamedata", category, filename);

	if (!existsSync(filePath)) {
		console.warn(`[DropsParser] Config file not found: ${filePath}`);
		return map;
	}

	try {
		const content: ConfigFile = JSON.parse(readFileSync(filePath, "utf-8"));

		// Traverse to find lists
		// Note: The structure is flattened in the JSON representation usually
		// We look for nodes like ITBL_ITEMS_LIST_BEG_0 -> ITBL_ITEMS_0
		// Or sometimes they are grouped under a parent ID node.

		// In the sample read:
		// ITBL_ITEMS_LIST_BEG_0 (value 113)
		//   - ITBL_ITEMS_0
		//   - ITBL_ITEMS_1

		// This suggests one big list or multiple lists.
		// Usually there is a table definition that points to these ranges.

		// Let's assume for now we just want to extract all "ITBL_ITEMS_*" entries
		// But we need to group them by table ID.
		// If the file structure doesn't explicitly group them by TableID in the JSON tree,
		// we might be missing the "Header" list that defines: TableID -> [StartIndex, Count].

		// Let's look for "ITBL_INFO_LIST_BEG" or similar which usually defines the tables.

		const _tables = new Map<string, DropEntry[]>();

		// First pass: Collect all drop items into a flat array
		const allDropItems: DropEntry[] = [];

		function collectItems(nodes: ConfigNode[]) {
			for (const node of nodes) {
				if (node.name.startsWith("ITBL_ITEMS_") && !node.name.includes("LIST")) {
					const entry = parseDropTable(node);
					if (entry) allDropItems.push(entry);
				}
				if (node.children) collectItems(node.children);
			}
		}
		collectItems(content.entries);

		// Second pass: Look for Table Definitions to slice the array
		// Expected name: ITBL_INFO_*
		// [0]: Table ID (Int)
		// [1]: Start Index (Int)
		// [2]: Count (Int)

		function mapTables(nodes: ConfigNode[]) {
			for (const node of nodes) {
				if (node.name.startsWith("ITBL_INFO_") && !node.name.includes("LIST")) {
					const vars = node.variables;
					if (vars.length >= 3) {
						const tableIdInt = parseInt(vars[0].value, 10);
						const tableId = toHex(tableIdInt);
						const startIndex = parseInt(vars[1].value, 10);
						const count = parseInt(vars[2].value, 10);

						const entries = allDropItems.slice(startIndex, startIndex + count);
						map.set(tableId, entries);
					}
				}
				if (node.children) mapTables(node.children);
			}
		}
		mapTables(content.entries);

		return map;
	} catch (e) {
		console.error(`[DropsParser] Failed to parse ${filename}`, e);
	}

	return map;
}

export interface BattleDropConfig {
	rarityId: string;
	itemTableId: string; // Using 'normal' for now
}

export function loadBattleDropsFromConfig(
	filename: string
): Map<number, { battleGroupId: number; itemTableId: string }> {
	const map = new Map<number, { battleGroupId: number; itemTableId: string }>();
	const filePath = join(DATA_ROOT, "common", "gamedata", "soccer", filename);

	if (!existsSync(filePath)) {
		console.warn(`[DropsParser] Config file not found: ${filePath}`);
		return map;
	}

	try {
		const content = JSON.parse(readFileSync(filePath, "utf-8"));

		// Find m_rarityDecideTableList
		// Structure:
		// lists: [{ name: "m_rarityDecideTableList", values: [{ rairtyId: "...", normal: "...", ... }] }]

		if (content.lists) {
			for (const list of content.lists) {
				if (list.name === "m_rarityDecideTableList") {
					for (const val of list.values) {
						// We map RarityID (which we might use as BattleGroupID proxy if we lack the link) to ItemTableID
						// Realistically, BattleGroupID -> RarityID link is elsewhere.
						// But for "entries", let's expose these as potential drop sources.
						// Since we need number keys for the map, and these are strings, we check if they convert.
						const rarityIdInt = parseInt(val.rairtyId, 16);

						// We'll treat rarityId as the key.
						map.set(rarityIdInt, {
							battleGroupId: rarityIdInt,
							itemTableId: val.normal, // Default to normal drops
						});
					}
				}
			}
		}
	} catch (e) {
		console.error(`[DropsParser] Failed to parse ${filename}`, e);
	}

	return map;
}
