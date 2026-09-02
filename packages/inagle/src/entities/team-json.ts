import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_ROOT } from "../core/paths.js";
import type { ZukanTeam } from "../zukan/types.js";

let zukanTeamCache: Map<string, ZukanTeam> | null = null;

export function loadZukanTeams(): Map<string, ZukanTeam> {
	if (zukanTeamCache) return zukanTeamCache;

	zukanTeamCache = new Map();
	const path = join(DATA_ROOT, "zukan/db_teams.json");

	if (!existsSync(path)) {
		return zukanTeamCache;
	}

	try {
		const content = readFileSync(path, "utf-8");
		const data = JSON.parse(content) as ZukanTeam[];

		for (const team of data) {
			zukanTeamCache.set(team.id, team);
		}
	} catch (e) {
		console.error("[ZukanLoader] Failed to parse db_teams.json", e);
	}

	return zukanTeamCache;
}
