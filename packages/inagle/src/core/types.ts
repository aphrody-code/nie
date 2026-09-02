/**
 * @file types.ts
 * @description Complete type definitions for IEVR game data entities
 */

// ============================================================================
// ELEMENT & POSITION ENUMS
// ============================================================================

/**
 * Character elements (属性)
 * Values match game internal IDs (1-based)
 *
 * Evidence from character data:
 * - Mark Evans: element=4 → Mountain
 * - Axel Blaze: element=3 → Fire
 * - Nathan Swift: element=1 → Wind
 */
export const ElementId = {
	Wind: 1, // 風 - Vent
	Forest: 2, // 林 - Forêt
	Fire: 3, // 火 - Feu
	Mountain: 4, // 山 - Montagne
} as const;

export type ElementId = (typeof ElementId)[keyof typeof ElementId];

export const ElementNames = {
	0: { ja: "なし", en: "Void", fr: "Néant" },
	1: { ja: "風", en: "Wind", fr: "Vent" },
	2: { ja: "林", en: "Forest", fr: "Forêt" },
	3: { ja: "火", en: "Fire", fr: "Feu" },
	4: { ja: "山", en: "Mountain", fr: "Montagne" },
	5: { ja: "無", en: "Void", fr: "Néant" },
} as const;

/**
 * Character positions (ポジション)
 * Values match game internal IDs
 */
export const PositionId = {
	Coach: 0, // Coach/Manager (no field position)
	GK: 1, // Goalkeeper
	FW: 2, // Forward
	MF: 3, // Midfielder
	DF: 4, // Defender
} as const;

export type PositionId = (typeof PositionId)[keyof typeof PositionId];

export const PositionNames = {
	0: { code: "Coach", en: "Coach", fr: "Entraîneur" },
	1: { code: "GK", en: "Goalkeeper", fr: "Gardien" },
	2: { code: "FW", en: "Forward", fr: "Attaquant" },
	3: { code: "MF", en: "Midfielder", fr: "Milieu" },
	4: { code: "DF", en: "Defender", fr: "Défenseur" },
} as const;

/**
 * Character rarity tiers
 *
 * In-game rarity progression (system_text NOUN_INFO 76-82):
 *   0 = Normal        (EN: COMMON)     — 4408 characters
 *   1 = En progression (EN: GROWING)   — upgrade tier
 *   2 = Expérimenté   (EN: ADVANCED)   — 150 characters
 *   3 = Émérite       (EN: TOP)        — upgrade tier
 *   4 = Légendaire    (EN: LEGENDARY)  — upgrade tier
 *   5 = Héros         (EN: HERO)       — 34 UR + 36 LR + 38 Legend
 *   6 = Basara        (EN: FABLED)     — 64 characters
 *
 * StarSign gacha codes: 0, 2, 5, 6, 7, 20
 * Codes 5/6/7 all map to "Légendaire" display (SR gacha pool).
 * "Héros" is set by match-heroes enrichment, not starSign.
 */
export const RarityId = {
	Normal: 0,
	EnProgression: 1,
	Experimente: 2,
	Emerite: 3,
	Legendaire4: 4,
	Legendaire5: 5,
	Legendaire6: 6,
	Legendaire7: 7,
	Hero: 10,
	BASARA: 20,
} as const;

export type RarityId = (typeof RarityId)[keyof typeof RarityId];

/**
 * French display names for each rarity code.
 *
 * Official names from game (system_text NOUN_INFO 76-82):
 *   Normal        — COMMON
 *   En progression — GROWING
 *   Expérimenté   — ADVANCED
 *   Émérite       — TOP
 *   Légendaire    — LEGENDARY
 *   Héros         — HERO (set by enrichment only)
 *   BASARA        — FABLED
 */
export const RarityNames = {
	0: "Normal",
	1: "En progression",
	2: "Expérimenté",
	3: "Émérite",
	4: "Légendaire",
	5: "Héros",
	6: "Héros",
	7: "Héros",
	10: "Héros",
	20: "BASARA",
} as const;

// ============================================================================
// NAMES & LOCALIZATION
// ============================================================================

/**
 * Localized names for an entity
 */
export interface LocalizedNames {
	/** Japanese name - format: "[漢字/ふりがな]" for kanji with reading */
	ja?: string;
	/** English name */
	en?: string;
	/** French name */
	fr?: string;
	/** German name */
	de?: string;
	/** Spanish name */
	es?: string;
	/** Italian name */
	it?: string;
	/** Portuguese name */
	pt?: string;
	/** Simplified Chinese */
	zhHans?: string;
	/** Traditional Chinese */
	zhHant?: string;
}

/**
 * Romanized name data
 */
export interface RomanizedName {
	/** Romanized first name (given name) */
	firstName?: string;
	/** Romanized last name (family name) */
	lastName?: string;
	/** Full romanized name */
	full?: string;
}

// ============================================================================
// CHARACTER STATS
// ============================================================================

/**
 * Character statistics at a specific level
 */
export interface CharacterStats {
	/** Kick power (シュート) */
	kick: number;
	/** Ball control (ドリブル) */
	control: number;
	/** Technique (テクニック) */
	technique: number;
	/** Defensive pressure (ブロック) */
	pressure: number;
	/** Physical strength (フィジカル) */
	physical: number;
	/** Agility/Speed (スピード) */
	agility: number;
	/** Game intelligence (ガッツ) */
	intelligence: number;
}

/**
 * Stats at multiple levels
 */
export interface MultiLevelStats {
	/** Stats at level 1 */
	lv1?: CharacterStats;
	/** Stats at level 30 */
	lv30?: CharacterStats;
	/** Stats at level 50 */
	lv50?: CharacterStats;
	/** Stats at level 99 (max) */
	lv99: CharacterStats;
}

// ============================================================================
// CHARACTER VARIANT (une carte spécifique)
// ============================================================================

/**
 * Character variant = une carte spécifique d'un personnage
 * Exemple: Mark Evans enfant N, Mark Evans adulte UR, Mark Evans BASARA
 */
export interface CharacterVariant {
	/** Param hash ID (hex string like "0xA41870E9") */
	charaParamId: string;
	/** Zukan Hash */
	zukanHash?: string;
	/** Zukan Order */
	zukanOrder?: number;

	/** Position code (GK/FW/MF/DF/Coach) */
	position: "Coach" | "GK" | "FW" | "MF" | "DF";
	/** Raw position ID (0-4) */
	positionRaw: PositionId;
	/** Sub position code */
	subPosition?: "Coach" | "GK" | "FW" | "MF" | "DF";

	/** Element name (localized) */
	element: string;
	/** Raw element ID (1-4) */
	elementRaw: number;

	/** Rarity tier name (Normal, En progression, Expérimenté, Émérite, Légendaire, Héros, BASARA) */
	rarity: string;
	/** Raw rarity code */
	rarityCode: number;

	/** Growth pattern index */
	growthPattern: number;

	/** Skills (Level, SkillID) */
	skills: { learnLevel: number; skillId: string }[];

	/** Character stats at various levels */
	stats: MultiLevelStats;

	/** Character image path (bucket relative) */
	image?: string;

	/** Is this a hero variant (火, 黒, 桃)? */
	heroType?: "fire" | "black" | "pink";

	/** Slug for URL */
	slug?: string;
	/** Sheet data object */
	sheetData?: any;
	/** Internal character code */
	internalCode?: string;

	/** Constellation (Players Universe star sign) */
	constellation?: {
		/** Constellation index (0-29) */
		index: number;
		/** Localized constellation names */
		names: LocalizedNames;
	};
}

// ============================================================================
// BASE CHARACTER (le personnage avec toutes ses variantes)
// ============================================================================

/**
 * Base character = le personnage lui-même avec toutes ses cartes
 * Exemple: Mark Evans avec ses 4+ variantes
 */
export interface BaseCharacter {
	/** Base character hash ID */
	charaId: string;
	/** Internal code string (e.g., "c01000100") */
	internalCode: string;
	/** Zukan Hash (representative image) */
	zukanHash?: string;
	/** Surnom officiel zukan.inazuma.jp (ex. "Evans" pour Mark Evans) */
	nickname?: string;
	/** Groupe d'âge zukan.inazuma.jp, brut EN (ex. "Middle School", "Adult") */
	ageGroup?: string;
	/** Année scolaire zukan.inazuma.jp, brut EN (ex. "Grade 8") */
	schoolYear?: string;

	/** Localized names */
	names: LocalizedNames;
	/** Romanized name data */
	romanized?: RomanizedName;

	/** Gender (0=male, 1=female) */
	gender: number;

	/** All variants of this character */
	variants: CharacterVariant[];

	/** Best rarity among all variants */
	bestRarity: string;
	/** Best rarity code */
	bestRarityCode: number;

	/** Slug for URL (English name with underscores) */
	slug?: string;
	/** Base slug for merging variants */
	baseSlug?: string;

	/** Is this a BASARA character? */
	isBasara: boolean;

	/** Character image path (bucket relative) */
	image?: string;

	/** Character icon/face paths */
	icons?: {
		face?: string;
		face2?: string;
	};

	/** Description texts */
	descriptions?: LocalizedNames;

	/** Wiki sections (CMS) */
	wikiSections?: { title: string; content: string }[];

	/** Sheet Data (Enriched) */
	sheetData?: Record<string, unknown>;

	/** Series/game this character belongs to */
	series?: {
		id: string;
		type: number;
		name?: string;
	};

	/** Primary team affiliation */
	teamId?: string;
	teamName?: string;

	/** Constellation (Players Universe star sign) */
	constellation?: {
		/** Constellation index (0-29) */
		index: number;
		/** Localized constellation names */
		names: LocalizedNames;
	};

	/** Whether any variant is controllable in story mode */
	isControllable?: boolean;

	/** Personality type (1-11) */
	personalityType?: number;
	/** Localized self-pronoun */
	firstPerson?: LocalizedNames;
	/** Localized address-pronoun for males */
	secondPersonMale?: LocalizedNames;
	/** Localized address-pronoun for females */
	secondPersonFemale?: LocalizedNames;
}

// ============================================================================
// CHARACTER ENTITY (legacy - single variant view)
// ============================================================================

/**
 * Raw character param data from game config
 */
export interface CharaParamRaw {
	/** Param entry hash ID */
	charaParamId: string;
	/** Base character hash ID */
	charaBaseId: string;
	/** Main position (1-4) */
	mainPosition: number;
	/** Sub position (1-4) */
	subPosition: number;
	/** Element (0-3) */
	element: number;
	/** Gender (0=male, 1=female) */
	gender: number;
	/** Rarity/rank */
	charaRank: number;
	/** Growth pattern for stat calculation */
	growthPattern: number;
	/** Body type index */
	bodyType: number;
	/** All raw variable values */
	rawVariables: number[];
}

/**
 * Complete character entity with all data
 */
export interface Character {
	/** Unique internal index */
	index: number;
	/** Param hash ID (hex string like "0xA41870E9") */
	charaParamId: string;
	/** Base character hash ID */
	charaId: string;
	/** Internal code string (e.g., "c01000100") */
	internalCode?: string;
	/** Zukan Hash from web site (for 3D model) */
	zukanHash?: string;
	/** Zukan Order (from web site list) */
	zukanOrder?: number;

	/** Localized names */
	names: LocalizedNames;
	/** Romanized name data */
	romanized?: RomanizedName;

	/** Position code (GK/FW/MF/DF/Coach) */
	position: "Coach" | "GK" | "FW" | "MF" | "DF";
	/** Raw position ID (0-4) */
	positionRaw: PositionId;
	/** Sub position code */
	subPosition?: "Coach" | "GK" | "FW" | "MF" | "DF";

	/** Element name (localized) */
	element: string;
	/** Raw element ID (0-3) */
	elementRaw: ElementId;

	/** Rarity tier name */
	rarity: string;
	/** Raw rarity code */
	rarityCode: RarityId;

	/** Gender (0=male, 1=female) */
	gender: number;
	/** Growth pattern index */
	growthPattern: number;

	/** Skills (Level, SkillID) */
	skills: { learnLevel: number; skillId: string }[];

	/** Character stats at various levels */
	stats: MultiLevelStats;

	/** Character image path (bucket relative) */
	image?: string;

	/** Character icon/face paths */
	icons?: {
		face?: string;
		face2?: string;
	};

	/** Description texts */
	descriptions?: LocalizedNames;

	/** Sheet Data */
	sheetData?: Record<string, unknown>;

	/** Series/game this character belongs to */
	series?: string;
	/** Series ID (hash) */
	seriesId?: string;

	/** Team affiliations */
	teams?: Array<{
		id: string;
		names: LocalizedNames;
		seasons: string[];
	}>;

	/** Personality type (1-11) */
	personalityType?: number;
	/** Localized self-pronoun */
	firstPerson?: LocalizedNames;
	/** Localized address-pronoun for males */
	secondPersonMale?: LocalizedNames;
	/** Localized address-pronoun for females */
	secondPersonFemale?: LocalizedNames;

	/** Constellation (Players Universe star sign) */
	constellation?: {
		/** Constellation index (0-29) */
		index: number;
		/** Localized constellation names */
		names: LocalizedNames;
	};

	/** Slug for URL (English name with underscores) */
	slug?: string;

	/** Whether this character is controllable in story mode */
	isControllable?: boolean;
	/** Control type (0, 1, 2) */
	controlType?: number;
}

// ============================================================================
// SKILL ENTITY
// ============================================================================

/**
 * Skill type categories
 */
export const SkillType = {
	Shoot: 1,
	Block: 2,
	Dribble: 3,
	Catch: 4,
	Special: 5,
	Strategy: 6,
} as const;

export type SkillType = (typeof SkillType)[keyof typeof SkillType];

/**
 * Complete skill entity
 */
export interface Skill {
	/** Unique index */
	index: number;
	/** Skill hash ID */
	skillId: string;
	/** Internal code */
	internalCode?: string;

	/** Localized names */
	names: LocalizedNames;
	/** Localized descriptions */
	descriptions?: LocalizedNames;

	/** Skill type */
	type: SkillType;
	/** Required element */
	element?: ElementId;
	/** Power rating */
	power?: number;
	/** TP cost */
	tpCost?: number;

	/** Icon path */
	icon?: string;

	/** Evolution chain */
	evolution?: {
		from?: string;
		to?: string;
	};
}

// ============================================================================
// TEAM ENTITY
// ============================================================================

/**
 * Complete team entity
 */
export interface Team {
	/** Team hash ID */
	teamId: string;
	/** Internal code */
	internalCode?: string;

	/** Localized names */
	names: LocalizedNames;

	/** Team emblem path */
	emblem?: string;

	/** Series this team belongs to */
	series?: {
		id: string;
		type: number;
	};

	/** Default formation */
	formation?: string;

	/** Team members (character IDs) */
	members?: string[];
}

// ============================================================================
// ITEM ENTITY
// ============================================================================

/**
 * Item categories
 */
export const ItemCategory = {
	Equipment: 1,
	Consumable: 2,
	Material: 3,
	Key: 4,
} as const;

export type ItemCategory = (typeof ItemCategory)[keyof typeof ItemCategory];

/**
 * Complete item entity
 */
export interface Item {
	/** Item hash ID */
	itemId: string;
	/** Internal code */
	internalCode?: string;

	/** Localized names */
	names: LocalizedNames;
	/** Localized descriptions */
	descriptions?: LocalizedNames;

	/** Item category */
	category: ItemCategory;

	/** Rarity */
	rarity?: number;

	/** Icon path */
	icon?: string;

	/** Effect data */
	effect?: {
		type: string;
		value: number;
	};
}

// ============================================================================
// BASARA ENTITY (Special characters with builds)
// ============================================================================

/**
 * BASARA build configuration
 */
export interface BasaraBuild {
	/** Build type (0-5) */
	type: number;
	/** Board hash ID */
	boardId: string;
}

/**
 * Hero variant flags for BASARA
 */
export interface HeroVariants {
	hasFire: boolean;
	fireParamId?: string;
	hasBlack: boolean;
	blackParamId?: string;
	hasPink: boolean;
	pinkParamId?: string;
}

/**
 * BASARA character (extends Character with builds)
 */
export interface Basara extends Character {
	/** Available builds */
	builds: BasaraBuild[];
	/** Hero variant availability */
	heroVariants: HeroVariants;
}

// ============================================================================
// DATA MANIFEST
// ============================================================================

/**
 * Metadata for generated data files
 */
export interface DataManifest {
	/** Generation timestamp */
	generatedAt: string;
	/** Source files used */
	sources: Record<string, string>;
	/** Entity counts */
	counts: {
		characters: number;
		skills: number;
		teams: number;
		items: number;
		basara: number;
	};
	/** Data version */
	version: string;
}
