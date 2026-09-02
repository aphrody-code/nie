/**
 * @file g4tx-parser.ts
 * @description Pure TypeScript parser for Level-5 G4TX texture containers
 * Ported from IECODE.Core/Formats/Level5/G4txParser.cs
 *
 * G4TX (Graphics 4 Texture) is Level-5's texture container format.
 * It wraps NXTCH (Nintendo Switch) or DDS textures with metadata.
 *
 * Format Structure:
 * - Header (0x60 bytes): Magic "G4TX" + metadata
 * - Entry table: Main texture entries (0x30 bytes each)
 * - Sub-entry table: Atlas regions (0x18 bytes each)
 * - Hash table: CRC32 hashes for texture names
 * - ID table: Texture IDs
 * - String table: Null-terminated texture names
 * - Texture data: NXTCH or DDS chunks
 */

// ============================================================================
// Types
// ============================================================================

export interface G4txHeader {
	magic: number; // "G4TX" (0x47345458)
	headerSize: number; // 0x60
	fileType: number; // 0x65
	tableSize: number; // Size of entry tables
	textureCount: number; // Number of main textures
	totalCount: number; // textureCount + subTextureCount
	subTextureCount: number; // Number of sub-textures (atlas regions)
	textureDataSize: number; // Total size of NXTCH data
}

export interface G4txEntry {
	nxtchOffset: number; // Offset to NXTCH chunk
	nxtchSize: number; // Size of NXTCH chunk
	width: number; // Texture width
	height: number; // Texture height
}

export interface G4txSubEntry {
	entryId: number; // Parent texture index
	x: number; // Region X offset
	y: number; // Region Y offset
	width: number; // Region width
	height: number; // Region height
}

export interface NxtchHeader {
	magic: bigint; // "NXTCH000"
	textureDataSize: number;
	width: number;
	height: number;
	format: number; // Texture format (BC7, BC1, etc.)
	mipMapCount: number;
	isValid: boolean;
}

export interface G4txSubTexture {
	id: number;
	name: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface G4txTexture {
	id: number;
	name: string;
	width: number;
	height: number;
	format: number;
	mipMapCount: number;
	textureData: Uint8Array;
	isDds: boolean;
	subTextures: G4txSubTexture[];
}

/**
 * NXTCH texture format enumeration
 */
export enum NxtchTextureFormat {
	Unknown = 0,
	BC1 = 0x01, // DXT1
	BC2 = 0x02, // DXT3
	BC3 = 0x03, // DXT5
	BC4 = 0x04, // ATI1/BC4
	BC5 = 0x05, // ATI2/BC5
	BC6 = 0x06, // BC6H
	BC7 = 0x07, // BC7
	RGBA8 = 0x1f, // RGBA8888
}

// ============================================================================
// Constants
// ============================================================================

export const G4TX_MAGIC = 0x58543447; // "G4TX" little-endian
export const DDS_MAGIC = 0x20534444; // "DDS " little-endian
const HEADER_SIZE = 0x60;
const ENTRY_SIZE = 0x30;
const SUB_ENTRY_SIZE = 0x18;
const NXTCH_HEADER_SIZE = 44;
const NXTCH_MAGIC_PREFIX = 0x484354584e; // "NXTCH" (5 bytes)

// ============================================================================
// Parser Implementation
// ============================================================================

/**
 * Check if data is a valid G4TX file.
 */
export function isG4tx(data: Uint8Array): boolean {
	if (data.length < 4) return false;
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	return view.getUint32(0, true) === G4TX_MAGIC;
}

/**
 * Parse G4TX header from binary data.
 */
export function parseHeader(data: Uint8Array): G4txHeader {
	if (data.length < HEADER_SIZE) {
		throw new Error(`Data too small for G4TX header: ${data.length} < ${HEADER_SIZE}`);
	}

	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const magic = view.getUint32(0, true);

	if (magic !== G4TX_MAGIC) {
		throw new Error(`Invalid G4TX magic: 0x${magic.toString(16).toUpperCase()}`);
	}

	return {
		magic,
		headerSize: view.getInt16(4, true),
		fileType: view.getInt16(6, true),
		tableSize: view.getInt32(12, true),
		textureCount: view.getInt16(0x20, true),
		totalCount: view.getInt16(0x22, true),
		subTextureCount: view.getUint8(0x25),
		textureDataSize: view.getInt32(0x2c, true),
	};
}

/**
 * Parse NXTCH header from texture chunk data.
 */
export function parseNxtchHeader(data: Uint8Array): NxtchHeader {
	if (data.length < NXTCH_HEADER_SIZE) {
		return {
			magic: 0n,
			textureDataSize: 0,
			width: 0,
			height: 0,
			format: 0,
			mipMapCount: 0,
			isValid: false,
		};
	}

	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
	const magic = view.getBigUint64(0, true);

	// Check if first 5 bytes match "NXTCH"
	const isValid = (magic & 0xffffffffffn) === BigInt(NXTCH_MAGIC_PREFIX);

	return {
		magic,
		textureDataSize: view.getInt32(8, true),
		width: view.getInt32(20, true),
		height: view.getInt32(24, true),
		format: view.getInt32(32, true),
		mipMapCount: view.getInt32(36, true),
		isValid,
	};
}

/**
 * Parse all textures from G4TX file.
 */
export function parseTextures(data: Uint8Array): G4txTexture[] {
	const header = parseHeader(data);
	const textures: G4txTexture[] = [];
	const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

	// Calculate offsets
	const entryOffset = HEADER_SIZE;
	const subEntryOffset = entryOffset + header.textureCount * ENTRY_SIZE;
	const hashOffset = alignUp(subEntryOffset + header.subTextureCount * SUB_ENTRY_SIZE, 0x10);
	const idOffset = hashOffset + header.totalCount * 4;
	const stringOffset = alignUp(idOffset + header.totalCount, 4);

	// Parse entries
	const entries: G4txEntry[] = [];
	for (let i = 0; i < header.textureCount; i++) {
		const offset = entryOffset + i * ENTRY_SIZE;
		entries.push({
			nxtchOffset: view.getInt32(offset + 4, true),
			nxtchSize: view.getInt32(offset + 8, true),
			width: view.getInt16(offset + 24, true),
			height: view.getInt16(offset + 26, true),
		});
	}

	// Parse sub-entries
	const subEntries: G4txSubEntry[] = [];
	for (let i = 0; i < header.subTextureCount; i++) {
		const offset = subEntryOffset + i * SUB_ENTRY_SIZE;
		subEntries.push({
			entryId: view.getInt16(offset, true),
			x: view.getInt16(offset + 4, true),
			y: view.getInt16(offset + 6, true),
			width: view.getInt16(offset + 8, true),
			height: view.getInt16(offset + 10, true),
		});
	}

	// Read IDs
	const ids = data.slice(idOffset, idOffset + header.totalCount);

	// Read string offsets
	const stringOffsets: number[] = [];
	for (let i = 0; i < header.totalCount; i++) {
		stringOffsets.push(view.getInt16(stringOffset + i * 2, true));
	}

	// Calculate NXTCH base offset
	const nxtchBase = alignUp(header.headerSize + header.tableSize, 0x10);

	// Parse each main texture
	for (let i = 0; i < header.textureCount; i++) {
		const entry = entries[i];

		// Read texture name
		const name = readNullTerminatedString(data, stringOffset + stringOffsets[i]);

		// Extract texture data
		const nxtchOffset = nxtchBase + entry.nxtchOffset;
		const textureData = data.slice(nxtchOffset, nxtchOffset + entry.nxtchSize);

		// Check for DDS Magic (DX11/PC)
		let isDds = false;
		let width = 0;
		let height = 0;
		let format = 0;
		let mipMapCount = 0;

		if (textureData.length >= 4) {
			const texView = new DataView(
				textureData.buffer,
				textureData.byteOffset,
				textureData.byteLength
			);
			const texMagic = texView.getUint32(0, true);

			if (texMagic === DDS_MAGIC) {
				isDds = true;
				// Parse DDS header
				width = texView.getInt32(16, true);
				height = texView.getInt32(12, true);
				mipMapCount = texView.getInt32(28, true);
				format = texView.getUint32(84, true); // FourCC
			} else {
				// Parse NXTCH header
				const nxtchHeader = parseNxtchHeader(textureData);
				width = nxtchHeader.width;
				height = nxtchHeader.height;
				format = nxtchHeader.format;
				mipMapCount = nxtchHeader.mipMapCount;
			}
		}

		// Find sub-textures for this entry
		const subTextures: G4txSubTexture[] = [];
		let subEntryId = header.textureCount;

		for (const subEntry of subEntries) {
			if (subEntry.entryId === i) {
				const subName = readNullTerminatedString(data, stringOffset + stringOffsets[subEntryId]);
				subTextures.push({
					id: ids[subEntryId],
					name: subName,
					x: subEntry.x,
					y: subEntry.y,
					width: subEntry.width,
					height: subEntry.height,
				});
				subEntryId++;
			}
		}

		textures.push({
			id: ids[i],
			name,
			width,
			height,
			format,
			mipMapCount,
			textureData,
			isDds,
			subTextures,
		});
	}

	return textures;
}

/**
 * Get texture format name from format code.
 */
export function getFormatName(format: number): string {
	switch (format) {
		case NxtchTextureFormat.BC1:
			return "BC1/DXT1";
		case NxtchTextureFormat.BC2:
			return "BC2/DXT3";
		case NxtchTextureFormat.BC3:
			return "BC3/DXT5";
		case NxtchTextureFormat.BC4:
			return "BC4/ATI1";
		case NxtchTextureFormat.BC5:
			return "BC5/ATI2";
		case NxtchTextureFormat.BC6:
			return "BC6H";
		case NxtchTextureFormat.BC7:
			return "BC7";
		case NxtchTextureFormat.RGBA8:
			return "RGBA8";
		default:
			return `Unknown(0x${format.toString(16)})`;
	}
}

/**
 * Convert NXTCH to DDS format.
 */
export function convertNxtchToDds(nxtchData: Uint8Array): Uint8Array {
	const nxtchHeader = parseNxtchHeader(nxtchData);
	if (!nxtchHeader.isValid) {
		throw new Error("Invalid NXTCH header");
	}

	const textureData = nxtchData.slice(NXTCH_HEADER_SIZE);

	// Create DDS header
	const ddsHeader = createDdsHeader(nxtchHeader);

	// Combine header + texture data
	const ddsData = new Uint8Array(ddsHeader.length + textureData.length);
	ddsData.set(ddsHeader, 0);
	ddsData.set(textureData, ddsHeader.length);

	return ddsData;
}

function createDdsHeader(nxtchHeader: NxtchHeader): Uint8Array {
	const ddsHeader = new Uint8Array(128);
	const view = new DataView(ddsHeader.buffer);

	// DDS magic
	view.setUint32(0, DDS_MAGIC, true);

	// DDS_HEADER
	view.setInt32(4, 124, true); // dwSize
	view.setUint32(8, 0x1007, true); // dwFlags
	view.setInt32(12, nxtchHeader.height, true);
	view.setInt32(16, nxtchHeader.width, true);

	// Calculate pitch
	const isPitchBC1 =
		nxtchHeader.format === NxtchTextureFormat.BC1 || nxtchHeader.format === NxtchTextureFormat.BC4;
	const pitchOrLinearSize = isPitchBC1
		? Math.max(1, Math.floor((nxtchHeader.width + 3) / 4)) * 8
		: Math.max(1, Math.floor((nxtchHeader.width + 3) / 4)) * 16;

	view.setInt32(20, pitchOrLinearSize, true);
	view.setInt32(28, Math.max(1, nxtchHeader.mipMapCount), true);

	// DDS_PIXELFORMAT
	view.setInt32(76, 32, true); // dwSize
	view.setUint32(80, 0x4, true); // dwFlags (FOURCC)

	// FourCC based on format
	let fourcc: number;
	switch (nxtchHeader.format) {
		case NxtchTextureFormat.BC1:
			fourcc = 0x31545844; // "DXT1"
			break;
		case NxtchTextureFormat.BC2:
			fourcc = 0x33545844; // "DXT3"
			break;
		case NxtchTextureFormat.BC3:
			fourcc = 0x35545844; // "DXT5"
			break;
		case NxtchTextureFormat.BC4:
			fourcc = 0x31495441; // "ATI1"
			break;
		case NxtchTextureFormat.BC5:
			fourcc = 0x32495441; // "ATI2"
			break;
		default:
			fourcc = 0x00000000; // DX10 header needed
			break;
	}
	view.setUint32(84, fourcc, true);

	// DDS_HEADER.dwCaps
	view.setUint32(108, 0x1000, true); // TEXTURE

	return ddsHeader;
}

// ============================================================================
// Utility Functions
// ============================================================================

function readNullTerminatedString(data: Uint8Array, offset: number): string {
	let end = offset;
	while (end < data.length && data[end] !== 0) {
		end++;
	}
	const decoder = new TextDecoder("utf-8");
	return decoder.decode(data.slice(offset, end));
}

function alignUp(value: number, alignment: number): number {
	return Math.ceil(value / alignment) * alignment;
}

// ============================================================================
// High-Level API
// ============================================================================

export interface G4txInfo {
	textureCount: number;
	subTextureCount: number;
	textures: {
		name: string;
		width: number;
		height: number;
		format: string;
		isDds: boolean;
		subTextures: {
			name: string;
			x: number;
			y: number;
			width: number;
			height: number;
		}[];
	}[];
}

/**
 * Parse G4TX and return summary info.
 */
export function getG4txInfo(data: Uint8Array): G4txInfo {
	const textures = parseTextures(data);
	const header = parseHeader(data);

	return {
		textureCount: header.textureCount,
		subTextureCount: header.subTextureCount,
		textures: textures.map((t) => ({
			name: t.name,
			width: t.width,
			height: t.height,
			format: getFormatName(t.format),
			isDds: t.isDds,
			subTextures: t.subTextures.map((s) => ({
				name: s.name,
				x: s.x,
				y: s.y,
				width: s.width,
				height: s.height,
			})),
		})),
	};
}
