/**
 * Characters API - Complete character data with multilingual support
 *
 * Derived exclusively from official game data files:
 * - chara_base_*.cfg.bin.json (IDs, hashes)
 * - chara_param_*.cfg.bin.json (stats, position, element)
 * - chara_text.cfg.bin.json (names)
 * - chara_description_text.cfg.bin.json (descriptions)
 * - star_sign_*.cfg.bin.json (rarity)
 */

import { createImageAPI } from "../core/images.js";
import type { BaseCharacter, Character } from "../core/types.js";
import { loadAllCharacters, loadBaseCharacters } from "../entities/character.js";

// Alias for backward compatibility
export type EnrichedCharacter = Character;

// Legacy type aliases (deprecated)
export interface CharacterDetail {
	chara_id: string;
	personality_type: number;
	name_FR?: string;
	name_EN?: string;
	name_JA?: string;
}

export interface CharacterNametag {
	charaId: string;
	nameHash: string;
	name_EN?: string;
	name_JA?: string;
	name_FR?: string;
}

export interface CharacterStarSign {
	charaParamId: string;
	charaRarity: number;
	isRemarkable: boolean;
}

export interface CharacterIdMapping {
	charaId: string;
	charaIdStr: string;
	nameHash: string;
}

/** Rarity names (French display labels — system_text NOUN_INFO 76-82) */
export const RARITY_NAMES: Record<number, string> = {
	0: "Normal",
	1: "En progression",
	2: "Expérimenté",
	3: "Émérite",
	4: "Normal",
	5: "Normal",
	6: "Normal",
	7: "Normal",
	10: "Héros",
	20: "BASARA",
};

/** Personality names */
export const PERSONALITY_NAMES: Record<number, { en: string; ja: string; fr: string }> = {
	0: { en: "Unknown", ja: "不明", fr: "Inconnu" },
	1: { en: "Gentle", ja: "おだやか", fr: "Doux" },
	2: { en: "Cool", ja: "クール", fr: "Cool" },
	3: { en: "Hot", ja: "熱血", fr: "Passionné" },
	4: { en: "Shy", ja: "内気", fr: "Timide" },
	5: { en: "Mature", ja: "大人", fr: "Mature" },
	6: { en: "Cheerful", ja: "明るい", fr: "Joyeux" },
	7: { en: "Serious", ja: "真面目", fr: "Sérieux" },
	8: { en: "Wild", ja: "ワイルド", fr: "Sauvage" },
	9: { en: "Mysterious", ja: "ミステリアス", fr: "Mystérieux" },
	10: { en: "Elegant", ja: "上品", fr: "Élégant" },
	11: { en: "Mischievous", ja: "いたずら", fr: "Espiègle" },
};

/** Characters database */
export interface CharactersDatabase {
	generatedAt: string;
	totalCharacters: number;
	characters: Character[];
	byCharaId: Map<string, Character>;
	byParamId: Map<string, Character>;
	byInternalCode: Map<string, Character>;
	byRarity: Map<number, Character[]>;
	byPosition: Map<string, Character[]>;
	byElement: Map<number, Character[]>;
	stats: {
		withNameFR: number;
		withNameEN: number;
		withNameJA: number;
		withRarity: number;
		remarkable: number;
		byRarity: Record<string, number>;
		byPosition: Record<string, number>;
		byElement: Record<string, number>;
	};
}

/**
 * Build complete characters database from parsers
 */
export function buildCharactersDatabase(): CharactersDatabase {
	// Load all characters from the entity builder
	// Note: preloadCharacterEnrichment() must be called before this for ctrl-chara data
	const characters = loadAllCharacters();

	// Initialize Image API for auto-matching
	const images = createImageAPI();

	// Build indexes
	const byCharaId = new Map<string, Character>();
	const byParamId = new Map<string, Character>();
	const byInternalCode = new Map<string, Character>();
	const byRarity = new Map<number, Character[]>();
	const byPosition = new Map<string, Character[]>();
	const byElement = new Map<number, Character[]>();

	const stats = {
		withNameFR: 0,
		withNameEN: 0,
		withNameJA: 0,
		withRarity: 0,
		remarkable: 0,
		byRarity: {} as Record<string, number>,
		byPosition: {} as Record<string, number>,
		byElement: {} as Record<string, number>,
	};

	for (const char of characters) {
		// Auto-resolve image if not already present or if we want to ensure latest map
		const resolvedFace = images.face(char.charaId);
		if (resolvedFace) {
			if (!char.icons) char.icons = {};
			char.icons.face = resolvedFace;
		}

		// Index by IDs
		byCharaId.set(char.charaId, char);
		byParamId.set(char.charaParamId, char);
		if (char.internalCode) {
			byInternalCode.set(char.internalCode, char);
		}

		// Group by rarity
		if (!byRarity.has(char.rarityCode)) {
			byRarity.set(char.rarityCode, []);
		}
		byRarity.get(char.rarityCode)?.push(char);

		// Group by position
		if (!byPosition.has(char.position)) {
			byPosition.set(char.position, []);
		}
		byPosition.get(char.position)?.push(char);

		// Group by element
		if (!byElement.has(char.elementRaw)) {
			byElement.set(char.elementRaw, []);
		}
		byElement.get(char.elementRaw)?.push(char);

		// Stats
		if (char.names.fr) stats.withNameFR++;
		if (char.names.en) stats.withNameEN++;
		if (char.names.ja) stats.withNameJA++;
		if (char.rarityCode > 0) stats.withRarity++;

		const rarityName = RARITY_NAMES[char.rarityCode] || `R${char.rarityCode}`;
		stats.byRarity[rarityName] = (stats.byRarity[rarityName] || 0) + 1;
		stats.byPosition[char.position] = (stats.byPosition[char.position] || 0) + 1;

		// 1=Wind, 2=Forest, 3=Fire, 4=Mountain
		const elemNameMap: Record<number, string> = {
			1: "Wind",
			2: "Forest",
			3: "Fire",
			4: "Mountain",
		};
		const elemName = elemNameMap[char.elementRaw] || "Unknown";
		stats.byElement[elemName] = (stats.byElement[elemName] || 0) + 1;
	}

	return {
		generatedAt: new Date().toISOString(),
		totalCharacters: characters.length,
		characters,
		byCharaId,
		byParamId,
		byInternalCode,
		byRarity,
		byPosition,
		byElement,
		stats,
	};
}

/**
 * Create Characters API
 */
/**
 * Create Empty Characters API (Fallback)
 */
function createEmptyCharactersAPI() {
	return {
		meta: {
			generatedAt: new Date().toISOString(),
			totalCharacters: 0,
			stats: {
				withNameFR: 0,
				withNameEN: 0,
				withNameJA: 0,
				withRarity: 0,
				remarkable: 0,
				byRarity: {} as Record<string, number>,
				byPosition: {} as Record<string, number>,
				byElement: {} as Record<string, number>,
			},
		},
		all: () => [],
		baseCharacters: () => [],
		getBaseCharacter: (_: string) => undefined,
		get: (_: string) => undefined,
		getByParamId: (_: string) => undefined,
		getByCode: (_: string) => undefined,
		search: (_query: string, _options?: { lang?: "fr" | "en" | "ja"; limit?: number }) => [],
		byPosition: (_: "Coach" | "GK" | "FW" | "MF" | "DF") => [],
		byElement: (_: number | "Fire" | "Wind" | "Forest" | "Mountain") => [],
		bySeries: (_: string) => [],
		byRarity: (_: number) => [],
		byPersonality: (_: number | string) => [],
		goalkeepers: () => [],
		forwards: () => [],
		midfielders: () => [],
		defenders: () => [],
		windCharacters: () => [],
		forestCharacters: () => [],
		fireCharacters: () => [],
		mountainCharacters: () => [],
		gentle: () => [],
		cool: () => [],
		hot: () => [],
		withRarity: () => [],
		rarityNames: RARITY_NAMES,
		personalityNames: PERSONALITY_NAMES,
	};
}

/**
 * Create Characters API
 */
export function createCharactersAPI() {
	let db: CharactersDatabase;

	try {
		db = buildCharactersDatabase();
	} catch (error) {
		console.warn(
			"[Inagle] Failed to build characters database (missing files?). Running in fallback mode.",
			error instanceof Error ? error.message : String(error)
		);
		return createEmptyCharactersAPI();
	}

	// Lazy-loaded base characters cache
	let _baseCharacters: BaseCharacter[] | null = null;
	let _baseCharactersByCharaId: Map<string, BaseCharacter> | null = null;

	const getBaseCharactersData = () => {
		if (!_baseCharacters) {
			try {
				_baseCharacters = loadBaseCharacters();
				_baseCharactersByCharaId = new Map();
				for (const bc of _baseCharacters) {
					// Update images for base characters too
					if (db) {
						const existing = db.byCharaId.get(bc.charaId);
						if (existing?.icons?.face) {
							if (!bc.icons) bc.icons = {};
							bc.icons.face = existing.icons.face;
						}
					}
					_baseCharactersByCharaId.set(bc.charaId, bc);
				}
			} catch (error) {
				console.warn("[Inagle] Failed to load base characters:", error);
				_baseCharacters = [];
				_baseCharactersByCharaId = new Map();
			}
		}
		return { list: _baseCharacters, byId: _baseCharactersByCharaId! };
	};

	return {
		/** Database metadata */
		meta: {
			generatedAt: db.generatedAt,
			totalCharacters: db.totalCharacters,
			stats: db.stats,
		},

		/** Get all characters */
		all: () => db.characters,

		/**
		 * Get all base characters with their variants grouped
		 * Returns one entry per unique character (charaId),
		 * with all their card variants (charaParamId) inside.
		 */
		baseCharacters: (): BaseCharacter[] => getBaseCharactersData().list,

		/**
		 * Get a base character by charaId
		 */
		getBaseCharacter: (charaId: string): BaseCharacter | undefined =>
			getBaseCharactersData().byId.get(charaId),

		/** Get character by chara_id (hash) */
		get: (id: string) => db.byCharaId.get(id),

		/** Get character by param ID */
		getByParamId: (paramId: string) => db.byParamId.get(paramId),

		/** Get character by internal code (c01000100) */
		getByCode: (code: string) => db.byInternalCode.get(code),

		/** Search characters by name */
		search: (query: string, options?: { lang?: "fr" | "en" | "ja"; limit?: number }) => {
			const q = query.toLowerCase();
			const lang = options?.lang;
			const limit = options?.limit || 50;

			const results: Character[] = [];

			for (const char of db.characters) {
				let match = false;

				if (!lang || lang === "fr") {
					match = match || (char.names.fr?.toLowerCase().includes(q) ?? false);
				}
				if (!lang || lang === "en") {
					match = match || (char.names.en?.toLowerCase().includes(q) ?? false);
				}
				if (!lang || lang === "ja") {
					match = match || (char.names.ja?.includes(q) ?? false);
				}

				if (match) {
					results.push(char);
					if (results.length >= limit) break;
				}
			}

			return results;
		},

		/** Get characters by position */
		byPosition: (position: "Coach" | "GK" | "FW" | "MF" | "DF") =>
			db.byPosition.get(position) || [],

		/** Get characters by element */
		byElement: (element: number | "Fire" | "Wind" | "Forest" | "Mountain") => {
			let elemId: number;
			if (typeof element === "string") {
				// 1=Wind, 2=Forest, 3=Fire, 4=Mountain
				const map: Record<string, number> = {
					Wind: 1,
					Forest: 2,
					Fire: 3,
					Mountain: 4,
				};
				elemId = map[element] || 0;
				if (elemId === 0) return [];
			} else {
				elemId = element;
			}
			return db.byElement.get(elemId) || [];
		},

		/** Get characters by series */
		bySeries: (series: string) =>
			db.characters.filter(
				(c) =>
					c.series?.toLowerCase() === series.toLowerCase() ||
					c.seriesId === series ||
					c.teams?.some((t) =>
						t.seasons.some((s) => s.toLowerCase().includes(series.toLowerCase()))
					)
			),

		/** Get characters by rarity code */
		byRarity: (rarity: number) => db.byRarity.get(rarity) || [],

		/** Get characters by personality */
		byPersonality: (personality: number | string) => {
			let pType: number;
			if (typeof personality === "string") {
				const entry = Object.entries(PERSONALITY_NAMES).find(
					([, v]) => v.en.toLowerCase() === personality.toLowerCase()
				);
				if (!entry) return [];
				pType = Number.parseInt(entry[0], 10);
			} else {
				pType = personality;
			}

			return db.characters.filter((c) => c.personalityType === pType);
		},

		// Convenience methods for positions
		goalkeepers: () => db.byPosition.get("GK") || [],
		forwards: () => db.byPosition.get("FW") || [],
		midfielders: () => db.byPosition.get("MF") || [],
		defenders: () => db.byPosition.get("DF") || [],

		// Convenience methods for elements
		// 1=Wind, 2=Forest, 3=Fire, 4=Mountain
		windCharacters: () => db.byElement.get(1) || [],
		forestCharacters: () => db.byElement.get(2) || [],
		fireCharacters: () => db.byElement.get(3) || [],
		mountainCharacters: () => db.byElement.get(4) || [],

		// Convenience methods for personalities
		gentle: () => db.characters.filter((c) => c.personalityType === 1),
		cool: () => db.characters.filter((c) => c.personalityType === 2),
		hot: () => db.characters.filter((c) => c.personalityType === 3),

		/** Get characters with rarity */
		withRarity: () => db.characters.filter((c) => c.rarityCode > 0),

		/** Rarity names map */
		rarityNames: RARITY_NAMES,

		/** Personality names map */
		personalityNames: PERSONALITY_NAMES,
	};
}

export type CharactersAPI = ReturnType<typeof createCharactersAPI>;
