/**
 * Core utilities module
 *
 * Contains low-level tools for working with IEVR game data:
 * - parser: CFG.BIN file parsing
 * - search: Full-text search utilities
 * - gamedata: Raw gamedata JSON loader (453 lists, 66k+ entries)
 * - entities: Curated entity data loader (pre-extracted)
 * - hash: Hash computation and lookup utilities
 * - images: Image path resolution and indexing
 * - openapi: OpenAPI 3.1.0 spec generator from Zod schemas
 * - paths: Data file paths configuration
 * - config-parser: Raw cfg.bin.json parser
 * - data-loader: Central data loading with caching
 * - types: Complete TypeScript type definitions
 */

export { loadJsonAsync as loadJsonFileAsync, loadJsonStream, measureTime } from "./async-loader.js";
export {
	type CharaBaseData,
	type CharaParamData,
	type ConfigFile,
	type ConfigNode,
	type ConfigVariable,
	extractVariables,
	getNodesByName,
	parseCharaBaseNode,
	parseCharaParamNode,
	parseFloatVar,
	parseIntVar,
	parseListVar,
	parseStringVar,
} from "./config-parser.js";
export {
	clearCache,
	dataExists,
	fromHex,
	type GrowthTableEntry,
	getAvailableLocales,
	LOCALES,
	listJsonFiles,
	loadCharaBase,
	loadCharaDetails,
	loadCharaParam,
	loadCharaSeriesInfo,
	loadCharaText,
	loadCharaTextRoma,
	loadConfig,
	loadGamedata,
	loadGrowthTableMain,
	loadJSON,
	loadStarSignCharaInfo,
	sanitizeText,
	toHex,
} from "./data-loader.js";
export * from "./entities.js";
// Error handling
export {
	InagleError,
	InagleErrorCode,
	type InagleErrorCodeType,
	type InagleErrorDetails,
	inagleLogger,
	isInagleError,
	wrapError,
} from "./errors.js";
export * from "./gamedata.js";
export * from "./hash.js";

export * from "./images.js";
export * from "./openapi.js";
export * from "./parser.js";
// New architecture - explicit exports to avoid conflicts
export { DATA_ROOT, type DataFile, type DataPath, FILES, PATHS } from "./paths.js";
export * from "./search.js";

// Types with aliased names to avoid conflicts
export {
	type Basara as GameBasara,
	type BasaraBuild as GameBasaraBuild,
	type Character,
	type Character as GameCharacter,
	type CharacterStats as GameCharacterStats,
	type CharaParamRaw,
	type DataManifest,
	ElementId,
	ElementNames,
	type HeroVariants as GameHeroVariants,
	type Item as GameItem,
	type LocalizedNames as GameLocalizedNames,
	type MultiLevelStats,
	PositionId,
	PositionNames,
	RarityId,
	RarityNames,
	type RomanizedName,
	type Skill as GameSkill,
	type Team as GameTeam,
} from "./types.js";
