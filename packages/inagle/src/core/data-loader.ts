/**
 * @file data-loader.ts
 * @description Central data loader for all game data sources
 *
 * This module provides unified access to:
 * - Raw config files (cfg.bin.json)
 * - Pre-processed JSON files (all-gamedata/)
 * - Text localization files
 * - Lua script data
 *
 * I/O 100% Bun-native depuis 1.2.0 (Bun.file, Bun.Glob.scanSync, bun:sqlite).
 * `findConfigFile` / `loadConfig*` essaient d'abord la DB cfgbin.sqlite (opt-in
 * via iecode toolkit), avec fallback complet sur les `.cfg.bin.json` du
 * filesystem si la DB n'est pas presente. Comportement inchange pour azalee.
 */

import { basename, dirname, join } from "node:path";
import {
	cfgbinDbAvailable,
	cfgbinDbFindLatest,
	cfgbinDbLoad,
	cfgbinDbLoadText,
} from "./cfgbin-db.js";
import type { ConfigFile, ConfigNode } from "./config-parser.js";
import { DATA_ROOT, FILES, PATHS } from "./paths.js";

/**
 * Supported locales for text files
 */
export const LOCALES = ["ja", "en", "fr", "de", "es", "it", "pt", "zh_hans", "zh_hant"] as const;
export type Locale = (typeof LOCALES)[number];

/**
 * Cache for loaded data files
 */
const dataCache = new Map<string, unknown>();
const asyncDataCache = new Map<string, Promise<unknown>>();

/**
 * Clear the data cache
 */
export function clearCache(): void {
	dataCache.clear();
	asyncDataCache.clear();
}

/**
 * Get the root data path
 */
export function getDataPath(): string {
	return DATA_ROOT;
}

/**
 * Read and parse a JSON file with caching (Synchronous - Deprecated)
 * @deprecated Use loadJSONAsync instead. Bun n'a pas de Bun.file sync, on
 * route via require() qui supporte JSON nativement et reste sync.
 */
export function loadJSON<T>(filePath: string): T {
	if (dataCache.has(filePath)) {
		return dataCache.get(filePath) as T;
	}

	try {
		// eslint-disable-next-line @typescript-eslint/no-require-imports, no-undef
		const data = require(filePath) as T;
		dataCache.set(filePath, data);
		return data;
	} catch {
		return { data: [], _meta: { count: 0 } } as unknown as T;
	}
}

/**
 * Read and parse a JSON file with caching (Asynchronous)
 */
export async function loadJSONAsync<T>(filePath: string): Promise<T> {
	if (asyncDataCache.has(filePath)) {
		return asyncDataCache.get(filePath) as Promise<T>;
	}

	// Deduplicating promise — prevents concurrent loads of the same path.
	const loadPromise = (async () => {
		const f = Bun.file(filePath);
		if (!(await f.exists())) {
			return { data: [], _meta: { count: 0 } } as unknown as T;
		}
		try {
			return (await f.json()) as T;
		} catch (error) {
			console.error(`Failed to load JSON file async: ${filePath}`, error);
			throw new Error(`Failed to parse ${filePath}: ${error}`);
		}
	})();

	asyncDataCache.set(filePath, loadPromise);
	return loadPromise;
}

/**
 * Find a config file in a category directory matching a prefix.
 * Tries SQLite cfgbin DB first (~/data/cache/cfgbin.sqlite), falls back to
 * scanning the filesystem at {DATA_ROOT}/common/gamedata/{category}/.
 */
export function findConfigFile(category: string, prefix: string): string | null {
	// 1. cfgbin SQLite DB (opt-in)
	if (cfgbinDbAvailable()) {
		const fromDb = cfgbinDbFindLatest(category, prefix);
		if (fromDb) return fromDb;
	}

	// 2. Filesystem fallback (loose .cfg.bin.json files)
	const dir = join(PATHS.gamedata, category);
	try {
		const found = [
			...new Bun.Glob(`${prefix}*.cfg.bin.json`).scanSync({
				cwd: dir,
				onlyFiles: true,
			}),
		]
			.sort()
			.pop();
		return found ?? null;
	} catch {
		return null;
	}
}

/**
 * Load a raw config file from common/gamedata (Async).
 * Tries cfgbin SQLite DB first, falls back to filesystem.
 */
export async function loadConfigAsync(category: string, filename: string): Promise<ConfigFile> {
	if (cfgbinDbAvailable()) {
		try {
			const raw = cfgbinDbLoad(category, filename) as {
				entries?: ConfigNode[];
			};
			return {
				name: filename,
				variables: [],
				children: raw.entries || [],
			};
		} catch {
			// Fallback to filesystem on miss
		}
	}

	const filePath = join(PATHS.gamedata, category, filename);
	const raw = await loadJSONAsync<{ entries: ConfigNode[] }>(filePath);

	return {
		name: filename,
		variables: [],
		children: raw.entries || [],
	};
}

/**
 * Load a pre-processed JSON file from all-gamedata (Async)
 */
export async function loadGamedataAsync<T>(filename: string): Promise<T> {
	const filePath = join(PATHS.allGamedata, filename);
	return loadJSONAsync<T>(filePath);
}

/**
 * Legacy Sync Loaders (kept for transitional compatibility).
 * Tries cfgbin SQLite DB first, falls back to filesystem.
 */
export function loadConfig(category: string, filename: string): ConfigFile {
	if (cfgbinDbAvailable()) {
		try {
			const raw = cfgbinDbLoad(category, filename) as {
				entries?: ConfigNode[];
			};
			return { name: filename, variables: [], children: raw.entries || [] };
		} catch {
			// Fallback to filesystem
		}
	}
	const filePath = join(PATHS.gamedata, category, filename);
	const raw = loadJSON<{ entries: ConfigNode[] }>(filePath);
	return { name: filename, variables: [], children: raw.entries || [] };
}

export function loadGamedata<T>(filename: string): T {
	const filePath = join(PATHS.allGamedata, filename);
	return loadJSON<T>(filePath);
}

/**
 * Load character param config
 */
export function loadCharaParam(): ConfigFile {
	const filename = findConfigFile("character", "chara_param_1") || FILES.charaParam;
	return loadConfig("character", filename);
}

/**
 * Load character base config
 */
export function loadCharaBase(): ConfigFile {
	const filename = findConfigFile("character", "chara_base_1") || FILES.charaBase;
	return loadConfig("character", filename);
}

/**
 * Load character details config
 */
export function loadCharaDetailsConfig(): ConfigFile {
	const filename = findConfigFile("character", "chara_details_config_0") || FILES.charaDetails;
	return loadConfig("character", filename);
}

/**
 * Load skill config (prefers highest version: v5 DLC Orion > v4 > v3 > v2 > v1)
 */
export function loadSkillConfig(): ConfigFile {
	const filename =
		findConfigFile("skill", "skill_config_5") ||
		findConfigFile("skill", "skill_config_4") ||
		findConfigFile("skill", "skill_config_3") ||
		findConfigFile("skill", "skill_config_2") ||
		findConfigFile("skill", "skill_config_1") ||
		FILES.skillBase;
	return loadConfig("skill", filename);
}

/**
 * Load team config
 */
export function loadTeamConfig(): ConfigFile {
	const filename = findConfigFile("team", "team_config") || FILES.teamConfig;
	return loadConfig("team", filename);
}

/**
 * Load character text for a specific locale.
 * Tries cfgbin SQLite DB first (gated par IEVR_CFGBIN_DB_TEXT), fallback FS.
 */
export function loadCharaText(locale: Locale): ConfigFile {
	if (cfgbinDbAvailable()) {
		try {
			const raw = cfgbinDbLoadText(locale, FILES.charaText) as {
				entries?: ConfigNode[];
			};
			return {
				name: `chara_text_${locale}`,
				variables: [],
				children: raw.entries || [],
			};
		} catch {
			// Fallback to filesystem
		}
	}
	const filePath = join(PATHS.textRoot, locale, FILES.charaText);
	const raw = loadJSON<{ entries?: ConfigNode[] }>(filePath);
	return {
		name: `chara_text_${locale}`,
		variables: [],
		children: raw.entries || [],
	};
}

/**
 * Load character romanized names for a locale.
 * Tries cfgbin SQLite DB first (gated par IEVR_CFGBIN_DB_TEXT), fallback FS.
 */
export function loadCharaTextRoma(locale: Locale): ConfigFile {
	if (cfgbinDbAvailable()) {
		try {
			const raw = cfgbinDbLoadText(locale, FILES.charaTextRoma) as {
				entries?: ConfigNode[];
			};
			return {
				name: `chara_text_roma_${locale}`,
				variables: [],
				children: raw.entries || [],
			};
		} catch {
			// Fallback to filesystem
		}
	}
	const filePath = join(PATHS.textRoot, locale, FILES.charaTextRoma);
	const raw = loadJSON<{ entries?: ConfigNode[] }>(filePath);
	return {
		name: `chara_text_roma_${locale}`,
		variables: [],
		children: raw.entries || [],
	};
}

// ============================================================================
// Pre-processed data loaders
// ============================================================================

/**
 * Growth table entry from all-gamedata
 */
export interface GrowthTableEntry {
	mainPosition: number;
	growthPattern: number;
	charaRank: number;
	Kc_50: number;
	Cr_50: number;
	Tc_50: number;
	Pr_50: number;
	Ps_50: number;
	Ag_50: number;
	It_50: number;
	Kc_99: number;
	Cr_99: number;
	Tc_99: number;
	Pr_99: number;
	Ps_99: number;
	Ag_99: number;
	It_99: number;
}

interface GrowthTableFile {
	_meta: { count: number };
	data: GrowthTableEntry[];
}

/**
 * Load main growth table
 */
export function loadGrowthTableMain(): GrowthTableEntry[] {
	const file = loadGamedata<{ main: GrowthTableEntry[] }>("growth_tables.json");
	return file.main || [];
}

/**
 * Star sign character info
 */
export interface StarSignCharaInfo {
	charaParamId: string;
	charaRarity: number;
	charaRateDefault: number;
	charaRateBoostA: number;
	charaRateBoostB: number;
	charaRateBoostC: number;
	charaRateBoostD: number;
	isRemarkable: boolean;
	enableCond: string;
}

interface StarSignFile {
	_meta: { count: number };
	data: StarSignCharaInfo[];
}

/**
 * Load star sign character info (Players Universe)
 */
export function loadStarSignCharaInfo(): StarSignCharaInfo[] {
	const file = loadGamedata<StarSignFile>("starSignCharaInfo.json");
	return file.data;
}

/**
 * Character series info
 */
export interface CharaSeriesInfo {
	charaSeriesId: string;
	charaSeriesType: number;
	charaSeriesNameTextId: string;
}

interface CharaSeriesFile {
	_meta: { count: number };
	data: CharaSeriesInfo[];
}

/**
 * Load character series info
 */
export function loadCharaSeriesInfo(): CharaSeriesInfo[] {
	const file = loadGamedata<CharaSeriesFile>("charaSeriesInfo.json");
	return file.data;
}

/**
 * Character details
 */
export interface CharaDetails {
	chara_id: string;
	personality_type: number;
	first_person: string;
	second_person_male: string;
	second_person_female: string;
}

interface CharaDetailsFile {
	_meta: { count: number };
	data: CharaDetails[];
}

/**
 * Load character details
 */
export function loadCharaDetails(): CharaDetails[] {
	const file = loadGamedata<CharaDetailsFile>("charaDetails.json");
	return file.data;
}

/**
 * Load Zukan hash mapping (sync — utilise loadJSON qui supporte sync via require()).
 */
export function loadZukanMapping(): Record<string, { hash: string; order: number }> {
	const filePath = join(DATA_ROOT, "zukan/zukan_mapping.json");
	try {
		return loadJSON<Record<string, { hash: string; order: number }>>(filePath);
	} catch {
		return {};
	}
}

/**
 * Load Zukan order list (sync)
 */
export function loadZukanOrder(): Array<{ order: number; name: string; zukanHash: string | null }> {
	const filePath = join(DATA_ROOT, "zukan/zukan_order_en.json");
	try {
		return loadJSON<Array<{ order: number; name: string; zukanHash: string | null }>>(filePath);
	} catch {
		return [];
	}
}

/**
 * Load Zukan hash mapping (async, Bun-native).
 */
export async function loadZukanMappingAsync(): Promise<
	Record<string, { hash: string; order: number }>
> {
	const filePath = join(DATA_ROOT, "zukan/zukan_mapping.json");
	const f = Bun.file(filePath);
	if (!(await f.exists())) return {};
	try {
		return (await f.json()) as Record<string, { hash: string; order: number }>;
	} catch (_e) {
		console.warn("Failed to load zukan mapping", _e);
		return {};
	}
}

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Convert signed 32-bit int to hex string
 */
export function toHex(value: number): string {
	if (value < 0) {
		// Convert negative to unsigned 32-bit
		return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
	}
	return `0x${value.toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Parse hex string to signed 32-bit int
 */
export function fromHex(hex: string): number {
	const unsigned = Number.parseInt(hex.replace("0x", ""), 16);
	// Convert to signed 32-bit if needed
	return unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
}

/**
 * List all JSON files in a directory (sync, uses Bun.Glob.scanSync).
 */
export function listJsonFiles(dir: string): string[] {
	try {
		return [...new Bun.Glob("*.json").scanSync({ cwd: dir, onlyFiles: true })].sort();
	} catch {
		return [];
	}
}

/**
 * Check if a data path exists (async — prefer this over the sync variant).
 */
export async function dataExistsAsync(path: string): Promise<boolean> {
	return Bun.file(path).exists();
}

/**
 * Check if a data path exists (sync shim — kept for call sites that cannot be async).
 * @deprecated Prefer dataExistsAsync().
 */
export function dataExists(path: string): boolean {
	// Bun n'a pas de sync exists API. Glob.scanSync sert de stat shim O(1) sur FS hot.
	try {
		const found = new Bun.Glob(basename(path)).scanSync({
			cwd: dirname(path),
			onlyFiles: false,
		});
		return !found.next().done;
	} catch {
		return false;
	}
}

/**
 * Sanitize text from game data files
 *
 * Cleans up escape sequences and special characters:
 * - \\n -> newline
 * - \\r -> removed
 * - \\t -> tab
 * - \\" -> "
 * - \\' -> '
 * - Trims whitespace
 * - Normalizes multiple spaces
 * - Removes control characters
 */
export function sanitizeText(text: string): string {
	if (!text) return "";

	return (
		text
			// Remove furigana: [Kanji/Reading] -> Kanji
			.replace(/\[([^/]+)\/[^\]]+\]/g, "$1")
			// Handle game tags
			// 1. Extract value from tags like <FLA:SAKAMAKI>, <FUL:DAISUKE>, <VAL:10> -> SAKAMAKI / DAISUKE / 10
			// We keep the value after the colon for all tags except COL (color)
			.replace(/<(?!COL:)[^:>]+:([^>]+)>/g, "$1")
			// 2. Remove any remaining tags like <COL:FFAA00>, <CLO>, <TX0>, etc.
			.replace(/<[^>]+>/g, "")
			// Handle escape sequences
			.replace(/\\n/g, "\n")
			.replace(/\\r/g, "")
			.replace(/\\t/g, "\t")
			.replace(/\\"/g, '"')
			.replace(/\\'/g, "'")
			// Remove control characters (except newline and tab)
			// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control char removal
			.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
			// Normalize multiple spaces (but preserve newlines)
			.replace(/[ ]+/g, " ")
			// Normalize multiple newlines
			.replace(/\n{3,}/g, "\n\n")
			// Trim each line
			.split("\n")
			.map((line) => line.trim())
			.join("\n")
			// Final trim
			.trim()
	);
}

/**
 * Get available locales for text files (sync, uses Bun.Glob.scanSync).
 */
export function getAvailableLocales(): Locale[] {
	try {
		const entries = [...new Bun.Glob("*").scanSync({ cwd: PATHS.textRoot, onlyFiles: false })];
		return entries.filter((d) => LOCALES.includes(d as Locale)) as Locale[];
	} catch {
		return [];
	}
}
