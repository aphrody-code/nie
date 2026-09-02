/**
 * @file extend-story-config.ts
 * @description Parser for extended story/DLC configuration
 *
 * Data source: extend_story/extend_story_data_config_0.00.02.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_exStoryDataConfigList: Story metadata (1 entry)
 * - m_exStoryGameEnterEvConfigList: Entry events (2 entries)
 * - m_exStoryGameWinEvConfigList: Win events (1 entry)
 * - m_exStoryGameLoseEvConfigList: Lose events (1 entry)
 * - m_exStoryGameDataConfigList: Game data with array refs (1 entry)
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ExtendStoryData {
	extendStoryId: string;
	titleTextId: string;
	explanationTextId: string;
	validCond: string;
	extendStoryType: number;
	extendStoryDataId: string;
	extendStoryClearFlgId: string;
}

export interface ExtendStoryGameData {
	extendStoryGameId: string;
	gameId: string;
	enterEvConfig: [number, number];
	winEvConfig: [number, number];
	loseEvConfig: [number, number];
}

export interface ExtendStoryDatabase {
	stories: ExtendStoryData[];
	enterEvents: Array<{ enterEventId: string }>;
	winEvents: Array<{ winEventId: string }>;
	loseEvents: Array<{ loseEventId: string }>;
	gameData: ExtendStoryGameData[];
	byStoryId: Map<string, ExtendStoryData>;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any) {
	const stories: ExtendStoryData[] = [];
	const enterEvents: Array<{ enterEventId: string }> = [];
	const winEvents: Array<{ winEventId: string }> = [];
	const loseEvents: Array<{ loseEventId: string }> = [];
	const gameData: ExtendStoryGameData[] = [];

	if (!content?.lists) return { stories, enterEvents, winEvents, loseEvents, gameData };

	for (const list of content.lists) {
		if (list.name === "m_exStoryDataConfigList") {
			for (const val of list.values) {
				stories.push({
					extendStoryId: val.extendStoryId,
					titleTextId: val.titleTextId,
					explanationTextId: val.explanationTextId,
					validCond: val.validCond,
					extendStoryType: val.extendStoryType,
					extendStoryDataId: val.extendStoryDataId,
					extendStoryClearFlgId: val.extendStoryClearFlgId,
				});
			}
		} else if (list.name === "m_exStoryGameEnterEvConfigList") {
			for (const val of list.values) enterEvents.push({ enterEventId: val.enterEventId });
		} else if (list.name === "m_exStoryGameWinEvConfigList") {
			for (const val of list.values) winEvents.push({ winEventId: val.winEventId });
		} else if (list.name === "m_exStoryGameLoseEvConfigList") {
			for (const val of list.values) loseEvents.push({ loseEventId: val.loseEventId });
		} else if (list.name === "m_exStoryGameDataConfigList") {
			for (const val of list.values) {
				gameData.push({
					extendStoryGameId: val.extendStoryGameId,
					gameId: val.gameId,
					enterEvConfig: val.enterEvConfig,
					winEvConfig: val.winEvConfig,
					loseEvConfig: val.loseEvConfig,
				});
			}
		}
	}
	return { stories, enterEvents, winEvents, loseEvents, gameData };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadExtendStoryConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("extend_story", "extend_story_data_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/extend_story", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildExtendStoryDatabase(
	dataPath: string = DATA_ROOT
): Promise<ExtendStoryDatabase> {
	const result = await loadExtendStoryConfigAsync(dataPath);
	const stories = result?.stories || [];
	const enterEvents = result?.enterEvents || [];
	const winEvents = result?.winEvents || [];
	const loseEvents = result?.loseEvents || [];
	const gameData = result?.gameData || [];

	const byStoryId = new Map<string, ExtendStoryData>();
	for (const s of stories) byStoryId.set(s.extendStoryId, s);

	return { stories, enterEvents, winEvents, loseEvents, gameData, byStoryId };
}
