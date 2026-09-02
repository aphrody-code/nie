/**
 * @file music-config.ts
 * @description Parser for music_app_config
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { loadTextList } from "./text-parser.js";

export interface ParsedMusic {
	musicId: string; // Hex
	names: { en?: string; fr?: string; ja?: string };
}

export function buildMusicDatabase(dataPath: string) {
	const dir = join(dataPath, "common", "gamedata", "music_app");
	const configPath = join(dir, "music_app_config.cfg.bin.json");

	const musics: ParsedMusic[] = [];

	if (!existsSync(configPath)) {
		console.warn("[music-config] Config not found:", configPath);
		return { musics };
	}

	// Texts as List
	const listEn = loadTextList("music", "en");
	const listFr = loadTextList("music", "fr");
	const listJa = loadTextList("music", "ja");

	try {
		const content = JSON.parse(readFileSync(configPath, "utf-8"));
		const entries = content.entries as ConfigNode[];

		function traverse(node: ConfigNode) {
			// MUSIC_APP_INFO_ITEM_0
			if (node.name.startsWith("MUSIC_APP_INFO_ITEM_") && !node.name.includes("_LIST_")) {
				const vars = node.variables;

				// Heuristic: Find valid text index
				for (const v of vars) {
					if (v.type === "Int") {
						const idx = Number.parseInt(v.value, 10);
						if (idx >= 0 && idx < listFr.length && listFr[idx]) {
							const music: ParsedMusic = {
								musicId: toHex(idx),
								names: {
									en: listEn[idx],
									fr: listFr[idx],
									ja: listJa[idx],
								},
							};
							musics.push(music);
							break;
						}
					}
				}
			}
			if (node.children) node.children.forEach(traverse);
		}

		entries.forEach(traverse);
		console.log(`[MusicParser] Loaded ${musics.length} music tracks.`);
	} catch (e) {
		console.error("[music-config] Build failed", e);
	}

	return { musics };
}
