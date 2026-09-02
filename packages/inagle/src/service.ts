import { createBasaraAPI } from "./basara/index.js";
import { createCharactersAPI } from "./characters/api.js";
import { compareEvolutions, getCharacterEvolution } from "./characters/evolution.js";

import { createImageAPI } from "./core/index.js";
import { DATA_ROOT } from "./core/paths.js";
import type { BaseCharacter, CharacterVariant } from "./core/types.js";
import { createDropsAPI } from "./drops/index.js";
import { preloadCharacterEnrichment } from "./entities/character.js";
import { createItemsAPIAsync } from "./items/api.js";
import { createMenuExplorer } from "./menu/index.js";
import {
	buildCapsuleDatabase,
	buildCharaCostumeDatabase,
	buildCharaExpTableDatabase,
	buildCtrlCharaDatabase,
	buildGalleryDatabase,
	buildGrowthTableDatabase,
	buildOpponentTeamDatabase,
	buildTrickDatabase,
} from "./parsers/index.js";
import { createQuestsAPI } from "./quests/index.js";
import { createGlobalSearch } from "./search/index.js";
import { createSkillsAPI } from "./skills/index.js";
import { createTeamsAPI } from "./teams/index.js";

// Re-export types for use in components
export type { BaseCharacter, CharacterVariant };

export interface InagleServiceConfig {
	baseUrl?: string;
	useRawPaths?: boolean;
}

export async function createInagleService(config?: InagleServiceConfig) {
	// Pre-load async enrichment data (ctrl-chara, growth lv1) before building character DB
	await preloadCharacterEnrichment();

	const basara = createBasaraAPI();
	const characters = createCharactersAPI();
	const items = await createItemsAPIAsync();
	const skills = createSkillsAPI();
	const teams = createTeamsAPI();
	const menu = createMenuExplorer();

	const drops = createDropsAPI();
	const quests = createQuestsAPI();

	const images = createImageAPI({
		baseUrl: config?.baseUrl || process.env.NEXT_PUBLIC_ASSET_URL,
		useRawPaths: config?.useRawPaths ?? process.env.NEXT_PUBLIC_USE_RAW_IMAGE_PATHS === "true",
	});

	const search = createGlobalSearch({
		basara: basara.all(),
		skills: skills.all(),
		auras: skills.auraAll(),
		passives: skills.passiveAll(),
		characters: characters.all(),
		items: items.allItems(),
	});

	// Lazy-loaded new parser databases (initialized on first access)
	const lazyParsers = {
		_gallery: null as Awaited<ReturnType<typeof buildGalleryDatabase>> | null,
		_capsules: null as Awaited<ReturnType<typeof buildCapsuleDatabase>> | null,
		_costumes: null as Awaited<ReturnType<typeof buildCharaCostumeDatabase>> | null,
		_expTable: null as Awaited<ReturnType<typeof buildCharaExpTableDatabase>> | null,
		_growthTable: null as Awaited<ReturnType<typeof buildGrowthTableDatabase>> | null,
		_tricks: null as Awaited<ReturnType<typeof buildTrickDatabase>> | null,
		_opponents: null as Awaited<ReturnType<typeof buildOpponentTeamDatabase>> | null,
		_ctrlChara: null as Awaited<ReturnType<typeof buildCtrlCharaDatabase>> | null,

		async gallery() {
			if (!this._gallery) this._gallery = await buildGalleryDatabase(DATA_ROOT);
			return this._gallery;
		},
		async capsules() {
			if (!this._capsules) this._capsules = await buildCapsuleDatabase(DATA_ROOT);
			return this._capsules;
		},
		async costumes() {
			if (!this._costumes) this._costumes = await buildCharaCostumeDatabase(DATA_ROOT);
			return this._costumes;
		},
		async expTable() {
			if (!this._expTable) this._expTable = await buildCharaExpTableDatabase(DATA_ROOT);
			return this._expTable;
		},
		async growthTable() {
			if (!this._growthTable) this._growthTable = await buildGrowthTableDatabase(DATA_ROOT);
			return this._growthTable;
		},
		async tricks() {
			if (!this._tricks) this._tricks = await buildTrickDatabase(DATA_ROOT);
			return this._tricks;
		},
		async opponents() {
			if (!this._opponents) this._opponents = await buildOpponentTeamDatabase(DATA_ROOT);
			return this._opponents;
		},
		async ctrlChara() {
			if (!this._ctrlChara) this._ctrlChara = await buildCtrlCharaDatabase(DATA_ROOT);
			return this._ctrlChara;
		},
	};

	return {
		basara,
		characters,
		drops,
		images,
		items,
		menu,
		quests,
		search,
		skills,
		teams,
		parsers: lazyParsers,
		evolution: {
			forCharacter: getCharacterEvolution,
			compare: compareEvolutions,
		},
	};
}

export type InagleService = Awaited<ReturnType<typeof createInagleService>>;
