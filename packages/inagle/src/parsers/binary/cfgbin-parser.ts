/**
 * @file cfgbin-parser.ts
 * @description Pure TypeScript parser for Level-5 cfg.bin configuration files
 * Ported from IECODE.Core/Formats/Level5/CfgBin/CfgBin.cs
 *
 * cfg.bin is Level-5's binary configuration format used extensively in IEVR.
 * It stores structured data (integers, floats, strings, lists) in a compact binary format.
 *
 * Format Structure:
 * - Header (8 bytes): magic + entry count
 * - Entries: Variable-length entries with type, hash, and values
 * - String table: UTF-8 strings referenced by offset
 * - Footer: Magic "CFG" + validation
 *
 * Utilise le C++ natif (iecode-bridge) si disponible comme voie rapide,
 * avec fallback gracieux sur le parser TS pur si la FFI est indisponible ou echoue.
 */

import { crc32String } from "../hash/crc32.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Variable types in cfg.bin format.
 */
export enum VariableType {
	List = 1,
	ListEnd = 2, // End of list marker
	Int = 3, // 32-bit integer
	Float = 4, // 32-bit float
	String = 5, // String reference
	IntList = 6, // Array of integers
}

/**
 * Parsed cfg.bin entry (key-value pair).
 */
export interface CfgBinEntry {
	/** CRC32 hash of the key name */
	hash: number;
	/** Resolved key name (if found in hash table) */
	name?: string;
	/** Entry type */
	type: VariableType;
	/** Entry value (type depends on VariableType) */
	value: number | number[] | string | CfgBinEntry[];
}

/**
 * Cfg.bin file header.
 */
export interface CfgBinHeader {
	magic: number;
	entryCount: number;
	tableOffset: number;
	stringTableOffset: number;
}

/**
 * Parsed cfg.bin document.
 */
export interface CfgBinDocument {
	header: CfgBinHeader;
	entries: CfgBinEntry[];
	strings: Map<number, string>;
}

// ============================================================================
// Constants
// ============================================================================

export const CFGBIN_MAGIC = 0x00020100;
const FOOTER_MAGIC = 0x00474643; // "CFG\0"

// ============================================================================
// Parser Implementation
// ============================================================================

/**
 * Check if data has valid cfg.bin footer.
 */
export function hasValidFooter(data: Uint8Array): boolean {
	if (data.length < 4) return false;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const footer = view.getUint32(data.length - 4, true);
	return footer === FOOTER_MAGIC;
}

/**
 * Parse cfg.bin header.
 */
export function parseHeader(data: Uint8Array): CfgBinHeader {
	if (data.length < 8) {
		throw new Error(`Data too small for cfg.bin header: ${data.length} < 8`);
	}

	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const magic = view.getUint32(0, true);

	if (magic !== CFGBIN_MAGIC) {
		throw new Error(`Invalid cfg.bin magic: 0x${magic.toString(16).toUpperCase()}`);
	}

	return {
		magic,
		entryCount: view.getUint32(4, true),
		tableOffset: 8,
		stringTableOffset: 0, // Calculated during parsing
	};
}

// ============================================================================
// Conversion du format JSON C++ vers CfgBinDocument
// ============================================================================

/**
 * Parse all entries from cfg.bin data.
 *
 * Utilise le C++ natif si disponible (via iecode-bridge) pour les fichiers >= 512 octets.
 * En cas d'echec ou si le FFI est indisponible, utilise le parser TS pur.
 */
export function parseCfgBin(data: Uint8Array): CfgBinDocument {
	return parseCfgBinTS(data);
}

/**
 * Implementation TS pure du parser cfg.bin (anciennement parseCfgBin).
 * Appelee directement par parseCfgBin() en fallback.
 * @internal
 */
function parseCfgBinTS(data: Uint8Array): CfgBinDocument {
	const header = parseHeader(data);
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const strings = new Map<number, string>();

	let offset = header.tableOffset;
	const entries: CfgBinEntry[] = [];

	// Parse entries recursively
	function parseEntry(): CfgBinEntry | null {
		if (offset + 8 > data.length) return null;

		const hash = view.getUint32(offset, true);
		const typeAndSize = view.getUint32(offset + 4, true);
		const type = typeAndSize & 0xff;

		offset += 8;

		switch (type) {
			case VariableType.Int: {
				const value = view.getInt32(offset, true);
				offset += 4;
				return { hash, type, value };
			}

			case VariableType.Float: {
				const value = view.getFloat32(offset, true);
				offset += 4;
				return { hash, type, value };
			}

			case VariableType.String: {
				const stringOffset = view.getUint32(offset, true);
				offset += 4;

				// Read string from string table
				let str = strings.get(stringOffset);
				if (str === undefined) {
					str = readNullTerminatedString(data, stringOffset);
					strings.set(stringOffset, str);
				}

				return { hash, type, value: str };
			}

			case VariableType.IntList: {
				const count = (typeAndSize >> 8) & 0xffffff;
				const values: number[] = [];

				for (let i = 0; i < count; i++) {
					values.push(view.getInt32(offset, true));
					offset += 4;
				}

				return { hash, type, value: values };
			}

			case VariableType.List: {
				const children: CfgBinEntry[] = [];

				// Parse children until ListEnd
				while (offset < data.length) {
					const peekType = view.getUint8(offset + 4);
					if (peekType === VariableType.ListEnd) {
						offset += 8; // Skip ListEnd marker
						break;
					}

					const child = parseEntry();
					if (child) children.push(child);
					else break;
				}

				return { hash, type, value: children };
			}

			case VariableType.ListEnd:
				// Should not reach here normally
				return null;

			default:
				// Unknown type, skip
				console.warn(`Unknown cfg.bin entry type: ${type} at offset ${offset - 8}`);
				return null;
		}
	}

	// Parse all root entries
	for (let i = 0; i < header.entryCount; i++) {
		const entry = parseEntry();
		if (entry) entries.push(entry);
	}

	return { header, entries, strings };
}

/**
 * Read null-terminated UTF-8 string from data.
 */
function readNullTerminatedString(data: Uint8Array, offset: number): string {
	let end = offset;
	while (end < data.length && data[end] !== 0) {
		end++;
	}
	const decoder = new TextDecoder("utf-8");
	return decoder.decode(data.slice(offset, end));
}

// ============================================================================
// Hash Resolution
// ============================================================================

/**
 * Build reverse hash lookup table from known key names.
 */
export function buildHashTable(names: string[]): Map<number, string> {
	const table = new Map<number, string>();

	for (const name of names) {
		const hash = crc32String(name);
		table.set(hash, name);
	}
	return table;
}

/**
 * Resolve entry hashes to names using a lookup table.
 */
export function resolveNames(entries: CfgBinEntry[], hashTable: Map<number, string>): void {
	function resolveEntry(entry: CfgBinEntry): void {
		const name = hashTable.get(entry.hash);
		if (name) entry.name = name;

		if (entry.type === VariableType.List && Array.isArray(entry.value)) {
			for (const child of entry.value as CfgBinEntry[]) {
				resolveEntry(child);
			}
		}
	}

	for (const entry of entries) {
		resolveEntry(entry);
	}
}

// ============================================================================
// High-Level API
// ============================================================================

export interface CfgBinInfo {
	isValid: boolean;
	hasFooter: boolean;
	entryCount: number;
	stringCount: number;
}

/**
 * Get cfg.bin file info without full parsing.
 */
export function getCfgBinInfo(data: Uint8Array): CfgBinInfo {
	try {
		const header = parseHeader(data);
		return {
			isValid: true,
			hasFooter: hasValidFooter(data),
			entryCount: header.entryCount,
			stringCount: 0, // Would require full parse
		};
	} catch {
		return {
			isValid: false,
			hasFooter: false,
			entryCount: 0,
			stringCount: 0,
		};
	}
}

/**
 * Convert cfg.bin document to JSON-friendly object.
 */
export function toJson(doc: CfgBinDocument): Record<string, unknown> {
	function entryToJson(entry: CfgBinEntry): Record<string, unknown> {
		const key = entry.name || `0x${entry.hash.toString(16).toUpperCase().padStart(8, "0")}`;

		if (entry.type === VariableType.List && Array.isArray(entry.value)) {
			return {
				[key]: (entry.value as CfgBinEntry[]).map(entryToJson),
			};
		}

		return { [key]: entry.value };
	}

	const result: Record<string, unknown> = {};
	for (const entry of doc.entries) {
		Object.assign(result, entryToJson(entry));
	}
	return result;
}
