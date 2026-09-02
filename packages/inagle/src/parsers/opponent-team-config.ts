/**
 * @file opponent-team-config.ts
 * @description Parser for opponent team configuration
 *
 * Data source: team/opponent_team_config_1.03.05.00.cfg.bin.json
 *
 * Structure (lists format):
 * - m_OpponentTeamInfoList: Main opponent team entries
 * - m_MatchDifficultyInfoList: Match difficulty settings
 * - m_PracticeMatchGameInfoList: Practice match game info
 * - m_PracticeMatchInfoList: Practice match info
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import { findConfigFile } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedOpponentTeam extends ExportableEntity {
	opponentId: string;
	type: number;
	teamId: string;
	descTextId: string;
	pointTextId: string;
	meetingEventId: string;
	flagNo: number;
	openCond: string;
	formationCond: string;
	menuBaseColor: number;
	menuTextColor: number;
	menuPlateColor: number;
	bgTextureName: string;
	bgTextureNameCrc: string;
	gameId: string;
	difficultyType: number;
}

export interface MatchDifficultyInfo {
	[key: string]: any;
}

export interface PracticeMatchInfo {
	[key: string]: any;
}

export interface OpponentTeamDatabase {
	opponents: ParsedOpponentTeam[];
	matchDifficulties: MatchDifficultyInfo[];
	practiceMatches: PracticeMatchInfo[];
	practiceMatchGames: any[];
	byId: Map<string, ParsedOpponentTeam>;
	byTeamId: Map<string, ParsedOpponentTeam[]>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Parser
// ============================================================================

function parseContent(content: any) {
	const opponents: ParsedOpponentTeam[] = [];
	const matchDifficulties: MatchDifficultyInfo[] = [];
	const practiceMatches: PracticeMatchInfo[] = [];
	const practiceMatchGames: any[] = [];

	if (!content?.lists) return { opponents, matchDifficulties, practiceMatches, practiceMatchGames };

	for (const list of content.lists) {
		if (list.name === "m_OpponentTeamInfoList") {
			for (const val of list.values) {
				opponents.push({
					id: val.id,
					name: val.bgTextureName,
					opponentId: val.id,
					type: val.type,
					teamId: val.teamId,
					descTextId: val.descTextId,
					pointTextId: val.pointTextId,
					meetingEventId: val.meetingtEventId,
					flagNo: val.flagNo,
					openCond: val.openCond,
					formationCond: val.formationCond,
					menuBaseColor: val.menuBaseColor,
					menuTextColor: val.menuTextColor,
					menuPlateColor: val.menuPlateColor,
					bgTextureName: val.bgTextureName,
					bgTextureNameCrc: val.bgTextureNameCrc,
					gameId: val.gameId,
					difficultyType: val.difficultyType,
					attributes: {
						Equipe: val.teamId,
						Difficulte: val.difficultyType,
						Texture: val.bgTextureName,
					},
				});
			}
		} else if (list.name === "m_MatchDifficultyInfoList") {
			for (const val of list.values) matchDifficulties.push(val);
		} else if (list.name === "m_PracticeMatchInfoList") {
			for (const val of list.values) practiceMatches.push(val);
		} else if (list.name === "m_PracticeMatchGameInfoList") {
			for (const val of list.values) practiceMatchGames.push(val);
		}
	}
	return { opponents, matchDifficulties, practiceMatches, practiceMatchGames };
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadOpponentTeamConfigAsync(dataPath: string = DATA_ROOT) {
	const filename = findConfigFile("team", "opponent_team_config");
	if (!filename) return null;

	const path = join(dataPath, "common/gamedata/team", filename);
	const content = await loadJsonAsync<any>(path);
	return content ? parseContent(content) : null;
}

export async function buildOpponentTeamDatabase(
	dataPath: string = DATA_ROOT
): Promise<OpponentTeamDatabase> {
	const result = await loadOpponentTeamConfigAsync(dataPath);
	const opponents = result?.opponents || [];
	const matchDifficulties = result?.matchDifficulties || [];
	const practiceMatches = result?.practiceMatches || [];
	const practiceMatchGames = result?.practiceMatchGames || [];

	const byId = new Map<string, ParsedOpponentTeam>();
	const byTeamId = new Map<string, ParsedOpponentTeam[]>();
	for (const o of opponents) {
		byId.set(o.opponentId, o);
		const arr = byTeamId.get(o.teamId) || [];
		arr.push(o);
		byTeamId.set(o.teamId, arr);
	}

	return {
		opponents,
		matchDifficulties,
		practiceMatches,
		practiceMatchGames,
		byId,
		byTeamId,
		toMarkdown: (id: string) => {
			const o = byId.get(id);
			return o ? EntityExporters.toMarkdown(o, "Equipe Adverse") : null;
		},
		toReact: (id: string) => {
			const o = byId.get(id);
			return o ? EntityExporters.toReact(o) : null;
		},
	};
}
