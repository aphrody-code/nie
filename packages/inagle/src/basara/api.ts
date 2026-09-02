/**
 * BASARA API - Complete BASARA data with multilingual support
 *
 * Uses pre-extracted data from:
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createCharactersAPI } from "../characters/api.js";
import { PATHS } from "../core/paths.js";
import {
	ElementNames as ELEMENT_NAMES,
	PositionNames as POSITION_NAMES,
	type Basara,
	type CharacterStats,
	type Character as EnrichedCharacter,
	type ElementId,
	type PositionId,
} from "../core/types.js";
import { loadBasaraConfig } from "../parsers/basara-config.js";
import { entreesDe } from "../utils/tables.js";

// Type aliases for compatibility
type BasaraCharacter = Basara;
type BasaraStats = CharacterStats;
type Position = "Coach" | "GK" | "FW" | "MF" | "DF";

interface BasaraDatabase {
	basara: BasaraCharacter[];
}

export { ELEMENT_NAMES, POSITION_NAMES };

// Data path (relative to inagle package)
const DEFAULT_ENTITIES_PATH = PATHS.entities;

/** Enriched BASARA with computed properties */
export interface EnrichedBasara extends BasaraCharacter {
	/** Primary display name (FR > EN > JA) */
	displayName: string;
	/** Element name (multilingual) */
	elementName: { en: string; ja: string; fr: string };
	/** Position name (multilingual) */
	positionName: { en: string; ja: string; fr: string };
	/** Total stats at Lv99 */
	totalStatsLv99: number;
	/** Hero variant count (0-3) */
	heroVariantCount: number;
	/** Build Type Indices (Raw) */
	buildTypeIndices?: number[];
}

/** In-memory BASARA database */
export interface BasaraIndexes {
	/** All enriched BASARA */
	all: EnrichedBasara[];
	/** By charaParamId */
	byParamId: Map<string, EnrichedBasara>;
	/** By charaId */
	byCharaId: Map<string, EnrichedBasara>;
	/** By internalCode */
	byCode: Map<string, EnrichedBasara>;
	/** By element (1-4) */
	byElement: Map<number, EnrichedBasara[]>;
	/** By position (1-4) */
	byPosition: Map<number, EnrichedBasara[]>;
	/** Metadata */
	meta: {
		generatedAt: string;
		totalCount: number;
		buildsPerCharacter: number;
		totalBuilds: number;
	};
}

/** Calculate total stats */
function sumStats(stats: BasaraStats): number {
	if (!stats) return 0;
	return (
		stats.kick +
		stats.control +
		stats.technique +
		stats.pressure +
		stats.physical +
		stats.agility +
		stats.intelligence
	);
}

/** Count available hero variants */
function countVariants(char: BasaraCharacter): number {
	let count = 0;
	if (char.heroVariants.hasFire) count++;
	if (char.heroVariants.hasBlack) count++;
	if (char.heroVariants.hasPink) count++;
	return count;
}

/**
 * Convert EnrichedCharacter to BasaraCharacter format
 */
function characterToBasara(char: EnrichedCharacter, index: number): BasaraCharacter {
	// Map element from character (Fire/Wind/Forest/Mountain) to basara element codes
	const elementMap: Record<string, number> = {
		Wind: 1,
		Forest: 2,
		Fire: 3,
		Mountain: 4,
	};

	// Map position from character (GK/DF/MF/FW) to basara position codes
	const positionMap: Record<string, number> = {
		GK: 1,
		FW: 2,
		MF: 3,
		DF: 4,
	};

	const elementRaw = (elementMap[char.element] || 1) as ElementId;
	const positionRaw = (positionMap[char.position] || 1) as PositionId;
	const internalCode = char.internalCode || char.charaId;

	return {
		index,
		charaParamId: char.charaParamId,
		charaId: char.charaId,
		internalCode: internalCode,
		names: {
			fr: char.names.fr || "?",
			en: char.names.en || "?",
			ja: char.names.ja || "?",
		},
		icons: {
			face: `chara_face/${internalCode}_01.png`,
			face2: `chara_face/${internalCode}_02.png`,
		},
		position: char.position as Position,
		positionRaw,
		element: ELEMENT_NAMES[elementRaw]?.fr || "Feu",
		elementRaw,
		rarity: "BASARA",
		rarityCode: 20, // RarityId.BASARA
		gender: char.gender,
		growthPattern: char.growthPattern,
		builds: [],
		skills: [],
		heroVariants: {
			hasFire: false,
			hasBlack: false,
			hasPink: false,
		},
		stats: {
			lv99: char.stats.lv99 ||
				char.stats.lv50 || {
					kick: 0,
					control: 0,
					technique: 0,
					pressure: 0,
					physical: 0,
					agility: 0,
					intelligence: 0,
				},
			lv50: char.stats.lv50,
			lv30: char.stats.lv30,
			lv1: char.stats.lv1,
		},
	};
}

/**
 * Build complete BASARA indexes from entities data or Characters API
 */
export function buildBasaraDatabase(options?: { entitiesPath?: string }): BasaraIndexes {
	const entitiesPath = options?.entitiesPath || DEFAULT_ENTITIES_PATH;
	const dataFile = join(entitiesPath, "basara-complete.json");

	// Load Basara Config Map (Sync)
	const basaraConfig = loadBasaraConfig();
	const buildMap = new Map<string, number[]>();
	if (basaraConfig) {
		for (const info of basaraConfig.buildInfos) {
			buildMap.set(info.charaId, info.buildTypeIndices);
		}
	}

	let basaraList: BasaraCharacter[];

	// Try loading from pre-generated file first
	if (existsSync(dataFile)) {
		const raw: BasaraDatabase = JSON.parse(readFileSync(dataFile, "utf-8"));
		basaraList = raw.basara;
	} else {
		// Fallback: extract BASARA from Characters API
		//console.log("[Basara] Loading from Characters API (no pre-generated file)");
		const charApi = createCharactersAPI();
		const allChars = charApi.all();
		const basaraChars = allChars.filter((c) => c.rarity === "BASARA" || c.rarityCode === 20);
		basaraList = basaraChars.map((c, i) => characterToBasara(c, i + 1));
	}

	// Build indexes
	const all: EnrichedBasara[] = [];
	const byParamId = new Map<string, EnrichedBasara>();
	const byCharaId = new Map<string, EnrichedBasara>();
	const byCode = new Map<string, EnrichedBasara>();
	const byElement = new Map<number, EnrichedBasara[]>();
	const byPosition = new Map<number, EnrichedBasara[]>();

	for (const basara of basaraList) {
		const displayName =
			basara.names.fr !== "?"
				? basara.names.fr!
				: basara.names.en !== "?"
					? basara.names.en!
					: basara.names.ja || "Unknown";

		const pos = POSITION_NAMES[basara.positionRaw] || POSITION_NAMES[1];

		const enriched: EnrichedBasara = {
			...basara,
			displayName,
			elementName: ELEMENT_NAMES[basara.elementRaw] || ELEMENT_NAMES[1],
			positionName: { en: pos.en, fr: pos.fr, ja: pos.en }, // JA missing in types
			totalStatsLv99: sumStats(basara.stats.lv99),
			heroVariantCount: countVariants(basara),
			buildTypeIndices: buildMap.get(basara.charaParamId),
		};

		all.push(enriched);

		// Index by IDs
		byParamId.set(basara.charaParamId, enriched);
		byCharaId.set(basara.charaId, enriched);
		if (basara.internalCode) {
			byCode.set(basara.internalCode, enriched);
		}

		// Index by element
		if (!byElement.has(basara.elementRaw)) {
			byElement.set(basara.elementRaw, []);
		}
		byElement.get(basara.elementRaw)?.push(enriched);

		// Index by position
		if (!byPosition.has(basara.positionRaw)) {
			byPosition.set(basara.positionRaw, []);
		}
		byPosition.get(basara.positionRaw)?.push(enriched);
	}

	return {
		all,
		byParamId,
		byCharaId,
		byCode,
		byElement,
		byPosition,
		meta: {
			generatedAt: new Date().toISOString(),
			totalCount: basaraList.length,
			buildsPerCharacter: 6,
			totalBuilds: basaraList.length * 6,
		},
	};
}

/**
 * Create BASARA API instance
 */
export function createBasaraAPI(options?: { entitiesPath?: string }) {
	const db = buildBasaraDatabase(options);

	return {
		/** Database metadata */
		meta: db.meta,

		/** Get all BASARA characters */
		all: () => db.all,

		/** Get BASARA by charaParamId */
		get: (id: string) => db.byParamId.get(id),

		/** Get BASARA by charaId */
		getByCharaId: (charaId: string) => db.byCharaId.get(charaId),

		/** Get BASARA by internalCode (e.g., "c01000100") */
		getByCode: (code: string) => db.byCode.get(code),

		/** Get BASARA by element (number or string) */
		byElement: (element: number | string) => {
			let elementId: number;
			if (typeof element === "string") {
				const entry = entreesDe(ELEMENT_NAMES).find(
					([, v]) =>
						v.en.toLowerCase() === element.toLowerCase() ||
						v.fr.toLowerCase() === element.toLowerCase()
				);
				if (!entry) return [];
				elementId = Number.parseInt(entry[0], 10);
			} else {
				elementId = element;
			}
			return db.byElement.get(elementId) || [];
		},

		/** Get BASARA by position (number or string) */
		byPosition: (position: number | string | Position) => {
			let positionId: number;
			if (typeof position === "string") {
				// Reverse lookup code from POSITION_MAP if possible?
				// Or search in POSITION_NAMES
				const entry = entreesDe(POSITION_NAMES).find(
					([, v]) =>
						v.code.toLowerCase() === position.toLowerCase() ||
						v.fr.toLowerCase() === position.toLowerCase() ||
						v.en.toLowerCase() === position.toLowerCase()
				);

				if (entry) {
					positionId = Number.parseInt(entry[0], 10);
				} else {
					return [];
				}
			} else {
				positionId = position;
			}
			return db.byPosition.get(positionId) || [];
		},

		/** Search BASARA by name */
		search: (query: string, options?: { lang?: "en" | "ja" | "fr"; limit?: number }) => {
			const q = query.toLowerCase();
			const lang = options?.lang;
			const limit = options?.limit || 20;

			const results: EnrichedBasara[] = [];

			for (const basara of db.all) {
				let match = false;

				if (!lang || lang === "fr") {
					match = match || (basara.names.fr?.toLowerCase().includes(q) ?? false);
				}
				if (!lang || lang === "en") {
					match = match || (basara.names.en?.toLowerCase().includes(q) ?? false);
				}
				if (!lang || lang === "ja") {
					match = match || (basara.names.ja?.includes(q) ?? false);
				}

				if (match) {
					results.push(basara);
					if (results.length >= limit) break;
				}
			}

			return results;
		},

		/** Get goalkeepers */
		goalkeepers: () => db.byPosition.get(1) || [],

		/** Get forwards */
		forwards: () => db.byPosition.get(2) || [],

		/** Get midfielders */
		midfielders: () => db.byPosition.get(3) || [],

		/** Get defenders */
		defenders: () => db.byPosition.get(4) || [],

		/** Get fire element BASARA */
		fire: () => db.byElement.get(3) || [],

		/** Get wood element BASARA */
		wood: () => db.byElement.get(2) || [],

		/** Get wind element BASARA */
		wind: () => db.byElement.get(1) || [],

		/** Get mountain element BASARA */
		mountain: () => db.byElement.get(4) || [],

		/** Get BASARA with hero variants */
		withHeroVariants: () => db.all.filter((b) => b.heroVariantCount > 0),

		/** Get top BASARA by total stats at Lv99 */
		topByStats: (limit = 10) => {
			return [...db.all].sort((a, b) => b.totalStatsLv99 - a.totalStatsLv99).slice(0, limit);
		},

		/** Get top BASARA by a specific stat at Lv99 */
		topByStat: (stat: keyof BasaraStats, limit = 10) => {
			return [...db.all].sort((a, b) => b.stats.lv99[stat] - a.stats.lv99[stat]).slice(0, limit);
		},

		/** Get BASARA with specific hero variant */
		withVariant: (variant: "fire" | "black" | "pink") => {
			return db.all.filter((b) => {
				switch (variant) {
					case "fire":
						return b.heroVariants.hasFire;
					case "black":
						return b.heroVariants.hasBlack;
					case "pink":
						return b.heroVariants.hasPink;
					default:
						return false;
				}
			});
		},

		/** Element names map */
		elements: ELEMENT_NAMES,

		/** Position names map */
		positions: POSITION_NAMES,
	};
}

export type BasaraAPI = ReturnType<typeof createBasaraAPI>;
