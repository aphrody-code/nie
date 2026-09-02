/**
 * @file constellation.ts
 * @description Parser for Players Universe (Constellation) data
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { PATHS, resolveGameDataFile } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

/** Raw star info from starInfo.json */
export interface StarInfo {
	starNameHash: string;
	starLocatorNameHash: string;
	starTextureNameHash: string;
	starAfterTextureNameHash: string;
	rareStarTextureNameHash: string;
	starSignLayerNameHash: string;
	starLayerNameHash: string;
	numTextureNameHash: string;
	starKeyInfoList: [number, number];
}

/** Raw rarity rate info */
export interface StarSignRarityRateInfo {
	rarityType: number;
	rarityRateDefault: number;
	rarityRateBoostA: number;
	rarityRateBoostB: number;
	rarityRateBoostC: number;
	rarityRateBoostD: number;
	starSignCharaInfoList: [number, number]; // [offset, count]
}

/** Constellation with localized names */
export interface Constellation {
	/** Index (0-29) */
	index: number;
	/** Hash ID for lookup */
	hashId: string;
	/** Localized names */
	names: {
		fr?: string;
		en?: string;
		ja?: string;
	};
	/** Character param IDs in this constellation */
	characterIds: string[];
	/** Character count */
	characterCount: number;
	/** Texture/visual references */
	textures: {
		star: string;
		starAfter: string;
		rareStar: string;
		layer: string;
	};
}

/** Mapping from charaParamId to constellation index */
export interface ConstellationMapping {
	/** charaParamId -> constellation index */
	byCharacterId: Map<string, number>;
	/** constellation index -> constellation data */
	constellations: Constellation[];
}

// ============================================================================
// Text Parsing
// ============================================================================

/** Parse players_universe_text for constellation names */
function parseConstellationNames(locale: "fr" | "en" | "ja"): Map<number, string> {
	const filePath = join(PATHS.textRoot, locale, "players_universe_text.cfg.bin.json");
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
							// Parse as signed int, then convert to unsigned for matching
							const hashSigned = Number.parseInt(hashStr, 10);
							const hash = hashSigned < 0 ? hashSigned >>> 0 : hashSigned;
							names.set(hash, text);
						}
					}
				}
			}
		}
	} catch (e) {
		console.error(`[Constellation] Failed to parse ${filePath}:`, e);
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

let constellationCache: ConstellationMapping | null = null;

/** Star sign info from starSignInfo.json */
export interface StarSignInfoEntry {
	starSignIdCrc: string;
	starSignNameId: string;
	starSignInfoTextId: string;
	starSignNo: number;
	keyItemId: string;
	keyItemNum: number;
	dropCharacterNum: number;
	starKeyNameHash: string;
	clearFlagIndex: number;
	enableCond: string;
}

/**
 * Charge les `lists` du vrai config Players Universe
 * (`players_universe_config_*.cfg.bin.json`) et indexe par nom de liste.
 *
 * Source de vérité = octets réels du dump. Les listes star/sign vivent ici
 * (`m_starInfoList`, `m_starSignInfoList`, `m_starSignRarityRateInfoList`,
 * `m_starSignCharaInfoList`, `m_starSignCharaSetDataList`), chaque entrée sous
 * la clé `values`. Repli legacy : anciens JSON pré-extraits dans all-gamedata.
 */
let rawListsCache: Map<string, any[]> | null = null;
function loadPlayersUniverseLists(): Map<string, any[]> {
	if (rawListsCache) return rawListsCache;
	const map = new Map<string, any[]>();
	const filePath =
		resolveGameDataFile("players_universe", "players_universe_config") ||
		join(PATHS.playersUniverse, "players_universe_config_1.03.59.00.cfg.bin.json");
	if (existsSync(filePath)) {
		try {
			const data = JSON.parse(readFileSync(filePath, "utf-8"));
			for (const list of data.lists || []) {
				if (list?.name) map.set(list.name, list.values || []);
			}
		} catch (e) {
			console.error(`[Constellation] Failed to parse ${filePath}:`, e);
		}
	}
	rawListsCache = map;
	return map;
}

/** Repli legacy : ancien JSON pré-extrait `all-gamedata/<name>.json` (`{ data: [] }`). */
function loadLegacyAllGamedata<T>(fileName: string): T[] {
	const filePath = join(PATHS.allGamedata, fileName);
	if (!existsSync(filePath)) return [];
	try {
		const data = JSON.parse(readFileSync(filePath, "utf-8"));
		return data.data || [];
	} catch {
		return [];
	}
}

/** Load star sign info (30 constellations with name hashes) */
function loadStarSignInfo(): StarSignInfoEntry[] {
	const fromConfig = loadPlayersUniverseLists().get("m_starSignInfoList");
	if (fromConfig?.length) return fromConfig as StarSignInfoEntry[];
	return loadLegacyAllGamedata<StarSignInfoEntry>("starSignInfo.json");
}

/** Load star info (30 constellations) */
function loadStarInfo(): StarInfo[] {
	const fromConfig = loadPlayersUniverseLists().get("m_starInfoList");
	if (fromConfig?.length) return fromConfig as StarInfo[];
	return loadLegacyAllGamedata<StarInfo>("starInfo.json");
}

/** Load rarity rate info (90 entries) */
function loadRarityRateInfo(): StarSignRarityRateInfo[] {
	const fromConfig = loadPlayersUniverseLists().get("m_starSignRarityRateInfoList");
	if (fromConfig?.length) return fromConfig as StarSignRarityRateInfo[];
	return loadLegacyAllGamedata<StarSignRarityRateInfo>("starSignRarityRateInfo.json");
}

/** Load character info (5010 entries) */
function loadCharaInfo(): Array<{ charaParamId: string }> {
	const fromConfig = loadPlayersUniverseLists().get("m_starSignCharaInfoList");
	if (fromConfig?.length) return fromConfig as Array<{ charaParamId: string }>;
	return loadLegacyAllGamedata<{ charaParamId: string }>("starSignCharaInfo.json");
}

// ============================================================================
// Main Builder
// ============================================================================

/**
 * Build complete constellation mapping
 * Maps each character to their constellation
 */
export function buildConstellationMapping(): ConstellationMapping {
	if (constellationCache) return constellationCache;

	// Load raw data
	const starSignInfoList = loadStarSignInfo();
	const starInfoList = loadStarInfo();
	const rarityRateList = loadRarityRateInfo();
	const charaInfoList = loadCharaInfo();

	// Load localized names
	const namesFR = parseConstellationNames("fr");
	const namesEN = parseConstellationNames("en");
	const namesJA = parseConstellationNames("ja");

	// Build map from starKeyNameHash -> starSignInfo (for linking with starInfo)
	const keyHashToSignInfo = new Map<string, StarSignInfoEntry>();
	for (const signInfo of starSignInfoList) {
		keyHashToSignInfo.set(signInfo.starKeyNameHash, signInfo);
	}

	// Pré-résolution des noms localisés HORS de la boucle principale. Sous Bun
	// 1.4-canary, faire les `Map.get()` de noms à l'intérieur de la grande boucle
	// builder déclenche une miscompilation JIT (un nom sur 30 sortait
	// `undefined`). Cette petite boucle dédiée n'est pas mal-optimisée et donne un
	// résultat déterministe 30/30. Indexée par position dans starInfoList.
	const resolvedNames: Array<{ fr?: string; en?: string; ja?: string }> = [];
	for (let i = 0; i < starInfoList.length; i++) {
		const signInfo = keyHashToSignInfo.get(starInfoList[i].starNameHash);
		const nameHash = signInfo ? hashToNumber(signInfo.starSignNameId) : 0;
		resolvedNames.push({
			fr: namesFR.get(nameHash),
			en: namesEN.get(nameHash),
			ja: namesJA.get(nameHash),
		});
	}

	// Build constellations
	const constellations: Constellation[] = [];
	const byCharacterId = new Map<string, number>();

	for (let i = 0; i < starInfoList.length; i++) {
		const star = starInfoList[i];

		// Noms localisés : pré-résolus hors boucle (cf. note ci-dessus).
		const names = resolvedNames[i];

		// Each constellation has 3 rarity entries (indices i*3, i*3+1, i*3+2)
		const rarityEntries = [
			rarityRateList[i * 3],
			rarityRateList[i * 3 + 1],
			rarityRateList[i * 3 + 2],
		].filter(Boolean);

		// Collect all character IDs for this constellation
		const characterIds: string[] = [];

		for (const entry of rarityEntries) {
			const [offset, count] = entry.starSignCharaInfoList;
			for (let j = 0; j < count; j++) {
				const charaEntry = charaInfoList[offset + j];
				if (charaEntry) {
					characterIds.push(charaEntry.charaParamId);
					byCharacterId.set(charaEntry.charaParamId, i);
				}
			}
		}

		const constellation: Constellation = {
			index: i,
			hashId: star.starNameHash,
			names,
			characterIds,
			characterCount: characterIds.length,
			textures: {
				star: star.starTextureNameHash,
				starAfter: star.starAfterTextureNameHash,
				rareStar: star.rareStarTextureNameHash,
				layer: star.starLayerNameHash,
			},
		};

		constellations.push(constellation);
	}

	constellationCache = { constellations, byCharacterId };
	return constellationCache;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Get all constellations
 */
export function getAllConstellations(): Constellation[] {
	return buildConstellationMapping().constellations;
}

/**
 * Get constellation for a character by param ID
 */
export function getConstellationForCharacter(charaParamId: string): Constellation | undefined {
	const mapping = buildConstellationMapping();
	const index = mapping.byCharacterId.get(charaParamId);
	if (index === undefined) return undefined;
	return mapping.constellations[index];
}

/**
 * Get constellation by index (0-29)
 */
export function getConstellationByIndex(index: number): Constellation | undefined {
	return buildConstellationMapping().constellations[index];
}

/**
 * Get constellation by name (searches FR, EN, JA)
 */
export function getConstellationByName(name: string): Constellation | undefined {
	const q = name.toLowerCase();
	return buildConstellationMapping().constellations.find(
		(c) =>
			c.names.fr?.toLowerCase().includes(q) ||
			c.names.en?.toLowerCase().includes(q) ||
			c.names.ja?.includes(name)
	);
}

/**
 * Get all character IDs in a constellation
 */
export function getCharacterIdsInConstellation(constellationIndex: number): string[] {
	const constellation = getConstellationByIndex(constellationIndex);
	return constellation?.characterIds || [];
}

/** Clear cache (for testing) */
export function clearConstellationCache(): void {
	constellationCache = null;
	rawListsCache = null;
}
