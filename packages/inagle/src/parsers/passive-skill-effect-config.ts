/**
 * @file passive-skill-effect-config.ts
 * @description Parser for passive skill effect parameters
 *
 * Data source: skill/passive_skill_effect_config.cfg.bin.json
 *
 * Structure (lists format):
 * - m_soccerPassiveSkillEffectRangeList: Range config (1 entry)
 *   Fields: rangeType (int)
 * - m_soccerPassiveSkillEffectList: Effect entries with 8 float params
 *   Fields: effectId (hex), effectParam1-8 (float)
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface PassiveSkillEffectRange {
	rangeType: number;
}

export interface PassiveSkillEffect {
	effectId: string;
	params: number[];
}

export interface PassiveSkillEffectDatabase {
	effects: PassiveSkillEffect[];
	ranges: PassiveSkillEffectRange[];
	byEffectId: Map<string, PassiveSkillEffect>;
	/** Get effect parameters by ID */
	getEffect: (effectId: string) => PassiveSkillEffect | null;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any) {
	const effects: PassiveSkillEffect[] = [];
	const ranges: PassiveSkillEffectRange[] = [];

	if (!content?.lists) return { effects, ranges };

	for (const list of content.lists) {
		if (list.name === "m_soccerPassiveSkillEffectRangeList") {
			for (const val of list.values) {
				ranges.push({ rangeType: val.rangeType });
			}
		} else if (list.name === "m_soccerPassiveSkillEffectList") {
			for (const val of list.values) {
				effects.push({
					effectId: val.effectId,
					params: [
						val.effectParam1,
						val.effectParam2,
						val.effectParam3,
						val.effectParam4,
						val.effectParam5,
						val.effectParam6,
						val.effectParam7,
						val.effectParam8,
					],
				});
			}
		}
	}
	return { effects, ranges };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadPassiveSkillEffectConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("skill", "passive_skill_effect_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/skill", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildPassiveSkillEffectDatabase(
	dataPath: string = DATA_ROOT
): Promise<PassiveSkillEffectDatabase> {
	const result = await loadPassiveSkillEffectConfigAsync(dataPath);
	const effects = result?.effects || [];
	const ranges = result?.ranges || [];

	const byEffectId = new Map<string, PassiveSkillEffect>();
	for (const e of effects) byEffectId.set(e.effectId, e);

	return {
		effects,
		ranges,
		byEffectId,
		getEffect: (effectId: string) => byEffectId.get(effectId) ?? null,
	};
}
