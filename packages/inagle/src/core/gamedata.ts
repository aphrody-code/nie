/**
 * Gamedata Loader - Uses pre-extracted all-gamedata JSON files
 *
 * This module provides easy access to all 453 game data lists
 * that have been extracted from the cfg.bin files.
 */

import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadJSONAsync } from "./data-loader.js";
import { PATHS } from "./paths.js";

// Default path to all-gamedata (relative to inagle package)
const DEFAULT_GAMEDATA_PATH = PATHS.allGamedata;

/** Metadata for a gamedata file */
export interface GamedataMeta {
	listName: string;
	typeName: string;
	count: number;
	sourceFile: string;
}

/** Generic gamedata file structure */
export interface GamedataFile<T = unknown> {
	_meta: GamedataMeta;
	data: T[];
}

/** Summary of all available gamedata */
export interface LoaderGamedataSummary {
	totalLists: number;
	totalEntries: number;
	lists: Array<{
		name: string;
		fileName: string;
		count: number;
		sourceFile: string;
	}>;
}

/** Gamedata loader options */
export interface GamedataLoaderOptions {
	/** Path to all-gamedata directory */
	gamedataPath?: string;
}

/**
 * GamedataLoader - Access all 453 game data lists (Async)
 */
export class GamedataLoader {
	private readonly basePath: string;
	private summary: LoaderGamedataSummary | null = null;
	private cache = new Map<string, Promise<GamedataFile<any>>>();

	constructor(options?: GamedataLoaderOptions) {
		this.basePath = options?.gamedataPath || DEFAULT_GAMEDATA_PATH;

		if (!existsSync(this.basePath)) {
			// In container/serverless environments, simple existence check on init
			// might be enough.
			// We don't throw here to avoid crashing if path is transiently unavailable?
			// But typically it means config error.
			console.warn(`Gamedata path not found: ${this.basePath}`);
		}
	}

	/** Get summary of all available data */
	async getSummary(): Promise<LoaderGamedataSummary> {
		if (!this.summary) {
			const summaryPath = join(this.basePath, "_summary.json");
			if (existsSync(summaryPath)) {
				const content = await readFile(summaryPath, "utf-8");
				this.summary = JSON.parse(content);
			} else {
				return { totalLists: 0, totalEntries: 0, lists: [] };
			}
		}
		return this.summary as LoaderGamedataSummary;
	}

	/** List all available data files */
	listFiles(): string[] {
		if (!existsSync(this.basePath)) return [];
		return readdirSync(this.basePath).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
	}

	/** Load a specific gamedata file by name (without .json extension) */
	async load<T = unknown>(name: string): Promise<GamedataFile<T>> {
		const fileName = name.endsWith(".json") ? name : `${name}.json`;

		// Check cache first
		if (this.cache.has(fileName)) {
			return this.cache.get(fileName) as Promise<GamedataFile<T>>;
		}

		const filePath = join(this.basePath, fileName);

		// Create promise
		const promise = (async () => {
			// Use the central async loader which handles caching too (though double caching is fine)
			// Actually loadJSONAsync handles raw JSON.
			return loadJSONAsync<GamedataFile<T>>(filePath);
		})();

		this.cache.set(fileName, promise);
		return promise;
	}

	/** Load data only (without metadata) */
	async loadData<T = unknown>(name: string): Promise<T[]> {
		const file = await this.load<T>(name);
		return file.data || [];
	}

	/** Search for files by pattern */
	findFiles(pattern: string | RegExp): string[] {
		const files = this.listFiles();
		if (typeof pattern === "string") {
			const lower = pattern.toLowerCase();
			return files.filter((f) => f.toLowerCase().includes(lower));
		}
		return files.filter((f) => pattern.test(f));
	}

	/** Get top N largest datasets */
	async getTopDatasets(n = 20): Promise<Array<{ name: string; count: number }>> {
		const summary = await this.getSummary();
		return summary.lists
			.slice(0, n)
			.map((l) => ({ name: l.fileName.replace(".json", ""), count: l.count }));
	}

	/** Clear cache */
	clearCache(): void {
		this.cache.clear();
	}
}

// ============= Pre-defined typed loaders =============

/** Skill info structure */
export interface LoaderSkillInfo {
	skillID: string;
	skillIDStr: string;
	eventID: string;
	eventIDName: string;
	skillNameId: string;
	skillDescId: string;
	power_min: number;
	power_max: number;
	element: number;
	category: number;
	consumeTp: number;
	partnerType: number;
	[key: string]: unknown;
}

/** Character star sign info */
export interface StarSignCharaInfo {
	charaId: string;
	starSign: number;
	[key: string]: unknown;
}

/** Formation info */
export interface LoaderFormationInfo {
	formId: string;
	nounId: string;
	descId: string;
	powerOffense: number;
	powerDefense: number;
	[key: string]: unknown;
}

/** Uniform info */
export interface LoaderUniformInfo {
	uniformId: string;
	[key: string]: unknown;
}

/** Quest data */
export interface QuestData {
	questId: string;
	explainTextId: string;
	condCount: number;
	[key: string]: unknown;
}

/** Gallery info */
export interface LoaderGalleryInfo {
	galleryId: string;
	imgPath: string;
	thumbPath: string;
	[key: string]: unknown;
}

/**
 * Create a pre-configured loader with typed accessors
 */
export function createGamedataAPI(options?: GamedataLoaderOptions) {
	const loader = new GamedataLoader(options);

	return {
		loader,

		/** Get summary */
		getSummary: () => loader.getSummary(),

		/** Skills (2458 entries) */
		getSkills: () => loader.loadData<LoaderSkillInfo>("skillInfo"),

		/** Skill events by ID */
		getSkillEvents: () => loader.loadData("skillByEventId"),

		/** Character star signs (4439 entries) */
		getStarSigns: () => loader.loadData<StarSignCharaInfo>("starSignCharaInfo"),

		/** Character placements (1633 entries) */
		getCharaPlacements: () => loader.loadData("charaPlacementData"),

		/** Character scales (2373 entries) */
		getCharaScales: () => loader.loadData("charaScale"),

		/** Formations (111 entries) */
		getFormations: () => loader.loadData<LoaderFormationInfo>("SoccerFormationInfo"),

		/** Formation placements (1045 entries) */
		getFormationPlacements: () => loader.loadData("SoccerFormPlacementInfo"),

		/** Uniforms (727 entries) */
		getUniforms: () => loader.loadData<LoaderUniformInfo>("UniformModelInfo"),

		/** Quests (755 entries) */
		getQuests: () => loader.loadData<QuestData>("questData"),

		/** Gallery (360 entries) */
		getGallery: () => loader.loadData<LoaderGalleryInfo>("GalleryInfo"),

		/** Skill evolution conditions (466 entries) */
		getSkillEvolutions: () => loader.loadData("skillExCondition"),

		/** Passive skill rarity table (388 entries) */
		getPassiveSkillRarity: () => loader.loadData("passiveSkillRarityTable"),

		/** Team passive lottery (653 entries) */
		getTeamPassives: () => loader.loadData("teamPassiveLotData"),

		/** Match difficulties (404 entries) */
		getMatchDifficulties: () => loader.loadData("MatchDifficultyInfo"),

		/** Scenario soccer demos (1170 entries) */
		getScenarios: () => loader.loadData("ScenarioSoccerDemoInfo"),

		/** Character edit presets (2704 entries) */
		getCharaEditPresets: () => loader.loadData("CharaEditPresetData"),

		/** Character edit colors (470 entries) */
		getCharaEditColors: () => loader.loadData("CharaEditColorData"),

		/** Load any data by name */
		load: <T = unknown>(name: string) => loader.loadData<T>(name),

		/** Find files matching pattern */
		find: (pattern: string | RegExp) => loader.findFiles(pattern),
	};
}

// Default export
export default GamedataLoader;
