// @ts-nocheck
/**
 * @file parsers/index.ts
 * @description Parser module exports for raw game data
 */

// Team and series parser
export {
	type BelongTeamInfo as RawBelongTeamInfo,
	buildSeriesMapping,
	buildTeamMapping,
	type CharaSeriesInfo,
	getAllSeries,
	getAllTeams,
	getSeriesById,
	getTeamById,
	getTeamsBySeason,
	SEASON_NAMES,
	SERIES_TYPE,
	type Season,
	type Series,
	searchTeams,
	type Team,
} from "./belong-team.js";
// Binary format parsers
export {
	buildHashTable,
	CFGBIN_MAGIC,
	type CfgBinDocument as BinaryCfgBinDocument,
	type CfgBinEntry as BinaryCfgBinEntry,
	type CfgBinHeader as BinaryCfgBinHeader,
	type CfgBinInfo,
	getCfgBinInfo,
	hasValidFooter,
	parseCfgBin,
	parseHeader as parseCfgBinHeader,
	resolveNames,
	toJson as cfgBinToJson,
	VariableType as BinaryCfgBinVariableType,
} from "./binary/cfgbin-parser.js";
export {
	convertNxtchToDds,
	DDS_MAGIC,
	G4TX_MAGIC,
	type G4txEntry,
	type G4txHeader,
	type G4txInfo,
	type G4txSubEntry,
	type G4txSubTexture,
	type G4txTexture,
	getFormatName,
	getG4txInfo,
	isG4tx,
	type NxtchHeader,
	NxtchTextureFormat,
	parseHeader as parseG4txHeader,
	parseNxtchHeader,
	parseTextures,
} from "./binary/g4tx-parser.js";
// Boost player group parser
export {
	type BoostPlayerGroupConfig,
	type BoostPlayerGroupDatabase,
	type BoostSpiritTableEntry,
	buildBoostPlayerGroupDatabase,
	loadBoostPlayerGroupConfigAsync,
} from "./boost-player-group-config.js";
// Capsule (gacha) parser
export {
	buildCapsuleDatabase,
	type CapsuleConfigInfo,
	type CapsuleDatabase,
	type CapsuleLotRankRate,
	type CapsulePrizeInfo,
	type CapsulePrizeTable,
	type CapsuleWeaponColorEntry,
	loadCapsuleConfigAsync,
} from "./capsule-config.js";
// Change Aura Skill parser
export {
	buildChangeAuraSkillDatabase,
	type ChangeAuraSkillData,
	type ChangeAuraSkillDatabase,
	type ChangeAuraSkillInfo,
	loadChangeAuraSkillConfigAsync,
} from "./change-aura-skill-config.js";
// Character base parser
export {
	buildCharaBaseMap,
	buildCodeToBaseMap,
	buildNameHashToBaseMap,
	type ParsedCharaBase,
	parseAllCharaBase,
} from "./chara-base.js";
// Character costume parser
export {
	buildCharaCostumeDatabase,
	type CharaCostume,
	type CharaCostumeDatabase,
	loadCharaCostumeConfigAsync,
} from "./chara-costume-config.js";
// Character description parser
export {
	buildAllDescriptionMaps,
	type DescriptionMaps,
	getDescription,
	loadCharaDescriptions,
	type ParsedDescription,
} from "./chara-description.js";
// Character EXP table parser
export {
	buildCharaExpTableDatabase,
	type CharaExpEntry,
	type CharaExpTableDatabase,
	type ExpRarityRate,
	loadCharaExpTableAsync,
} from "./chara-exp-table.js";
// Character param parser
export {
	buildCharaBaseToParamsMap,
	buildCharaParamMap,
	elementIdToNames,
	type ParsedCharaParam,
	parseAllCharaParams,
	positionIdToCode,
	rarityCodeToName,
} from "./chara-param.js";
// Character text parser
export {
	buildAllNameMaps,
	buildNameMap,
	buildRomanizedMap,
	getLocalizedNames,
	type LocalizedCharaNames,
	type ParsedNoun,
	type ParsedRomanizedName,
} from "./chara-text.js";
// Constellation parser (Players Universe star signs)
export {
	buildConstellationMapping,
	type Constellation,
	type ConstellationMapping,
	clearConstellationCache,
	getAllConstellations,
	getCharacterIdsInConstellation,
	getConstellationByIndex,
	getConstellationByName,
	getConstellationForCharacter,
	type StarInfo,
	type StarSignRarityRateInfo,
} from "./constellation.js";
// Controllable character parser
export {
	buildCtrlCharaDatabase,
	type CtrlCharaData,
	type CtrlCharaDatabase,
	loadCtrlCharaConfigAsync,
} from "./ctrl-chara-config.js";
// Dictionary parser
export {
	buildDictionaryDatabase,
	type DictionaryDatabase,
	type DictionaryHabitat,
	type DictionaryObservation,
	loadDictionaryConfigAsync,
} from "./dictionary-config.js";
// Enjoy mode team parser
export {
	buildEnjoyModeTeamDatabase,
	type EnjoyModeTeamDatabase,
	loadEnjoyModeTeamConfigAsync,
	type ParsedEnjoyModeTeam,
} from "./enjoy-mode-team-config.js";
// Extended story parser
export {
	buildExtendStoryDatabase,
	type ExtendStoryData,
	type ExtendStoryDatabase,
	type ExtendStoryGameData,
	loadExtendStoryConfigAsync,
} from "./extend-story-config.js";
// Formation parser
export { buildFormationDatabase, type ParsedFormation } from "./formation-config.js";
// Gallery parser
export {
	buildGalleryDatabase,
	type GalleryDatabase,
	loadGalleryConfigAsync,
	type ParsedGallery,
} from "./gallery-config.js";
// Unlock-condition decoder (gallery openCond + scene_archive condition)
export {
	buildEventCrcLookup,
	decodeUnlockCondition,
	type RequiredEvent,
	STORY_EPISODE_BASE,
	STORY_EPISODE_STEP,
	STORY_NAMESPACE,
	storyThresholdToEpisode,
	type UnlockCondition,
	type UnlockOp,
} from "./unlock-condition.js";
// Gameplay parser (Events, Craft, Routes)
export {
	buildCraftDatabase,
	buildEventDatabase,
	buildVsRouteDatabase,
	type ParsedCraft,
	type ParsedEvent,
	type ParsedVsRoute,
} from "./gameplay-config.js";
// Growth table parser
export {
	buildGrowthTableDatabase,
	type GrowthTableDatabase,
	type GrowthTableLv1,
	type GrowthTableLv30,
	type GrowthTableMain,
	type GrowthTableSub,
	loadGrowthTableConfigAsync,
} from "./growth-table-config.js";
// Hash utilities - renamed to avoid conflicts with core/crc32
export { crc32 as binaryCrc32, crc32Hex as binaryCrc32Hex } from "./hash/crc32.js";
// Help parser
export { buildHelpDatabase, type ParsedHelp } from "./help-config.js";
// Inacode parser
export {
	buildInacodeDatabase,
	type InacodeDatabase,
	type InacodeStamp,
	loadInacodeConfigAsync,
} from "./inacode-config.js";
// Item config parser
export {
	buildItemDatabase,
	buildItemDatabaseAsync,
	type ItemCategory,
	loadFashionItemMappingAsync,
	loadItemConfig,
	type ParsedItem,
} from "./item-config.js";
// Mission parser
export { buildMissionDatabase, type ParsedMission } from "./mission-config.js";
// Music parser
export { buildMusicDatabase, type ParsedMusic } from "./music-config.js";
// NFC lottery parser
export {
	buildNfcLotteryDatabase,
	loadNfcLotteryConfigAsync,
	type NfcLottery,
	type NfcLotteryDatabase,
	type NfcLotteryItem,
	type NfcLotteryTable,
} from "./nfc-lottery-config.js";
// Opponent team parser
export {
	buildOpponentTeamDatabase,
	loadOpponentTeamConfigAsync,
	type MatchDifficultyInfo,
	type OpponentTeamDatabase,
	type ParsedOpponentTeam,
	type PracticeMatchInfo,
} from "./opponent-team-config.js";
// Override Skill parser (DLC Orion)
export {
	buildOverrideSkillDatabase,
	loadOverrideSkillConfigAsync,
	type OverrideConditionInfo,
	type OverrideConditionSkillInfo,
	type OverrideSkillDatabase,
	type OverrideSkillInfo,
	type ResolvedOverride,
} from "./override-skill-config.js";
// Passive Skill parser
export {
	buildPassiveDatabase,
	buildPassiveDatabaseAsync,
	type ParsedPassive,
} from "./passive-skill-config.js";
// Passive skill effect parser
export {
	buildPassiveSkillEffectDatabase,
	loadPassiveSkillEffectConfigAsync,
	type PassiveSkillEffect,
	type PassiveSkillEffectDatabase,
	type PassiveSkillEffectRange,
} from "./passive-skill-effect-config.js";
// Playstyle parser (chara_param T2B[5])
export {
	buildPlaystyleMap,
	type PlaystyleEntry,
	parseAllPlaystyles,
	playstyleIdToEn,
	playstyleIdToFr,
} from "./playstyle.js";
// Post/Delivery parser
export { buildPostDatabase, type ParsedDelivery, type ParsedPassword } from "./post-config.js";
// Quest parser
export {
	buildQuestDatabase,
	loadQuestConfig,
	type ParsedQuest,
	QuestType,
} from "./quest-config.js";
// Real skill parser
export {
	buildRealSkillDatabase,
	loadRealSkillConfigAsync,
	type RealSkillDatabase,
	type RealSkillInfo,
	type RealSkillShootCourse,
} from "./real-skill-config.js";
// Shop parser
export { loadShopConfig, type ShopInfo, type ShopItem } from "./shop-config.js";
// Skill parser
export { buildSkillDatabase, buildSkillDatabaseAsync, type ParsedSkill } from "./skill-config.js";
// Skill technic parser
export {
	buildSkillTechnicDatabase,
	loadSkillTechnicConfigAsync,
	type SkillTechnicDatabase,
	type SkillTechnicInfo,
} from "./skill-technic-config.js";
// Star sign parser (Players Universe rarity / drop pool per sign)
export {
	buildStarSignMap,
	getRarity,
	isRemarkable,
	loadStarSignCharaInfo,
	rarityToGrowthRank,
	type StarSignCharaInfo,
} from "./star-sign.js";
// Special Tactics parser (DLC Orion - Tactiques Speciales)
export {
	buildSpecialTacticsDatabase,
	type ParsedSpecialTactic,
	type SpecialTacticsCondId,
	type SpecialTacticsDatabase,
	type SpecialTacticsEffect,
} from "./special-tactics-config.js";
// Super tactics base parser (pre-DLC)
export {
	buildSuperTacticsBaseDatabase,
	loadSuperTacticsBaseConfigAsync,
	type SuperTacticsBaseDatabase,
	type SuperTacticsBaseEffect,
	type SuperTacticsBaseInfo,
} from "./super-tactics-base-config.js";
// System/Menu parser
export { buildMenuDatabase, type ParsedMenuInfo } from "./system-config.js";
// Team Build parser (DLC Orion)
export {
	buildTeamBuildDatabase,
	loadTeamBuildConfigAsync,
	type TeamBuildDatabase,
	type TeamBuildEffectData,
	type TeamBuildEffectInfo,
	type TeamBuildInfo,
	type TeamBuildModifierData,
} from "./team-build-config.js";
// Generic text parser for all text files
export {
	buildTextDatabase,
	buildTextMaps,
	type GameTextType,
	getLocalizedText,
	type LocalizedTextMaps,
	loadTextFile,
	loadTextFileAsync,
	loadTextListAsync,
	type TextDatabase,
} from "./text-parser.js";
// Trick parser
export {
	buildTrickDatabase,
	loadTrickConfigAsync,
	type ParsedTrick,
	type TrickDatabase,
} from "./trick-config.js";
// Trophy parser
export { buildTrophyDatabase, type ParsedTrophy } from "./trophy-config.js";
// Uniform parser
export {
	buildUniformDatabase,
	loadUniformConfigAsync,
	type UniformDatabase,
	type UniformInfo,
	type UniformModelInfo,
} from "./uniform-config.js";
// Universal gamedata parser - auto-discovers ALL gamedata files
export {
	buildUniversalGamedataDatabase,
	createUniversalGamedataAPI,
	discoverAllGamedata,
	discoverCategoryFiles,
	discoverGamedataCategories,
	type EntityExtractorConfig,
	extractEntities,
	type GamedataFileInfo,
	type LoadedGamedata,
	loadFromDatabase,
	loadGamedataFile,
	type ParsedEntry,
	type UniversalGamedataAPI,
	type UniversalGamedataDatabase,
} from "./universal-gamedata.js";
// Universal text parser - auto-discovers ALL text files
export {
	buildUniversalTextDatabase,
	createUniversalTextAPI,
	discoverTextFiles,
	loadTextFileRaw,
	loadUniversalText,
	type TextFileInfo,
	type UniversalTextAPI,
	type UniversalTextDatabase,
} from "./universal-text.js";

// Additional config parsers
export {
	buildActivityPhotoDatabase,
	type ActivityPhotoDatabase,
	type ParsedTrophyReward,
} from "./activity-photo-config.js";
export {
	buildChatEmoteDatabase,
	type ChatEmoteDatabase,
	type ParsedChatEmote,
} from "./chat-emote-config.js";
export {
	buildNameplateDatabase,
	type NameplateDatabase,
	type ParsedNameplate,
} from "./nameplate-config.js";
export {
	buildPerformanceDatabase,
	type PerformanceDatabase,
	type ParsedPerformance,
} from "./performance-config.js";
export {
	buildPhaseTitleDatabase,
	type PhaseTitleDatabase,
	type ParsedPhaseTitle,
} from "./phase-title-config.js";
export {
	buildSceneArchiveDatabase,
	type SceneArchiveDatabase,
	type ParsedSceneArchive,
} from "./scene-archive-config.js";
export {
	buildStadiumDatabase,
	type StadiumDatabase,
	type ParsedStadium,
} from "./stadium-config.js";
export {
	buildCharaMenuResourceDatabase,
	type ParsedCharaResource,
} from "./chara-menu-resource-config.js";

// Story text parser (dialogues, map NPCs, goals, phases)
export {
	buildStoryTextDatabase,
	parseAllEventDialogues,
	parseAllMapNpcDialogues,
	parseAllStoryGoals,
	parseAllChapterPhases,
	type StoryEvent,
	type StoryDialogueLine,
	type ResolvedSpeaker,
	type MapNpcDialogue,
	type StoryGoal,
	type ChapterPhase,
} from "./story-text-parser.js";



