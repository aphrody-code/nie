/**
 * @file enjoy-mode-team-config.ts
 * @description Parser for enjoy mode team configuration
 *
 * Data source: team/enjoy_mode_team_config_1.04.02.00.cfg.bin.json
 *
 * Structure (entries format):
 * - ENJOY_MODE_TEAM_INFO_LIST_BEG_0: 28 team entries
 *   Each child: 12 variables (mix of Int and String)
 *   vars[0]=teamId(CRC), vars[1]=subId(CRC), vars[2]=colorCrc(CRC),
 *   vars[3]=type(Int), vars[4]=formationCrc(CRC),
 *   vars[5]=texturePath(String), vars[6]=textureName(String),
 *   vars[7..11]=Int flags/colors
 */

import { join } from "node:path";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { DATA_ROOT, resolveGameDataFile } from "../core/paths.js";

// ============================================================================
// Types
// ============================================================================

export interface ParsedEnjoyModeTeam extends ExportableEntity {
	teamId: string;
	subId: string;
	colorCrc: string;
	type: number;
	formationCrc: string;
	texturePath: string;
	textureName: string;
}

export interface EnjoyModeTeamDatabase {
	teams: ParsedEnjoyModeTeam[];
	byTeamId: Map<string, ParsedEnjoyModeTeam>;
	toMarkdown: (id: string) => string | null;
	toReact: (id: string) => any | null;
}

// ============================================================================
// Parser
// ============================================================================

function parseIntVar(v: { type: string; value: string }): number {
	return Number.parseInt(v.value, 10);
}

function parseEntries(entries: ConfigNode[]): ParsedEnjoyModeTeam[] {
	const teams: ParsedEnjoyModeTeam[] = [];

	for (const entry of entries) {
		if (!entry.name.startsWith("ENJOY_MODE_TEAM_INFO_LIST_BEG")) continue;
		const children = entry.children || [];

		for (const child of children) {
			if (!child.name.startsWith("ENJOY_MODE_TEAM_INFO_")) continue;
			const vars = child.variables;
			if (vars.length < 7) continue;

			const teamId = toHex(parseIntVar(vars[0]));
			const subId = toHex(parseIntVar(vars[1]));
			const colorCrc = toHex(parseIntVar(vars[2]));
			const type = parseIntVar(vars[3]);
			const formationCrc = toHex(parseIntVar(vars[4]));
			const texturePath = vars[5].value;
			const textureName = vars[6].value;

			teams.push({
				id: teamId,
				name: textureName,
				teamId,
				subId,
				colorCrc,
				type,
				formationCrc,
				texturePath,
				textureName,
				attributes: {
					Type: type,
					Texture: textureName,
				},
			});
		}
	}
	return teams;
}

// ============================================================================
// Loaders
// ============================================================================

export async function loadEnjoyModeTeamConfigAsync(dataPath: string = DATA_ROOT) {
	// Résolution version-agnostique (repli sur le chemin versionné historique si introuvable)
	const path =
		resolveGameDataFile("team", "enjoy_mode_team_config") ??
		join(dataPath, "common/gamedata/team", "enjoy_mode_team_config_1.04.02.00.cfg.bin.json");
	const content = await loadJsonAsync<{ entries: ConfigNode[] }>(path);
	if (!content?.entries) return null;
	return parseEntries(content.entries);
}

export async function buildEnjoyModeTeamDatabase(
	dataPath: string = DATA_ROOT
): Promise<EnjoyModeTeamDatabase> {
	const teams = (await loadEnjoyModeTeamConfigAsync(dataPath)) || [];
	const byTeamId = new Map<string, ParsedEnjoyModeTeam>();
	for (const t of teams) byTeamId.set(t.teamId, t);

	return {
		teams,
		byTeamId,
		toMarkdown: (id: string) => {
			const t = byTeamId.get(id);
			return t ? EntityExporters.toMarkdown(t, "Equipe Mode Plaisir") : null;
		},
		toReact: (id: string) => {
			const t = byTeamId.get(id);
			return t ? EntityExporters.toReact(t) : null;
		},
	};
}
