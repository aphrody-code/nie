/**
 * @file activity-photo-config.ts
 * @description Parser for activity photo paths from trophy config
 *
 * Data source: trophy/trophy_config_*.cfg.bin.json
 *
 * Structure (entries format):
 * - TEXTURE_BASE_PATH_0: Base path for activity photos
 *   "#/menu/220_img/activity_photo/<LG>/"
 * - TROPHY_REWARD_LIST_BEG_0: 384 trophy reward entries
 *   Each TROPHY_REWARD_N has [trophyId (Int), rewardValue (Int)]
 *
 * This parser extracts the activity photo base path and trophy reward
 * associations. The actual file listing comes from the bucket.
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedTrophyReward extends ExportableEntity {
	trophyIdRaw: number;
	trophyIdHex: string;
	reward: number;
}

export interface ActivityPhotoDatabase {
	basePath: string;
	rewards: ParsedTrophyReward[];
	byId: Map<string, ParsedTrophyReward>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Helpers
// ============================================================================

function toHex(value: number): string {
	return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any): { basePath: string; rewards: ParsedTrophyReward[] } {
	let basePath = "";
	const rewards: ParsedTrophyReward[] = [];

	if (!content?.entries) return { basePath, rewards };

	for (const entry of content.entries) {
		// Extract base path
		if (entry.name === "TEXTURE_BASE_PATH_0") {
			const strVar = entry.variables?.find((v: any) => v.type === "String");
			if (strVar) {
				basePath = strVar.value.replace("#/menu/", "").replace("<LG>", "fr");
			}
		}

		// Extract trophy rewards
		if (entry.name === "TROPHY_REWARD_LIST_BEG_0") {
			const rewardMap = new Map<string, ParsedTrophyReward>();
			for (const child of entry.children || []) {
				if (!child.name?.startsWith("TROPHY_REWARD_")) continue;
				const vars = child.variables || [];
				if (vars.length < 2) continue;

				const trophyIdRaw = parseInt(vars[0].value, 10);
				const reward = parseInt(vars[1].value, 10);
				const hex = toHex(trophyIdRaw);

				const existing = rewardMap.get(hex);
				if (!existing || reward > existing.reward) {
					rewardMap.set(hex, {
						id: hex,
						name: hex,
						trophyIdRaw,
						trophyIdHex: hex,
						reward,
						attributes: {
							Reward: reward,
						},
					});
				}
			}
			rewards.push(...rewardMap.values());
		}
	}

	return { basePath, rewards };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadActivityPhotoConfigAsync(
	dataPath: string = DATA_ROOT
): Promise<{ basePath: string; rewards: ParsedTrophyReward[] } | null> {
	const filename = findConfigFile("trophy", "trophy_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/trophy", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildActivityPhotoDatabase(
	dataPath: string = DATA_ROOT
): Promise<ActivityPhotoDatabase> {
	const result = await loadActivityPhotoConfigAsync(dataPath);
	const basePath = result?.basePath || "220_img/activity_photo/fr/";
	const rewards = result?.rewards || [];

	const byId = new Map<string, ParsedTrophyReward>();
	for (const r of rewards) byId.set(r.trophyIdHex, r);

	return {
		basePath,
		rewards,
		byId,
		toMarkdown: (id: string) => {
			const r = byId.get(id);
			return r ? EntityExporters.toMarkdown(r, "Trophee") : null;
		},
		toReact: (id: string) => {
			const r = byId.get(id);
			return r ? EntityExporters.toReact(r) : null;
		},
	};
}
