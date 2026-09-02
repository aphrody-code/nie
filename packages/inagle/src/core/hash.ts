/**
 * Hash/CRC utilities for Level-5 game data.
 *
 * Level-5 uses CRC32 (polynomial 0xEDB88320) for texture path hashing.
 * Paths may include the "#/" prefix.
 */

// CRC32 lookup table (polynomial 0xEDB88320)
const CRC32_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
	let crc = i;
	for (let j = 0; j < 8; j++) {
		crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
	}
	CRC32_TABLE[i] = crc >>> 0;
}

/**
 * Compute CRC32 of a string (as Level-5 does).
 * @param str - Input string (UTF-8 encoded)
 * @returns CRC32 as unsigned 32-bit integer
 */
export function crc32(str: string): number {
	const bytes = new TextEncoder().encode(str);
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ byte) & 0xff];
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Convert CRC32 to hex string (e.g., "0xABCD1234").
 */
export function crc32Hex(str: string): string {
	return `0x${crc32(str).toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Convert unsigned 32-bit CRC to signed int (as stored in game files).
 * @example 0xABCD1234 → -1412567500
 */
export function crcToSigned(crc: number): number {
	return crc > 0x7fffffff ? crc - 0x100000000 : crc;
}

/**
 * Convert signed int to unsigned 32-bit CRC.
 * @example -1412567500 → 0xABCD1234
 */
export function signedToCrc(signed: number): number {
	return signed < 0 ? signed + 0x100000000 : signed;
}

/**
 * Convert signed int to hex string.
 * @example -1412567500 → "0xABCD1234"
 */
export function signedToHex(signed: number): string {
	const unsigned = signedToCrc(signed);
	return `0x${unsigned.toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Parse hex string to unsigned 32-bit integer.
 * @example "0xABCD1234" → 2882343476
 */
export function hexToUnsigned(hex: string): number {
	return Number.parseInt(hex.replace("0x", ""), 16) >>> 0;
}

// ============================================================================
// Hash Lookup Cache
// ============================================================================

let hashLookup: {
	path_to_hash: Record<string, string>;
	hash_to_path: Record<string, string>;
} | null = null;

/**
 * Load the hash lookup table from generated JSON.
 */
export async function loadHashLookup(
	lookupPath = "../../../data/all-gamedata/_hash_lookup.json"
): Promise<typeof hashLookup> {
	if (hashLookup) return hashLookup;

	try {
		const fs = await import("node:fs/promises");
		const path = await import("node:path");
		const fullPath = path.resolve(import.meta.dirname ?? ".", lookupPath);
		const content = await fs.readFile(fullPath, "utf-8");
		hashLookup = JSON.parse(content);
		return hashLookup;
	} catch {
		console.warn("Hash lookup file not found, using empty lookup");
		hashLookup = { path_to_hash: {}, hash_to_path: {} };
		return hashLookup;
	}
}

/**
 * Resolve a hash to its texture path.
 * @param hash - Hash in "0xABCD1234" format or as number
 * @returns Texture path or undefined
 */
export async function resolveHash(hash: string | number): Promise<string | undefined> {
	const lookup = await loadHashLookup();

	let hexHash: string;
	if (typeof hash === "number") {
		hexHash = signedToHex(hash);
	} else {
		hexHash = hash.toUpperCase();
	}

	return lookup?.hash_to_path[hexHash];
}

/**
 * Get hash for a texture path.
 * @param path - Texture path (with or without #/ prefix)
 * @returns Hash in "0xABCD1234" format
 */
export function getPathHash(path: string): string {
	return crc32Hex(path);
}

// ============================================================================
// Texture Path Utilities
// ============================================================================

/**
 * Standard texture path prefixes used in the game.
 */
export const TEXTURE_PREFIXES = {
	ICON_COMMON: "#/menu/200_icon/15_icon_common",
	ICON_EMBLEM: "200_icon/01_icon_emblem",
	ICON_NAMEPLATE: "#/menu/200_icon/25_icon_nameplate",
	CHARA_FACE: "#/menu/100_chara/01_chara_face",
	SKILL_ICON: "#/menu/200_icon/10_icon_skill",
} as const;

/**
 * Build a standard icon path.
 */
export function buildIconPath(
	prefix: keyof typeof TEXTURE_PREFIXES,
	filename: string,
	lang = "<LG>"
): string {
	const base = TEXTURE_PREFIXES[prefix];
	if (base.includes("<LG>")) {
		return `${base.replace("<LG>", lang)}/${filename}.g4tx`;
	}
	return `${base}/${filename}.g4tx`;
}

/**
 * Verify a path matches its expected hash.
 */
export function verifyPathHash(path: string, expectedHash: string): boolean {
	const computed = crc32Hex(path);
	return computed === expectedHash.toUpperCase();
}
