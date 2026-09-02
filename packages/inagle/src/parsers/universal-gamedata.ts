/* eslint-disable no-console */
/**
 * @file universal-gamedata.ts
 * @description Universal parser for any gamedata file in common/gamedata
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";
import { entreesDe } from "../utils/tables.js";

/** Gamedata file info */
export interface GamedataFileInfo {
	/** Category (folder name) */
	category: string;
	/** File name without extension */
	name: string;
	/** Full file path */
	path: string;
	/** File size in bytes */
	size: number;
	/** Number of top-level entries */
	entryCount: number;
	/** Whether it has the simplified .json version */
	hasSimplified: boolean;
}

/** Parsed gamedata entry */
export interface ParsedEntry {
	/** Entry name (e.g., 'SKILL_INFO_0') */
	name: string;
	/** Parsed variables as typed values */
	values: (string | number)[];
	/** Variable types for reference */
	types: string[];
	/** Child entries */
	children: ParsedEntry[];
}

/**
 * Parse a ConfigNode into a simpler structure
 */
function parseConfigNode(node: ConfigNode): ParsedEntry {
	const values: (string | number)[] = [];
	const types: string[] = [];

	for (const v of node.variables) {
		types.push(v.type);
		if (v.type === "Int") {
			values.push(Number.parseInt(v.value, 10));
		} else if (v.type === "Float") {
			values.push(Number.parseFloat(v.value));
		} else {
			values.push(v.value);
		}
	}

	const children: ParsedEntry[] = [];
	if (node.children) {
		for (const child of node.children) {
			children.push(parseConfigNode(child));
		}
	}

	return {
		name: node.name,
		values,
		types,
		children,
	};
}

/**
 * Load a gamedata config file
 */
export function loadGamedataFile(filePath: string): ParsedEntry[] {
	if (!existsSync(filePath)) {
		return [];
	}

	const content = readFileSync(filePath, "utf-8");
	const data = JSON.parse(content) as { entries: ConfigNode[] };

	return data.entries.map(parseConfigNode);
}

/**
 * Discover all gamedata files in a category
 */
export function discoverCategoryFiles(
	category: string,
	dataPath: string = DATA_ROOT
): GamedataFileInfo[] {
	const categoryDir = join(dataPath, "common", "gamedata", category);
	if (!existsSync(categoryDir)) return [];

	const files = readdirSync(categoryDir).filter((f) => f.endsWith(".cfg.bin.json"));
	const results: GamedataFileInfo[] = [];

	for (const file of files) {
		const filePath = join(categoryDir, file);
		const stats = statSync(filePath);
		const name = file.replace(".cfg.bin.json", "");

		// Quick entry count
		const content = readFileSync(filePath, "utf-8");
		const data = JSON.parse(content) as { entries: ConfigNode[] };

		// Check for simplified version
		const simplifiedPath = filePath.replace(".cfg.bin.json", ".json");
		const hasSimplified = existsSync(simplifiedPath);

		results.push({
			category,
			name,
			path: filePath,
			size: stats.size,
			entryCount: data.entries?.length || 0,
			hasSimplified,
		});
	}

	return results;
}

/**
 * Discover all gamedata categories
 */
export function discoverGamedataCategories(dataPath: string = DATA_ROOT): string[] {
	const gamedataDir = join(dataPath, "common", "gamedata");
	if (!existsSync(gamedataDir)) return [];

	return readdirSync(gamedataDir).filter((f) => {
		const stat = statSync(join(gamedataDir, f));
		return stat.isDirectory();
	});
}

/**
 * Discover all gamedata files across all categories
 */
export function discoverAllGamedata(dataPath: string = DATA_ROOT): {
	categories: string[];
	files: GamedataFileInfo[];
	byCategory: Map<string, GamedataFileInfo[]>;
} {
	const categories = discoverGamedataCategories(dataPath);
	const files: GamedataFileInfo[] = [];
	const byCategory = new Map<string, GamedataFileInfo[]>();

	for (const category of categories) {
		const categoryFiles = discoverCategoryFiles(category, dataPath);
		files.push(...categoryFiles);
		byCategory.set(category, categoryFiles);
	}

	return { categories, files, byCategory };
}

/** Loaded gamedata with parsed entries */
export interface LoadedGamedata {
	info: GamedataFileInfo;
	entries: ParsedEntry[];
}

/**
 * Universal gamedata database
 */
export interface UniversalGamedataDatabase {
	/** All categories discovered */
	categories: string[];
	/** All files discovered */
	files: GamedataFileInfo[];
	/** Files by category */
	byCategory: Map<string, GamedataFileInfo[]>;
	/** Loaded data cache */
	cache: Map<string, LoadedGamedata>;
	/** Total files */
	totalFiles: number;
	/** Total entries (estimated from discovery) */
	totalEntries: number;
}

/**
 * Build gamedata discovery database (lazy loading)
 */
export function buildUniversalGamedataDatabase(
	dataPath: string = DATA_ROOT
): UniversalGamedataDatabase {
	console.log("[UniversalGamedata] Discovering gamedata files...");
	const { categories, files, byCategory } = discoverAllGamedata(dataPath);

	console.log(`[UniversalGamedata] Found ${categories.length} categories, ${files.length} files`);

	let totalEntries = 0;
	for (const file of files) {
		totalEntries += file.entryCount;
	}

	return {
		categories,
		files,
		byCategory,
		cache: new Map(),
		totalFiles: files.length,
		totalEntries,
	};
}

/**
 * Load a specific gamedata file from the database
 */
export function loadFromDatabase(
	db: UniversalGamedataDatabase,
	category: string,
	name: string
): LoadedGamedata | undefined {
	const cacheKey = `${category}/${name}`;

	// Check cache first
	if (db.cache.has(cacheKey)) {
		return db.cache.get(cacheKey);
	}

	// Find file info
	const categoryFiles = db.byCategory.get(category);
	if (!categoryFiles) return undefined;

	const info = categoryFiles.find((f) => f.name === name);
	if (!info) return undefined;

	// Load and cache
	const entries = loadGamedataFile(info.path);
	const loaded: LoadedGamedata = { info, entries };
	db.cache.set(cacheKey, loaded);

	return loaded;
}

/**
 * Extract entities from a gamedata file using a pattern
 */
export interface EntityExtractorConfig {
	/** Pattern to match entry names (regex) */
	pattern: RegExp;
	/** Whether to include children entries */
	includeChildren?: boolean;
	/** Field mapping: index -> field name */
	fields: Record<number, string>;
	/** Hash fields (convert to hex) */
	hashFields?: number[];
}

/**
 * Extract entities from parsed entries
 */
export function extractEntities<T extends Record<string, unknown>>(
	entries: ParsedEntry[],
	config: EntityExtractorConfig
): T[] {
	const results: T[] = [];

	function processEntry(entry: ParsedEntry) {
		if (config.pattern.test(entry.name)) {
			const entity: Record<string, unknown> = {};

			for (const [indexStr, fieldName] of entreesDe(config.fields)) {
				const index = Number.parseInt(indexStr, 10);
				let value = entry.values[index];

				// Convert hash fields
				if (config.hashFields?.includes(index) && typeof value === "number") {
					value = toHex(value);
				}

				entity[fieldName] = value;
			}

			results.push(entity as T);
		}

		// Process children if configured
		if (config.includeChildren && entry.children) {
			for (const child of entry.children) {
				processEntry(child);
			}
		}
	}

	for (const entry of entries) {
		processEntry(entry);
		// Also process top-level children
		if (entry.children) {
			for (const child of entry.children) {
				processEntry(child);
			}
		}
	}

	return results;
}

/**
 * Create universal gamedata API
 */
export function createUniversalGamedataAPI(dataPath: string = DATA_ROOT) {
	const db = buildUniversalGamedataDatabase(dataPath);

	return {
		/** Database metadata */
		meta: {
			categories: db.categories.length,
			totalFiles: db.totalFiles,
			totalEntries: db.totalEntries,
		},

		/** Get all categories */
		categories: () => db.categories,

		/** Get files in a category */
		filesIn: (category: string) => db.byCategory.get(category) || [],

		/** Get all file info */
		allFiles: () => db.files,

		/** Load a specific file */
		load: (category: string, name: string) => loadFromDatabase(db, category, name),

		/** Load by full name pattern */
		loadByPattern: (category: string, pattern: RegExp) => {
			const files = db.byCategory.get(category) || [];
			for (const file of files) {
				if (pattern.test(file.name)) {
					return loadFromDatabase(db, category, file.name);
				}
			}
			return undefined;
		},

		/** Extract entities with a config */
		extractEntities: <T extends Record<string, unknown>>(
			category: string,
			name: string,
			config: EntityExtractorConfig
		): T[] => {
			const loaded = loadFromDatabase(db, category, name);
			if (!loaded) return [];
			return extractEntities<T>(loaded.entries, config);
		},

		/** Find files by name pattern */
		findFiles: (pattern: RegExp) => db.files.filter((f) => pattern.test(f.name)),

		/** Get category summary */
		categorySummary: () =>
			db.categories.map((cat) => ({
				name: cat,
				files: db.byCategory.get(cat)?.length || 0,
				entries: db.byCategory.get(cat)?.reduce((sum, f) => sum + f.entryCount, 0) || 0,
			})),

		/** Raw database access */
		database: db,
	};
}

export type UniversalGamedataAPI = ReturnType<typeof createUniversalGamedataAPI>;
