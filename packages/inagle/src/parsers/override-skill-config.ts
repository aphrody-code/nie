/**
 * @file override-skill-config.ts
 * @description Parser for override_skill_config files (DLC Orion - Skill Override system)
 *
 * Data source: skill/override_skill_config_3.00.21.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_OverrideConditionSkillInfoList: Skill conditions for override activation
 * - m_OverrideConditionInfoList: Condition groups referencing skill data
 * - m_OverrideSkillInfoList: Override skills referencing conditions
 *
 * Override skills are activated when certain skill conditions are met in battle.
 * For example, having specific skills equipped can upgrade/transform into a stronger version.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";

// ============================================================================
// Types
// ============================================================================

/** Condition skill entry - a skill that must be present for the override to trigger */
export interface OverrideConditionSkillInfo {
	/** Skill ID (hex CRC hash) */
	skillId: string;
	/** Required number of this skill (usually 1, sometimes 2-4) */
	num: number;
}

/** Condition group that references a slice of condition skills */
export interface OverrideConditionInfo {
	/** Condition type (0 = individual skill check, 2 = team/combo check) */
	conditionType: number;
	/** Reference to condition skill data [startIndex, count] */
	refConditionSkillData: [number, number];
}

/** Override skill entry - the resulting skill when conditions are met */
export interface OverrideSkillInfo {
	/** Override skill ID (hex CRC hash) */
	overrideSkillId: string;
	/** Reference to condition data [startIndex, count] */
	refConditionData: [number, number];
}

/** Resolved override: skill + all its activation conditions */
export interface ResolvedOverride {
	/** The override skill ID */
	overrideSkillId: string;
	/** Conditions needed to activate this override */
	conditions: Array<{
		conditionType: number;
		requiredSkills: OverrideConditionSkillInfo[];
	}>;
}

/** Complete override skill database */
export interface OverrideSkillDatabase {
	conditionSkills: OverrideConditionSkillInfo[];
	conditions: OverrideConditionInfo[];
	overrides: OverrideSkillInfo[];
	/** Resolved overrides with conditions fully linked */
	resolved: ResolvedOverride[];
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): OverrideSkillDatabase {
	const conditionSkills: OverrideConditionSkillInfo[] = [];
	const conditions: OverrideConditionInfo[] = [];
	const overrides: OverrideSkillInfo[] = [];

	if (!content.lists) {
		return { conditionSkills, conditions, overrides, resolved: [] };
	}

	for (const list of content.lists) {
		if (list.name === "m_OverrideConditionSkillInfoList") {
			for (const val of list.values) {
				conditionSkills.push({
					skillId: val.skillId,
					num: val.num,
				});
			}
		} else if (list.name === "m_OverrideConditionInfoList") {
			for (const val of list.values) {
				conditions.push({
					conditionType: val.conditionType,
					refConditionSkillData: val.refConditionSkillData as [number, number],
				});
			}
		} else if (list.name === "m_OverrideSkillInfoList") {
			for (const val of list.values) {
				overrides.push({
					overrideSkillId: val.overrideSkillId,
					refConditionData: val.refConditionData as [number, number],
				});
			}
		}
	}

	// Resolve references: override -> conditions -> skills
	const resolved: ResolvedOverride[] = [];
	for (const override of overrides) {
		const [condStart, condCount] = override.refConditionData;
		const resolvedConditions: ResolvedOverride["conditions"] = [];

		for (let i = condStart; i < condStart + condCount && i < conditions.length; i++) {
			const cond = conditions[i];
			const [skillStart, skillCount] = cond.refConditionSkillData;
			const requiredSkills: OverrideConditionSkillInfo[] = [];

			for (let j = skillStart; j < skillStart + skillCount && j < conditionSkills.length; j++) {
				requiredSkills.push(conditionSkills[j]);
			}

			resolvedConditions.push({
				conditionType: cond.conditionType,
				requiredSkills,
			});
		}

		resolved.push({
			overrideSkillId: override.overrideSkillId,
			conditions: resolvedConditions,
		});
	}

	return { conditionSkills, conditions, overrides, resolved };
}

// ============================================================================
// Loaders
// ============================================================================

function findOverrideSkillConfigFile(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir);
	const configFile = files
		.filter((f) => f.startsWith("override_skill_config_") && f.endsWith(".cfg.bin.json"))
		.sort()
		.pop();
	return configFile ? join(dir, configFile) : null;
}

export async function loadOverrideSkillConfigAsync(
	dataPath: string
): Promise<OverrideSkillDatabase | null> {
	const skillDir = join(dataPath, "common", "gamedata", "skill");
	const configPath = findOverrideSkillConfigFile(skillDir);

	if (!configPath) {
		console.warn("[override-skill-config] Config not found in", skillDir);
		return null;
	}

	const content = await loadJsonAsync<any>(configPath);
	if (!content) return null;

	const db = parseContent(content);
	console.log(
		`[OverrideSkillParser] Loaded ${db.overrides.length} override skills, ` +
			`${db.conditions.length} conditions, ${db.conditionSkills.length} condition skills.`
	);
	return db;
}

export async function buildOverrideSkillDatabase(dataPath: string) {
	const db = await loadOverrideSkillConfigAsync(dataPath);
	return db || { conditionSkills: [], conditions: [], overrides: [], resolved: [] };
}
