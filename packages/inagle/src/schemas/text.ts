/**
 * Text CFG.BIN schemas for localized strings
 *
 * Source files:
 * - dump/data/common/text/{locale}/chara_text.cfg.bin.json
 * - dump/data/common/text/{locale}/skill_text.cfg.bin.json
 * - dump/data/common/text/{locale}/item_text.cfg.bin.json
 * - dump/data/common/text/{locale}/team_text.cfg.bin.json
 *
 * Available locales: en, fr (with JSON exports)
 * Other locales (ja, de, es, it, pt, zh_hans, zh_hant) exist but need conversion
 */

/**
 * TEXT_INFO entry - generic text content
 * Found in: skill_text, item_text, team_text, menu_text, etc.
 *
 * Variables structure:
 * - variables[0].value: hashId (Int) - CRC32 hash identifier
 * - variables[1].value: index (Int) - Secondary index (usually 0)
 * - variables[2].value: text (String) - Localized text content
 */
export interface TextInfo {
	hashId: number;
	index: number;
	text: string;
}

/**
 * NOUN_INFO entry - character names with multiple forms
 * Found in: chara_text.cfg.bin.json
 *
 * Variables structure:
 * - variables[0].value: hashId (Int) - CRC32 hash
 * - variables[1].value: nameType (Int) - 0=full, 11=surname
 * - variables[2-4]: empty strings
 * - variables[5].value: name (String) - The actual name
 * - variables[6-9]: empty strings
 * - variables[10-14]: int flags
 */
export interface NounInfo {
	hashId: number;
	nameType: number;
	name: string;
}

/**
 * Locales with JSON exports available in dump
 */
export const AvailableLocales = ["en", "fr"] as const;
export type AvailableLocale = (typeof AvailableLocales)[number];

/**
 * All locales defined in dump structure
 */
export const AllLocales = [
	"ja", // Japanese
	"en", // English
	"fr", // French
	"de", // German
	"es", // Spanish
	"it", // Italian
	"pt", // Portuguese
	"zh_hans", // Simplified Chinese
	"zh_hant", // Traditional Chinese
] as const;
export type Locale = (typeof AllLocales)[number];

/**
 * Text file types available in each locale folder
 * Based on: dump/data/common/text/fr/*.cfg.bin.json
 */
export const TextFileTypes = [
	"ai_text",
	"chara_add_info_text",
	"chara_description_text",
	"chara_text",
	"chara_text_roma",
	"chat_text",
	"craft_text",
	"data_file_text",
	"extend_story_text",
	"formation_text",
	"help_list_text",
	"inacode_text",
	"item_text",
	"item_explain_text",
	"map_text",
	"map_text_roma",
	"medal_text",
	"menu_text",
	"mission_text",
	"music_name_text",
	"players_universe_text",
	"post_text",
	"quest_purpose_text",
	"quest_title_text",
	"rpg_battle_cmd_text",
	"rpg_battle_message_text",
	"rpg_battle_text",
	"scene_archive_text",
	"scout_phase_text",
	"search_word_text",
	"setting_text",
	"shop_text",
	"skill_text",
	"soccer_common_text",
	"soccer_game_title",
	"soccer_history_check_text",
	"soccer_quick_action_text",
	"soccer_suggest_text",
	"soccer_team_passive_text",
	"soccer_technic_text",
	"staffroll_text",
	"system_text",
	"team_text",
	"theater_text",
	"trophy_text",
] as const;
export type TextFileType = (typeof TextFileTypes)[number];
