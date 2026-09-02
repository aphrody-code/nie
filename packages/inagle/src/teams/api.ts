/**
 * Teams & Formations API - Complete team and formation data
 *
 * Uses pre-extracted data from:
 * - all-gamedata/belongTeamInfo.json (205 entries)
 * - all-gamedata/SoccerFormationInfo.json (111 entries)
 * - all-gamedata/SoccerFormPlacementInfo.json (1,045 entries)
 * - all-gamedata/UniformModelInfo.json (727 entries)
 * - entities/teams.json, formations.json, uniforms.json
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createImageAPI } from "../core/images.js";
import { PATHS } from "../core/paths.js";
import { buildSeriesMapping, getAllTeams, type Series } from "../parsers/belong-team.js";
import { loadTextFile } from "../parsers/text-parser.js";
import type {
	FormationInfo,
	FormationPlacement,
	TeamInfo,
	UniformInfo,
} from "../types/gamedata.js";

// Data paths
const ENTITIES_PATH = PATHS.entities;

export interface EnrichedTeam extends TeamInfo {
	name: string;
	displayName: string;
	desc?: string;
	series?: Series;
	uniforms?: UniformInfo[];
	emblemImage?: string;
}

export interface EnrichedFormation extends FormationInfo {
	displayName: string;
	desc?: string;
	balance: "offensive" | "defensive" | "balanced";
	placements: FormationPlacement[];
}

/** Teams database */
export interface TeamsDatabase {
	generatedAt: string;
	teams: EnrichedTeam[];
	formations: EnrichedFormation[];
	uniforms: UniformInfo[];
	series: Series[];
	byTeamId: Map<string, EnrichedTeam>;
	byFormationId: Map<string, EnrichedFormation>;
	byUniformId: Map<string, UniformInfo>;
	bySeriesId: Map<string, Series>;
	stats: {
		totalTeams: number;
		totalFormations: number;
		totalUniforms: number;
		totalSeries: number;
		formationsByBalance: Record<string, number>;
	};
}

function loadJsonIfExists<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	try {
		const content = readFileSync(path, "utf-8");
		return JSON.parse(content);
	} catch (e) {
		console.error(`Failed to load ${path}`, e);
		return null;
	}
}

interface Wrapper<T> {
	teams?: T[];
	formations?: T[];
	uniforms?: T[];
	data?: T[];
}

/**
 * Build teams and formations database
 */
export function buildTeamsDatabase(options?: {
	gamedataPath?: string;
	entitiesPath?: string;
}): TeamsDatabase {
	const entitiesPath = options?.entitiesPath || ENTITIES_PATH;

	// Initialize Image API
	const images = createImageAPI();

	// Load Series
	const seriesMap = buildSeriesMapping();
	const series = Array.from(seriesMap.values()).sort((a, b) => a.type - b.type);

	// Load basic entities
	const teamsRawResult = loadJsonIfExists<TeamInfo[] | Wrapper<TeamInfo>>(
		join(entitiesPath, "teams.json")
	);
	let teamsRaw: TeamInfo[] = [];
	if (Array.isArray(teamsRawResult)) {
		teamsRaw = teamsRawResult;
	} else if (teamsRawResult) {
		if ("teams" in teamsRawResult && Array.isArray(teamsRawResult.teams)) {
			teamsRaw = teamsRawResult.teams;
		} else if ("data" in teamsRawResult && Array.isArray(teamsRawResult.data)) {
			teamsRaw = teamsRawResult.data;
		}
	}

	const formationsRawResult = loadJsonIfExists<FormationInfo[] | Wrapper<FormationInfo>>(
		join(entitiesPath, "formations.json")
	);
	let formationsRaw: FormationInfo[] = [];
	if (Array.isArray(formationsRawResult)) {
		formationsRaw = formationsRawResult;
	} else if (formationsRawResult) {
		if ("formations" in formationsRawResult && Array.isArray(formationsRawResult.formations)) {
			formationsRaw = formationsRawResult.formations;
		} else if ("data" in formationsRawResult && Array.isArray(formationsRawResult.data)) {
			formationsRaw = formationsRawResult.data;
		}
	}

	const uniformsRawResult = loadJsonIfExists<UniformInfo[] | Wrapper<UniformInfo>>(
		join(entitiesPath, "uniforms.json")
	);
	let uniformsRaw: UniformInfo[] = [];
	if (Array.isArray(uniformsRawResult)) {
		uniformsRaw = uniformsRawResult;
	} else if (uniformsRawResult) {
		if ("uniforms" in uniformsRawResult && Array.isArray(uniformsRawResult.uniforms)) {
			uniformsRaw = uniformsRawResult.uniforms;
		} else if ("data" in uniformsRawResult && Array.isArray(uniformsRawResult.data)) {
			uniformsRaw = uniformsRawResult.data;
		}
	}

	const placementsRaw =
		loadJsonIfExists<FormationPlacement[]>(join(entitiesPath, "formationPlacements.json")) || [];

	// Create Maps
	const byTeamId = new Map<string, EnrichedTeam>();
	const byFormationId = new Map<string, EnrichedFormation>();
	const byUniformId = new Map<string, UniformInfo>();
	const uniformsByTeamId = new Map<string, UniformInfo[]>();

	for (const u of uniformsRaw) {
		byUniformId.set(u.uniformId, u);
		if (!uniformsByTeamId.has(u.teamId)) {
			uniformsByTeamId.set(u.teamId, []);
		}
		uniformsByTeamId.get(u.teamId)?.push(u);
	}

	// Enrich Teams
	const teamText = loadTextFile("team", "fr");
	let teams: EnrichedTeam[] = [];

	if (teamsRaw.length > 0) {
		teams = teamsRaw.map((t) => {
			const name = t.name_FR || teamText.get(t.teamId) || t.teamIdStr || "Unknown Team";

			// Resolve emblem image
			// emblemId might be 0 or defined
			let emblemImage: string | undefined;
			if (t.emblemId) {
				// emblemId is usually hex (0x...), convert to int for lookup if needed
				// or just pass as string if images.emblem handles it.
				// Images usually mapped by simple number string e.g. "1", "2" if scanned.
				// Or if we have hex in raw data, we might need conversion.
				// But buildImageIndex scans "emXXXX.webp".
				// Let's assume t.emblemId is accessible.
				// Note: t.emblemId is HashId (string), usually hex.
				// We might not have easy mapping from hex HashId to index (em001) without extra data.
				// BUT `emblemId` in some contexts is the index.
				// In TeamInfo it says HashId.
				// However, let's try resolving by string.
				emblemImage = images.emblem(t.emblemId.toString());
			}

			return {
				...t,
				name,
				displayName: name,
				uniforms: uniformsByTeamId.get(t.teamId) || [],
				emblemImage,
			};
		});
	} else {
		// Fallback: build teams from mapping (raw files)
		const mappedTeams = getAllTeams();
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		teams = mappedTeams.map((t: any) => {
			// Resolve emblem from mapped data which often has direct ID
			const emblemId = t.emblemId || t.emblems?.[0];
			let emblemImage: string | undefined;
			if (emblemId) {
				emblemImage = images.emblem(emblemId.toString());
			}

			return {
				teamId: t.teamId,
				teamIdStr: t.teamId,
				name: t.names.fr || t.names.en || t.names.ja || t.teamId,
				displayName: t.names.fr || t.names.en || t.names.ja || t.teamId,
				name_FR: t.names.fr,
				name_EN: t.names.en,
				name_JA: t.names.ja,
				binderTeamOrderType: t.orderType,
				emblems: t.emblems,
				kits: t.kits,
				seasons: t.seasons,
				uniforms: uniformsByTeamId.get(t.teamId) || [],
				emblemImage,
			};
		}) as unknown as EnrichedTeam[];
	}

	for (const t of teams) {
		byTeamId.set(t.teamId, t);
	}

	// Enrich Formations
	// Load placements map
	const placementsByFormId = new Map<string, FormationPlacement[]>();
	for (const p of placementsRaw) {
		if (!placementsByFormId.has(p.formId)) {
			placementsByFormId.set(p.formId, []);
		}
		placementsByFormId.get(p.formId)?.push(p);
	}

	const formations: EnrichedFormation[] = formationsRaw.map((f) => {
		const name = f.name_FR || f.formIdStr || "Unknown Formation";
		const placements = placementsByFormId.get(f.formId) || [];

		let balance: "offensive" | "defensive" | "balanced" = "balanced";
		if (f.powerOffense > f.powerDefense) balance = "offensive";
		if (f.powerDefense > f.powerOffense) balance = "defensive";

		return {
			...f,
			displayName: name,
			balance,
			placements,
		};
	});

	for (const f of formations) {
		byFormationId.set(f.formId, f);
	}

	// Stats
	const stats = {
		totalTeams: teams.length,
		totalFormations: formations.length,
		totalUniforms: uniformsRaw.length,
		totalSeries: series.length,
		formationsByBalance: {} as Record<string, number>,
	};

	for (const f of formations) {
		stats.formationsByBalance[f.balance] = (stats.formationsByBalance[f.balance] || 0) + 1;
	}

	return {
		generatedAt: new Date().toISOString(),
		teams,
		formations,
		uniforms: uniformsRaw,
		series,
		byTeamId,
		byFormationId,
		byUniformId,
		bySeriesId: seriesMap,
		stats,
	};
}

/**
 * Create Empty Teams API (Fallback)
 */
function createEmptyTeamsAPI() {
	return {
		stats: () => ({
			totalTeams: 0,
			totalFormations: 0,
			totalUniforms: 0,
			totalSeries: 0,
			formationsByBalance: {},
		}),
		allTeams: () => [],
		getTeam: (_id: string) => undefined,
		searchTeams: (_query: string) => [],
		allSeries: () => [],
		getSeries: (_id: string) => undefined,
		allFormations: () => [],
		getFormation: (_id: string) => undefined,
		allUniforms: () => [],
		getUniform: (_id: string) => undefined,
	};
}

/**
 * Create Teams API
 */
export function createTeamsAPI(options?: { gamedataPath?: string; entitiesPath?: string }) {
	let db: TeamsDatabase;

	try {
		db = buildTeamsDatabase(options);
	} catch (error) {
		console.warn(
			"[Inagle] Failed to build teams database (missing files?). Running in fallback mode.",
			error instanceof Error ? error.message : String(error)
		);
		return createEmptyTeamsAPI();
	}

	return {
		// === META ===
		stats: () => db.stats,

		// === TEAMS ===

		/** Get all teams */
		allTeams: () => db.teams,

		/** Get team by ID */
		getTeam: (id: string) => db.byTeamId.get(id),

		/** Search teams by name */
		searchTeams: (query: string) => {
			const q = query.toLowerCase();
			return db.teams.filter(
				(t) =>
					t.name.toLowerCase().includes(q) ||
					t.displayName.toLowerCase().includes(q) ||
					t.name_EN?.toLowerCase().includes(q) ||
					t.name_JA?.includes(query)
			);
		},

		// === SERIES ===

		/** Get all series */
		allSeries: () => db.series,

		/** Get series by ID */
		getSeries: (id: string) => db.bySeriesId.get(id),

		// === FORMATIONS ===

		/** Get all formations */
		allFormations: () => db.formations,

		/** Get formation by ID */
		getFormation: (id: string) => db.byFormationId.get(id),

		/** Get offensive formations */
		offensiveFormations: () => db.formations.filter((f) => f.balance === "offensive"),

		/** Get defensive formations */
		defensiveFormations: () => db.formations.filter((f) => f.balance === "defensive"),

		/** Get balanced formations */
		balancedFormations: () => db.formations.filter((f) => f.balance === "balanced"),

		// === UNIFORMS ===

		/** Get all uniforms */
		allUniforms: () => db.uniforms,

		/** Get uniform by ID */
		getUniform: (id: string) => db.byUniformId.get(id),
	};
}

export type TeamsAPI = ReturnType<typeof createTeamsAPI>;
