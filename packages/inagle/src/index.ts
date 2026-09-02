/**
 * @file index.ts
 * @description Universal Game Data API for Inazuma Eleven: Victory Road
 * @module @/lib/inagle
 */

// Re-export types
export { createInagleAppAsync, type InagleApp } from "./adapters/hono.js";

// Domain APIs
export {
	type BasaraAPI,
	type BasaraBuild,
	type BasaraCharacter,
	type BasaraDatabase,
	type BasaraIcons,
	type BasaraIndexes,
	type BasaraStats,
	buildBasaraDatabase,
	createBasaraAPI,
	type Element,
	type EnrichedBasara,
	type HeroVariants,
	POSITION_MAP,
	type Position,
} from "./basara/index.js";

// Characters API
export {
	buildCharactersDatabase,
	type CharacterDetail,
	type CharacterIdMapping,
	type CharacterNametag,
	type CharacterStarSign as CharacterStarSignRarity,
	type CharactersAPI,
	type CharactersDatabase,
	createCharactersAPI,
	type EnrichedCharacter,
	PERSONALITY_NAMES,
	RARITY_NAMES,
} from "./characters/api.js";
export * from "./characters/comparison-engine.js";

// Constellation
export { type ConstellationAPI, createConstellationAPI } from "./constellation/index.js";
// Exporters
export * from "./core/exporters.js";

// Core exports
export {
	DATA_ROOT,
	ElementId,
	ElementNames,
	FILES,
	fromHex,
	InagleError,
	InagleErrorCode,
	measureTime,
	PATHS,
	PositionId,
	PositionNames,
	RarityId,
	RarityNames,
	toHex,
} from "./core/index.js";
// Core types for base characters with variants
export type {
	BaseCharacter,
	Character,
	CharacterStats as GameCharacterStats,
	CharacterVariant,
	MultiLevelStats,
} from "./core/types.js";
export * from "./drops/index.js";
// New entity builders
export {
	type BaseCharacterStats,
	buildCharacter,
	type CharacterFilter,
	type CharacterStatsSummary,
	getCharacterByParamId,
	getCharacterStats,
	loadAllCharacters,
	loadBaseCharacters,
	loadFilteredCharacters,
	preloadCharacterEnrichment,
} from "./entities/character.js";
export * from "./menu/index.js";
export * from "./rag/index.js";
// APIs
export * from "./service.js";

// Stat Calculator
export * from "./analysis/index.js";
export * from "./stat-calculator.js";
export * from "./zukan/index.js";

// === AZALEE COMPATIBILITY LAYER ===

export type { ItemsAPI, ItemsDatabase } from "./items/api.js";
export { buildItemsDatabaseAsync, createItemsAPIAsync } from "./items/api.js";
// Items
export type { ItemCategory, ParsedItem as Item } from "./parsers/item-config.js";
// Global Search
export {
	createGlobalSearch,
	type GlobalSearchAPI,
	type GlobalSearchResult,
	type SearchableType,
	type SearchConfig,
} from "./search/index.js";
// Skills
export type {
	EnrichedAuraSkill as Aura,
	EnrichedPassiveSkill as Passive,
	EnrichedSkill as Skill,
	SkillsAPI,
	SkillsDatabase,
	SkillType,
	TeamPassive,
} from "./skills/api.js";
export {
	buildSkillsDatabase,
	CATEGORY_NAMES,
	createSkillsAPI,
	ELEMENT_NAMES,
	PASSIVE_BOOST_NAMES,
	PASSIVE_SCOPE_NAMES,
} from "./skills/api.js";
// Teams & Formations
export type {
	EnrichedFormation as Formation,
	EnrichedTeam as Team,
	TeamsAPI,
	TeamsDatabase,
} from "./teams/api.js";
export { buildTeamsDatabase, createTeamsAPI } from "./teams/api.js";

// Romaji & Transliteration
export { initRomaji, toRomaji, toRomajiTitleCase, toKana } from "./utils/romaji.js";
