/**
 * Skill schemas based on actual JSON structure
 *
 * Source files:
 * - dump/data/common/gamedata/skill/skill_config_2.00.19.00.cfg.bin.json
 * - dump/data/common/gamedata/skill/aura_skill_config_1.04.09.00.cfg.bin.json
 * - dump/data/common/gamedata/skill/passive_skill_config_0.08.86.cfg.bin.json
 * - dump/data/common/gamedata/skill/special_tactics_config_1.04.09.10.cfg.bin.json
 */

/**
 * SKILL_OPTION_INFO from m_skillOptionInfoList
 */
export interface SkillOptionInfo {
	optionId: string; // hex e.g. "0xEF79D00C"
	isMiddleBattle: boolean;
	isCloseBattle: boolean;
	isTechnic: boolean;
}

/**
 * SKILL_INFO from m_skillInfoList
 * Main skill definition structure
 */
export interface RawSkillInfo {
	skillID: string; // hex e.g. "0x63BDA8A4"
	skillIDStr: string; // e.g. "whs00010"
	eventID: string; // hex
	eventIDName: string; // e.g. "ev60_00010"
	failEventID: string; // hex
	failEventIDName: string;
	skillNameId: string; // hex - reference to text
	skillDescId: string; // hex - reference to text
	cmdOptIdx: number; // 0-3
	skillEffectBitFlag: number;
	power_min: number;
	power_max: number;
	element: number; // 1=Fire, 2=Wood, 3=Wind, 4=Earth
	colorIdx: number; // 1-4
	category: number; // Skill category
	growthType: number; // 1-6
	foulRate: number;
	consumeTp: number; // TP cost
	focusBattleEffectId: string;
	recastTime: number; // Cooldown
	partnerType: number; // 0=solo, 2=combo
	partner1: string; // hex - partner character ID
	partner2: string;
	partner3: string;
	telopInfoId: string; // hex
	eldorado: boolean; // Eldorado skill flag
}

/**
 * Skill element enum
 */
export const RawSkillElement = {
	Fire: 1,
	Wood: 2,
	Wind: 3,
	Earth: 4,
} as const;
export type RawSkillElement = (typeof RawSkillElement)[keyof typeof RawSkillElement];

/**
 * Skill category enum
 */
export const RawSkillCategory = {
	Shot: 1,
	Dribble: 2,
	Block: 3,
	Catch: 4,
} as const;
export type RawSkillCategory = (typeof RawSkillCategory)[keyof typeof RawSkillCategory];

/**
 * Full skill_config document structure
 */
export interface SkillConfigDocument {
	version: 100;
	lists: [
		{
			name: "m_skillOptionInfoList";
			typeName: "SKILL_OPTION_INFO";
			values: SkillOptionInfo[];
		},
		{ name: "m_skillInfoList"; typeName: "SKILL_INFO"; values: RawSkillInfo[] },
	];
}
