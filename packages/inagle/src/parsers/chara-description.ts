/**
 * @file chara-description.ts
 * @description Parser for character description text files
 *
 * Parses chara_description_text.cfg.bin.json to extract localized descriptions
 * Format: [hashId (Int), 0 (Int), description (String)]
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { type Locale, sanitizeText, toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

/**
 * Parsed character description entry
 */
export interface ParsedDescription {
	/** Hash ID (hex string) matching chara_base nameHash */
	hashId: string;
	/** Description text */
	description: string;
}

/**
 * Description maps by locale
 */
export interface DescriptionMaps {
	/** Map of hashId -> description for each locale */
	descriptions: Map<Locale, Map<string, string>>;
}

/**
 * Parse a TEXT_INFO node to extract description
 */
function parseDescriptionNode(node: ConfigNode): ParsedDescription | null {
	const vars = node.variables;
	if (vars.length < 3) return null;

	// [0] = hashId (Int), [1] = 0, [2] = description (String)
	const hashVar = vars[0];
	const descVar = vars[2];

	if (hashVar.type !== "Int" || descVar.type !== "String") return null;

	const hashId = toHex(Number.parseInt(hashVar.value, 10));
	const description = sanitizeText(descVar.value);

	if (!description) return null;

	return { hashId, description };
}

/**
 * Load and parse chara_description_text for a locale
 */
export function loadCharaDescriptions(locale: Locale): Map<string, string> {
	const filePath = join(DATA_ROOT, "common/text", locale, "chara_description_text.cfg.bin.json");

	if (!existsSync(filePath)) {
		return new Map();
	}

	const content = readFileSync(filePath, "utf-8");
	const data = JSON.parse(content) as { entries: ConfigNode[] };

	const descriptions = new Map<string, string>();

	// Navigate to TEXT_INFO nodes (inside TEXT_INFO_BEGIN_0)
	for (const entry of data.entries) {
		if (entry.name === "TEXT_INFO_BEGIN_0" && entry.children) {
			for (const child of entry.children) {
				if (child.name.startsWith("TEXT_INFO_")) {
					const parsed = parseDescriptionNode(child);
					if (parsed) {
						descriptions.set(parsed.hashId, parsed.description);
					}
				}
			}
		}
	}

	return descriptions;
}

/**
 * Build description maps for all available locales
 */
export function buildAllDescriptionMaps(): DescriptionMaps {
	const locales: Locale[] = ["ja", "en", "fr", "de", "es", "it", "pt", "zh_hans", "zh_hant"];
	const descriptions = new Map<Locale, Map<string, string>>();

	for (const locale of locales) {
		const map = loadCharaDescriptions(locale);
		if (map.size > 0) {
			descriptions.set(locale, map);
		}
	}

	return { descriptions };
}

/**
 * Get localized description for a character by nameHash
 */
export function getDescription(
	maps: DescriptionMaps,
	nameHash: string
): { en?: string; fr?: string; ja?: string } {
	return {
		en: maps.descriptions.get("en")?.get(nameHash),
		fr: maps.descriptions.get("fr")?.get(nameHash),
		ja: maps.descriptions.get("ja")?.get(nameHash),
	};
}
