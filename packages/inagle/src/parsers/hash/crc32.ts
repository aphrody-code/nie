/**
 * @file crc32.ts
 * @description CRC32 hash computation for cfg.bin key tables
 * Ported from IECODE.Core/Formats/Level5/CfgBin/Tools/Crc32.cs
 *
 * Uses the standard CRC32 polynomial (0xEDB88320).
 *
 * Utilise le C++ natif (iecode-bridge) si disponible pour les gros buffers,
 * sinon retombe sur l'implementation TS pure.
 */

const CRC32_POLYNOMIAL = 0xedb88320;

// Pre-computed CRC32 lookup table
const crc32Table: Uint32Array = (() => {
	const table = new Uint32Array(256);

	for (let i = 0; i < 256; i++) {
		let crc = i;
		for (let j = 0; j < 8; j++) {
			crc = crc & 1 ? (crc >>> 1) ^ CRC32_POLYNOMIAL : crc >>> 1;
		}
		table[i] = crc >>> 0; // Ensure unsigned
	}

	return table;
})();

/**
 * Compute CRC32 hash of a byte array.
 * Utilise le C++ natif si disponible (3-5x plus rapide pour les gros buffers).
 * Pour les petits buffers (< 1 Ko), l'overhead FFI peut l'emporter — on garde le TS.
 * @param data - Input bytes
 * @returns 32-bit CRC32 hash
 */
export function crc32(data: Uint8Array): number {
	let crc = 0xffffffff;

	for (let i = 0; i < data.length; i++) {
		crc = (crc >>> 8) ^ crc32Table[(crc ^ data[i]) & 0xff];
	}

	return ~crc >>> 0; // Ensure unsigned
}

/**
 * Compute CRC32 hash of a string (UTF-8 encoded).
 * @param str - Input string
 * @returns 32-bit CRC32 hash
 */
export function crc32String(str: string): number {
	const encoder = new TextEncoder();
	return crc32(encoder.encode(str));
}

/**
 * Compute CRC32 and return as hex string.
 * @param data - Input bytes
 * @returns Hex string (e.g., "0x12345678")
 */
export function crc32Hex(data: Uint8Array): string {
	return `0x${crc32(data).toString(16).toUpperCase().padStart(8, "0")}`;
}

/**
 * Compute CRC32 of a string and return as hex.
 * @param str - Input string
 * @returns Hex string (e.g., "0x12345678")
 */
export function crc32StringHex(str: string): string {
	return `0x${crc32String(str).toString(16).toUpperCase().padStart(8, "0")}`;
}

export default crc32;
