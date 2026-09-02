/**
 * @file belong-team.ts
 * @description Parser for team affiliation data
 *
 * Maps characters to their teams with localized names and season appearances.
 *
 * Data sources:
 * - belongTeamInfo.json: 205 teams with season appearances
 * - team_text.cfg.bin.json: Localized team names (FR, EN, JA)
 * - charaSeriesInfo.json: 9 series (IE, GO, Ares, Orion, Victory Road)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sanitizeText } from "../core/data-loader.js";
import { PATHS } from "../core/paths.js";
import type { LocalizedNames } from "../core/types.js";

// ============================================================================
// Types
// ============================================================================

/** Raw belong team info from belongTeamInfo.json */
export interface BelongTeamInfo {
	belongTeamId: string;
	binderTeamOrderType: number;
	teamNameTextId: string;
	teamEmblemId_IE: string;
	teamEmblemId_GO: string;
	teamEmblemId_AREORI: string;
	teamEmblemId_V: string;
	teamNumber_IE1: number;
	teamNumber_IE2: number;
	teamNumber_IE3: number;
	teamNumber_GO1: number;
	teamNumber_GO2: number;
	teamNumber_GO3: number;
	teamNumber_ARES: number;
	teamNumber_ORION: number;
	teamNumber_V: number;
	teamKit_IE: string;
	teamKit_GO: string;
	teamKit_AREORI: string;
	teamKit_V: string;
}

/** Season codes */
export type Season = "IE1" | "IE2" | "IE3" | "GO1" | "GO2" | "GO3" | "ARES" | "ORION" | "V";

/** Season names for display */
export const SEASON_NAMES: Record<Season, { en: string; fr: string; ja: string }> = {
	IE1: { en: "IE Season 1", fr: "IE Saison 1", ja: "イナズマイレブン1" },
	IE2: { en: "IE Season 2", fr: "IE Saison 2", ja: "イナズマイレブン2" },
	IE3: { en: "IE Season 3", fr: "IE Saison 3", ja: "イナズマイレブン3" },
	GO1: { en: "GO Season 1", fr: "GO Saison 1", ja: "GO1" },
	GO2: { en: "GO Chrono Stone", fr: "GO Chrono Stone", ja: "GOクロノストーン" },
	GO3: { en: "GO Galaxy", fr: "GO Galaxy", ja: "GOギャラクシー" },
	ARES: { en: "Ares", fr: "Ares", ja: "アレスの天秤" },
	ORION: { en: "Orion", fr: "Orion", ja: "オリオンの刻印" },
	V: { en: "Victory Road", fr: "Victory Road", ja: "ビクトリーロード" },
};

/** Enriched team with localized names and seasons */
export interface Team {
	/** Team hash ID */
	teamId: string;
	/** Order type for sorting */
	orderType: number;
	/** Localized team names */
	names: LocalizedNames;
	/** Seasons where this team appears (with their appearance number) */
	seasons: Partial<Record<Season, number>>;
	/** Emblems by series */
	emblems: {
		ie?: string;
		go?: string;
		aresOrion?: string;
		v?: string;
	};
	/** Kits by series */
	kits: {
		ie?: string;
		go?: string;
		aresOrion?: string;
		v?: string;
	};
}

/** Raw series info from charaSeriesInfo.json */
export interface CharaSeriesInfo {
	charaSeriesId: string;
	charaSeriesType: number;
	charaSeriesNameTextId: string;
}

/** Enriched series with localized names */
export interface Series {
	/** Series hash ID */
	seriesId: string;
	/** Series type (1-9) */
	type: number;
	/** Localized series names */
	names: LocalizedNames;
}

/** Series type enum — validated against zukan.inazuma.jp character data */
export const SERIES_TYPE = {
	IE1: 1,
	IE2: 2,
	IE3: 3,
	GO: 4,
	CHRONO_STONE: 5,
	GALAXY: 6,
	ARES: 7,
	ORION: 8,
	VICTORY_ROAD: 9,
} as const;

/** Series names by type — validated against zukan.inazuma.jp (5640 cross-referenced characters) */
const SERIES_NAMES_BY_TYPE: Record<number, LocalizedNames> = {
	1: { en: "Inazuma Eleven", fr: "Inazuma Eleven", ja: "イナズマイレブン" },
	2: {
		en: "Inazuma Eleven 2",
		fr: "Inazuma Eleven 2",
		ja: "イナズマイレブン2 脅威の侵略者 ファイア／ブリザード",
	},
	3: {
		en: "Inazuma Eleven 3",
		fr: "Inazuma Eleven 3",
		ja: "イナズマイレブン3 世界への挑戦!! スパーク／ボンバー／ジ・オーガ",
	},
	4: {
		en: "Inazuma Eleven GO",
		fr: "Inazuma Eleven GO",
		ja: "イナズマイレブンGO シャイン／ダーク",
	},
	5: {
		en: "Chrono Stone",
		fr: "Chrono Stone",
		ja: "イナズマイレブンGO2 クロノ・ストーン ネップウ／ライメイ",
	},
	6: {
		en: "Galaxy",
		fr: "Galaxy",
		ja: "イナズマイレブンGO ギャラクシー ビッグバン／スーパーノヴァ",
	},
	7: { en: "Ares", fr: "Ares", ja: "イナズマイレブン アレスの天秤" },
	8: { en: "Orion", fr: "Orion", ja: "イナズマイレブン オリオンの刻印" },
	9: {
		en: "Victory Road",
		fr: "Victory Road",
		ja: "イナズマイレブン 英雄たちのヴィクトリーロード",
	},
};

// ============================================================================
// Text Parsing
// ============================================================================

/** Parse team names from team_text.cfg.bin.json */
function parseTeamNames(locale: "fr" | "en" | "ja"): Map<number, string> {
	const filePath = join(PATHS.textRoot, locale, "team_text.cfg.bin.json");
	const names = new Map<number, string>();

	if (!existsSync(filePath)) {
		return names;
	}

	try {
		const data = JSON.parse(readFileSync(filePath, "utf-8"));

		for (const entry of data.entries || []) {
			if (entry.name.startsWith("NOUN_INFO_BEGIN")) {
				for (const child of entry.children || []) {
					if (child.name.startsWith("NOUN_INFO_")) {
						const vars = child.variables || [];
						// First variable is hash (signed int as string)
						const hashStr = vars[0]?.value;
						// 6th variable (index 5) is the text
						const text = vars[5]?.value;

						if (hashStr !== undefined && text) {
							const hashSigned = Number.parseInt(hashStr, 10);
							const hash = hashSigned < 0 ? hashSigned >>> 0 : hashSigned;
							const cleaned = sanitizeText(text);
							/* if (text.includes("[")) {
															} */
							names.set(hash, cleaned);
						}
					}
				}
			}
		}
	} catch (e) {
		console.error(`[BelongTeam] Failed to parse ${filePath}:`, e);
	}

	return names;
}

/** Convert hex hash string to unsigned number */
function hashToNumber(hash: string): number {
	return Number.parseInt(hash, 16) >>> 0;
}

// ============================================================================
// Data Loading
// ============================================================================

let teamCache: Map<string, Team> | null = null;
let seriesCache: Map<string, Series> | null = null;

/** Load belong team info (205 teams) */
function loadBelongTeamInfo(): BelongTeamInfo[] {
	const filePath = join(PATHS.allGamedata, "belongTeamInfo.json");

	if (existsSync(filePath)) {
		const data = JSON.parse(readFileSync(filePath, "utf-8"));
		return data.data || [];
	}

	// Fallback to raw config
	const rawPath = join(PATHS.character, "belong_team_config_0.00.00.cfg.bin.json");
	if (existsSync(rawPath)) {
		try {
			const data = JSON.parse(readFileSync(rawPath, "utf-8"));
			return data.lists?.[0]?.values || [];
		} catch (e) {
			console.error("[BelongTeam] Failed to parse raw belong team config:", e);
		}
	}

	return [];
}

/** Load series info (9 series) */
function loadCharaSeriesInfo(): CharaSeriesInfo[] {
	const filePath = join(PATHS.allGamedata, "charaSeriesInfo.json");

	if (existsSync(filePath)) {
		const data = JSON.parse(readFileSync(filePath, "utf-8"));
		return data.data || [];
	}

	// Fallback to raw config
	const rawPath = join(PATHS.character, "chara_series_config.cfg.bin.json");
	if (existsSync(rawPath)) {
		try {
			const data = JSON.parse(readFileSync(rawPath, "utf-8"));
			return data.lists?.[0]?.values || [];
		} catch (e) {
			console.error("[BelongTeam] Failed to parse raw series config:", e);
		}
	}

	return [];
}

// ============================================================================
// Main Builders
// ============================================================================

/**
 * Build team mapping
 */
export function buildTeamMapping(): Map<string, Team> {
	if (teamCache) return teamCache;

	const rawTeams = loadBelongTeamInfo();

	// Load localized names
	const namesFR = parseTeamNames("fr");
	const namesEN = parseTeamNames("en");
	const namesJA = parseTeamNames("ja");

	teamCache = new Map();

	for (const raw of rawTeams) {
		const nameHash = hashToNumber(raw.teamNameTextId);

		// Build seasons map
		const seasons: Partial<Record<Season, number>> = {};
		if (raw.teamNumber_IE1 > 0) seasons.IE1 = raw.teamNumber_IE1;
		if (raw.teamNumber_IE2 > 0) seasons.IE2 = raw.teamNumber_IE2;
		if (raw.teamNumber_IE3 > 0) seasons.IE3 = raw.teamNumber_IE3;
		if (raw.teamNumber_GO1 > 0) seasons.GO1 = raw.teamNumber_GO1;
		if (raw.teamNumber_GO2 > 0) seasons.GO2 = raw.teamNumber_GO2;
		if (raw.teamNumber_GO3 > 0) seasons.GO3 = raw.teamNumber_GO3;
		if (raw.teamNumber_ARES > 0) seasons.ARES = raw.teamNumber_ARES;
		if (raw.teamNumber_ORION > 0) seasons.ORION = raw.teamNumber_ORION;
		if (raw.teamNumber_V > 0) seasons.V = raw.teamNumber_V;

		const team: Team = {
			teamId: raw.belongTeamId,
			orderType: raw.binderTeamOrderType,
			names: {
				fr: namesFR.get(nameHash),
				en: namesEN.get(nameHash),
				ja: namesJA.get(nameHash),
			},
			seasons,
			emblems: {
				ie: raw.teamEmblemId_IE !== "0x00000000" ? raw.teamEmblemId_IE : undefined,
				go: raw.teamEmblemId_GO !== "0x00000000" ? raw.teamEmblemId_GO : undefined,
				aresOrion: raw.teamEmblemId_AREORI !== "0x00000000" ? raw.teamEmblemId_AREORI : undefined,
				v: raw.teamEmblemId_V !== "0x00000000" ? raw.teamEmblemId_V : undefined,
			},
			kits: {
				ie: raw.teamKit_IE !== "0x00000000" ? raw.teamKit_IE : undefined,
				go: raw.teamKit_GO !== "0x00000000" ? raw.teamKit_GO : undefined,
				aresOrion: raw.teamKit_AREORI !== "0x00000000" ? raw.teamKit_AREORI : undefined,
				v: raw.teamKit_V !== "0x00000000" ? raw.teamKit_V : undefined,
			},
		};

		teamCache.set(raw.belongTeamId, team);
	}

	return teamCache;
}

/**
 * Build series mapping
 */
export function buildSeriesMapping(): Map<string, Series> {
	if (seriesCache) return seriesCache;

	const rawSeries = loadCharaSeriesInfo();

	seriesCache = new Map();

	for (const raw of rawSeries) {
		// Use hardcoded names based on type (text files don't have reliable entries)
		const hardcodedNames = SERIES_NAMES_BY_TYPE[raw.charaSeriesType];

		const series: Series = {
			seriesId: raw.charaSeriesId,
			type: raw.charaSeriesType,
			names: hardcodedNames || { en: `Series ${raw.charaSeriesType}` },
		};

		seriesCache.set(raw.charaSeriesId, series);
	}

	return seriesCache;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get all teams
 */
export function getAllTeams(): Team[] {
	return Array.from(buildTeamMapping().values()).sort((a, b) => a.orderType - b.orderType);
}

/**
 * Get team by ID
 */
export function getTeamById(teamId: string): Team | undefined {
	return buildTeamMapping().get(teamId);
}

/**
 * Get all series
 */
export function getAllSeries(): Series[] {
	return Array.from(buildSeriesMapping().values()).sort((a, b) => a.type - b.type);
}

/**
 * Get series by ID
 */
export function getSeriesById(seriesId: string): Series | undefined {
	return buildSeriesMapping().get(seriesId);
}

/**
 * Get teams by season
 */
export function getTeamsBySeason(season: Season): Team[] {
	return getAllTeams().filter((t) => t.seasons[season] !== undefined);
}

/**
 * Search teams by name
 */
export function searchTeams(query: string): Team[] {
	const q = query.toLowerCase();
	return getAllTeams().filter(
		(t) =>
			t.names.fr?.toLowerCase().includes(q) ||
			t.names.en?.toLowerCase().includes(q) ||
			t.names.ja?.includes(query)
	);
}

/** Clear caches (for testing) */
export function clearTeamCache(): void {
	teamCache = null;
	seriesCache = null;
}
