/**
 * @file team-build-config.ts
 * @description Parser for team_build_config files (DLC Orion - Team Build system)
 *
 * Data source: skill/team_build_config_5.00.23.cfg.bin.json
 *
 * Structure (entries format with named children):
 * - TEAM_BUILD_EFFECT_DATA: Base effect data (effectId, threshold, value, conditions)
 * - TEAM_BUILD_EFFECT_INFO: Effect info grouping effect data refs
 * - TEAM_BUILD_UP_DATA: Build-up bonuses (type, threshold, multiplier, conditions)
 * - TEAM_BUILD_DOWN_DATA: Build-down penalties (type, threshold, multiplier, conditions)
 * - TEAM_BUILD_INFO: Build configuration linking up/down data and effect info
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";

// ============================================================================
// Types
// ============================================================================

/** Team build effect data entry */
export interface TeamBuildEffectData {
	/** Effect ID (CRC hash) */
	effectId: string;
	/** Activation threshold */
	threshold: number;
	/** Effect value/power */
	value: number;
	/** Condition IDs (up to 6, -992181094 = null sentinel) */
	conditions: string[];
}

/** Team build effect info, references effect data entries */
export interface TeamBuildEffectInfo {
	/** Number of effect data entries referenced */
	count: number;
	/** Indices into effect data list [startIndex, count] */
	effectDataRef?: [number, number];
}

/** Team build up/down data entry */
export interface TeamBuildModifierData {
	/** Modifier type (e.g., stat boost category) */
	type: number;
	/** Activation threshold (or null sentinel) */
	threshold: number;
	/** Multiplier/level */
	multiplier: number;
	/** Condition value 1 (or null sentinel) */
	condValue1: number;
	/** Condition value 2 (or null sentinel) */
	condValue2: number;
	/** Effect reference ID (CRC hash) */
	effectRefId: string;
	/** Effect count */
	effectCount: number;
}

/** Team build info entry (top-level build configuration) */
export interface TeamBuildInfo {
	/** Build type index */
	buildType: number;
	/** Build level/tier */
	buildLevel: number;
	/** Up data references [startIndex, count] */
	upDataRef?: [number, number];
	/** Down data references [startIndex, count] */
	downDataRef?: [number, number];
	/** Effect info references [startIndex, count] */
	effectInfoRef?: [number, number];
}

/** Complete team build database */
export interface TeamBuildDatabase {
	effectData: TeamBuildEffectData[];
	effectInfos: TeamBuildEffectInfo[];
	upData: TeamBuildModifierData[];
	downData: TeamBuildModifierData[];
	buildInfos: TeamBuildInfo[];
}

// ============================================================================
// Null sentinel used in the binary format
// ============================================================================
const NULL_SENTINEL = -992181094;

// ============================================================================
// Parser
// ============================================================================

function parseIntVar(v: { type: string; value: string }): number {
	return Number.parseInt(v.value, 10);
}

function parseContent(entries: ConfigNode[]): TeamBuildDatabase {
	const effectData: TeamBuildEffectData[] = [];
	const effectInfos: TeamBuildEffectInfo[] = [];
	const upData: TeamBuildModifierData[] = [];
	const downData: TeamBuildModifierData[] = [];
	const buildInfos: TeamBuildInfo[] = [];

	for (const entry of entries) {
		const children = entry.children || [];

		if (entry.name.startsWith("TEAM_BUILD_EFFECT_DATA_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("TEAM_BUILD_EFFECT_DATA_")) continue;
				const vars = child.variables;
				if (vars.length < 9) continue;

				const effectId = toHex(parseIntVar(vars[0]));
				const threshold = parseIntVar(vars[1]);
				const value = parseIntVar(vars[2]);
				const conditions: string[] = [];
				for (let i = 3; i < 9; i++) {
					const val = parseIntVar(vars[i]);
					if (val !== NULL_SENTINEL) {
						conditions.push(toHex(val));
					}
				}

				effectData.push({ effectId, threshold, value, conditions });
			}
		} else if (entry.name.startsWith("TEAM_BUILD_EFFECT_INFO_LIST_BEG")) {
			let currentInfo: TeamBuildEffectInfo | null = null;

			for (const child of children) {
				if (child.name.match(/^TEAM_BUILD_EFFECT_INFO_\d+$/)) {
					if (currentInfo) effectInfos.push(currentInfo);
					const vars = child.variables;
					currentInfo = { count: vars.length > 0 ? parseIntVar(vars[0]) : 0 };
				} else if (child.name.startsWith("TEAM_BUILD_EFFECT_INFO_REF_EFFECT_DATA_")) {
					if (currentInfo && child.variables.length >= 2) {
						currentInfo.effectDataRef = [
							parseIntVar(child.variables[0]),
							parseIntVar(child.variables[1]),
						];
					}
				}
			}
			if (currentInfo) effectInfos.push(currentInfo);
		} else if (entry.name.startsWith("TEAM_BUILD_UP_DATA_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("TEAM_BUILD_UP_DATA_")) continue;
				const vars = child.variables;
				if (vars.length < 7) continue;

				upData.push({
					type: parseIntVar(vars[0]),
					threshold: parseIntVar(vars[1]),
					multiplier: parseIntVar(vars[2]),
					condValue1: parseIntVar(vars[3]),
					condValue2: parseIntVar(vars[4]),
					effectRefId: toHex(parseIntVar(vars[5])),
					effectCount: parseIntVar(vars[6]),
				});
			}
		} else if (entry.name.startsWith("TEAM_BUILD_DOWN_DATA_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("TEAM_BUILD_DOWN_DATA_")) continue;
				const vars = child.variables;
				if (vars.length < 7) continue;

				downData.push({
					type: parseIntVar(vars[0]),
					threshold: parseIntVar(vars[1]),
					multiplier: parseIntVar(vars[2]),
					condValue1: parseIntVar(vars[3]),
					condValue2: parseIntVar(vars[4]),
					effectRefId: toHex(parseIntVar(vars[5])),
					effectCount: parseIntVar(vars[6]),
				});
			}
		} else if (entry.name.startsWith("TEAM_BUILD_INFO_LIST_BEG")) {
			let currentBuild: TeamBuildInfo | null = null;

			for (const child of children) {
				if (child.name.match(/^TEAM_BUILD_INFO_\d+$/)) {
					if (currentBuild) buildInfos.push(currentBuild);
					const vars = child.variables;
					currentBuild = {
						buildType: vars.length > 0 ? parseIntVar(vars[0]) : 0,
						buildLevel: vars.length > 1 ? parseIntVar(vars[1]) : 0,
					};
				} else if (child.name.startsWith("TEAM_BUILD_INFO_REF_UP_DATA_")) {
					if (currentBuild && child.variables.length >= 2) {
						currentBuild.upDataRef = [
							parseIntVar(child.variables[0]),
							parseIntVar(child.variables[1]),
						];
					}
				} else if (child.name.startsWith("TEAM_BUILD_INFO_REF_DOWN_DATA_")) {
					if (currentBuild && child.variables.length >= 2) {
						currentBuild.downDataRef = [
							parseIntVar(child.variables[0]),
							parseIntVar(child.variables[1]),
						];
					}
				} else if (child.name.startsWith("TEAM_BUILD_INFO_REF_EFFECT_INFO_")) {
					if (currentBuild && child.variables.length >= 2) {
						currentBuild.effectInfoRef = [
							parseIntVar(child.variables[0]),
							parseIntVar(child.variables[1]),
						];
					}
				}
			}
			if (currentBuild) buildInfos.push(currentBuild);
		}
	}

	return { effectData, effectInfos, upData, downData, buildInfos };
}

// ============================================================================
// Loaders
// ============================================================================

function findTeamBuildConfigFile(dir: string): string | null {
	if (!existsSync(dir)) return null;
	const files = readdirSync(dir);
	const configFile = files
		.filter((f) => f.startsWith("team_build_config_") && f.endsWith(".cfg.bin.json"))
		.sort()
		.pop();
	return configFile ? join(dir, configFile) : null;
}

export async function loadTeamBuildConfigAsync(
	dataPath: string
): Promise<TeamBuildDatabase | null> {
	const skillDir = join(dataPath, "common", "gamedata", "skill");
	const configPath = findTeamBuildConfigFile(skillDir);

	if (!configPath) {
		console.warn("[team-build-config] Config not found in", skillDir);
		return null;
	}

	const content = await loadJsonAsync<{ entries: ConfigNode[] }>(configPath);
	if (!content?.entries) return null;

	const db = parseContent(content.entries);
	console.log(
		`[TeamBuildParser] Loaded ${db.buildInfos.length} build infos, ` +
			`${db.effectData.length} effect data, ${db.upData.length} up, ${db.downData.length} down.`
	);
	return db;
}

export async function buildTeamBuildDatabase(dataPath: string) {
	const db = await loadTeamBuildConfigAsync(dataPath);
	return db || { effectData: [], effectInfos: [], upData: [], downData: [], buildInfos: [] };
}
