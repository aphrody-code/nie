/**
 * @file super-tactics-base-config.ts
 * @description Parser for base super tactics configuration (pre-DLC)
 *
 * Data source: skill/super_tactics_config_0.08.86.cfg.bin.json
 *
 * Structure (entries format):
 * - SUPER_TACTICS_EFFECT_LIST_BEG_0: Effects (11 children, 9 Int vars each)
 *   vars[0] = effectId (CRC), vars[1..8] = condition CRCs (-992181094 = null sentinel)
 * - SUPER_TACTICS_INFO_LIST_BEG_0: Tactic info entries (12 children)
 *
 * This is the base version; special-tactics-config.ts handles the DLC Orion version.
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

const NULL_SENTINEL = -992181094;

export interface SuperTacticsBaseEffect {
	effectId: string;
	conditions: string[];
}

export interface SuperTacticsBaseInfo {
	[key: string]: any;
}

export interface SuperTacticsBaseDatabase {
	effects: SuperTacticsBaseEffect[];
	tactics: SuperTacticsBaseInfo[];
}

// ============================================================================
// Parser
// ============================================================================

function parseIntVar(v: { type: string; value: string }): number {
	return Number.parseInt(v.value, 10);
}

function parseEntries(entries: ConfigNode[]) {
	const effects: SuperTacticsBaseEffect[] = [];
	const tactics: SuperTacticsBaseInfo[] = [];

	for (const entry of entries) {
		const children = entry.children || [];

		if (entry.name.startsWith("SUPER_TACTICS_EFFECT_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("SUPER_TACTICS_EFFECT_")) continue;
				const vars = child.variables;
				if (vars.length < 1) continue;

				const effectId = toHex(parseIntVar(vars[0]));
				const conditions: string[] = [];
				for (let i = 1; i < vars.length; i++) {
					const val = parseIntVar(vars[i]);
					if (val !== NULL_SENTINEL) {
						conditions.push(toHex(val));
					}
				}
				effects.push({ effectId, conditions });
			}
		} else if (entry.name.startsWith("SUPER_TACTICS_INFO_LIST_BEG")) {
			for (const child of children) {
				if (!child.name.startsWith("SUPER_TACTICS_INFO_")) continue;
				const vars = child.variables;
				const info: Record<string, any> = {};
				for (let i = 0; i < vars.length; i++) {
					info[`var${i}`] = vars[i].type === "Int" ? parseIntVar(vars[i]) : vars[i].value;
				}
				if (vars.length > 0) info.id = toHex(parseIntVar(vars[0]));
				tactics.push(info);
			}
		}
	}
	return { effects, tactics };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadSuperTacticsBaseConfigAsync(dataPath: string = DATA_ROOT) {
	const path = join(dataPath, "common/gamedata/skill", "super_tactics_config_0.08.86.cfg.bin.json");
	const content = await loadJsonAsync<{ entries: ConfigNode[] }>(path);
	if (!content?.entries) return null;
	return parseEntries(content.entries);
}

export async function buildSuperTacticsBaseDatabase(
	dataPath: string = DATA_ROOT
): Promise<SuperTacticsBaseDatabase> {
	const result = await loadSuperTacticsBaseConfigAsync(dataPath);
	return {
		effects: result?.effects || [],
		tactics: result?.tactics || [],
	};
}
