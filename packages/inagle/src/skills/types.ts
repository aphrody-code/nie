/**
 * Skill data types for IEVR
 * Based on skill_config and passive_skill_config dump structures
 */

import type { CfgBinEntry, CfgBinFile } from "../characters/types.js";

export type { CfgBinEntry, CfgBinFile };

/** Skill config file structure (version-based format) */
export interface SkillConfigFile {
	version: number;
	lists: SkillConfigList[];
}

/** Raw skill info from skill_config (exact JSON structure) */
export interface RawSkillConfigInfo {
	skillID: string; // Hex like "0x63BDA8A4"
	skillIDStr: string; // String like "whs00010"
	eventID: string;
	eventIDName: string;
	failEventID: string;
	failEventIDName: string;
	skillNameId: string; // Hex hash for name
	skillDescId: string; // Hex hash for description
	cmdOptIdx: number;
	skillEffectBitFlag: number;
	power_min: number;
	power_max: number;
	element: number; // 1=Wind, 2=Forest, 3=Fire, 4=Mountain
	colorIdx: number;
	category: number; // 1=Shoot, 2=Block, 3=Dribble, 4=Catch, 5=Special
	growthType: number;
	foulRate: number;
	consumeTp: number; // Internal name, actual game mechanic is "Tension"
	focusBattleEffectId: string;
	recastTime: number;
	partnerType: number; // 0=Solo, 1=Duo, 2=Trio
	partner1: string;
	partner2: string;
	partner3: string;
	telopInfoId: string;
	eldorado: boolean;
}

export interface SkillConfigList {
	name: string;
	typeName: string;
	values: RawSkillConfigInfo[];
}

/** Passive skill config file structure (CfgBin-like format with Entries) */
export interface PassiveSkillConfigFile {
	encoding: string;
	entries: PassiveSkillConfigEntry[];
}

export interface PassiveSkillConfigEntry {
	name: string;
	endTerminator?: boolean;
	variables?: PassiveSkillVariable[];
	children?: PassiveSkillConfigEntry[];
	// Support legacy upper-case for backward-compatibility if mixed files used?
	// But based on dump, it is strictly lowercase.
	// We can add optional uppercase just in case.
	Name?: string;
	Variables?: PassiveSkillVariable[];
	Children?: PassiveSkillConfigEntry[];
}

export interface PassiveSkillVariable {
	name?: string;
	type?: string;
	value?: number | string | null;
	// Alternate casing
	Name?: string;
	Type?: string;
	Value?: number | string | null;
}

/** Skill element enum - based on actual game data
 * Verified: Fire Tornado (whs00030) has element=3, so 3=Fire
 * Character elements use same IDs (see chara-param.ts elementIdToNames)
 */
export const ELEMENT_NAMES: Record<number, { en: string; ja: string; fr: string }> = {
	0: { en: "None", ja: "なし", fr: "Aucun" },
	1: { en: "Wind", ja: "風", fr: "Vent" },
	2: { en: "Forest", ja: "林", fr: "Forêt" },
	3: { en: "Fire", ja: "火", fr: "Feu" },
	4: { en: "Mountain", ja: "山", fr: "Montagne" },
	5: { en: "Void", ja: "無", fr: "Néant" },
};

/** Skill category enum - based on skillInfo dump and menu_text localization */
export const CATEGORY_NAMES: Record<number, { en: string; ja: string; fr: string }> = {
	0: { en: "None", ja: "なし", fr: "Aucun" },
	1: { en: "Shoot", ja: "シュート", fr: "Tir" },
	2: { en: "Dribble", ja: "ドリブル", fr: "Dribble" },
	3: { en: "Block", ja: "ブロック", fr: "Défense" },
	4: { en: "Catch", ja: "キャッチ", fr: "Arrêt" },
	5: { en: "Special", ja: "スペシャル", fr: "Spécial" },
	6: { en: "Passive", ja: "パッシブ", fr: "Passif" },
	9: { en: "Stat Boost", ja: "ステータス", fr: "Boost Stats" },
};

/** Unified active skill with all localized data */
export interface UnifiedSkill {
	/** Internal ID (index-based) */
	id: number;
	/** Hash ID (from skillID) */
	hashId: number;
	/** Internal code like "whs00010" */
	internalCode: string;
	/** Event ID name */
	eventName: string;
	/** Image filename (e.g., "whs00010.webp") - use with skill-images/{lang}/ path */
	image?: string;
	/** Localized names */
	names: {
		en?: string;
		fr?: string;
		ja?: string;
	};
	/** Descriptions by language */
	descriptions: {
		en?: string;
		fr?: string;
		ja?: string;
	};
	/** Skill stats */
	stats: {
		powerMin: number;
		powerMax: number;
		/** Tension cost to activate the skill */
		tensionCost: number;
		recastTime: number;
		growthType: number;
		foulRate: number;
		skillEffectBitFlag?: number;
	};
	/** Element info */
	element: {
		id: number;
		nameEn: string;
		nameJa: string;
	};
	/** Category info */
	category: {
		id: number;
		nameEn: string;
		nameJa: string;
	};
	/** Partner type: 0=Solo, 1=Duo, 2=Trio */
	partnerType: number;
	/** Is Eldorado exclusive */
	isEldorado: boolean;
	/** Shops where this skill can be bought */
	shops?: {
		en: string[];
		fr: string[];
	};
}

/** Passive skill scope - Team vs Player */
export type PassiveScope = "team" | "player" | "enemy" | "unknown";

/** Passive skill boost type */
export type PassiveBoostType =
	| "breach" // Brèche - Breakthrough rate
	| "justice" // Justice - Counter rate
	| "attack" // ATT - Attack stat
	| "defense" // DÉF - Defense stat
	| "shoot" // TIR - Shoot stat
	| "dribble" // DRB - Dribble stat
	| "block" // BLC - Block stat
	| "catch" // ART - Catch/Stop stat
	| "speed" // VIT - Speed stat
	| "stamina" // END - Stamina stat
	| "confrontation" // Affrontement - Confrontation ATT/DEF
	| "tension" // Tension - Tension gain
	| "recovery" // Récup - Recovery
	| "mixed" // Multiple stats combined
	| "special" // Special effects (debuff enemy, zone control, etc.)
	| "unknown";

/** Passive skill scope names */
export const PASSIVE_SCOPE_NAMES: Record<PassiveScope, { en: string; fr: string }> = {
	team: { en: "Team", fr: "Équipe" },
	player: { en: "Player", fr: "Joueur" },
	enemy: { en: "Enemy", fr: "Adversaire" },
	unknown: { en: "Unknown", fr: "Inconnu" },
};

/** Passive skill boost type names */
export const PASSIVE_BOOST_NAMES: Record<PassiveBoostType, { en: string; fr: string }> = {
	breach: { en: "Breach", fr: "Brèche" },
	justice: { en: "Justice", fr: "Justice" },
	attack: { en: "Attack", fr: "Attaque" },
	defense: { en: "Defense", fr: "Défense" },
	shoot: { en: "Shoot", fr: "Tir" },
	dribble: { en: "Dribble", fr: "Dribble" },
	block: { en: "Block", fr: "Défense" },
	catch: { en: "Catch", fr: "Arrêt" },
	speed: { en: "Speed", fr: "Vitesse" },
	stamina: { en: "Stamina", fr: "Physique" },
	confrontation: { en: "Confrontation", fr: "Affrontement" },
	tension: { en: "Tension", fr: "Tension" },
	recovery: { en: "Recovery", fr: "Récupération" },
	mixed: { en: "Mixed", fr: "Mixte" },
	special: { en: "Special", fr: "Spécial" },
	unknown: { en: "Unknown", fr: "Inconnu" },
};

/** Unified passive skill */
export interface UnifiedPassiveSkill {
	/** Internal ID (index-based) */
	id: number;
	/** Hash ID (from Variables[0]) */
	hashId: number;
	/** Description/effect text (from NOUN_INFO) */
	effect: {
		en?: string;
		fr?: string;
		ja?: string;
	};
	/** Effect values parsed from template */
	effectValues?: number[];
	/** Associated element (optional) */
	element?: number;
	/** Rarity code */
	rarity?: number;
	/** Scope: team, player, or enemy */
	scope: PassiveScope;
	/** Boost type: breach, justice, attack, defense, etc. */
	boostType: PassiveBoostType;
	/** Linked Item ID (from item_config) */
	itemId?: string;
	/** Item Number (Order in menu) */
	itemNumber?: number;
	/** Item Internal Code (whs/whd...) */
	itemCode?: string;
	/** Drop locations (compiled from item sources) */
	drops?: string[];
}

/** Team Passive (Tactics/Buffs) */
export interface TeamPassive {
	id: string;
	effectId: string;
	effectValueMin: number;
	effectValueMax: number;
	textId: string;
	name: {
		en?: string;
		fr?: string;
	};
}

/** Complete skill database */
export interface SkillDatabase {
	/** Generation timestamp */
	generatedAt: string;
	/** Source files used */
	sources: {
		skillConfig: string;
		skillTextEn: string;
		skillTextFr: string;
		skillTextJa: string;
	};
	/** Statistics */
	stats: {
		totalSkills: number;
		withNameEn: number;
		withNameFr: number;
		withNameJa: number;
		withDescEn: number;
		withDescFr: number;
		withDescJa: number;
		byElement: Record<string, number>;
		byCategory: Record<string, number>;
	};
	/** All skills */
	skills: UnifiedSkill[];
}

/** Complete passive skill database */
export interface PassiveSkillDatabase {
	/** Generation timestamp */
	generatedAt: string;
	/** Source files used */
	sources: {
		passiveSkillConfig: string;
		skillTextEn: string;
		skillTextFr: string;
	};
	/** Statistics */
	stats: {
		totalPassiveSkills: number;
		uniqueEffects: number;
		withEffectEn: number;
		withEffectFr: number;
	};
	/** All passive skills */
	passiveSkills: UnifiedPassiveSkill[];
	/** Team passives */
	teamPassives: TeamPassive[];
}
