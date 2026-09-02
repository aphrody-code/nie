/**
 * @file change-aura-skill-config.ts
 * @description Parser for aura skill change mappings
 *
 * Data source: skill/change_aura_skill_config_1.01.73.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_ChangeAuraSkillDataList: Aura skill → character mappings
 *   Fields: id (hex), charaParamId (hex, 0x00000000 if none)
 * - m_ChangeAuraSkillInfoList: Additional aura skill info
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ChangeAuraSkillData {
	/** Aura skill ID (hex) */
	id: string;
	/** Character param ID linked to this aura (0x00000000 if generic) */
	charaParamId: string;
}

export interface ChangeAuraSkillInfo {
	[key: string]: any;
}

export interface ChangeAuraSkillDatabase {
	data: ChangeAuraSkillData[];
	info: ChangeAuraSkillInfo[];
	bySkillId: Map<string, ChangeAuraSkillData>;
	/** Get character linked to an aura skill */
	getCharaForSkill: (skillId: string) => string | null;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any) {
	const data: ChangeAuraSkillData[] = [];
	const info: ChangeAuraSkillInfo[] = [];

	if (!content?.lists) return { data, info };

	for (const list of content.lists) {
		if (list.name === "m_ChangeAuraSkillDataList") {
			for (const val of list.values || []) {
				data.push({
					id: val.id,
					charaParamId: val.charaParamId,
				});
			}
		} else if (list.name === "m_ChangeAuraSkillInfoList") {
			for (const val of list.values || []) {
				info.push(val);
			}
		}
	}
	return { data, info };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadChangeAuraSkillConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("skill", "change_aura_skill_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/skill", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildChangeAuraSkillDatabase(
	dataPath: string = DATA_ROOT
): Promise<ChangeAuraSkillDatabase> {
	const result = await loadChangeAuraSkillConfigAsync(dataPath);
	const data = result?.data || [];
	const info = result?.info || [];

	const bySkillId = new Map<string, ChangeAuraSkillData>();
	for (const d of data) bySkillId.set(d.id, d);

	return {
		data,
		info,
		bySkillId,
		getCharaForSkill: (skillId: string) => {
			const entry = bySkillId.get(skillId);
			return entry && entry.charaParamId !== "0x00000000" ? entry.charaParamId : null;
		},
	};
}
