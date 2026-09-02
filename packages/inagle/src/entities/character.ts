/**
 * @file character.ts
 * @description Complete character module with stats calculation
 *
 * This module combines:
 * - chara_base parsing for IDs and name hashes
 * - chara_param parsing for position, element, rarity
 * - chara_text parsing for localized names
 * - Growth table lookup for stats calculation
 * - Entity building for complete Character objects
 */

import {
	type GrowthTableEntry,
	loadGrowthTableMain,
	loadZukanMapping,
	loadZukanOrder,
} from "../core/data-loader.js";
import { createImageAPI } from "../core/images.js";
import type {
	Character,
	CharacterStats,
	LocalizedNames,
	MultiLevelStats,
	RarityId,
	BaseCharacter,
	CharacterVariant,
} from "../core/types.js";
import { buildSeriesMapping, buildTeamMapping } from "../parsers/belong-team.js";
import { parseAllCharaBase } from "../parsers/chara-base.js";
import { buildAllDescriptionMaps } from "../parsers/chara-description.js";
import {
	buildCharaParamMap,
	elementIdToNames,
	type ParsedCharaParam,
	parseAllCharaParams,
	positionIdToCode,
	buildCharaBaseToParamsMap,
} from "../parsers/chara-param.js";
import { buildAllNameMaps, getLocalizedNames } from "../parsers/chara-text.js";
import { buildConstellationMapping, type ConstellationMapping } from "../parsers/constellation.js";
import { type CtrlCharaData, loadCtrlCharaConfigAsync } from "../parsers/ctrl-chara-config.js";
import { type GrowthTableLv1, loadGrowthTableConfigAsync } from "../parsers/growth-table-config.js";
import { loadHeroConfig } from "../parsers/hero-config.js";
import { buildStarSignMap, rarityCodeToName, rarityToGrowthRank } from "../parsers/star-sign.js";
import { loadZukanCharacters } from "./chara-json.js";
import { parseCharaDetails } from "../parsers/chara-details.js";
import { loadUniversalText } from "../parsers/universal-text.js";

// ============================================================================
// Series from Internal Code
// ============================================================================

/**
 * Series mapping based on internal code prefix
 *
 * Validated against zukan.inazuma.jp (5640 cross-referenced characters):
 * - c01: Inazuma Eleven (IE1 — Mark Evans, Axel Blaze, Nathan Swift...)
 * - c02: Inazuma Eleven 2 (IE2 — Erik Eagle, Bryce Withingale...)
 * - c03: Inazuma Eleven 3 (IE3 — Luca, Fideo, Rococo...)
 * - c04: Inazuma Eleven GO (GO — Arion Sherwind, Victor Blade, Riccardo...)
 * - c05: Chrono Stone (GO2 — Fei Rune, Zanark, Alpha...)
 * - c06: Galaxy (GO3 — Samguk, Matatagi, Potomuri...)
 * - c07: Ares (Asuto/Astro, Nosaka, Haizaki...)
 * - c08: Orion (Ichihoshi, Froy, Zhao Jinyun...)
 * - c09-c12, npc: Victory Road
 */
// NOTE: Code prefixes do NOT reliably map to character origin series.
// The correct series comes from the game's seriesMapping (charaSeriesType).
// This fallback is only used when seriesMapping has no data.
// Mapping validated against zukan.inazuma.jp (5640 cross-referenced characters).
const SERIES_BY_CODE_PREFIX: Record<string, string> = {
	c01: "Inazuma Eleven",
	c02: "Inazuma Eleven 2",
	c03: "Inazuma Eleven 3",
	c04: "Inazuma Eleven GO",
	c05: "Chrono Stone",
	c06: "Galaxy",
	c07: "Ares",
	c08: "Orion",
	c09: "Victory Road",
	c10: "Victory Road",
	c11: "Victory Road",
	c12: "Victory Road",
	npc: "Victory Road",
};

/**
 * Get series name from internal code prefix
 */
function getSeriesFromInternalCode(code: string): string | undefined {
	if (!code) return undefined;

	// Try exact prefix match (c01, c02, etc.)
	const match = code.match(/^(c\d{2}|npc)/);
	if (match) {
		return SERIES_BY_CODE_PREFIX[match[1]];
	}

	return undefined;
}

// ============================================================================
// Growth Table Cache
// ============================================================================

// Controllable characters cache (loaded async on first use)
let ctrlCharaCache: Map<string, CtrlCharaData> | null = null;

async function _getCtrlCharaMap(): Promise<Map<string, CtrlCharaData>> {
	if (!ctrlCharaCache) {
		const data = await loadCtrlCharaConfigAsync();
		ctrlCharaCache = new Map();
		if (data) {
			for (const c of data) ctrlCharaCache.set(c.charaParamId, c);
		}
	}
	return ctrlCharaCache;
}

// Sync version for existing sync code paths
let ctrlCharaCacheSync: Map<string, CtrlCharaData> | null = null;

function getCtrlCharaMapSync(): Map<string, CtrlCharaData> {
	return ctrlCharaCacheSync ?? new Map();
}

// Growth table lv1 cache
let growthLv1Cache: GrowthTableLv1[] | null = null;

function getGrowthLv1(): GrowthTableLv1[] {
	return growthLv1Cache ?? [];
}

function findGrowthLv1(mainPos: number, subPos: number, playStyle: number): GrowthTableLv1 | null {
	const lv1 = getGrowthLv1();
	
	// 1. Try exact match (position + subposition + playstyle)
	const exact = lv1.find(
		(e) => e.mainPosition === mainPos && e.subPosition === subPos && e.playStyle === playStyle
	);
	if (exact) return exact;

	// 2. Fallback 1: Try position + subposition
	const fallback1 = lv1.find((e) => e.mainPosition === mainPos && e.subPosition === subPos);
	if (fallback1) return fallback1;

	// 3. Fallback 2: Try position + playstyle
	const fallback2 = lv1.find((e) => e.mainPosition === mainPos && e.playStyle === playStyle);
	if (fallback2) return fallback2;

	// 4. Fallback 3: Try just position
	const fallback3 = lv1.find((e) => e.mainPosition === mainPos);
	if (fallback3) return fallback3;

	return null;
}

let growthTableCache: Map<string, GrowthTableEntry> | null = null;

function getGrowthTable(): Map<string, GrowthTableEntry> {
	if (!growthTableCache) {
		const entries = loadGrowthTableMain();
		growthTableCache = new Map();

		for (const entry of entries) {
			// Key: position-pattern-rank
			const key = `${entry.mainPosition}-${entry.growthPattern}-${entry.charaRank}`;
			growthTableCache.set(key, entry);
		}
	}
	return growthTableCache;
}

/**
 * Find growth table entry for a character param, using rarity from starSign
 *
 * Growth table only contains patterns 0 and 1.
 * Characters with pattern 2+ fallback to pattern 1, then pattern 0.
 */
function findGrowthEntry(param: ParsedCharaParam, charaRank: number): GrowthTableEntry | undefined {
	const table = getGrowthTable();
	// Use the growth rank (0-5) for lookup, not the rarity code (1-7, 20)
	const growthRank = rarityToGrowthRank(charaRank);

	// Try exact pattern first
	const key = `${param.mainPosition}-${param.growthPattern}-${growthRank}`;
	let entry = table.get(key);

	// Fallback: growth table only has patterns 0 and 1
	// If pattern >= 2, try pattern 1 first (closer to original), then pattern 0
	if (!entry && param.growthPattern >= 2) {
		const fallback1Key = `${param.mainPosition}-1-${growthRank}`;
		entry = table.get(fallback1Key);
		if (!entry) {
			const fallback0Key = `${param.mainPosition}-0-${growthRank}`;
			entry = table.get(fallback0Key);
		}
	}

	return entry;
}

// ============================================================================
// Stats Calculation
// ============================================================================

/**
 * Convert growth entry to CharacterStats at level 50
 */
function statsAt50(entry: GrowthTableEntry): CharacterStats {
	return {
		kick: entry.Kc_50,
		control: entry.Cr_50,
		technique: entry.Tc_50,
		physical: entry.Pr_50,
		pressure: entry.Ps_50,
		agility: entry.Ag_50,
		intelligence: entry.It_50,
	};
}

/**
 * Convert growth entry to CharacterStats at level 99
 */
function statsAt99(entry: GrowthTableEntry): CharacterStats {
	return {
		kick: entry.Kc_99,
		control: entry.Cr_99,
		technique: entry.Tc_99,
		physical: entry.Pr_99,
		pressure: entry.Ps_99,
		agility: entry.Ag_99,
		intelligence: entry.It_99,
	};
}

/**
 * Calculate multi-level stats for a character
 */
function calculateMultiLevelStats(
	param: ParsedCharaParam,
	charaRank: number
): MultiLevelStats | undefined {
	const entry = findGrowthEntry(param, charaRank);
	if (!entry) return undefined;

	return {
		lv50: statsAt50(entry),
		lv99: statsAt99(entry),
	};
}

// ============================================================================
// Character Building
// ============================================================================

/**
 * Build a complete Character entity from parsed data
 */
export function buildCharacter(
	param: ParsedCharaParam,
	index: number,
	names: LocalizedNames,
	charaRank: number,
	gender?: number
): Character {
	const positionCode = positionIdToCode(param.mainPosition);
	const elementNames = elementIdToNames(param.element);
	const stats = calculateMultiLevelStats(param, charaRank);

	// Generate slug
	const slugName = names.en || names.fr || names.ja || "unknown";
	const slug = `${generateSlug(slugName)}-${param.charaParamId}`;

	const character: Character = {
		index,
		charaParamId: param.charaParamId,
		charaId: param.charaBaseId,

		names,

		position: positionCode ?? "MF",
		positionRaw: param.mainPosition as 0 | 1 | 2 | 3 | 4,
		subPosition: positionIdToCode(param.subPosition),

		element: elementNames?.en ?? "Unknown",
		elementRaw: param.element as 1 | 2 | 3 | 4,

		rarity: rarityCodeToName(charaRank),
		rarityCode: charaRank as RarityId,

		// Gender from chara_base: 1=male, 2=female → convert to 0/1 for consistency
		gender: gender === 2 ? 1 : 0,
		growthPattern: param.growthPattern,

		skills: param.skills || [],

		stats: stats ?? {
			lv50: {
				kick: 0,
				control: 0,
				technique: 0,
				physical: 0,
				pressure: 0,
				agility: 0,
				intelligence: 0,
			},
			lv99: {
				kick: 0,
				control: 0,
				technique: 0,
				physical: 0,
				pressure: 0,
				agility: 0,
				intelligence: 0,
			},
		},

		slug,
	};

	return character;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Load all characters with complete data
 *
 * Strategy:
 * 1. Load chara_base to get charaId -> nameHash mapping
 * 2. Load chara_param to get position, element, rarity, etc.
 * 3. Load chara_text to get localized names via nameHash
 * 4. Load chara_description_text to get localized descriptions
 * 5. Join all data together
 */
/**
 * Pre-load async data (ctrl-chara, growth lv1) into sync caches.
 * Call this once before loadAllCharacters() for enriched data.
 */
export async function preloadCharacterEnrichment(): Promise<void> {
	const [ctrlData, growthData] = await Promise.all([
		loadCtrlCharaConfigAsync(),
		loadGrowthTableConfigAsync(),
	]);

	ctrlCharaCacheSync = new Map();
	if (ctrlData) {
		for (const c of ctrlData) ctrlCharaCacheSync.set(c.charaParamId, c);
	}
	console.log(`[Character] Preloaded ${ctrlCharaCacheSync.size} controllable characters`);

	growthLv1Cache = growthData?.lv1 ?? [];
	console.log(`[Character] Preloaded ${growthLv1Cache.length} growth lv1 entries`);
}

export function loadAllCharacters(): Character[] {
	//console.log("[Character] Loading chara_base for name hashes...");
	const bases = parseAllCharaBase();
	//console.log(`[Character] Found ${bases.length} base entries`);

	// Build charaId -> nameHash/descriptionHash/gender/series/team maps
	const charaIdToNameHash = new Map<string, string>();
	const charaIdToLastNameHash = new Map<string, string>();
	const charaIdToDescHash = new Map<string, string>();
	const charaIdToCode = new Map<string, string>();
	const charaIdToGender = new Map<string, number>();
	const charaIdToSeriesId = new Map<string, string>();
	const charaIdToTeamId = new Map<string, string>();
	for (const base of bases) {
		charaIdToNameHash.set(base.charaId, base.nameHash);
		if (base.lastNameHash) {
			charaIdToLastNameHash.set(base.charaId, base.lastNameHash);
		}
		if (base.descriptionHash) {
			charaIdToDescHash.set(base.charaId, base.descriptionHash);
		}
		charaIdToCode.set(base.charaId, base.internalCode);
		charaIdToGender.set(base.charaId, base.gender);
		if (base.seriesId) {
			charaIdToSeriesId.set(base.charaId, base.seriesId);
		}
		if (base.belongTeamId) {
			charaIdToTeamId.set(base.charaId, base.belongTeamId);
		}
	}

	//console.log("[Character] Loading chara_param...");
	const params = parseAllCharaParams();
	//console.log(`[Character] Found ${params.length} param entries`);

	//console.log("[Character] Loading localized name maps...");
	const { names: nameMaps, romanized: romaMaps } = buildAllNameMaps();
	//console.log(`[Character] Loaded ${nameMaps.size} locale name maps`);

	//console.log("[Character] Loading character descriptions...");
	const descMaps = buildAllDescriptionMaps();

	//console.log("[Character] Loading star sign rarity data...");
	const starSignMap = buildStarSignMap();

	//console.log("[Character] Loading constellation data...");
	const constellationMapping = buildConstellationMapping();

	//console.log("[Character] Loading team and series data...");
	const teamMapping = buildTeamMapping();
	const seriesMapping = buildSeriesMapping();

	//console.log("[Character] Loading zukan mapping...");
	// Import dynamically or use the loader we added
	const zukanMapping = loadZukanMapping?.() || {};
	const zukanStats = loadZukanCharacters();
	const zukanOrderList = loadZukanOrder() || [];
	const hashToOrderMap = new Map<string, number>();
	for (const e of zukanOrderList) {
		if (e.zukanHash) hashToOrderMap.set(e.zukanHash, e.order);
	}

	const images = createImageAPI();

	// Load hero variant config (Fire/Black/Pink)
	const heroConfig = loadHeroConfig();

	const charaDetailsMap = parseCharaDetails();
	const charaTextMap = loadUniversalText("chara_text");

	const resolvePronoun = (hash: string | undefined): LocalizedNames | undefined => {
		if (!hash || hash === "0X00000000" || hash === "0x00000000") return undefined;
		const norm = hash.toUpperCase().replace("0X", "0x");
		const ja = charaTextMap.maps.get("ja")?.get(norm);
		const en = charaTextMap.maps.get("en")?.get(norm);
		const fr = charaTextMap.maps.get("fr")?.get(norm);
		if (ja || en || fr) {
			return { ja, en, fr };
		}
		return undefined;
	};

	//console.log("[Character] Building character entities...");
	const characters: Character[] = [];

	for (let i = 0; i < params.length; i++) {
		const param = params[i];

		// Get nameHash and descriptionHash from chara_base via charaBaseId
		const nameHash = charaIdToNameHash.get(param.charaBaseId);
		const descHash = charaIdToDescHash.get(param.charaBaseId);
		const internalCode = charaIdToCode.get(param.charaBaseId);

		// Get localized names using the nameHash (first name) + lastNameHash (family name)
		let localizedNames: LocalizedNames = {};
		if (nameHash) {
			localizedNames = getLocalizedNames(nameHash, nameMaps, romaMaps);
		}
		// Build full name: "FirstName LastName" for each locale
		const lastNameHash = charaIdToLastNameHash.get(param.charaBaseId);
		if (lastNameHash) {
			for (const [locale, map] of nameMaps) {
				const lastName = map.get(lastNameHash);
				if (!lastName) continue;
				const key = locale as keyof LocalizedNames;
				const firstName = localizedNames[key] as string | undefined;
				if (firstName && !firstName.includes(lastName)) {
					(localizedNames as any)[key] = `${firstName} ${lastName}`;
				}
			}
		}

		// Get localized descriptions using the descriptionHash
		let descriptions: LocalizedNames | undefined;
		if (descHash) {
			const en = descMaps.descriptions.get("en")?.get(descHash);
			const fr = descMaps.descriptions.get("fr")?.get(descHash);
			const ja = descMaps.descriptions.get("ja")?.get(descHash);
			if (en || fr || ja) {
				descriptions = { en, fr, ja };
			}
		}

		// Get rarity from starSign (or fallback to 0)
		const starSign = starSignMap.get(param.charaParamId);
		const charaRank = starSign?.charaRarity ?? 0;

		// Get gender from chara_base
		const gender = charaIdToGender.get(param.charaBaseId);

		// Build character with internalCode, rarity, and gender
		const character = buildCharacter(param, i, localizedNames, charaRank, gender);
		if (internalCode) {
			character.internalCode = internalCode;
			// Resolve image path
			character.image = images.face(internalCode);
		}
		if (descriptions) {
			character.descriptions = descriptions;
		}

		// Tag hero variant type (Fire/Black/Pink) from soccer_chara_unique_rarity_config
		const heroType = heroConfig.byParamId.get(param.charaParamId);
		if (heroType) {
			character.sheetData = { ...character.sheetData, heroType };
			// Hero variants get the "Héros" rarity label
			character.rarity = "Héros";
			character.rarityCode = 10 as RarityId;
		}

		// Tag controllable characters from ctrl_chara_config (indexed by charaId/charaBaseId)
		const ctrlChara = getCtrlCharaMapSync().get(param.charaBaseId);
		if (ctrlChara) {
			character.isControllable = true;
			character.controlType = ctrlChara.controlType;
		}

		const details = charaDetailsMap.get(param.charaBaseId.toUpperCase());
		if (details) {
			character.personalityType = details.personalityType;
			character.firstPerson = resolvePronoun(details.firstPerson);
			character.secondPersonMale = resolvePronoun(details.secondPersonMale);
			character.secondPersonFemale = resolvePronoun(details.secondPersonFemale);
		}

		// Add lv1 stats from growth_table_config (independent of growthTableMain)
		const lv1Entry = findGrowthLv1(param.mainPosition, param.subPosition, param.growthPattern);
		if (lv1Entry) {
			character.stats.lv1 = {
				kick: lv1Entry.Kc_1,
				control: lv1Entry.Cr_1,
				technique: lv1Entry.Tc_1,
				physical: lv1Entry.Pr_1,
				pressure: lv1Entry.Ps_1,
				agility: lv1Entry.Ag_1,
				intelligence: lv1Entry.It_1,
			};
		}

		// Backfill stats from Zukan (chara.json) if missing
		if (
			character.stats.lv99.kick === 0 &&
			character.internalCode &&
			zukanStats.has(character.internalCode)
		) {
			const zData = zukanStats.get(character.internalCode)!;
			character.stats.lv99 = {
				kick: zData.stats.kick,
				control: zData.stats.control,
				technique: zData.stats.technique,
				pressure: zData.stats.pressure,
				physical: zData.stats.physical,
				agility: zData.stats.agility,
				intelligence: zData.stats.intelligence,
			};
		}

		// Add zukan hash and order from mapping
		const zukanInfo = zukanMapping[param.charaParamId] as string | { hash: string; order: number };
		if (zukanInfo) {
			if (typeof zukanInfo === "string") {
				// Legacy support or fallback if type mismatch
				character.zukanHash = zukanInfo;
			} else {
				character.zukanHash = zukanInfo.hash;
				character.zukanOrder = zukanInfo.order;
			}
		}
		if (character.zukanHash && (character.zukanOrder === undefined || character.zukanOrder === null || character.zukanOrder === 0)) {
			const o = hashToOrderMap.get(character.zukanHash);
			if (o !== undefined) {
				character.zukanOrder = o;
			}
		}

		// Add constellation data
		const constellationIndex = constellationMapping.byCharacterId.get(param.charaParamId);
		if (constellationIndex !== undefined) {
			const constellation = constellationMapping.constellations[constellationIndex];
			if (constellation) {
				character.constellation = {
					index: constellation.index,
					names: constellation.names,
				};
			}
		}

		// Add series data — seriesId from cfg.bin field[15] is authoritative
		const seriesId = charaIdToSeriesId.get(param.charaBaseId);
		if (seriesId) {
			character.seriesId = seriesId;
			const series = seriesMapping.get(seriesId);
			if (series) {
				character.series = series.names.en ?? series.names.ja;
			}
		}

		// Fallback: derive series from internal code prefix
		if (!character.series && internalCode) {
			const seriesFromCode = getSeriesFromInternalCode(internalCode);
			if (seriesFromCode) {
				character.series = seriesFromCode;
			}
		}

		// Add team data
		const teamId = charaIdToTeamId.get(param.charaBaseId);
		if (teamId) {
			const team = teamMapping.get(teamId);
			if (team) {
				// Convert seasons object to array of season names
				const seasonNames = Object.keys(team.seasons) as string[];
				character.teams = [
					{
						id: team.teamId,
						names: team.names,
						seasons: seasonNames,
					},
				];
			}
		}

		characters.push(character);
	}

	// Sort by Zukan Order first (to match official site), then by internal code
	characters.sort((a, b) => {
		const orderA = a.zukanOrder !== undefined && a.zukanOrder !== null ? a.zukanOrder : 999999;
		const orderB = b.zukanOrder !== undefined && b.zukanOrder !== null ? b.zukanOrder : 999999;
		if (orderA !== orderB) {
			return orderA - orderB;
		}

		// Fallback to internal code
		const codeA = a.internalCode || "";
		const codeB = b.internalCode || "";
		return codeA.localeCompare(codeB, undefined, { numeric: true });
	});
	//console.log(`[Character] Built ${characters.length} complete characters`);
	return characters;
}

/**
 * Get a character by param ID
 */
export function getCharacterByParamId(paramId: string): Character | undefined {
	const paramMap = buildCharaParamMap();
	const param = paramMap.get(paramId);
	if (!param) return undefined;

	const { names: nameMaps, romanized: romaMaps } = buildAllNameMaps();
	const localizedNames = getLocalizedNames(param.charaBaseId, nameMaps, romaMaps);

	// Get rarity from starSign
	const starSignMap = buildStarSignMap();
	const starSign = starSignMap.get(paramId);
	const charaRank = starSign?.charaRarity ?? 0;

	const character = buildCharacter(param, 0, localizedNames, charaRank);

	// Add constellation data
	const constellationMapping = buildConstellationMapping();
	const constellationIndex = constellationMapping.byCharacterId.get(paramId);
	if (constellationIndex !== undefined) {
		const constellation = constellationMapping.constellations[constellationIndex];
		if (constellation) {
			character.constellation = {
				index: constellation.index,
				names: constellation.names,
			};
		}
	}

	return character;
}

/**
 * Filter characters by criteria
 */
export interface CharacterFilter {
	position?: "GK" | "FW" | "MF" | "DF";
	element?: 0 | 1 | 2 | 3;
	minRarity?: number;
	maxRarity?: number;
	gender?: 0 | 1;
	hasNames?: boolean;
}

/**
 * Load characters matching filter
 */
export function loadFilteredCharacters(filter: CharacterFilter): Character[] {
	const all = loadAllCharacters();

	return all.filter((char) => {
		if (filter.position && char.position !== filter.position) return false;
		if (filter.element !== undefined && char.elementRaw !== filter.element) return false;
		if (filter.minRarity && char.rarityCode < filter.minRarity) return false;
		if (filter.maxRarity && char.rarityCode > filter.maxRarity) return false;
		if (filter.gender !== undefined && char.gender !== filter.gender) return false;
		if (filter.hasNames && !char.names.ja && !char.names.en && !char.names.fr) return false;
		return true;
	});
}

/**
 * Get character statistics summary
 */
export interface CharacterStatsSummary {
	total: number;
	byPosition: Record<string, number>;
	byElement: Record<string, number>;
	byRarity: Record<string, number>;
	withNames: number;
	withStats: number;
}

export function getCharacterStats(characters: Character[]): CharacterStatsSummary {
	const summary: CharacterStatsSummary = {
		total: characters.length,
		byPosition: { GK: 0, FW: 0, MF: 0, DF: 0 },
		byElement: { Fire: 0, Wind: 0, Forest: 0, Mountain: 0 },
		byRarity: {},
		withNames: 0,
		withStats: 0,
	};

	for (const char of characters) {
		// By position
		if (char.position in summary.byPosition) {
			summary.byPosition[char.position]++;
		}

		// By element
		const elementNames = elementIdToNames(char.elementRaw);
		if (elementNames) {
			summary.byElement[elementNames.en] = (summary.byElement[elementNames.en] ?? 0) + 1;
		}

		// By rarity
		summary.byRarity[char.rarity] = (summary.byRarity[char.rarity] ?? 0) + 1;

		// With names
		if (char.names.ja || char.names.en || char.names.fr) {
			summary.withNames++;
		}

		// With stats
		if (char.stats.lv99.kick > 0) {
			summary.withStats++;
		}
	}

	return summary;
}

// ============================================================================
// BASE CHARACTER WITH VARIANTS
// ============================================================================



/**
 * Build a CharacterVariant from parsed param data
 */
function buildVariant(
	param: ParsedCharaParam,
	charaRank: number,
	constellationMapping?: ConstellationMapping,
	slug?: string,
	internalCode?: string,
	image?: string,
	sheetData?: any
): CharacterVariant {
	const positionCode = positionIdToCode(param.mainPosition);
	const elementNames = elementIdToNames(param.element);
	const stats = calculateMultiLevelStats(param, charaRank);

	const lv1Entry = findGrowthLv1(param.mainPosition, param.subPosition, param.growthPattern);
	const lv1Stats = lv1Entry ? {
		kick: lv1Entry.Kc_1,
		control: lv1Entry.Cr_1,
		technique: lv1Entry.Tc_1,
		physical: lv1Entry.Pr_1,
		pressure: lv1Entry.Ps_1,
		agility: lv1Entry.Ag_1,
		intelligence: lv1Entry.It_1,
	} : undefined;

	const variant: CharacterVariant = {
		charaParamId: param.charaParamId,
		position: positionCode ?? "MF",
		positionRaw: param.mainPosition as 0 | 1 | 2 | 3 | 4,
		subPosition: positionIdToCode(param.subPosition),
		element: elementNames?.en ?? "Unknown",
		elementRaw: param.element,
		rarity: rarityCodeToName(charaRank),
		rarityCode: charaRank,
		growthPattern: param.growthPattern,
		skills: param.skills || [],
		stats: {
			lv50: stats?.lv50 ?? { kick: 0, control: 0, technique: 0, physical: 0, pressure: 0, agility: 0, intelligence: 0 },
			lv99: stats?.lv99 ?? { kick: 0, control: 0, technique: 0, physical: 0, pressure: 0, agility: 0, intelligence: 0 },
			lv1: lv1Stats
		} as any,
		slug,
		internalCode,
		image,
		sheetData
	};

	if (constellationMapping) {
		const constellationIndex = constellationMapping.byCharacterId.get(param.charaParamId);
		if (constellationIndex !== undefined) {
			const constellation = constellationMapping.constellations[constellationIndex];
			if (constellation) {
				variant.constellation = {
					index: constellation.index,
					names: constellation.names,
				};
			}
		}
	}

	return variant;
}

/**
 * Generate a URL-friendly slug from a name
 */
function generateSlug(name: string): string {
	return name
		.toLowerCase()
		.replace(/['’]/g, "") // Remove apostrophes
		.replace(/[^a-z0-9]+/g, "_") // Replace non-alphanumeric with underscore
		.replace(/^_+|_+$/g, ""); // Trim underscores
}

/**
 * Load all base characters with their variants grouped
 *
 * Returns one entry per unique character (charaId),
 * with all their card variants (charaParamId) inside.
 */
export function loadBaseCharacters(): BaseCharacter[] {
	const bases = parseAllCharaBase();

	// Build maps
	const charaIdToBase = new Map<string, (typeof bases)[0]>();
	const charaIdToSeriesId = new Map<string, string>(); // Add this map
	for (const base of bases) {
		charaIdToBase.set(base.charaId, base);
		if (base.seriesId) {
			charaIdToSeriesId.set(base.charaId, base.seriesId);
		}
	}
	const baseToParams = buildCharaBaseToParamsMap();

	const { names: nameMaps, romanized: romaMaps } = buildAllNameMaps();

	const starSignMap = buildStarSignMap();

	const constellationMapping = buildConstellationMapping();

	const teamMapping = buildTeamMapping();
	const seriesMapping = buildSeriesMapping(); // Load series mapping

	const zukanMapping = loadZukanMapping?.() || {};
	const zukanStats = loadZukanCharacters();
	const images = createImageAPI();
	const zukanOrderList = loadZukanOrder() || [];
	const hashToOrderMap = new Map<string, number>();
	for (const e of zukanOrderList) {
		if (e.zukanHash) hashToOrderMap.set(e.zukanHash, e.order);
	}

	const charaDetailsMap = parseCharaDetails();
	const charaTextMap = loadUniversalText("chara_text");

	const resolvePronoun = (hash: string | undefined): LocalizedNames | undefined => {
		if (!hash || hash === "0X00000000" || hash === "0x00000000") return undefined;
		const norm = hash.toUpperCase().replace("0X", "0x");
		const ja = charaTextMap.maps.get("ja")?.get(norm);
		const en = charaTextMap.maps.get("en")?.get(norm);
		const fr = charaTextMap.maps.get("fr")?.get(norm);
		if (ja || en || fr) {
			return { ja, en, fr };
		}
		return undefined;
	};

	const results: BaseCharacter[] = [];

	for (const [charaId, params] of baseToParams) {
		const base = charaIdToBase.get(charaId);
		if (!base) continue;

		// Get localized names
		const localizedNames = getLocalizedNames(base.nameHash, nameMaps, romaMaps);
		const slugName = localizedNames.en || localizedNames.fr || localizedNames.ja || "unknown";
		const baseSlug = generateSlug(slugName);

		// Build all variants
		const variants: CharacterVariant[] = [];
		let bestRarityCode = 0;

		for (const param of params) {
			const starSign = starSignMap.get(param.charaParamId);
			const charaRank = starSign?.charaRarity ?? 0;
			const variantSlug = `${baseSlug}-${param.charaParamId}`;
			const faceImage = images.face(base.internalCode);
			const variant = buildVariant(param, charaRank, constellationMapping, variantSlug, base.internalCode, faceImage);

			// Backfill stats from Zukan (chara.json) if missing
			if (variant.stats.lv99.kick === 0 && base.internalCode && zukanStats.has(base.internalCode)) {
				const zData = zukanStats.get(base.internalCode)!;
				variant.stats.lv99 = {
					kick: zData.stats.kick,
					control: zData.stats.control,
					technique: zData.stats.technique,
					pressure: zData.stats.pressure,
					physical: zData.stats.physical,
					agility: zData.stats.agility,
					intelligence: zData.stats.intelligence,
				};
			}

			const zukanInfo = zukanMapping[param.charaParamId] as
				| string
				| { hash: string; order: number };
			if (zukanInfo) {
				if (typeof zukanInfo === "string") {
					variant.zukanHash = zukanInfo;
				} else {
					variant.zukanHash = zukanInfo.hash;
					variant.zukanOrder = zukanInfo.order;
				}
			}
			if (variant.zukanHash && (variant.zukanOrder === undefined || variant.zukanOrder === null || variant.zukanOrder === 0)) {
				const o = hashToOrderMap.get(variant.zukanHash);
				if (o !== undefined) {
					variant.zukanOrder = o;
				}
			}

			variants.push(variant);

			if (charaRank > bestRarityCode) {
				bestRarityCode = charaRank;
			}
		}

		// Sort variants by age (youngest first)
		variants.sort((a, b) => {
			const orderA = a.zukanOrder !== undefined && a.zukanOrder !== null ? a.zukanOrder : 999999;
			const orderB = b.zukanOrder !== undefined && b.zukanOrder !== null ? b.zukanOrder : 999999;
			if (orderA !== orderB) return orderA - orderB;
			const idA = parseInt(a.charaParamId, 16) || 0;
			const idB = parseInt(b.charaParamId, 16) || 0;
			return idA - idB;
		});

		const isBasara = variants.some((v) => v.rarityCode === 20);

		// Get team info
		const baseEntry = charaIdToBase.get(charaId);
		let teamId: string | undefined;
		let teamName: string | undefined;

		if (baseEntry?.belongTeamId) {
			teamId = baseEntry.belongTeamId;
			const team = teamMapping.get(teamId);
			// Use French name if available, else English, else undefined
			if (team) {
				teamName = team.names.fr || team.names.en || team.names.ja;
			}
		}

		// Find best zukan hash (prefer variants with hash, sorted by zukanOrder ascending)
		let zukanHash: string | undefined;

		const variantsWithHash = variants.filter((v) => v.zukanHash);
		if (variantsWithHash.length > 0) {
			variantsWithHash.sort((a, b) => {
				const orderA = a.zukanOrder ?? 999999;
				const orderB = b.zukanOrder ?? 999999;
				if (orderA !== orderB) return orderA - orderB;
				return a.rarityCode - b.rarityCode;
			});
			zukanHash = variantsWithHash[0].zukanHash;
		}

		// Find constellation (common to all variants of a base character usually)
		const constellation = variants.find((v) => v.constellation)?.constellation;

		// Resolve Series
		let series: { id: string; type: number; name?: string } | undefined;
		const seriesId = charaIdToSeriesId.get(charaId);
		if (seriesId) {
			const s = seriesMapping.get(seriesId);
			if (s) {
				series = {
					id: s.seriesId,
					type: s.type,
					name: s.names.fr || s.names.en || s.names.ja,
				};
			}
		}
		// Fallback to internal code prefix
		if (!series && base.internalCode) {
			const seriesName = getSeriesFromInternalCode(base.internalCode);
			if (seriesName) {
				// Construct a pseudo-series object for consistency
				// We don't have an ID, so we use the name as ID or a placeholder
				series = {
					id: seriesName,
					type: 0,
					name: seriesName,
				};
			}
		}

		// Generate slug
		const slug = generateSlug(slugName);

		// Check if this base character is controllable (ctrl_chara uses charaId)
		const isControllable = getCtrlCharaMapSync().has(charaId);

		const details = charaDetailsMap.get(charaId.toUpperCase());

		results.push({
			charaId,
			internalCode: base.internalCode,
			zukanHash, // Add zukanHash
			names: localizedNames,
			gender: base.gender === 2 ? 1 : 0,
			variants,
			bestRarity: rarityCodeToName(bestRarityCode),
			bestRarityCode,
			slug,
			isBasara,
			isControllable: isControllable || undefined,
			teamId,
			teamName,
			constellation,
			series,
			personalityType: details?.personalityType,
			firstPerson: resolvePronoun(details?.firstPerson),
			secondPersonMale: resolvePronoun(details?.secondPersonMale),
			secondPersonFemale: resolvePronoun(details?.secondPersonFemale),
		});
	}

	// GROUPING BY NAME (User Request)
	// Merge characters that have the exact same name (e.g., Mark Evans forms)
	const nameMap = new Map<string, BaseCharacter>();

	for (const char of results) {
		// Use French name as key, or fallback to English/Japanese
		const key = char.names.fr || char.names.en || char.names.ja || char.charaId;

		if (nameMap.has(key)) {
			const existing = nameMap.get(key)!;
			// Merge variants
			existing.variants.push(...char.variants);

			// Update best rarity if needed
			if (char.bestRarityCode > existing.bestRarityCode) {
				existing.bestRarityCode = char.bestRarityCode;
				existing.bestRarity = char.bestRarity;
			}

			// Update isBasara flag
			if (char.isBasara) existing.isBasara = true;

			// Perform resort of variants by age (youngest first)
			existing.variants.sort((a, b) => {
				const orderA = a.zukanOrder !== undefined && a.zukanOrder !== null ? a.zukanOrder : 999999;
				const orderB = b.zukanOrder !== undefined && b.zukanOrder !== null ? b.zukanOrder : 999999;
				if (orderA !== orderB) return orderA - orderB;
				const idA = parseInt(a.charaParamId, 16) || 0;
				const idB = parseInt(b.charaParamId, 16) || 0;
				return idA - idB;
			});
		} else {
			nameMap.set(key, char);
		}
	}

	// Rebuild results from map values
	const uniqueResults = Array.from(nameMap.values());

	// Update representative fields for ALL base characters from their youngest variant
	for (const char of uniqueResults) {
		if (char.variants.length > 0) {
			const youngest = char.variants[0];
			// Determine the actual best rarity across all variants
			let maxRarityCode = 0;
			let maxRarity = "Normal";
			for (const v of char.variants) {
				if (v.rarityCode > maxRarityCode) {
					maxRarityCode = v.rarityCode;
					maxRarity = v.rarity;
				}
			}
			char.bestRarityCode = maxRarityCode;
			char.bestRarity = maxRarity;
			char.image = youngest.image || char.image;
			char.slug = youngest.slug || char.slug;
			char.zukanHash = youngest.zukanHash || char.zukanHash;
			char.sheetData = youngest.sheetData || char.sheetData;
			char.internalCode = youngest.internalCode || char.internalCode;
			char.icons = { face: youngest.image };
		}
	}

	// Sort by best rarity then by name
	uniqueResults.sort((a, b) => {
		if (b.bestRarityCode !== a.bestRarityCode) {
			return b.bestRarityCode - a.bestRarityCode;
		}
		return (a.names.en ?? a.names.ja ?? "").localeCompare(b.names.en ?? b.names.ja ?? "");
	});
	return uniqueResults;
}

/**
 * Get statistics about base characters
 */
export interface BaseCharacterStats {
	totalBaseCharacters: number;
	totalVariants: number;
	avgVariantsPerCharacter: number;
	maxVariants: number;
	maxVariantsCharacter?: string;
	basaraCount: number;
	byBestRarity: Record<string, number>;
}

export function getBaseCharacterStats(characters: BaseCharacter[]): BaseCharacterStats {
	let totalVariants = 0;
	let maxVariants = 0;
	let maxVariantsCharacter: string | undefined;
	let basaraCount = 0;
	const byBestRarity: Record<string, number> = {};

	for (const char of characters) {
		totalVariants += char.variants.length;

		if (char.variants.length > maxVariants) {
			maxVariants = char.variants.length;
			maxVariantsCharacter = char.names.en ?? char.names.ja;
		}

		if (char.isBasara) basaraCount++;

		byBestRarity[char.bestRarity] = (byBestRarity[char.bestRarity] ?? 0) + 1;
	}

	return {
		totalBaseCharacters: characters.length,
		totalVariants,
		avgVariantsPerCharacter: Math.round((totalVariants / characters.length) * 100) / 100,
		maxVariants,
		maxVariantsCharacter,
		basaraCount,
		byBestRarity,
	};
}
