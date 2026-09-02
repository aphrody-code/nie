/**
 * @file scene-archive-config.ts
 * @description Parser for scene archive (theater) configuration
 *
 * Data source: scene_archive/scene_archive_config_*.cfg.bin.json
 *
 * Structure (lists format):
 * - m_sceneArchiveDataList: Theater scene entries (~112 entries)
 *   Fields: id, category, text_id_title, text_id_explain, event_id_text,
 *           thumbnail_texture_path, chapter_no, is_full_screen_view, condition
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";
import {
	buildEventCrcLookup,
	decodeUnlockCondition,
	type UnlockCondition,
} from "./unlock-condition.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedSceneArchive extends ExportableEntity {
	sceneId: string;
	category: number;
	titleTextId: string;
	explainTextId: string;
	eventIdText: string;
	chapterNo: number;
	isFullScreen: boolean;
	thumbnailPath: string;
	/** Condition de deblocage brute (base64). */
	condition: string;
	/** Condition de deblocage decodee. */
	unlock: UnlockCondition;
}

export interface SceneArchiveDatabase {
	scenes: ParsedSceneArchive[];
	byId: Map<string, ParsedSceneArchive>;
	byCategory: Map<number, ParsedSceneArchive[]>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Helpers
// ============================================================================

/** Extract clean image name from full texture path */
function extractImageName(texturePath: string): string {
	return texturePath.replace("#/menu/220_img/", "").replace(".g4tx", "");
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): ParsedSceneArchive[] {
	const scenes: ParsedSceneArchive[] = [];
	if (!content?.lists) return scenes;

	for (const list of content.lists) {
		if (list.name === "m_sceneArchiveDataList") {
			// 1re passe : index CRC32 -> event_id pour resoudre les feuilles event-flag.
			const crcLookup = buildEventCrcLookup(
				(list.values as any[]).map((v) => v.event_id_text).filter(Boolean) as string[]
			);
			const resolveEvent = (crc: number) => crcLookup.get(crc >>> 0);

			for (const val of list.values) {
				const thumbPath = extractImageName(val.thumbnail_texture_path || "");
				scenes.push({
					id: val.id,
					name: val.event_id_text || val.id,
					sceneId: val.id,
					category: val.category ?? 0,
					titleTextId: val.text_id_title || "0x00000000",
					explainTextId: val.text_id_explain || "0x00000000",
					eventIdText: val.event_id_text || "",
					chapterNo: val.chapter_no ?? 0,
					isFullScreen: val.is_full_screen_view ?? false,
					thumbnailPath: thumbPath,
					condition: val.condition || "",
					unlock: decodeUnlockCondition(val.condition, resolveEvent),
					attributes: {
						Category: val.category,
						Chapter: val.chapter_no,
						Event: val.event_id_text,
						Image: thumbPath,
					},
				});
			}
		}
	}
	return scenes;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadSceneArchiveConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<ParsedSceneArchive[] | null> {
	const filename = findConfigFile("scene_archive", "scene_archive_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/scene_archive", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildSceneArchiveDatabase(
	dataPath: string = DATA_ROOT
): Promise<SceneArchiveDatabase> {
	const scenes = (await loadSceneArchiveConfigAsync(dataPath)) || [];
	const byId = new Map<string, ParsedSceneArchive>();
	const byCategory = new Map<number, ParsedSceneArchive[]>();

	for (const s of scenes) {
		byId.set(s.sceneId, s);
		const cat = byCategory.get(s.category) || [];
		cat.push(s);
		byCategory.set(s.category, cat);
	}

	return {
		scenes,
		byId,
		byCategory,
		toMarkdown: (id: string) => {
			const s = byId.get(id);
			return s ? EntityExporters.toMarkdown(s, "Scene") : null;
		},
		toReact: (id: string) => {
			const s = byId.get(id);
			return s ? EntityExporters.toReact(s) : null;
		},
	};
}
