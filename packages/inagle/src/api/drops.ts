import { PATHS } from "../core/paths.js";
import { type BattleDropInfo, loadBattleDrops } from "../data/drops/battles.js";
import { type DropEntry, loadItemDropTables } from "../data/drops/tables.js";
import { loadTreasureDrops, type TreasureDrop } from "../data/drops/treasures.js";

const DEFAULT_DATA_PATH = PATHS.root;

export type { TreasureDrop };

export interface DropSource {
	type: "battle" | "treasure" | "quest";
	id: string; // Battle Group ID, Treasure ID, etc.
	condition?: string; // e.g. 'S Rank', 'Win'
	probability?: number; // If known from the source context
	mapId?: string; // For treasures
	pos?: [number, number, number, number]; // For treasures
}

export interface DropsDatabase {
	tables: Map<string, DropEntry[]>;
	battles: Map<number, BattleDropInfo>;
	treasures: TreasureDrop[];

	// Reverse Indexes
	itemToTables: Map<number | string, string[]>; // ItemID (number or hex string) -> List of TableIDs containing it
	tableToBattles: Map<string, number[]>; // TableID -> List of BattleGroupIDs using it
}

let _db: DropsDatabase | null = null;

function buildDatabase(dataPath: string): DropsDatabase {
	try {
		const tables = loadItemDropTables(dataPath);
		const battles = loadBattleDrops(dataPath);
		const treasures = loadTreasureDrops(dataPath);

		// Build Reverse Indexes for fast lookup
		const itemToTables = new Map<number | string, string[]>();
		const tableToBattles = new Map<string, number[]>();

		// Index: Item -> Tables
		for (const [tableId, entries] of tables.entries()) {
			for (const entry of entries) {
				if (!itemToTables.has(entry.itemId)) {
					itemToTables.set(entry.itemId, []);
				}
				// Avoid duplicates
				if (!itemToTables.get(entry.itemId)?.includes(tableId)) {
					itemToTables.get(entry.itemId)?.push(tableId);
				}
			}
		}

		// Index: Table -> Battles
		for (const [battleGroupId, info] of battles.entries()) {
			const tableId = info.itemTableId;
			if (!tableToBattles.has(tableId)) {
				tableToBattles.set(tableId, []);
			}
			if (!tableToBattles.get(tableId)?.includes(battleGroupId)) {
				tableToBattles.get(tableId)?.push(battleGroupId);
			}
		}

		return {
			tables,
			battles,
			treasures,
			itemToTables,
			tableToBattles,
		};
	} catch (error) {
		console.warn("[DropsAPI] Failed to build database, returning empty.", error);
		return {
			tables: new Map(),
			battles: new Map(),
			treasures: [],
			itemToTables: new Map(),
			tableToBattles: new Map(),
		};
	}
}

export function createDropsAPI(dataPath?: string) {
	const path = dataPath || DEFAULT_DATA_PATH;

	if (!_db) {
		_db = buildDatabase(path);
	}
	const db = _db;

	return {
		/**
		 * Get the drop table content by ID
		 */
		getTable: (tableId: string): DropEntry[] => {
			return db.tables.get(tableId) || [];
		},

		/**
		 * Find all sources that drop a specific item
		 */
		getSources: (itemId: string | number): DropSource[] => {
			const sources: DropSource[] = [];
			const itemIdNum = typeof itemId === "string" ? Number.parseInt(itemId, 16) : itemId;
			const itemIdStr =
				typeof itemId === "number" ? `0x${itemId.toString(16).toUpperCase()}` : itemId;

			// 1. Check Treasures (Direct Item ID)
			for (const treasure of db.treasures) {
				for (const item of treasure.items) {
					if (item.itemId === itemIdStr) {
						sources.push({
							type: "treasure",
							id: "treasure", // Generic ID, use mapId/pos for specifics
							mapId: treasure.mapId,
							pos: treasure.pos,
							probability: 100, // Treasures are guaranteed
						});
					}
				}
			}

			// 2. Check Tables (Battles)
			// Try lookup by string (preferred for hex) or number
			let tableIds = db.itemToTables.get(itemIdStr) || [];
			if (tableIds.length === 0 && !Number.isNaN(itemIdNum)) {
				tableIds = db.itemToTables.get(itemIdNum) || [];
			}

			for (const tableId of tableIds) {
				// Check Battles using this table
				const battleGroupIds = db.tableToBattles.get(tableId) || [];
				for (const groupId of battleGroupIds) {
					sources.push({
						type: "battle",
						id: `0x${groupId.toString(16).toUpperCase()}`,
					});
				}
			}

			return sources;
		},

		/**
		 * Get all potential drops for a specific Battle Group
		 */
		getBattleDrops: (battleGroupId: number): { items: DropEntry[] }[] => {
			const results: { items: DropEntry[] }[] = [];
			const info = db.battles.get(battleGroupId);

			if (info) {
				const items = db.tables.get(info.itemTableId) || [];
				results.push({
					items,
				});
			}
			return results;
		},

		// Expose all data for seeding/migration
		getAllTables: () => db.tables,
		getAllBattles: () => db.battles,
		getAllTreasures: () => db.treasures,
	};
}
