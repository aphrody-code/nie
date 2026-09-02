/* eslint-disable no-console */
/**
 * @file text-parser.ts
 * @description Universal text parser for cfg.bin.json files
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { type Locale, sanitizeText, toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";
import type { TextFileType } from "../schemas/text.js";

/**
 * Simplified text type keys for API usage
 */
export type GameTextType =
	| "ai"
	| "chara_add"
	| "chara_description"
	| "chara_roma"
	| "chara"
	| "chat"
	| "craft"
	| "data_file"
	| "extend_story"
	| "formation"
	| "help"
	| "inacode"
	| "item"
	| "item_explain"
	| "map_roma"
	| "map"
	| "medal"
	| "menu"
	| "mission"
	| "music"
	| "constellation" // players_universe_text
	| "post"
	| "quest_purpose"
	| "quest_title"
	| "battle_cmd"
	| "battle_msg"
	| "battle"
	| "archive"
	| "scout"
	| "search"
	| "setting"
	| "shop"
	| "skill"
	| "soccer_common"
	| "soccer_title"
	| "soccer_history"
	| "soccer_quick"
	| "soccer_suggest"
	| "soccer_passive"
	| "soccer_technic"
	| "staffroll"
	| "system"
	| "team"
	| "theater"
	| "trophy";

/**
 * Text file name mapping
 */
const TEXT_FILE_NAMES: Record<GameTextType, TextFileType> = {
	ai: "ai_text",
	chara_add: "chara_add_info_text",
	chara_description: "chara_description_text",
	chara_roma: "chara_text_roma",
	chara: "chara_text",
	chat: "chat_text",
	craft: "craft_text",
	data_file: "data_file_text",
	extend_story: "extend_story_text",
	formation: "formation_text",
	help: "help_list_text",
	inacode: "inacode_text",
	item: "item_text",
	item_explain: "item_explain_text",
	map_roma: "map_text_roma",
	map: "map_text",
	medal: "medal_text",
	menu: "menu_text",
	mission: "mission_text",
	music: "music_name_text",
	constellation: "players_universe_text",
	post: "post_text",
	quest_purpose: "quest_purpose_text",
	quest_title: "quest_title_text",
	battle_cmd: "rpg_battle_cmd_text",
	battle_msg: "rpg_battle_message_text",
	battle: "rpg_battle_text",
	archive: "scene_archive_text",
	scout: "scout_phase_text",
	search: "search_word_text",
	setting: "setting_text",
	shop: "shop_text",
	skill: "skill_text",
	soccer_common: "soccer_common_text",
	soccer_title: "soccer_game_title",
	soccer_history: "soccer_history_check_text",
	soccer_quick: "soccer_quick_action_text",
	soccer_suggest: "soccer_suggest_text",
	soccer_passive: "soccer_team_passive_text",
	soccer_technic: "soccer_technic_text",
	staffroll: "staffroll_text",
	system: "system_text",
	team: "team_text",
	theater: "theater_text",
	trophy: "trophy_text",
};

/**
 * Parse TEXT_INFO node to extract hashId and text
 * Supports both TEXT_INFO (3 vars) and NOUN_INFO (15+ vars) formats
 */
function parseTextInfoNode(node: ConfigNode): { hashId: string; text: string } | null {
	const vars = node.variables;
	if (vars.length < 3) return null;

	const hashVar = vars[0];
	if (hashVar.type !== "Int") return null;

	// NOUN_INFO format: text is at index 5
	// TEXT_INFO format: text is at index 2
	let textVar: { type: string; value: string } | undefined;

	if (node.name.startsWith("NOUN_INFO")) {
		// NOUN_INFO: [hashId, ?, ?, ?, ?, text, ...]
		textVar = vars[5];
	} else {
		// TEXT_INFO: [hashId, 0, text]
		textVar = vars[2];
	}

	if (!textVar || textVar.type !== "String") return null;

	const hashId = toHex(Number.parseInt(hashVar.value, 10));
	const text = sanitizeText(textVar.value);

	if (!text) return null;

	return { hashId, text };
}

/**
 * Load and parse a text file for a locale
 */
export function loadTextFile(type: GameTextType, locale: Locale): Map<string, string> {
	const textFileType = TEXT_FILE_NAMES[type];
	const filename = `${textFileType}.cfg.bin.json`;
	const filePath = join(DATA_ROOT, "common/text", locale, filename);

	if (!existsSync(filePath)) {
		return new Map();
	}

	const content = readFileSync(filePath, "utf-8");
	const data = JSON.parse(content) as { entries: ConfigNode[] };

	const texts = new Map<string, string>();

	for (const entry of data.entries) {
		// Support all TEXT_INFO_BEGIN_x and NOUN_INFO_BEGIN_x formats
		if (
			(entry.name.startsWith("TEXT_INFO_BEGIN_") || entry.name.startsWith("NOUN_INFO_BEGIN_")) &&
			entry.children
		) {
			for (const child of entry.children) {
				if (child.name.startsWith("TEXT_INFO_") || child.name.startsWith("NOUN_INFO_")) {
					const parsed = parseTextInfoNode(child);
					if (parsed) {
						texts.set(parsed.hashId, parsed.text);
					}
				}
			}
		}
	}

	return texts;
}

/**
 * Load text file as an ordered list (for index-based lookups)
 */
export function loadTextList(type: GameTextType, locale: Locale): string[] {
	const textFileType = TEXT_FILE_NAMES[type];
	const filename = `${textFileType}.cfg.bin.json`;
	const filePath = join(DATA_ROOT, "common/text", locale, filename);

	if (!existsSync(filePath)) {
		return [];
	}

	const content = readFileSync(filePath, "utf-8");
	const data = JSON.parse(content) as { entries: ConfigNode[] };

	const list: string[] = [];

	for (const entry of data.entries) {
		if (
			(entry.name === "TEXT_INFO_BEGIN_0" || entry.name === "NOUN_INFO_BEGIN_0") &&
			entry.children
		) {
			// Sort children by name suffix to ensure correct order?
			// Usually they are already sorted TEXT_INFO_0, TEXT_INFO_1...
			// But let's trust the array order for performance, or better:
			// Extract index from name "TEXT_INFO_123" -> 123.
			for (const child of entry.children) {
				let text = "";
				let index = -1;

				if (child.name.startsWith("TEXT_INFO_") || child.name.startsWith("NOUN_INFO_")) {
					// Parse index from name
					const parts = child.name.split("_");
					const idxStr = parts[parts.length - 1];
					const idx = parseInt(idxStr, 10);
					if (!Number.isNaN(idx)) index = idx;

					const parsed = parseTextInfoNode(child);
					if (parsed) {
						text = parsed.text;
					}
				}

				if (index >= 0) {
					list[index] = text;
				}
			}
		}
	}

	return list;
}

/**
 * Localized text maps for a type
 */
export interface LocalizedTextMaps {
	type: GameTextType;
	maps: Map<Locale, Map<string, string>>;
	totalEntries: number;
}

/**
 * Build text maps for all available locales
 */
export function buildTextMaps(type: GameTextType): LocalizedTextMaps {
	const locales: Locale[] = ["ja", "en", "fr", "de", "es", "it", "pt", "zh_hans", "zh_hant"];
	const maps = new Map<Locale, Map<string, string>>();
	let totalEntries = 0;

	for (const locale of locales) {
		const map = loadTextFile(type, locale);
		if (map.size > 0) {
			maps.set(locale, map);
			if (locale === "en") {
				totalEntries = map.size;
			}
		}
	}

	return { type, maps, totalEntries };
}

/**
 * Get localized text for a hash
 */
export function getLocalizedText(
	maps: LocalizedTextMaps,
	hashId: string
): { en?: string; fr?: string; ja?: string } {
	return {
		en: maps.maps.get("en")?.get(hashId),
		fr: maps.maps.get("fr")?.get(hashId),
		ja: maps.maps.get("ja")?.get(hashId),
	};
}

/**
 * Pre-built text databases
 */
export interface TextDatabase {
	charaDescriptions: LocalizedTextMaps;
	skills: LocalizedTextMaps;
	items: LocalizedTextMaps;
	teams: LocalizedTextMaps;
	quests: LocalizedTextMaps;
	missions: LocalizedTextMaps;
}

/**
 * Build complete text database
 */
export function buildTextDatabase(): TextDatabase {
	console.log("[TextParser] Loading all text files...");

	const charaDescriptions = buildTextMaps("chara_description");
	console.log(`  - Character descriptions: ${charaDescriptions.totalEntries}`);

	const skills = buildTextMaps("skill");
	console.log(`  - Skill descriptions: ${skills.totalEntries}`);

	const items = buildTextMaps("item");
	console.log(`  - Item texts: ${items.totalEntries}`);

	const teams = buildTextMaps("team");
	console.log(`  - Team texts: ${teams.totalEntries}`);

	const quests = buildTextMaps("quest_title");
	console.log(`  - Quest titles: ${quests.totalEntries}`);

	const missions = buildTextMaps("mission");
	console.log(`  - Mission texts: ${missions.totalEntries}`);

	return { charaDescriptions, skills, items, teams, quests, missions };
}

/**
 * Asynchronously load and parse a text file for a locale
 */
export async function loadTextFileAsync(
	type: GameTextType,
	locale: Locale
): Promise<Map<string, string>> {
	const textFileType = TEXT_FILE_NAMES[type];
	const filename = `${textFileType}.cfg.bin.json`;
	const filePath = join(DATA_ROOT, "common/text", locale, filename);

	// loadJsonAsync handles caching and existence check
	const data = await loadJsonAsync<{ entries: ConfigNode[] }>(filePath);
	const texts = new Map<string, string>();

	if (!data) return texts;

	for (const entry of data.entries) {
		if (
			(entry.name.startsWith("TEXT_INFO_BEGIN_") || entry.name.startsWith("NOUN_INFO_BEGIN_")) &&
			entry.children
		) {
			for (const child of entry.children) {
				if (child.name.startsWith("TEXT_INFO_") || child.name.startsWith("NOUN_INFO_")) {
					const parsed = parseTextInfoNode(child);
					if (parsed) {
						texts.set(parsed.hashId, parsed.text);
					}
				}
			}
		}
	}

	return texts;
}

/**
 * Asynchronously load text file as an ordered list
 */
export async function loadTextListAsync(type: GameTextType, locale: Locale): Promise<string[]> {
	const textFileType = TEXT_FILE_NAMES[type];
	const filename = `${textFileType}.cfg.bin.json`;
	const filePath = join(DATA_ROOT, "common/text", locale, filename);

	const data = await loadJsonAsync<{ entries: ConfigNode[] }>(filePath);
	const list: string[] = [];

	if (!data) return list;

	for (const entry of data.entries) {
		if (
			(entry.name === "TEXT_INFO_BEGIN_0" || entry.name === "NOUN_INFO_BEGIN_0") &&
			entry.children
		) {
			for (const child of entry.children) {
				let text = "";
				let index = -1;

				if (child.name.startsWith("TEXT_INFO_") || child.name.startsWith("NOUN_INFO_")) {
					const parts = child.name.split("_");
					const idxStr = parts[parts.length - 1];
					const idx = parseInt(idxStr, 10);
					if (!Number.isNaN(idx)) index = idx;

					const parsed = parseTextInfoNode(child);
					if (parsed) {
						text = parsed.text;
					}
				}

				if (index >= 0) {
					list[index] = text;
				}
			}
		}
	}

	return list;
}

/**
 * Build text maps for all available locales asynchronously and in parallel
 */
export async function buildTextMapsAsync(type: GameTextType): Promise<LocalizedTextMaps> {
	const locales: Locale[] = ["ja", "en", "fr"];
	// Limit to main languages for performance unless needed

	const maps = new Map<Locale, Map<string, string>>();

	// Load all in parallel
	const results = await Promise.all(
		locales.map(async (loc) => ({ loc, map: await loadTextFileAsync(type, loc) }))
	);

	let totalEntries = 0;
	for (const { loc, map } of results) {
		if (map.size > 0) {
			maps.set(loc, map);
			if (loc === "en") totalEntries = map.size;
		}
	}

	return { type, maps, totalEntries };
}

/**
 * Build complete text database asynchronously
 */
export async function buildTextDatabaseAsync(): Promise<TextDatabase> {
	console.log("[TextParser] Loading all text files (Async)...");

	const [charaDescriptions, skills, items, teams, quests, missions] = await Promise.all([
		buildTextMapsAsync("chara_description"),
		buildTextMapsAsync("skill"),
		buildTextMapsAsync("item"),
		buildTextMapsAsync("team"),
		buildTextMapsAsync("quest_title"),
		buildTextMapsAsync("mission"),
	]);

	return { charaDescriptions, skills, items, teams, quests, missions };
}
