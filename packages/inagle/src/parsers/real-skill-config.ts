/**
 * @file real-skill-config.ts
 * @description Parser for real skill shoot trajectory configuration
 *
 * Data source: skill/real_skill_config_1.03.74.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_RealSkillShootCourseInfoList: Shoot trajectory courses (6 entries)
 * - m_RealSkillInfoList: Real skill entries with refs to courses (19 entries)
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface RealSkillShootCourse {
	targetRate: number;
	isGroundTarget: boolean;
	targetHeightOffset: number;
	targetHoriOffset: number;
	curveRate: number;
	curveHeightRate: number;
	curveAngle: number;
	moveTimeRate: number;
}

export interface RealSkillInfo {
	id: string;
	loseType: number;
	formationType: number;
	formationCharaLen: number;
	shootLimitBallHeightAttr: number;
	shootGroundingEffectName: string;
	shootGroundingEffectIntervalTime: number;
	shootGroundingEffectScale: number;
	shootGroundingEffectScatteringPos: number;
	/** [startIndex, count] ref to courses */
	shootCourseInfoRef: [number, number];
}

export interface RealSkillDatabase {
	courses: RealSkillShootCourse[];
	skills: RealSkillInfo[];
	bySkillId: Map<string, RealSkillInfo>;
	/** Get courses for a given skill */
	getCoursesForSkill: (skillId: string) => RealSkillShootCourse[];
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any) {
	const courses: RealSkillShootCourse[] = [];
	const skills: RealSkillInfo[] = [];

	if (!content?.lists) return { courses, skills };

	for (const list of content.lists) {
		if (list.name === "m_RealSkillShootCourseInfoList") {
			for (const val of list.values) {
				courses.push({
					targetRate: val.targetRate,
					isGroundTarget: val.isGroundTarget,
					targetHeightOffset: val.targetHeightOffset,
					targetHoriOffset: val.targetHoriOffset,
					curveRate: val.curveRate,
					curveHeightRate: val.curveHeightRate,
					curveAngle: val.curveAngle,
					moveTimeRate: val.moveTimeRate,
				});
			}
		} else if (list.name === "m_RealSkillInfoList") {
			for (const val of list.values) {
				skills.push({
					id: val.id,
					loseType: val.loseType,
					formationType: val.formationType,
					formationCharaLen: val.formationCharaLen,
					shootLimitBallHeightAttr: val.shootLimitBallHeightAttr,
					shootGroundingEffectName: val.shootGroundingEffectName,
					shootGroundingEffectIntervalTime: val.shootGroundingEffectIntervalTime,
					shootGroundingEffectScale: val.shootGroundingEffectScale,
					shootGroundingEffectScatteringPos: val.shootGroundingEffectScatteringPos,
					shootCourseInfoRef: val.shootCourseInfoRef,
				});
			}
		}
	}
	return { courses, skills };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadRealSkillConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("skill", "real_skill_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/skill", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildRealSkillDatabase(
	dataPath: string = DATA_ROOT
): Promise<RealSkillDatabase> {
	const result = await loadRealSkillConfigAsync(dataPath);
	const courses = result?.courses || [];
	const skills = result?.skills || [];

	const bySkillId = new Map<string, RealSkillInfo>();
	for (const s of skills) bySkillId.set(s.id, s);

	return {
		courses,
		skills,
		bySkillId,
		getCoursesForSkill: (skillId: string) => {
			const skill = bySkillId.get(skillId);
			if (!skill) return [];
			const [start, count] = skill.shootCourseInfoRef;
			return courses.slice(start, start + count);
		},
	};
}
