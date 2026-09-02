/**
 * BASARA Types - Complete typings for BASARA/FABLED characters
 *
 * BASARA (婆娑羅) is the highest rarity tier added in the Galaxy & LBX DLC.
 * These characters can change builds and reassign techniques freely.
 */

/** Position/Play style */
export type Position = "GK" | "DF" | "MF" | "FW";

/** Element type */
export type Element = "Feu" | "Forêt" | "Vent" | "Montagne";

/** Hero variant types (alternate character forms) */
export interface HeroVariants {
	/** Fire hero variant available */
	hasFire: boolean;
	/** Fire variant charaParamId (0x00000000 if unavailable) */
	fireParamId: string;
	/** Black hero variant available */
	hasBlack: boolean;
	/** Black variant charaParamId */
	blackParamId: string;
	/** Pink hero variant available */
	hasPink: boolean;
	/** Pink variant charaParamId */
	pinkParamId: string;
}

/** Character stats at a specific level */
export interface BasaraStats {
	kick: number;
	control: number;
	technique: number;
	pressure: number;
	physical: number;
	agility: number;
	intelligence: number;
}

/** Icon paths for character portraits */
export interface BasaraIcons {
	/** Primary face expression */
	face1: string;
	/** Alternate face expression */
	face2: string;
	/** Whether icons exist on disk */
	exists: boolean;
}

/** Build/Board configuration */
export interface BasaraBuild {
	/** Build type (0-5) */
	type: number;
	/** Board ID hash */
	boardId: string;
}

/** Multilingual name */
export interface MultilingualName {
	fr: string;
	en: string;
	ja: string;
}

/**
 * Complete BASARA character data
 */
export interface BasaraCharacter {
	/** Index in the BASARA list (1-52) */
	index: number;

	/** Character parameter ID (hex hash) */
	charaParamId: string;

	/** Character ID (hex hash) */
	charaId: string;

	/** Character ID string (e.g., "c01000100") */
	charaIdStr: string;

	/** Multilingual names */
	names: MultilingualName;

	/** Icon paths */
	icons: BasaraIcons;

	/** Position (GK/DF/MF/FW) */
	position: Position;

	/** Position raw code (1=GK, 2=FW, 3=MF, 4=DF) */
	positionRaw: number;

	/** Element (localized) */
	element: string;

	/** Element raw code (1=Wind, 2=Wood, 3=Fire, 4=Mountain) */
	elementRaw: number;

	/** Rarity label */
	rarity: "BASARA";

	/** Rarity code (20 for BASARA) */
	rarityCode: 20;

	/** Raw parameter variables from game data */
	paramVariables: number[];

	/** Available builds (6 per character) */
	builds: BasaraBuild[];

	/** Hero variant availability */
	heroVariants: HeroVariants;

	/** Stats at level 50 */
	statsLv50: BasaraStats;

	/** Stats at level 99 (max) */
	statsLv99: BasaraStats;
}

/**
 * BASARA database metadata
 */
export interface BasaraDatabase {
	/** Generation timestamp */
	generatedAt: string;
	/** Total BASARA count */
	count: number;
	/** Builds per character */
	buildsPerCharacter: number;
	/** Total builds count */
	totalBuilds: number;
	/** All BASARA characters */
	basara: BasaraCharacter[];
}

/**
 * Element name mappings (validated against character data)
 *
 * Evidence:
 * - Mark Evans: element=4 → Mountain
 * - Axel Blaze: element=3 → Fire
 * - Nathan Swift: element=1 → Wind
 */
export const ELEMENT_NAMES: Record<number, { en: string; ja: string; fr: string }> = {
	1: { en: "Wind", ja: "風", fr: "Vent" },
	2: { en: "Wood", ja: "林", fr: "Forêt" },
	3: { en: "Fire", ja: "火", fr: "Feu" },
	4: { en: "Mountain", ja: "山", fr: "Montagne" },
};

/** Position name mappings */
export const POSITION_NAMES: Record<number, { en: string; ja: string; fr: string }> = {
	1: { en: "GK", ja: "GK", fr: "GB" },
	2: { en: "FW", ja: "FW", fr: "AV" },
	3: { en: "MF", ja: "MF", fr: "MO" },
	4: { en: "DF", ja: "DF", fr: "DF" },
};

/** Position code to abbreviation */
export const POSITION_MAP: Record<number, Position> = {
	1: "GK",
	2: "FW",
	3: "MF",
	4: "DF",
};
