/**
 * Complete TypeScript types for all gamedata
 * Generated from all-gamedata extraction (453 lists, 66,270 entries)
 */

// ============= COMMON TYPES =============

/** Hash ID string (0xXXXXXXXX) */
export type HashId = string;

/** Multilingual text fields */
export interface MultilingualText {
	name_EN?: string;
	name_JA?: string;
	name_FR?: string;
	desc_EN?: string;
	desc_JA?: string;
	desc_FR?: string;
}

/** Base entity with source tracking */
export interface BaseGamedataEntity {
	_source?: string;
	_file?: string;
}

// ============= SKILLS (2,458 entries) =============

/** Skill element */
export enum SkillElement {
	Neutral = 0,
	Fire = 1,
	Wind = 2,
	Earth = 3,
	Wood = 4,
	Void = 5,
}

/** Skill category */
export enum SkillCategory {
	Unknown = 0,
	Shoot = 1,
	Dribble = 2,
	Block = 3,
	Catch = 4,
	Skill = 5,
	Passive = 6,
	Special = 9,
}

/** Skill partner type */
export enum SkillPartnerType {
	None = 0,
	One = 1,
	Two = 2,
	Three = 3,
}

/** Complete skill info */
export interface SkillInfo extends BaseGamedataEntity, MultilingualText {
	skillID: HashId;
	skillIDStr: string;
	eventID: HashId;
	eventIDName: string;
	failEventID: HashId;
	failEventIDName: string;
	skillNameId: HashId;
	skillDescId: HashId;
	cmdOptIdx: number;
	skillEffectBitFlag: number;
	power_min: number;
	power_max: number;
	element: SkillElement;
	colorIdx: number;
	category: SkillCategory;
	growthType: number;
	foulRate: number;
	consumeTp: number;
	focusBattleEffectId: HashId;
	recastTime: number;
	partnerType: SkillPartnerType;
	partner1: HashId;
	partner2: HashId;
	partner3: HashId;
	telopInfoId: HashId;
	eldorado: boolean;
}

// ============= CHARACTERS =============

/** Character personality type */
export enum PersonalityType {
	Unknown = 0,
	Gentle = 1,
	Cool = 2,
	Hot = 3,
	Shy = 4,
	Mature = 5,
}

/** Character details (550 entries) */
export interface CharacterDetails extends BaseGamedataEntity, MultilingualText {
	chara_id: HashId;
	charaIdStr?: string;
	personality_type: PersonalityType;
	first_person: HashId;
	second_person_male: HashId;
	second_person_female: HashId;
	nameHash?: HashId;
	rubyName_FR?: string | null;
}

/** Character name tag config (590 entries) */
export interface CharacterNameTag extends BaseGamedataEntity, MultilingualText {
	charaId: HashId;
	nameHash: HashId;
	charaIdStr?: string;
}

/** Character star sign info (4,439 entries) - rarity and gacha rate info */
export interface CharacterStarSign extends BaseGamedataEntity {
	charaParamId: HashId;
	charaRarity: number;
	charaRateDefault: number;
	charaRateBoostA: number;
	charaRateBoostB: number;
	charaRateBoostC: number;
	charaRateBoostD: number;
	isRemarkable: boolean;
	enableCond: string;
	name_FR?: string | null;
	rubyName_FR?: string | null;
}

/** Character ID to nameHash mapping (7,148 entries) */
export interface CharacterIdMapping extends BaseGamedataEntity, MultilingualText {
	charaId: HashId;
	nameHash: HashId;
	starSign?: number;
}

/** Character scale info (2,373 entries) */
export interface CharacterScale extends BaseGamedataEntity {
	charaId: HashId;
	height: number;
	bodyScale: number;
	headScale: number;
}

/** Character placement data (1,633 entries) */
export interface CharacterPlacement extends BaseGamedataEntity {
	charaId: HashId;
	position: number;
	formation: HashId;
}

// ============= TEAMS & FORMATIONS =============

/** Team info (9 entries) */
export interface TeamInfo extends BaseGamedataEntity, MultilingualText {
	teamId: HashId;
	teamIdStr?: string;
	uniformId: HashId;
	emblemId: HashId;
	homeStadiumId: HashId;
}

/** Formation info (77 unique 11v11 formations after filtering) */
export interface FormationInfo extends BaseGamedataEntity, MultilingualText {
	formId: HashId;
	formIdStr?: string;
	placementInfo: [number, number];
	powerOffense: number;
	powerDefense: number;
	nounId: HashId;
	descId: HashId;
}

/** Formation placement info (1,045 entries) */
export interface FormationPlacement extends BaseGamedataEntity {
	formId: HashId;
	index: number;
	posX: number;
	posY: number;
	role: number;
}

/** Uniform info (727 entries) */
export interface UniformInfo extends BaseGamedataEntity {
	uniformId: HashId;
	uniformIdStr?: string;
	teamId: HashId;
	colorMain: number;
	colorSub: number;
	modelPath: string;
}

// ============= QUESTS (755 entries) =============

export interface QuestInfo extends BaseGamedataEntity {
	questId?: HashId;
	explainTextId: HashId;
	condCount: number;
	questFlagNum: number;
	openPhase: number;
	itemTableId: HashId;
	limit: string;
	icon: [number, number];
	explain_EN?: string;
	explain_JA?: string;
	explain_FR?: string;
}

// ============= ITEMS =============

/** Item type */
export enum ItemType {
	Consumable = 0,
	KeyItem = 1,
	Equipment = 2,
	Material = 3,
	Capsule = 4,
}

/** Item info */
export interface ItemInfo extends BaseGamedataEntity, MultilingualText {
	itemId: HashId;
	itemIdStr?: string;
	itemType: ItemType;
	maxCount: number;
	sellPrice: number;
	buyPrice: number;
	effectId: HashId;
	iconPath: string;
}

/** Capsule info */
export interface CapsuleInfo extends BaseGamedataEntity, MultilingualText {
	capsuleId: HashId;
	capsuleIdStr?: string;
	rarity: number;
	dropTable: HashId[];
	thumbnailPath: string;
}

// ============= GALLERY (360 entries) =============

export interface GalleryInfo extends BaseGamedataEntity, MultilingualText {
	galleryId: HashId;
	galleryIdStr?: string;
	categoryId: number;
	imgPath: string;
	thumbPath: string;
	unlockCondition: HashId;
}

// ============= SERIES (game series info) =============

export interface SeriesInfo extends BaseGamedataEntity, MultilingualText {
	seriesId: HashId;
	seriesIdStr?: string;
	displayOrder: number;
	iconPath: string;
}

// ============= MATCH & BATTLE =============

/** Match difficulty info (404 entries) */
export interface MatchDifficultyInfo extends BaseGamedataEntity {
	difficultyId: HashId;
	level: number;
	cpuStrength: number;
	rewardMultiplier: number;
}

/** Battle event (scenarios, 1,170 entries) */
export interface ScenarioBattleInfo extends BaseGamedataEntity {
	scenarioId: HashId;
	scenarioIdStr?: string;
	battleType: number;
	opponentTeam: HashId;
	difficulty: number;
	rewards: HashId[];
}

// ============= CHARACTER EDIT (2,704+ entries) =============

export interface CharaEditPreset extends BaseGamedataEntity {
	presetId: HashId;
	presetIdStr?: string;
	categoryId: number;
	partsData: number[];
	colorData: number[];
}

export interface CharaEditColor extends BaseGamedataEntity {
	colorId: HashId;
	colorIdStr?: string;
	r: number;
	g: number;
	b: number;
	a: number;
}

export interface CharaEditParts extends BaseGamedataEntity {
	partsId: HashId;
	partsIdStr?: string;
	categoryId: number;
	modelPath: string;
	iconPath: string;
}

// ============= PASSIVE SKILLS =============

export interface PassiveSkillInfo extends BaseGamedataEntity, MultilingualText {
	passiveId: HashId;
	passiveIdStr?: string;
	effectType: number;
	effectValue: number;
	targetType: number;
	rarity: number;
}

export interface TeamPassiveInfo extends BaseGamedataEntity, MultilingualText {
	teamPassiveId: HashId;
	teamPassiveIdStr?: string;
	effectType: number;
	effectValue: number;
	conditionType: number;
}

// ============= SKILL EVOLUTION =============

export interface SkillEvolutionCondition extends BaseGamedataEntity {
	skillId: HashId;
	targetSkillId: HashId;
	conditionType: number;
	conditionValue: number;
	requiredLevel: number;
}

// ============= MISC =============

/** Staff roll entry (2,033 entries) */
export interface StaffRollEntry extends BaseGamedataEntity {
	staffId: HashId;
	name: string;
	role: string;
	section: string;
}

/** Expression info for characters */
export interface CharaExpressionInfo extends BaseGamedataEntity {
	expressionId: HashId;
	charaId: HashId;
	expressionType: number;
	animationPath: string;
}

// ============= SUMMARY =============

export interface GamedataSummary {
	totalLists: number;
	totalEntries: number;
	lists: Array<{
		name: string;
		fileName: string;
		count: number;
		sourceFile: string;
	}>;
}

// ============= COLLECTION TYPES =============

export interface AllGamedata {
	skills: SkillInfo[];
	characters: CharacterDetails[];
	characterNameTags: CharacterNameTag[];
	characterStarSigns: CharacterStarSign[];
	characterIdMapping: CharacterIdMapping[];
	characterScales: CharacterScale[];
	teams: TeamInfo[];
	formations: FormationInfo[];
	formationPlacements: FormationPlacement[];
	uniforms: UniformInfo[];
	quests: QuestInfo[];
	items: ItemInfo[];
	capsules: CapsuleInfo[];
	gallery: GalleryInfo[];
	series: SeriesInfo[];
	matchDifficulties: MatchDifficultyInfo[];
	scenarios: ScenarioBattleInfo[];
	charaEditPresets: CharaEditPreset[];
	charaEditColors: CharaEditColor[];
	passiveSkills: PassiveSkillInfo[];
	teamPassives: TeamPassiveInfo[];
	skillEvolutions: SkillEvolutionCondition[];
}
