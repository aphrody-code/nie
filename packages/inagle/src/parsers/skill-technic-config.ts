/**
 * @file skill-technic-config.ts
 * @description Parser for skill technic/animation configuration
 *
 * Data source: skill/skill_technic_config_1.01.34.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_SkillTechnicInfoList: Technic entries (14 entries)
 *   Fields: id (hex), winSubMotionNameCrc, loseSubMotionNameCrc,
 *           loseType, formationType, formationCharaLen,
 *           shootCurveMidRate, shootCurveHeightRate, shootCurveAngle
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface SkillTechnicInfo {
	id: string;
	winSubMotionNameCrc: string;
	loseSubMotionNameCrc: string;
	loseType: number;
	formationType: number;
	formationCharaLen: number;
	shootCurveMidRate: number;
	shootCurveHeightRate: number;
	shootCurveAngle: number;
}

export interface SkillTechnicDatabase {
	technics: SkillTechnicInfo[];
	bySkillId: Map<string, SkillTechnicInfo>;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): SkillTechnicInfo[] {
	const technics: SkillTechnicInfo[] = [];
	if (!content?.lists) return technics;

	for (const list of content.lists) {
		if (list.name === "m_SkillTechnicInfoList") {
			for (const val of list.values) {
				technics.push({
					id: val.id,
					winSubMotionNameCrc: val.winSubMotionNameCrc,
					loseSubMotionNameCrc: val.loseSubMotionNameCrc,
					loseType: val.loseType,
					formationType: val.formationType,
					formationCharaLen: val.formationCharaLen,
					shootCurveMidRate: val.shootCurveMidRate,
					shootCurveHeightRate: val.shootCurveHeightRate,
					shootCurveAngle: val.shootCurveAngle,
				});
			}
		}
	}
	return technics;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadSkillTechnicConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("skill", "skill_technic_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/skill", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildSkillTechnicDatabase(
	dataPath: string = DATA_ROOT
): Promise<SkillTechnicDatabase> {
	const technics = (await loadSkillTechnicConfigAsync(dataPath)) || [];
	const bySkillId = new Map<string, SkillTechnicInfo>();
	for (const t of technics) bySkillId.set(t.id, t);

	return { technics, bySkillId };
}
