/**
 * @file inacode-config.ts
 * @description Parser for Inacode stamps/social data
 *
 * Data source: inacode/inacode_config_1.01.57.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_InacodeStampDataList: Stamp data (15 entries) — idCrc, imgNameCrc, imgPathCrc
 * - m_InacodeAuthorNameDataList: Author names (29 entries)
 * - m_InacodeCommentDataList: Comments (968 entries)
 * - m_InacodeCommentSetDataList: Comment sets (83 entries)
 * - m_InacodeStampSetDataList: Stamp sets
 * - m_InacodeStampSlotDataList: Stamp slots
 * - m_InacodeQRDataList: QR code data
 * - m_InacodeMemberIconDataList: Member icons
 * - m_InacodeDefaultImageList: Default images
 * - m_InacodeStickerDataList: Sticker data
 *
 * Note: Most fields are CRC hashes pointing to assets.
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface InacodeStamp {
	idCrc: string;
	imgNameCrc: string;
	imgPathCrc: string;
}

export interface InacodeDatabase {
	stamps: InacodeStamp[];
	authors: any[];
	comments: any[];
	commentSets: any[];
	stampSets: any[];
	stampSlots: any[];
	qrData: any[];
	memberIcons: any[];
	defaultImages: any[];
	stickers: any[];
	byStampId: Map<string, InacodeStamp>;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any) {
	const stamps: InacodeStamp[] = [];
	const authors: any[] = [];
	const comments: any[] = [];
	const commentSets: any[] = [];
	const stampSets: any[] = [];
	const stampSlots: any[] = [];
	const qrData: any[] = [];
	const memberIcons: any[] = [];
	const defaultImages: any[] = [];
	const stickers: any[] = [];

	if (!content?.lists)
		return {
			stamps,
			authors,
			comments,
			commentSets,
			stampSets,
			stampSlots,
			qrData,
			memberIcons,
			defaultImages,
			stickers,
		};

	for (const list of content.lists) {
		const values = list.values || [];
		switch (list.name) {
			case "m_InacodeStampDataList":
				for (const val of values) {
					stamps.push({ idCrc: val.idCrc, imgNameCrc: val.imgNameCrc, imgPathCrc: val.imgPathCrc });
				}
				break;
			case "m_InacodeAuthorNameDataList":
				authors.push(...values);
				break;
			case "m_InacodeCommentDataList":
				comments.push(...values);
				break;
			case "m_InacodeCommentSetDataList":
				commentSets.push(...values);
				break;
			case "m_InacodeStampSetDataList":
				stampSets.push(...values);
				break;
			case "m_InacodeStampSlotDataList":
				stampSlots.push(...values);
				break;
			case "m_InacodeQRDataList":
				qrData.push(...values);
				break;
			case "m_InacodeMemberIconDataList":
				memberIcons.push(...values);
				break;
			case "m_InacodeDefaultImageList":
				defaultImages.push(...values);
				break;
			case "m_InacodeStickerDataList":
				stickers.push(...values);
				break;
		}
	}
	return {
		stamps,
		authors,
		comments,
		commentSets,
		stampSets,
		stampSlots,
		qrData,
		memberIcons,
		defaultImages,
		stickers,
	};
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadInacodeConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("inacode", "inacode_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/inacode", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildInacodeDatabase(dataPath: string = DATA_ROOT): Promise<InacodeDatabase> {
	const result = await loadInacodeConfigAsync(dataPath);
	const stamps = result?.stamps || [];
	const byStampId = new Map<string, InacodeStamp>();
	for (const s of stamps) byStampId.set(s.idCrc, s);

	return {
		stamps,
		authors: result?.authors || [],
		comments: result?.comments || [],
		commentSets: result?.commentSets || [],
		stampSets: result?.stampSets || [],
		stampSlots: result?.stampSlots || [],
		qrData: result?.qrData || [],
		memberIcons: result?.memberIcons || [],
		defaultImages: result?.defaultImages || [],
		stickers: result?.stickers || [],
		byStampId,
	};
}
