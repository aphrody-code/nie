/**
 * Multilingual Entities Loader
 *
 * Loads pre-processed entities with EN/JA/FR localization
 * from the entities directory.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default path to entities data
const DEFAULT_ENTITIES_PATH = join(__dirname, "../../../../../data/entities");

/** Multilingual name structure */
export interface MultilingualName {
	en?: string;
	ja?: string;
	fr?: string;
}

/** Base entity with multilingual support */
export interface BaseEntity {
	id: string;
	nameHash?: string;
	names?: MultilingualName;
	[key: string]: unknown;
}

/** Skill entity */
export interface SkillEntity extends BaseEntity {
	eventId: string;
	element: number;
	category: number;
	power_min: number;
	power_max: number;
	consumeTp: number;
	partnerType: number;
}

/** Character entity */
export interface CharacterEntity extends BaseEntity {
	charaId: string;
	nameHash: string;
	starSign?: number;
}

/** Team entity */
export interface TeamEntity extends BaseEntity {
	teamId: string;
	uniformId: string;
}

/** Formation entity */
export interface FormationEntity extends BaseEntity {
	formId: string;
	descHash?: string;
	powerOffense: number;
	powerDefense: number;
}

/** Quest entity */
export interface QuestEntity extends BaseEntity {
	questId: string;
	explainTextId: string;
	condCount: number;
}

/** Item entity */
export interface ItemEntity extends BaseEntity {
	itemId: string;
	itemType: number;
	maxCount: number;
}

/** Entities collection */
export interface EntitiesCollection {
	skills?: SkillEntity[];
	characters?: CharacterEntity[];
	teams?: TeamEntity[];
	formations?: FormationEntity[];
	quests?: QuestEntity[];
	items?: ItemEntity[];
	[key: string]: unknown;
}

/** Entity loader options */
export interface EntitiesLoaderOptions {
	/** Path to entities directory */
	entitiesPath?: string;
}

/**
 * EntitiesLoader - Access multilingual game entities
 */
export class EntitiesLoader {
	private readonly basePath: string;
	private cache = new Map<string, unknown>();

	constructor(options?: EntitiesLoaderOptions) {
		this.basePath = options?.entitiesPath || DEFAULT_ENTITIES_PATH;
	}

	/** Check if entities directory exists */
	exists(): boolean {
		return existsSync(this.basePath);
	}

	/** Load skills with multilingual names */
	getSkills(): SkillEntity[] {
		// Try multilingual first, fallback to raw
		return (
			this.loadFile<SkillEntity[]>("skills-multilingual.json") ||
			this.loadFile<SkillEntity[]>("skills.json") ||
			[]
		);
	}

	/** Load characters with multilingual names */
	getCharacters(): CharacterEntity[] {
		return (
			this.loadFile<CharacterEntity[]>("characters-multilingual.json") ||
			this.loadFile<CharacterEntity[]>("character-id-mapping.json") ||
			this.loadFile<CharacterEntity[]>("characters-details.json") ||
			[]
		);
	}

	/** Load teams with multilingual names */
	getTeams(): TeamEntity[] {
		return (
			this.loadFile<TeamEntity[]>("teams-multilingual.json") ||
			this.loadFile<TeamEntity[]>("teams.json") ||
			[]
		);
	}

	/** Load formations with multilingual names */
	getFormations(): FormationEntity[] {
		return (
			this.loadFile<FormationEntity[]>("formations-multilingual.json") ||
			this.loadFile<FormationEntity[]>("formations.json") ||
			[]
		);
	}

	/** Load quests with multilingual names */
	getQuests(): QuestEntity[] {
		return (
			this.loadFile<QuestEntity[]>("quests-multilingual.json") ||
			this.loadFile<QuestEntity[]>("quests.json") ||
			[]
		);
	}

	/** Load items with multilingual names */
	getItems(): ItemEntity[] {
		return (
			this.loadFile<ItemEntity[]>("items-multilingual.json") ||
			this.loadFile<ItemEntity[]>("items.json") ||
			[]
		);
	}

	/** Load character ID mapping (charaId -> nameHash) */
	getCharacterIdMapping(): unknown[] {
		return this.loadFile<unknown[]>("character-id-mapping.json") || [];
	}

	/** Load character nametags */
	getCharacterNametags(): unknown[] {
		return this.loadFile<unknown[]>("characters-nametags.json") || [];
	}

	/** Load character star signs */
	getCharacterStarSigns(): unknown[] {
		return this.loadFile<unknown[]>("characters-starsign.json") || [];
	}

	/** Load uniforms */
	getUniforms(): unknown[] {
		return this.loadFile<unknown[]>("uniforms.json") || [];
	}

	/** Load gallery */
	getGallery(): unknown[] {
		return this.loadFile<unknown[]>("gallery.json") || [];
	}

	/** Load series info */
	getSeries(): unknown[] {
		return this.loadFile<unknown[]>("series.json") || [];
	}

	/** Load enemies */
	getEnemies(): unknown[] {
		return this.loadFile<unknown[]>("enemies.json") || [];
	}

	/** Get all available entity files */
	getAvailableFiles(): string[] {
		const files = [
			// Multilingual files (from build-multilingual-dataset.mjs)
			"skills-multilingual.json",
			"characters-multilingual.json",
			"teams-multilingual.json",
			"formations-multilingual.json",
			"quests-multilingual.json",
			"items-multilingual.json",
			// Standard entity files
			"skills.json",
			"characters-details.json",
			"characters-nametags.json",
			"characters-starsign.json",
			"character-id-mapping.json",
			"teams.json",
			"formations.json",
			"quests.json",
			"items.json",
			"items-all.json",
			"uniforms.json",
			"gallery.json",
			"series.json",
			"enemies.json",
		];
		return files.filter((f) => existsSync(join(this.basePath, f)));
	}

	/** Load a custom file */
	loadFile<T>(fileName: string): T | null {
		if (this.cache.has(fileName)) {
			return this.cache.get(fileName) as T;
		}

		const filePath = join(this.basePath, fileName);
		if (!existsSync(filePath)) {
			return null;
		}

		try {
			const data = JSON.parse(readFileSync(filePath, "utf-8")) as T;
			this.cache.set(fileName, data);
			return data;
		} catch (error) {
			console.error(`Failed to load ${fileName}:`, error);
			return null;
		}
	}

	/** Clear cache */
	clearCache(): void {
		this.cache.clear();
	}
}

/**
 * Create multilingual entities API
 */
export function createEntitiesAPI(options?: EntitiesLoaderOptions) {
	const loader = new EntitiesLoader(options);

	return {
		loader,

		/** Check if data exists */
		exists: () => loader.exists(),

		/** Get available entity files */
		getAvailable: () => loader.getAvailableFiles(),

		/** Skills with EN/JA/FR names */
		skills: () => loader.getSkills(),

		/** Characters with EN/JA/FR names */
		characters: () => loader.getCharacters(),

		/** Teams with EN/JA/FR names */
		teams: () => loader.getTeams(),

		/** Formations with EN/JA/FR names */
		formations: () => loader.getFormations(),

		/** Quests with EN/JA/FR names */
		quests: () => loader.getQuests(),

		/** Items with EN/JA/FR names */
		items: () => loader.getItems(),

		/** Search entities by name (in any language) */
		search: (query: string, entityType?: string) => {
			const q = query.toLowerCase();
			const results: Array<{ type: string; entity: BaseEntity }> = [];

			const searchIn = (type: string, entities: BaseEntity[]) => {
				for (const e of entities) {
					const names = e.names;
					if (names) {
						if (
							names.en?.toLowerCase().includes(q) ||
							names.ja?.includes(q) ||
							names.fr?.toLowerCase().includes(q)
						) {
							results.push({ type, entity: e });
						}
					}
				}
			};

			if (!entityType || entityType === "skills") {
				searchIn("skill", loader.getSkills());
			}
			if (!entityType || entityType === "characters") {
				searchIn("character", loader.getCharacters());
			}
			if (!entityType || entityType === "teams") {
				searchIn("team", loader.getTeams());
			}
			if (!entityType || entityType === "formations") {
				searchIn("formation", loader.getFormations());
			}
			if (!entityType || entityType === "quests") {
				searchIn("quest", loader.getQuests());
			}
			if (!entityType || entityType === "items") {
				searchIn("item", loader.getItems());
			}

			return results;
		},
	};
}

export default EntitiesLoader;
