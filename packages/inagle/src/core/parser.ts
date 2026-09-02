/**
 * CFG.BIN JSON parsers
 *
 * Parses the two JSON formats found in the dump:
 * 1. Entries format (tree) - text files, item_config, team_config
 * 2. Version 100 format (typed lists) - skill_config, soccer_*, formation_*
 */

import type {
	CfgBinDocument,
	CfgBinEntry,
	CfgBinNamedDocument,
	TypedDocument,
} from "../schemas/cfgbin.js";
import type { NounInfo, TextInfo } from "../schemas/text.js";

/**
 * Check if document is lowercase Entries format
 */
export function isEntriesDocument(doc: unknown): doc is CfgBinDocument {
	return (
		typeof doc === "object" &&
		doc !== null &&
		"entries" in doc &&
		Array.isArray((doc as CfgBinDocument).entries)
	);
}

/**
 * Check if document is PascalCase Entries format
 */
export function isNamedEntriesDocument(doc: unknown): doc is CfgBinNamedDocument {
	return (
		typeof doc === "object" &&
		doc !== null &&
		"Entries" in doc &&
		Array.isArray((doc as CfgBinNamedDocument).Entries)
	);
}

/**
 * Check if document is version 100 typed format
 */
export function isTypedDocument(doc: unknown): doc is TypedDocument {
	return (
		typeof doc === "object" &&
		doc !== null &&
		"version" in doc &&
		(doc as TypedDocument).version === 100 &&
		"lists" in doc
	);
}

/**
 * Extract TEXT_INFO entries from a text document
 * Used for: skill_text, item_text, team_text, etc.
 */
export function extractTextInfo(doc: CfgBinDocument): TextInfo[] {
	const results: TextInfo[] = [];

	for (const entry of doc.entries) {
		if (entry.name.startsWith("TEXT_INFO_BEGIN")) {
			for (const child of entry.children) {
				if (child.name.startsWith("TEXT_INFO_") && child.variables.length >= 3) {
					const hashId = Number(child.variables[0].value);
					const index = Number(child.variables[1].value);
					const text = String(child.variables[2].value);
					results.push({ hashId, index, text });
				}
			}
		}
	}

	return results;
}

/**
 * Extract NOUN_INFO entries from chara_text document
 * Used for: character names
 */
export function extractNounInfo(doc: CfgBinDocument): NounInfo[] {
	const results: NounInfo[] = [];

	for (const entry of doc.entries) {
		if (entry.name.startsWith("NOUN_INFO_BEGIN")) {
			for (const child of entry.children) {
				if (child.name.startsWith("NOUN_INFO_") && child.variables.length >= 6) {
					const hashId = Number(child.variables[0].value);
					const nameType = Number(child.variables[1].value);
					const name = String(child.variables[5].value);
					if (name) {
						results.push({ hashId, nameType, name });
					}
				}
			}
		}
	}

	return results;
}

/**
 * Find entry by name pattern in tree
 */
export function findEntries(entries: CfgBinEntry[], pattern: string | RegExp): CfgBinEntry[] {
	const results: CfgBinEntry[] = [];
	const regex = typeof pattern === "string" ? new RegExp(pattern) : pattern;

	function traverse(entry: CfgBinEntry) {
		if (regex.test(entry.name)) {
			results.push(entry);
		}
		for (const child of entry.children) {
			traverse(child);
		}
	}

	for (const entry of entries) {
		traverse(entry);
	}

	return results;
}

/**
 * Get typed list by name from version 100 document
 */
export function getTypedList<T>(doc: TypedDocument, listName: string): T[] | undefined {
	const list = doc.lists.find((l) => l.name === listName);
	return list?.values as T[] | undefined;
}

/**
 * Build hash lookup map from text entries
 */
export function buildTextHashMap(entries: TextInfo[]): Map<number, string> {
	const map = new Map<number, string>();
	for (const entry of entries) {
		map.set(entry.hashId, entry.text);
	}
	return map;
}

/**
 * Build hash lookup map from noun entries (character names)
 */
export function buildNounHashMap(entries: NounInfo[]): Map<number, NounInfo> {
	const map = new Map<number, NounInfo>();
	for (const entry of entries) {
		// Store by hashId, prefer full name (nameType 0)
		if (!map.has(entry.hashId) || entry.nameType === 0) {
			map.set(entry.hashId, entry);
		}
	}
	return map;
}

/**
 * Convert hex string to number
 * e.g. "0x63BDA8A4" -> 1673291940
 */
export function hexToNumber(hex: string): number {
	if (hex.startsWith("0x") || hex.startsWith("0X")) {
		return Number.parseInt(hex, 16);
	}
	return Number.parseInt(hex, 10);
}

/**
 * Convert signed int32 to hex string
 * e.g. -447611118 -> "0xE5627392"
 */
export function int32ToHex(value: number): string {
	return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}
