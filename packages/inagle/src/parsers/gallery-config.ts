/**
 * @file gallery-config.ts
 * @description Parser for gallery/CG unlock configuration
 *
 * Data source: gallery/gallery_config_1.03.71.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_GalleryInfoList: Gallery entries (360 entries)
 *   Fields: galleryId (hex), imgPath (string), thumbPath (string),
 *           needTokenNum (int), flgNo (int), openCond (base64)
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";
import { decodeUnlockCondition, type UnlockCondition } from "./unlock-condition.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedGallery extends ExportableEntity {
	galleryId: string;
	imgPath: string;
	thumbPath: string;
	needTokenNum: number;
	flgNo: number;
	/** Condition de deblocage brute (base64). */
	openCond: string;
	/** Condition de deblocage decodee. */
	unlock: UnlockCondition;
}

export interface GalleryDatabase {
	galleries: ParsedGallery[];
	byId: Map<string, ParsedGallery>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): ParsedGallery[] {
	const galleries: ParsedGallery[] = [];
	if (!content?.lists) return galleries;

	for (const list of content.lists) {
		if (list.name === "m_GalleryInfoList") {
			for (const val of list.values || []) {
				galleries.push({
					id: val.galleryId,
					name: val.imgPath,
					galleryId: val.galleryId,
					imgPath: val.imgPath,
					thumbPath: val.thumbPath,
					needTokenNum: val.needTokenNum,
					flgNo: val.flgNo,
					openCond: val.openCond,
					unlock: decodeUnlockCondition(val.openCond),
					attributes: {
						Image: val.imgPath,
						Cout: val.needTokenNum,
					},
				});
			}
		}
	}
	return galleries;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadGalleryConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedGallery[] | null> {
	const filename = findConfigFile("gallery", "gallery_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/gallery", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildGalleryDatabase(dataPath: string = DATA_ROOT): Promise<GalleryDatabase> {
	const galleries = (await loadGalleryConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedGallery>();
	for (const g of galleries) byId.set(g.galleryId, g);

	return {
		galleries,
		byId,
		toMarkdown: (id: string) => {
			const g = byId.get(id);
			return g ? EntityExporters.toMarkdown(g, "Galerie") : null;
		},
		toReact: (id: string) => {
			const g = byId.get(id);
			return g ? EntityExporters.toReact(g) : null;
		},
	};
}
