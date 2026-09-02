/**
 * @file chara-text.ts
 * @description Parser for character text localization files
 *
 * Parses chara_text.cfg.bin.json files to extract:
 * - Character names in all languages
 * - Maps hash IDs to localized strings
 */

import type { ConfigNode } from "../core/config-parser.js";
import {
	type Locale,
	loadCharaText,
	loadCharaTextRoma,
	sanitizeText,
	toHex,
} from "../core/data-loader.js";

/**
 * Parsed noun (name) entry from text file
 */
export interface ParsedNoun {
	/** Hash ID (hex string) */
	hashId: string;
	/** Primary name text */
	name: string;
	/** Alternative name forms */
	altNames: string[];
}

/**
 * Parse a NOUN_INFO node to extract name
 *
 * Variable structure:
 * [0] = hashId (Int)
 * [1] = unknown (Int)
 * [2-4] = empty strings
 * [5] = primary name (String)
 * [6-8] = alternative forms
 * ...rest = flags
 */
function parseNounNode(node: ConfigNode): ParsedNoun | null {
	const vars = node.variables;
	if (vars.length < 6) return null;

	// First variable is the hash ID
	const hashVar = vars[0];
	if (hashVar.type !== "Int") return null;

	const hashId = toHex(Number.parseInt(hashVar.value, 10));

	// Find the primary name (usually index 5)
	let name = "";
	const altNames: string[] = [];

	for (let i = 2; i < vars.length; i++) {
		const v = vars[i];
		if (v.type === "String" && typeof v.value === "string" && v.value.trim()) {
			const cleaned = sanitizeText(v.value);
			if (cleaned) {
				if (!name) {
					name = cleaned;
				} else {
					altNames.push(cleaned);
				}
			}
		}
	}

	if (!name) return null;

	return { hashId, name, altNames };
}

/**
 * Parse all nouns from a character text config
 */
function parseNounsFromConfig(children: ConfigNode[]): ParsedNoun[] {
	const results: ParsedNoun[] = [];

	function traverse(node: ConfigNode) {
		if (node.name.startsWith("NOUN_INFO_") && !node.name.includes("BEGIN")) {
			const parsed = parseNounNode(node);
			if (parsed) {
				results.push(parsed);
			}
		}

		if (node.children) {
			for (const child of node.children) {
				traverse(child);
			}
		}
	}

	for (const entry of children) {
		traverse(entry);
	}

	return results;
}

/**
 * Build a name lookup map for a locale
 * Returns hashId -> name
 */
export function buildNameMap(locale: Locale): Map<string, string> {
	const config = loadCharaText(locale);
	const nouns = parseNounsFromConfig(config.children);
	const map = new Map<string, string>();

	for (const noun of nouns) {
		map.set(noun.hashId, noun.name);
	}

	return map;
}

/**
 * Romanized name entry
 */
export interface ParsedRomanizedName {
	hashId: string;
	firstName: string;
	lastName: string;
}

/**
 * Parse romanized name node
 * Usually has first/last name split
 */
function parseRomaNode(node: ConfigNode): ParsedRomanizedName | null {
	const vars = node.variables;
	if (vars.length < 3) return null;

	const hashVar = vars[0];
	if (hashVar.type !== "Int") return null;

	const hashId = toHex(Number.parseInt(hashVar.value, 10));

	// Find string values for first/last name
	let firstName = "";
	let lastName = "";

	for (let i = 1; i < vars.length; i++) {
		const v = vars[i];
		if (v.type === "String" && typeof v.value === "string" && v.value.trim()) {
			if (!lastName) {
				lastName = v.value.trim();
			} else if (!firstName) {
				firstName = v.value.trim();
			}
		}
	}

	if (!firstName && !lastName) return null;

	return { hashId, firstName, lastName };
}

/**
 * Build romanized name map for a locale
 */
export function buildRomanizedMap(locale: Locale): Map<string, ParsedRomanizedName> {
	try {
		const config = loadCharaTextRoma(locale);
		const map = new Map<string, ParsedRomanizedName>();

		function traverse(node: ConfigNode) {
			if (node.name.startsWith("NOUN_INFO_") && !node.name.includes("BEGIN")) {
				const parsed = parseRomaNode(node);
				if (parsed) {
					map.set(parsed.hashId, parsed);
				}
			}

			if (node.children) {
				for (const child of node.children) {
					traverse(child);
				}
			}
		}

		for (const entry of config.children) {
			traverse(entry);
		}

		return map;
	} catch {
		// Romanized files may not exist for all locales
		return new Map();
	}
}

/**
 * Localized name data for a character
 */
export interface LocalizedCharaNames {
	ja?: string;
	en?: string;
	fr?: string;
	de?: string;
	es?: string;
	it?: string;
	pt?: string;
	zhHans?: string;
	zhHant?: string;
	romanized?: {
		firstName?: string;
		lastName?: string;
	};
}

/**
 * Build multi-locale name maps
 */
export function buildAllNameMaps(): {
	names: Map<Locale, Map<string, string>>;
	romanized: Map<Locale, Map<string, ParsedRomanizedName>>;
} {
	const names = new Map<Locale, Map<string, string>>();
	const romanized = new Map<Locale, Map<string, ParsedRomanizedName>>();

	// Load available locales
	const locales: Locale[] = ["ja", "en", "fr"];

	for (const locale of locales) {
		try {
			names.set(locale, buildNameMap(locale));
			romanized.set(locale, buildRomanizedMap(locale));
		} catch {
			// Skip unavailable locales
		}
	}

	return { names, romanized };
}

/**
 * Get localized names for a hash ID across all loaded locales
 */
export function getLocalizedNames(
	hashId: string,
	nameMaps: Map<Locale, Map<string, string>>,
	romaMaps: Map<Locale, Map<string, ParsedRomanizedName>>
): LocalizedCharaNames {
	const result: LocalizedCharaNames = {};

	for (const [locale, map] of nameMaps) {
		const name = map.get(hashId);
		if (name) {
			switch (locale) {
				case "ja":
					result.ja = name;
					break;
				case "en":
					result.en = name;
					break;
				case "fr":
					result.fr = name;
					break;
				case "de":
					result.de = name;
					break;
				case "es":
					result.es = name;
					break;
				case "it":
					result.it = name;
					break;
				case "pt":
					result.pt = name;
					break;
				case "zh_hans":
					result.zhHans = name;
					break;
				case "zh_hant":
					result.zhHant = name;
					break;
			}
		}
	}

	// Add romanized from Japanese
	const jaRoma = romaMaps.get("ja")?.get(hashId);
	if (jaRoma) {
		result.romanized = {
			firstName: jaRoma.firstName,
			lastName: jaRoma.lastName,
		};
	}

	return result;
}
