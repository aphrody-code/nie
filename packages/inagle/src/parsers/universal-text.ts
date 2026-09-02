/* eslint-disable no-console */
/**
 * @file universal-text.ts
 * @description Universal text parser that can load ANY text file type
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { type Locale, sanitizeText, toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

/** Supported locales */
export const ALL_LOCALES: Locale[] = [
	"ja",
	"en",
	"fr",
	"de",
	"es",
	"it",
	"pt",
	"zh_hans",
	"zh_hant",
];

/** Text file info */
export interface TextFileInfo {
	/** File type name without extension (e.g., 'skill_text') */
	type: string;
	/** Short key (e.g., 'skill') */
	key: string;
	/** Available locales */
	locales: Locale[];
	/** Entry count per locale */
	entryCounts: Partial<Record<Locale, number>>;
}

/**
 * Parse TEXT_INFO node to extract hashId and text
 */
function parseTextInfoNode(node: ConfigNode): { hashId: string; text: string } | null {
	const vars = node.variables;
	if (vars.length < 3) return null;

	const hashVar = vars[0];
	const textVar = vars[2];

	if (hashVar.type !== "Int" || textVar.type !== "String") return null;

	const hashId = toHex(Number.parseInt(hashVar.value, 10));
	const text = sanitizeText(textVar.value);

	if (!text) return null;

	return { hashId, text };
}

/**
 * Parse NOUN_INFO node to extract hashId and text
 */
function parseNounInfoNode(node: ConfigNode): { hashId: string; text: string } | null {
	const vars = node.variables;
	// We expect at least 6 variables. Index 5 is the text.
	if (vars.length < 6) return null;

	const hashVar = vars[0];
	const textVar = vars[5];

	if (hashVar.type !== "Int" || textVar.type !== "String") return null;

	const hashId = toHex(Number.parseInt(hashVar.value, 10));
	const text = sanitizeText(textVar.value);

	if (!text) return null;

	return { hashId, text };
}

/**
 * Load a text file and return hash->text map
 */
export function loadTextFileRaw(filePath: string): Map<string, string> {
	if (!existsSync(filePath)) {
		return new Map();
	}

	const content = readFileSync(filePath, "utf-8");
	const data = JSON.parse(content) as { entries: ConfigNode[] };
	const texts = new Map<string, string>();

	for (const entry of data.entries) {
		if (entry.name.startsWith("TEXT_INFO_BEGIN") && entry.children) {
			for (const child of entry.children) {
				if (child.name.startsWith("TEXT_INFO_")) {
					const parsed = parseTextInfoNode(child);
					if (parsed) {
						texts.set(parsed.hashId, parsed.text);
					}
				}
			}
		}
		if (entry.name.startsWith("NOUN_INFO_BEGIN") && entry.children) {
			for (const child of entry.children) {
				if (child.name.startsWith("NOUN_INFO_")) {
					const parsed = parseNounInfoNode(child);
					if (parsed) {
						texts.set(parsed.hashId, parsed.text);
					}
				}
			}
		}
	}

	return texts;
}

/**
 * Discover all text files in the text directory
 */
export function discoverTextFiles(dataPath: string = DATA_ROOT): TextFileInfo[] {
	const textDir = join(dataPath, "common", "text");
	const results: TextFileInfo[] = [];

	// Use 'en' as reference to discover all text file types
	const enDir = join(textDir, "en");
	if (!existsSync(enDir)) return results;

	const files = readdirSync(enDir).filter((f) => f.endsWith(".cfg.bin.json"));

	for (const file of files) {
		const type = file.replace(".cfg.bin.json", "");
		const key = type.replace("_text", "").replace("_roma", "_romanized");

		const info: TextFileInfo = {
			type,
			key,
			locales: [],
			entryCounts: {},
		};

		// Check which locales have this file
		for (const locale of ALL_LOCALES) {
			const localePath = join(textDir, locale, file);
			if (existsSync(localePath)) {
				info.locales.push(locale);
				// Count entries (quick scan)
				const content = readFileSync(localePath, "utf-8");
				const matches = content.match(/"TEXT_INFO_\d+"/g);
				info.entryCounts[locale] = matches?.length || 0;
			}
		}

		results.push(info);
	}

	return results.sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Universal text map for a single type
 */
export interface UniversalTextMap {
	type: string;
	key: string;
	maps: Map<Locale, Map<string, string>>;
	totalEntries: number;
}

/**
 * Load all locales for a specific text type
 */
export function loadUniversalText(type: string, dataPath: string = DATA_ROOT): UniversalTextMap {
	const textDir = join(dataPath, "common", "text");
	const filename = `${type}.cfg.bin.json`;
	const key = type.replace("_text", "").replace("_roma", "_romanized");

	const maps = new Map<Locale, Map<string, string>>();
	let totalEntries = 0;

	for (const locale of ALL_LOCALES) {
		const filePath = join(textDir, locale, filename);
		const map = loadTextFileRaw(filePath);
		if (map.size > 0) {
			maps.set(locale, map);
			if (locale === "en" || (totalEntries === 0 && locale === "ja")) {
				totalEntries = map.size;
			}
		}
	}

	return { type, key, maps, totalEntries };
}

/**
 * Complete text database with all discovered files
 */
export interface UniversalTextDatabase {
	/** All text types discovered */
	types: TextFileInfo[];
	/** Loaded text maps by key */
	texts: Map<string, UniversalTextMap>;
	/** Total files loaded */
	totalFiles: number;
	/** Total entries across all files */
	totalEntries: number;
}

/**
 * Build complete text database from all available text files
 */
export function buildUniversalTextDatabase(
	dataPath: string = DATA_ROOT,
	options?: {
		/** Only load specific types (by key) */
		include?: string[];
		/** Exclude specific types (by key) */
		exclude?: string[];
	}
): UniversalTextDatabase {
	console.log("[UniversalText] Discovering text files...");
	const types = discoverTextFiles(dataPath);
	console.log(`[UniversalText] Found ${types.length} text file types`);

	const texts = new Map<string, UniversalTextMap>();
	let totalEntries = 0;

	for (const info of types) {
		// Apply filters
		if (options?.include && !options.include.includes(info.key)) continue;
		if (options?.exclude?.includes(info.key)) continue;

		const textMap = loadUniversalText(info.type, dataPath);
		texts.set(info.key, textMap);
		totalEntries += textMap.totalEntries;

		console.log(`  - ${info.key}: ${textMap.totalEntries} entries (${textMap.maps.size} locales)`);
	}

	return {
		types,
		texts,
		totalFiles: texts.size,
		totalEntries,
	};
}

/**
 * Get localized text from the database
 */
export function getTextFromDatabase(
	db: UniversalTextDatabase,
	textType: string,
	hashId: string
): { en?: string; fr?: string; ja?: string } | undefined {
	const textMap = db.texts.get(textType);
	if (!textMap) return undefined;

	return {
		en: textMap.maps.get("en")?.get(hashId),
		fr: textMap.maps.get("fr")?.get(hashId),
		ja: textMap.maps.get("ja")?.get(hashId),
	};
}

/**
 * Create a text API for easy access
 */
export function createUniversalTextAPI(dataPath: string = DATA_ROOT) {
	const db = buildUniversalTextDatabase(dataPath);

	return {
		/** Database metadata */
		meta: {
			totalFiles: db.totalFiles,
			totalEntries: db.totalEntries,
			types: db.types.map((t) => ({
				key: t.key,
				locales: t.locales.length,
				entries: t.entryCounts.en || t.entryCounts.ja || 0,
			})),
		},

		/** Get all available text types */
		types: () => db.types,

		/** Get text map for a specific type */
		getMap: (key: string) => db.texts.get(key),

		/** Get localized text */
		getText: (textType: string, hashId: string) => getTextFromDatabase(db, textType, hashId),

		/** Search across all texts */
		search: (query: string, options?: { lang?: Locale; limit?: number }) => {
			const q = query.toLowerCase();
			const lang = options?.lang || "en";
			const limit = options?.limit || 50;
			const results: Array<{ type: string; hashId: string; text: string }> = [];

			for (const [key, textMap] of db.texts) {
				const localeMap = textMap.maps.get(lang);
				if (!localeMap) continue;

				for (const [hashId, text] of localeMap) {
					if (text.toLowerCase().includes(q)) {
						results.push({ type: key, hashId, text });
						if (results.length >= limit) break;
					}
				}
				if (results.length >= limit) break;
			}

			return results;
		},

		/** Raw database access */
		database: db,
	};
}

export type UniversalTextAPI = ReturnType<typeof createUniversalTextAPI>;
