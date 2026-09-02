/**
 * Character data types for IEVR
 * Based on actual dump JSON structure
 */

import type { CfgBinDocument, CfgBinEntry, CfgBinVariable } from "../schemas/cfgbin.js";

export type { CfgBinEntry, CfgBinVariable };
export type CfgBinFile = CfgBinDocument;

/** Character base info extracted from chara_base */
export interface CharaBaseInfo {
	/** Index in the file */
	index: number;
	/** Hash ID (first Int variable) */
	hashId: number;
	/** Internal code like "npc0202", "pla0001" */
	internalCode: string;
	/** Reference hash for name lookup */
	nameHash: number;
}

/** Character param info extracted from chara_param */
export interface CharaParamInfo {
	index: number;
	/** Primary hash ID */
	hashId: number;
	/** Secondary hash (potential name reference) */
	nameHash: number;
	/** Various stat values */
	stats: number[];
}

/** Character text info (name) */
export interface CharaTextInfo {
	/** Hash ID linking to character */
	hashId: number;
	/** Text type (0=full name, 11=family name, 12=first name) */
	textType: number;
	/** The actual name string */
	name: string;
}

/** Character description */
export interface CharaDescriptionInfo {
	/** Hash ID linking to character */
	hashId: number;
	/** Description text */
	description: string;
}

/** Unified character with all localized data */
export interface UnifiedCharacter {
	/** Internal ID (index-based) */
	id: number;
	/** Hash ID used for linking */
	hashId: number;
	/** Internal game code */
	internalCode: string;
	/** Localized names */
	names: {
		/** English name (Mark Evans) */
		en?: string;
		/** English family name */
		enFamily?: string;
		/** English first name */
		enFirst?: string;
		/** Japanese romanized (Mamoru Endo) */
		jp?: string;
		/** Japanese family name */
		jpFamily?: string;
		/** Japanese first name */
		jpFirst?: string;
		/** French name */
		fr?: string;
		/** French family name */
		frFamily?: string;
		/** French first name */
		frFirst?: string;
	};
	/** Descriptions by language */
	descriptions: {
		fr?: string;
		en?: string;
		de?: string;
		es?: string;
		it?: string;
		pt?: string;
	};
	/** Character variants (different versions of same character) */
	variants?: UnifiedCharacterVariant[];
}

export interface UnifiedCharacterVariant {
	/** Variant hash */
	hashId: number;
	/** Variant internal code */
	internalCode: string;
	/** Specific name if different */
	name?: string;
}

/** Complete character database */
export interface CharacterDatabase {
	/** Generation timestamp */
	generatedAt: string;
	/** Source files used */
	sources: {
		charaBase: string;
		charaParam: string;
		charaTextEn: string;
		charaTextRoma: string;
		charaDescFr: string;
	};
	/** Total character count */
	totalCharacters: number;
	/** All characters */
	characters: UnifiedCharacter[];
}
