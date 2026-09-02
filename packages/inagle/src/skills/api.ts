/**
 * Skills API - Complete skill data with multilingual support
 *
 * Uses pre-extracted data from:
 * - entities/skills-all-types.json (unified: 2458 main + 58 aura + 402 passive)
 * - Fallback: all-gamedata/skillInfo.json
 * - Text data: common/text/{locale}/skill_text.cfg.bin.json for names/descriptions
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

import { createImageAPI } from "../core/images.js";
import { PATHS } from "../core/paths.js";
import { loadTextFile } from "../parsers/text-parser.js";
import type { SkillInfo } from "../types/gamedata.js";
import { loadAuraSkills } from "./mapper-aura.js";
import { buildPassiveSkillDatabase } from "./mapper-passive.js";
import {
	CATEGORY_NAMES,
	ELEMENT_NAMES,
	PASSIVE_BOOST_NAMES,
	PASSIVE_SCOPE_NAMES,
	type PassiveBoostType,
	type PassiveScope,
	type TeamPassive,
} from "./types.js";
import { loadSkillVideos } from "./video-loader.js";

export {
	CATEGORY_NAMES,
	ELEMENT_NAMES,
	PASSIVE_BOOST_NAMES,
	PASSIVE_SCOPE_NAMES,
	type TeamPassive,
};

const __dirname = dirname(fileURLToPath(import.meta.url));

// Data paths
const GAMEDATA_PATH = PATHS.allGamedata;
const ENTITIES_PATH = PATHS.entities;
// Path to scraped data directory
const DATA_DIR = PATHS.root;

/** Skill type */
export type SkillType = "main" | "aura" | "passive";

/** Enriched skill with computed properties */
export interface EnrichedSkill extends SkillInfo {
	/** Skill type */
	skillType: SkillType;
	/** Display name (first available: FR > EN > JA) */
	displayName: string;
	/** Element name */
	elementName: { en: string; ja: string; fr: string };
	/** Category name */
	categoryName: { en: string; ja: string; fr: string };
	/** Power range string */
	powerRange: string;
	/** Has partner skill */
	hasPartner: boolean;
	/** Partner count */
	partnerCount: number;
	/** Shops */
	shops?: { en: string[]; fr: string[] };
	/** Video URL from Zukan (WebM) */
	videoUrl?: string;
	/** Image d'attente de la vidéo zukan (jpg ~1280 px, extraite de l'animation). */
	posterUrl?: string;
	/** Vignette webp zukan (~6 Ko) — celle des grilles, pas le poster. */
	thumbnailUrl?: string;
	/** Image Path (Auto-resolved) */
	image?: string;
	/** Foul rate percentage */
	foulRate: number;
	/** Growth speed type (0=Slow, 1=Normal, 2=Fast) */
	growthType: number;
	/** Growth speed string (Lent, Normal, Rapide) */
	growthSpeed: string;
	/** Derived tags from bitflags (Long Shot, Block, etc.) */
	tags: string[];
	/** Internal code (e.g. ss_sk123) */
	internalCode?: string;
}

/** Aura skill from extraction */
export interface AuraSkill {
	auraId: string;
	auraIdStr: string;
	rarity?: number;
	element?: number;
	name_FR?: string;
	name_EN?: string;
	name_JA?: string;
	desc_FR?: string;
	desc_JA?: string;
	image?: string;
	assetCode?: string;
	subType?: "Aura" | "Keshin" | "Soul" | "Awakening" | "ModeChange" | "Miximax";
	_source: string;
	_file: string;
}

/** Passive skill from extraction */
export interface PassiveSkill {
	passiveId: string;
	passiveIdStr?: string;
	effectType?: number;
	effectValue?: number;
	rarity?: number;
	name_FR?: string;
	name_JA?: string;
	element?: number;
	desc_FR?: string;
	desc_JA?: string;
	scope?: PassiveScope;
	boostType?: PassiveBoostType;
	itemId?: string;
	itemNumber?: number;
	itemCode?: string;
	_source: string;
	_file: string;
}

/** Enriched aura skill */
export interface EnrichedAuraSkill extends AuraSkill {
	displayName: string;
	elementName: { en: string; ja: string; fr: string };
}

/** Enriched passive skill */
export interface EnrichedPassiveSkill extends PassiveSkill {
	displayName: string;
	scopeName: { en: string; fr: string };
	boostTypeName: { en: string; fr: string };
}

// Data structure loaded from skills-all-types.json
// Contains: main (2458), aura (58), passive (402)

/** Skills database */
export interface SkillsDatabase {
	generatedAt: string;
	totalSkills: number;
	totalAura: number;
	totalPassive: number;
	skills: EnrichedSkill[];
	activeSkills: EnrichedSkill[];
	auraSkills: EnrichedAuraSkill[];
	passiveSkills: EnrichedPassiveSkill[];
	teamPassives: TeamPassive[];
	byElement: Map<number, EnrichedSkill[]>;
	byCategory: Map<number, EnrichedSkill[]>;
	byId: Map<string, EnrichedSkill>;
	auraById: Map<string, EnrichedAuraSkill>;
	passiveById: Map<string, EnrichedPassiveSkill>;
	teamPassiveById: Map<string, TeamPassive>;
	passiveByScope: Map<PassiveScope, EnrichedPassiveSkill[]>;
	passiveByBoostType: Map<PassiveBoostType, EnrichedPassiveSkill[]>;
	stats: {
		withNameEN: number;
		withNameJA: number;
		withNameFR: number;
		withVideo: number;
		byElement: Record<string, number>;
		byCategory: Record<string, number>;
		auraByElement: Record<string, number>;
	};
}

/**
 * Build complete skills database from skills-all-types.json
 * Includes: 2458 main + 58 aura + 402 passive skills
 */
export function buildSkillsDatabase(options?: {
	gamedataPath?: string;
	entitiesPath?: string;
}): SkillsDatabase {
	const gamedataPath = options?.gamedataPath || GAMEDATA_PATH;
	const entitiesPath = options?.entitiesPath || ENTITIES_PATH;

	// Initialize Image API
	const images = createImageAPI();

	// Load video URLs from scraped data
	const videoMap = loadSkillVideos(DATA_DIR);
	if (videoMap.size > 0) {
	} else {
	}

	// Try skills-all-types.json first (complete unified data)
	const allTypesFile = join(entitiesPath, "skills-all-types.json");
	const entitiesFile = join(entitiesPath, "skills.json");
	const gamedataFile = join(gamedataPath, "skillInfo.json");

	// Fallback to internal entries directory (packaged in monorepo)
	const internalEntriesDir = join(__dirname, "../entries");
	const fallbackAllTypesFile = join(internalEntriesDir, "skills-all-types.json");
	const fallbackEntitiesFile = join(internalEntriesDir, "skills.json");

	let rawSkills: SkillInfo[] = [];
	let auraSkillsRaw: AuraSkill[] = [];
	let passiveSkillsRaw: PassiveSkill[] = [];
	let teamPassives: TeamPassive[] = [];

	if (existsSync(allTypesFile)) {
		const allTypes = JSON.parse(readFileSync(allTypesFile, "utf-8")) as {
			main: SkillInfo[];
			aura: AuraSkill[];
			passive: PassiveSkill[];
		};
		rawSkills = allTypes.main || [];
		auraSkillsRaw = allTypes.aura || [];
		passiveSkillsRaw = allTypes.passive || [];
	} else if (existsSync(fallbackAllTypesFile)) {
		const allTypes = JSON.parse(readFileSync(fallbackAllTypesFile, "utf-8")) as {
			main: SkillInfo[];
			aura: AuraSkill[];
			passive: PassiveSkill[];
		};
		rawSkills = allTypes.main || [];
		auraSkillsRaw = allTypes.aura || [];
		passiveSkillsRaw = allTypes.passive || [];
	} else if (existsSync(entitiesFile)) {
		const content = JSON.parse(readFileSync(entitiesFile, "utf-8"));
		// Check if new format with metadata
		if (content.skills && Array.isArray(content.skills)) {
			rawSkills = content.skills;
		} else if (content.data && Array.isArray(content.data)) {
			// Support generic data wrapper
			rawSkills = content.data;
		} else {
			rawSkills = content;
		}
	} else if (existsSync(fallbackEntitiesFile)) {
		const content = JSON.parse(readFileSync(fallbackEntitiesFile, "utf-8"));
		// Check if new format with metadata
		if (content.skills && Array.isArray(content.skills)) {
			rawSkills = content.skills;
		} else if (content.data && Array.isArray(content.data)) {
			// Support generic data wrapper
			rawSkills = content.data;
		} else {
			rawSkills = content;
		}
	} else if (existsSync(gamedataFile)) {
		const gamedata = JSON.parse(readFileSync(gamedataFile, "utf-8"));
		rawSkills = gamedata.data || gamedata;
	} else {
		try {
			// Use a dynamic import or assume it's available. For now, let's use a simpler approach.
			// I will add the import at the top of the file in the next step.

			const { buildSkillDatabase: buildRawDb } = require("./mapper.js");
			const mapperDb = buildRawDb({ dataRoot: PATHS.root });
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			rawSkills = mapperDb.skills as any;
		} catch (e) {
			console.error("[SkillsAPI] Failed to rebuild from raw files", e);
			throw new Error("No skill data found");
		}
	}

	// Load skill texts for name/description resolution
	const skillTextEN = loadTextFile("skill", "en");
	const skillTextFR = loadTextFile("skill", "fr");
	const skillTextJA = loadTextFile("skill", "ja");

	// Helper to lookup internal codes (e.g. whs00010) if missing in source
	const skillIdMap = new Map<string, string>();
	const skillStatsMap = new Map<string, any>();
	const skillInfoPath = join(gamedataPath, "skillInfo.json");
	if (existsSync(skillInfoPath)) {
		try {
			const info = JSON.parse(readFileSync(skillInfoPath, "utf-8"));
			const data = info.data || info;
			if (Array.isArray(data)) {
				for (const item of data as any[]) {
					if (item.skillID) {
						if (item.skillIDStr) {
							skillIdMap.set(item.skillID, item.skillIDStr);
						}
						// Store stats for fallback
						skillStatsMap.set(item.skillID, {
							power_min: item.power_min,
							power_max: item.power_max,
							consumeTp: item.consumeTp,
							foulRate: item.foulRate,
							growthType: item.growthType,
							recastTime: item.recastTime,
						});
					}
				}
			}
		} catch (e) {
			console.error("Failed to load ID map from skillInfo.json", e);
		}
	}

	// Fallback: Load Aura Skills from prepackaged fallback files if not present
	if (auraSkillsRaw.length === 0) {
		const fallbackAurasFile = join(internalEntriesDir, "auras.json");
		if (existsSync(fallbackAurasFile)) {
			try {
				auraSkillsRaw = JSON.parse(readFileSync(fallbackAurasFile, "utf-8"));
			} catch (e) {
				console.error("Failed to load prepackaged aura skills", e);
			}
		}
	}

	if (auraSkillsRaw.length === 0) {
		try {
			const skillInfoPath = join(gamedataPath, "skillInfo.json");
			// loadAuraSkills handles its own file discovery for the config file
			// We just need to pass the text map
			auraSkillsRaw = loadAuraSkills(
				skillInfoPath,
				"", // Internal path resolution in mapper
				skillTextFR,
				skillTextEN,
				skillTextJA
			);
		} catch (e) {
			console.error("Failed to load aura skills from mapper", e);
		}
	}

	// Fallback: Load Passive Skills from prepackaged fallback files first
	if (passiveSkillsRaw.length === 0) {
		const fallbackPassivesFile = join(internalEntriesDir, "passives.json");
		if (existsSync(fallbackPassivesFile)) {
			try {
				passiveSkillsRaw = JSON.parse(readFileSync(fallbackPassivesFile, "utf-8"));
			} catch (e) {
				console.error("Failed to load prepackaged passive skills", e);
			}
		}
	}

	// Always load Passive Skills and Team Passives from mapper to get latest data
	try {
		// dataRoot should be the parent of all-gamedata, i.e., 'data'
		const dataRoot = DATA_DIR;
		const mapperDb = buildPassiveSkillDatabase({ dataRoot });

		if (passiveSkillsRaw.length === 0) {
			passiveSkillsRaw = mapperDb.passiveSkills.map((p) => ({
				passiveId: `0x${p.hashId.toString(16).toUpperCase()}`,
				passiveIdStr: `passive_${p.id}`,
				name_FR: formatPassiveDescription(p.effect.fr, p.effectValues?.[0]) || "Passif Inconnu",
				name_JA: formatPassiveDescription(p.effect.ja, p.effectValues?.[0]) || "未知のパッシブ",
				desc_FR: formatPassiveDescription(p.effect.fr, p.effectValues?.[0]),
				desc_JA: formatPassiveDescription(p.effect.ja, p.effectValues?.[0]),
				element: p.element,
				effectValue: p.effectValues?.[0], // Expose raw value for card
				scope: p.scope,
				boostType: p.boostType,
				itemId: p.itemId,
				itemNumber: p.itemNumber,
				itemCode: p.itemCode,
				_source: "passive_skill_config",
				_file: "passive_skill_config.json",
			}));
		}

		// Load Team Passives
		teamPassives = mapperDb.teamPassives || [];
	} catch (e) {
		// Only print error if we don't have passives loaded from prepackaged files
		if (passiveSkillsRaw.length === 0) {
			console.error("Failed to load passive skills from mapper", e);
		}
	}

	// Build enriched main skills
	const skills: EnrichedSkill[] = [];
	const byElement = new Map<number, EnrichedSkill[]>();
	const byCategory = new Map<number, EnrichedSkill[]>();
	const byId = new Map<string, EnrichedSkill>();

	const stats = {
		withNameEN: 0,
		withNameJA: 0,
		withNameFR: 0,
		withVideo: 0,
		byElement: {} as Record<string, number>,
		byCategory: {} as Record<string, number>,
		auraByElement: {} as Record<string, number>,
	};

	for (const raw of rawSkills) {
		// Normalize category and element (handle numeric vs object format)
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const r = raw as any;

		// Normalize category and element (handle numeric vs object format)
		let categoryId =
			typeof r.category === "object" && r.category !== null ? r.category.id : Number(r.category);

		// Fallback for string-based 'type' (e.g. "Tir", "Air") from JSON
		if (Number.isNaN(categoryId) && typeof r.type === "string") {
			const map: Record<string, number> = {
				Tir: 1,
				Shoot: 1,
				Défense: 2,
				Block: 2,
				Dribble: 3,
				Arrêt: 4,
				Catch: 4,
				Gardien: 4,
				Spécial: 5,
				Special: 5,
				Talent: 6,
				Passive: 6,
				Technique: 6,
			};
			categoryId = map[r.type] || 0;
		}

		let elementId =
			typeof r.element === "object" && r.element !== null ? r.element.id : Number(r.element);

		if (Number.isNaN(elementId) && typeof r.element === "string") {
			const map: Record<string, number> = {
				Air: 1,
				Vent: 1,
				Wind: 1,
				Bois: 2,
				Forêt: 2,
				Forest: 2,
				Wood: 2,
				Feu: 3,
				Fire: 3,
				Terre: 4,
				Montagne: 4,
				Earth: 4,
				Mountain: 4,
				Néant: 5,
				Void: 5,
			};
			elementId = map[r.element] || 0;
		}

		const elementInfo = ELEMENT_NAMES[elementId] || ELEMENT_NAMES[0];
		const categoryInfo = CATEGORY_NAMES[categoryId] || CATEGORY_NAMES[0];

		// Normalize IDs (UnifiedSkill has internalCode/hashId, SkillInfo has skillIDStr/skillID)
		const skillID =
			r.skillID ||
			r.skillId ||
			(r.hashId !== undefined
				? `0x${Number(r.hashId).toString(16).toUpperCase().padStart(8, "0")}`
				: `Skill_${Math.random().toString(36).substring(7)}`);

		let skillIDStr = r.skillIDStr || r.internalCode || "";
		if (!skillIDStr && skillIdMap.has(skillID)) {
			skillIDStr = skillIdMap.get(skillID) || "";
		}

		// Auto-resolve image using skill ID string or internal code
		const imagePath =
			images.skill(skillIDStr) || (r.internalCode ? images.skill(r.internalCode) : undefined);

		// Helper to extract stats from legacy flat structure or new nested 'stats' object
		const getStat = (legacyKey: string, newKey: string, defaultValue = 0) => {
			// Check nested stats object first (New Unified Format)
			if (r.stats && r.stats[newKey] !== undefined) return r.stats[newKey];
			// Check flat property (Legacy Format)
			if (r[legacyKey] !== undefined) return r[legacyKey];

			// Fallback to skillStatsMap
			if (skillStatsMap.has(skillID)) {
				const fallback = skillStatsMap.get(skillID);
				// Map legacy key names used in map to values
				if (fallback[legacyKey] !== undefined) return fallback[legacyKey];
			}

			// Fallback
			return defaultValue;
		};

		const powerMin = getStat("power_min", "powerMin", 0);
		const powerMax = getStat("power_max", "powerMax", 0);
		const consumeTp = getStat("consumeTp", "tensionCost", 0);
		const foulRate = getStat("foulRate", "foulRate", 0);
		const growthType = getStat("growthType", "growthType", 0);
		const recastTime = getStat("recastTime", "recastTime", 0);

		// Resolve names from skill texts using skillNameId hash or fallback to pre-resolved
		const nameEN = skillTextEN.get(r.skillNameId) || r.name_EN || r.names?.en;
		const nameFR = skillTextFR.get(r.skillNameId) || r.name_FR || r.names?.fr;
		const nameJA = skillTextJA.get(r.skillNameId) || r.name_JA || r.names?.ja;

		// Resolve descriptions using skillDescId hash or fallback to pre-resolved
		const descEN = skillTextEN.get(r.skillDescId) || r.desc_EN || r.descriptions?.en;
		const descFR = skillTextFR.get(r.skillDescId) || r.desc_FR || r.descriptions?.fr;
		const descJA = skillTextJA.get(r.skillDescId) || r.desc_JA || r.descriptions?.ja;

		// Video matching logic
		// Match against English name first as Zukan scrape is English
		let videoUrl: string | undefined;
		if (nameEN) {
			// Simple exact match on lower case name
			videoUrl = videoMap.get(nameEN.trim().toLowerCase());
		}

		// Evolution Types mapping
		const getEvolutionLabel = (type: number): string => {
			switch (type) {
				case 0:
					return "Lente";
				case 1:
					return "Normale (+1/+2)";
				case 2:
					return "V (V2/V3)";
				case 3:
					return "G (G2/G3)";
				case 7:
					return "Infinie (N)";
				default:
					return `Type ${type}`;
			}
		};

		const enriched: EnrichedSkill = {
			// Manually map required SkillInfo fields from r (raw) to avoid spread issues
			eventID: r.eventID,
			eventIDName: r.eventIDName,
			failEventID: r.failEventID,
			failEventIDName: r.failEventIDName,
			skillNameId: r.skillNameId,
			skillDescId: r.skillDescId,
			cmdOptIdx: r.cmdOptIdx,
			skillEffectBitFlag: r.skillEffectBitFlag,
			colorIdx: r.colorIdx,
			focusBattleEffectId: r.focusBattleEffectId,
			partner1: r.partner1,
			partner2: r.partner2,
			partner3: r.partner3,
			telopInfoId: r.telopInfoId,
			oldorado: r.eldorado,
			partnerType: r.partnerType,
			skillID: skillID,
			skillIDStr: skillIDStr,
			// Overwrite complex objects with primitives to satisfy SkillInfo/sorting
			element: elementId,
			category: categoryId,
			// Internal
			internalCode: r.internalCode || r.skillIDStr,
			// Names
			name_EN: nameEN,
			name_FR: nameFR,
			name_JA: nameJA,
			// Desc
			desc_EN: descEN,
			desc_FR: descFR,
			desc_JA: descJA,
			// Main props
			skillType: "main",
			displayName: nameFR || nameEN || nameJA || skillIDStr || `Skill_${skillID}`,
			elementName: elementInfo,
			categoryName: categoryInfo,
			powerRange: `${powerMin}-${powerMax}`,
			hasPartner: (r.partnerType || 0) > 0,
			partnerCount: r.partnerType || 0,
			shops: r.shops,
			videoUrl,
			image: imagePath,
			// Ensure flat properties are populated for UI
			power_min: powerMin,
			power_max: powerMax,
			consumeTp: consumeTp,
			recastTime: recastTime,
			foulRate: foulRate,
			growthType: growthType,
			growthSpeed: getEvolutionLabel(growthType),
			tags: [
				(r.skillEffectBitFlag & 16) !== 0 ? "Contre" : null,
				(r.skillEffectBitFlag & 8) !== 0 ? "Tir de loin" : null,
				(r.skillEffectBitFlag & 32) !== 0 ? "Chaîne" : null,
				(r.skillEffectBitFlag & 64) !== 0 ? "Brèche" : null,
				(r.skillEffectBitFlag & 128) !== 0 ? "Surcharge" : null,
				(r.skillEffectBitFlag & 256) !== 0 ? "Zone" : null,
			].filter((t): t is string => t !== null),
		} as unknown as EnrichedSkill;

		skills.push(enriched);

		// Index by ID (both string code and hex ID)
		if (enriched.skillIDStr) byId.set(enriched.skillIDStr, enriched);
		if (enriched.skillID) byId.set(enriched.skillID, enriched);

		// Index by element
		if (!byElement.has(elementId)) {
			byElement.set(elementId, []);
		}
		byElement.get(elementId)?.push(enriched);

		// Index by category
		if (!byCategory.has(categoryId)) {
			byCategory.set(categoryId, []);
		}
		byCategory.get(categoryId)?.push(enriched);

		// Stats - use resolved names
		if (nameEN) stats.withNameEN++;
		if (nameJA) stats.withNameJA++;
		if (nameFR) stats.withNameFR++;
		if (videoUrl) stats.withVideo++;

		stats.byElement[elementInfo.en] = (stats.byElement[elementInfo.en] || 0) + 1;
		stats.byCategory[categoryInfo.en] = (stats.byCategory[categoryInfo.en] || 0) + 1;
	}

	// Create separated Active Skills list (Categories 1-5)
	// Sorted by: Category Order (Shoot > Dribble > Block > Catch > Special) -> Element -> Name
	const activeSkills = skills.filter((s) => s.category >= 1 && s.category <= 5);
	const categoryOrder = [1, 3, 2, 4, 5]; // Shoot, Dribble, Block, Catch, Special

	activeSkills.sort((a, b) => {
		// 1. Category Custom Order
		const catA = categoryOrder.indexOf(a.category);
		const catB = categoryOrder.indexOf(b.category);
		if (catA !== -1 && catB !== -1 && catA !== catB) {
			return catA - catB;
		}
		// Fallback if category not in list (shouldn't happen due to filter)
		if (a.category !== b.category) return a.category - b.category;

		// 2. Element
		if (a.element !== b.element) return a.element - b.element;

		// 3. Name
		const nameA = a.displayName || "";
		const nameB = b.displayName || "";
		return nameA.localeCompare(nameB);
	});

	// Build enriched aura skills
	const auraSkills: EnrichedAuraSkill[] = [];
	const auraById = new Map<string, EnrichedAuraSkill>();

	for (const raw of auraSkillsRaw) {
		// Deduplicate by ID
		if (auraById.has(raw.auraId)) continue;

		const elementInfo = ELEMENT_NAMES[raw.element ?? 0] || ELEMENT_NAMES[0];

		// Auto-resolve aura image — raw.image (buildImagePath) prend la priorité
		// car images.skill() génère un fallback ${code}_0.webp même si le fichier n'existe pas
		const auraImage =
			raw.image || images.aura(raw.assetCode || "") || images.aura(raw.auraIdStr || "");

		const enriched: EnrichedAuraSkill = {
			...raw,
			displayName: raw.name_FR || raw.auraIdStr || raw.auraId,
			elementName: elementInfo,
			image: auraImage,
		};

		auraSkills.push(enriched);
		auraById.set(raw.auraId, enriched);
		if (raw.auraIdStr) auraById.set(raw.auraIdStr, enriched);

		// Stats
		stats.auraByElement[elementInfo.en] = (stats.auraByElement[elementInfo.en] || 0) + 1;
	}

	// Sort aura skills: SubType -> Element -> Name
	const subTypeOrder = ["Keshin", "Soul", "Awakening", "ModeChange", "Aura"];
	auraSkills.sort((a, b) => {
		// 1. SubType Priority
		const typeA = subTypeOrder.indexOf(a.subType || "Aura");
		const typeB = subTypeOrder.indexOf(b.subType || "Aura");
		if (typeA !== typeB) return typeA - typeB;

		// 2. Element
		if (a.element !== b.element) return (a.element || 0) - (b.element || 0);

		// 3. Name
		return (a.displayName || "").localeCompare(b.displayName || "");
	});

	// Build enriched passive skills
	const passiveSkills: EnrichedPassiveSkill[] = [];
	const passiveById = new Map<string, EnrichedPassiveSkill>();
	const passiveByScope = new Map<PassiveScope, EnrichedPassiveSkill[]>();
	const passiveByBoostType = new Map<PassiveBoostType, EnrichedPassiveSkill[]>();

	for (const raw of passiveSkillsRaw) {
		const scope = raw.scope || "unknown";
		const boostType = raw.boostType || "unknown";

		const enriched: EnrichedPassiveSkill = {
			...raw,
			displayName: raw.name_FR || raw.passiveIdStr || raw.passiveId,
			scopeName: PASSIVE_SCOPE_NAMES[scope],
			boostTypeName: PASSIVE_BOOST_NAMES[boostType],
		};

		passiveSkills.push(enriched);
		passiveById.set(raw.passiveId, enriched);
		if (raw.passiveIdStr) passiveById.set(raw.passiveIdStr, enriched);

		// Index by scope
		if (!passiveByScope.has(scope)) {
			passiveByScope.set(scope, []);
		}
		passiveByScope.get(scope)?.push(enriched);

		// Index by boost type
		if (!passiveByBoostType.has(boostType)) {
			passiveByBoostType.set(boostType, []);
		}
		passiveByBoostType.get(boostType)?.push(enriched);
	}

	// Sort passive skills: Scope (team first), BoostType, then Name
	const scopeOrder: PassiveScope[] = ["team", "player", "enemy", "unknown"];
	const boostTypeOrder: PassiveBoostType[] = [
		"breach",
		"justice",
		"confrontation",
		"attack",
		"defense",
		"shoot",
		"dribble",
		"block",
		"catch",
		"speed",
		"stamina",
		"tension",
		"recovery",
		"mixed",
		"special",
		"unknown",
	];

	passiveSkills.sort((a, b) => {
		// 1. Scope order
		const scopeA = scopeOrder.indexOf(a.scope || "unknown");
		const scopeB = scopeOrder.indexOf(b.scope || "unknown");
		if (scopeA !== scopeB) return scopeA - scopeB;

		// 2. Boost type order
		const boostA = boostTypeOrder.indexOf(a.boostType || "unknown");
		const boostB = boostTypeOrder.indexOf(b.boostType || "unknown");
		if (boostA !== boostB) return boostA - boostB;

		// 3. Name
		return (a.displayName || "").localeCompare(b.displayName || "");
	});

	// Index Team Passives
	const teamPassiveById = new Map<string, TeamPassive>();
	for (const tp of teamPassives) {
		teamPassiveById.set(tp.id, tp);
	}

	return {
		generatedAt: new Date().toISOString(),
		totalSkills: skills.length,
		totalAura: auraSkills.length,
		totalPassive: passiveSkills.length,
		skills,
		activeSkills,
		auraSkills,
		passiveSkills,
		teamPassives,
		byElement,
		byCategory,
		byId,
		auraById,
		passiveById,
		teamPassiveById,
		passiveByScope,
		passiveByBoostType,
		stats,
	};
}

/**
 * Create Empty Skills API (Fallback)
 */
function createEmptySkillsAPI() {
	return {
		meta: {
			generatedAt: new Date().toISOString(),
			totalSkills: 0,
			totalAura: 0,
			totalPassive: 0,
			stats: {
				withNameEN: 0,
				withNameJA: 0,
				withNameFR: 0,
				withVideo: 0,
				byElement: {},
				byCategory: {},
				auraByElement: {},
			},
		},
		all: () => [],
		moves: () => [],
		get: (_: string) => undefined,
		byElement: (_: number | string) => [],
		byCategory: (_: number | string) => [],
		search: (_: string) => [],
		shoots: () => [],
		dribbles: () => [],
		blocks: () => [],
		catches: () => [],
		specials: () => [],
		talents: () => [],
		fire: () => [],
		forest: () => [],
		wind: () => [],
		mountain: () => [],
		strongest: () => [],
		partnerSkills: () => [],
		oldorado: () => [],
		auraAll: () => [],
		auraGet: (_: string) => undefined,
		auraByElement: (_: number | string) => [],
		auraSearch: (_: string) => [],
		auraByType: (_: string | undefined | null) => [],
		keshins: () => [],
		souls: () => [],
		awakenings: () => [],
		modeChanges: () => [],
		passiveAll: () => [],
		passiveGet: (_: string) => undefined,
		passiveByRarity: (_: number) => [],
		passiveByEffect: (_: number) => [],
		passiveTeam: () => [],
		passivePlayer: () => [],
		passiveEnemy: () => [],
		passiveByScope: (_: PassiveScope) => [],
		passiveBreach: () => [],
		passiveJustice: () => [],
		passiveConfrontation: () => [],
		passiveAttack: () => [],
		passiveDefense: () => [],
		passiveShoot: () => [],
		passiveDribble: () => [],
		passiveBlock: () => [],
		passiveCatch: () => [],
		passiveSpeed: () => [],
		passiveStamina: () => [],
		passiveTension: () => [],
		passiveMixed: () => [],
		passiveSpecial: () => [],
		passiveByBoostType: (_: PassiveBoostType) => [],
		passiveSearch: (_: string) => [],
		teamPassives: () => [],
		getTeamPassive: (_: string) => undefined,
		elements: ELEMENT_NAMES,
		categories: CATEGORY_NAMES,
		passiveScopes: PASSIVE_SCOPE_NAMES,
		passiveBoostTypes: PASSIVE_BOOST_NAMES,
		raw: {
			generatedAt: new Date().toISOString(),
			totalSkills: 0,
			totalAura: 0,
			totalPassive: 0,
			skills: [],
			activeskills: [],
			auraSkills: [],
			passiveSkills: [],
			teamPassives: [],
			byElement: new Map(),
			byCategory: new Map(),
			byId: new Map(),
			auraById: new Map(),
			passiveById: new Map(),
			teamPassiveById: new Map(),
			passiveByScope: new Map(),
			passiveByBoostType: new Map(),
			stats: {
				withNameEN: 0,
				withNameJA: 0,
				withNameFR: 0,
				withVideo: 0,
				byElement: {},
				byCategory: {},
				auraByElement: {},
			},
		},
	};
}

/**
 * Create Skills API with complete aura and passive support
 */
export function createSkillsAPI(options?: { gamedataPath?: string; entitiesPath?: string }) {
	let db: SkillsDatabase;

	try {
		db = buildSkillsDatabase(options);
	} catch (error) {
		console.warn(
			"[Inagle] Failed to build skills database (missing files?). Running in fallback mode.",
			error instanceof Error ? error.message : String(error)
		);
		return createEmptySkillsAPI();
	}

	return {
		/** Database metadata */
		meta: {
			generatedAt: db.generatedAt,
			totalSkills: db.totalSkills,
			totalAura: db.totalAura,
			totalPassive: db.totalPassive,
			stats: db.stats,
		},

		// ========== MAIN SKILLS ==========

		/** Get all main skills (includes Actives and Main Passives) */
		all: () => db.skills,

		/** Get only active skills (Shoot, Dribble, Block, Catch, Special) sorted by category */
		moves: () => db.activeSkills,

		/** Get main skill by ID (string) */
		get: (id: string) => db.byId.get(id),

		/** Get skills by element */
		byElement: (element: number | string) => {
			let elementId: number;
			if (typeof element === "string") {
				const entry = Object.entries(ELEMENT_NAMES).find(
					([, v]) => v.en.toLowerCase() === element.toLowerCase()
				);
				if (!entry) return [];
				elementId = Number.parseInt(entry[0], 10);
			} else {
				elementId = element;
			}
			return db.byElement.get(elementId) || [];
		},

		/** Get skills by category */
		byCategory: (category: number | string) => {
			let categoryId: number;
			if (typeof category === "string") {
				const entry = Object.entries(CATEGORY_NAMES).find(
					([, v]) => v.en.toLowerCase() === category.toLowerCase()
				);
				if (!entry) return [];
				categoryId = Number.parseInt(entry[0], 10);
			} else {
				categoryId = category;
			}
			return db.byCategory.get(categoryId) || [];
		},

		/** Search main skills by name */
		search: (query: string, searchOptions?: { lang?: "en" | "ja" | "fr"; limit?: number }) => {
			const q = query.toLowerCase();
			const lang = searchOptions?.lang;
			const limit = searchOptions?.limit || 50;

			const results: EnrichedSkill[] = [];

			for (const skill of db.skills) {
				let match = false;

				if (!lang || lang === "en") {
					match = match || (skill.name_EN?.toLowerCase().includes(q) ?? false);
				}
				if (!lang || lang === "ja") {
					match = match || (skill.name_JA?.includes(q) ?? false);
				}
				if (!lang || lang === "fr") {
					match = match || (skill.name_FR?.toLowerCase().includes(q) ?? false);
				}

				if (match) {
					results.push(skill);
					if (results.length >= limit) break;
				}
			}

			return results;
		},

		/** Get shoot skills */
		shoots: () => db.byCategory.get(1) || [],

		/** Get dribble skills */
		dribbles: () => db.byCategory.get(3) || [],

		/** Get block skills */
		blocks: () => db.byCategory.get(2) || [],

		/** Get catch skills */
		catches: () => db.byCategory.get(4) || [],

		/** Get special skills */
		specials: () => db.byCategory.get(5) || [],

		/** Get talents (passive skills - category 6) */
		talents: () => db.byCategory.get(6) || [],

		/** Get fire element skills (1) */
		fire: () => db.byElement.get(1) || [],

		/** Get forest element skills (2) */
		forest: () => db.byElement.get(2) || [],

		/** Get wind element skills (3) */
		wind: () => db.byElement.get(3) || [],

		/** Get mountain element skills (4) */
		mountain: () => db.byElement.get(4) || [],

		/** Get strongest skills by power_max */
		strongest: (limit = 20) => {
			return [...db.skills].sort((a, b) => b.power_max - a.power_max).slice(0, limit);
		},

		/** Get partner skills */
		partnerSkills: () => db.skills.filter((s) => s.hasPartner),

		/** Get eldorado skills */
		oldorado: () => db.skills.filter((s) => s.eldorado),

		// ========== AURA SKILLS ==========

		/** Get all aura skills (58 total) */
		auraAll: () => db.auraSkills,

		/** Get aura skill by ID */
		auraGet: (id: string) => db.auraById.get(id),

		/** Get aura skills by element */
		auraByElement: (element: number | string) => {
			let elementId: number;
			if (typeof element === "string") {
				const entry = Object.entries(ELEMENT_NAMES).find(
					([, v]) => v.en.toLowerCase() === element.toLowerCase()
				);
				if (!entry) return [];
				elementId = Number.parseInt(entry[0], 10);
			} else {
				elementId = element;
			}
			return db.auraSkills.filter((a) => a.element === elementId);
		},

		/** Search aura skills by name */
		auraSearch: (query: string) => {
			const q = query.toLowerCase();
			return db.auraSkills.filter(
				(a) =>
					a.displayName?.toLowerCase().includes(q) ||
					a.name_FR?.toLowerCase().includes(q) ||
					a.desc_FR?.toLowerCase().includes(q)
			);
		},

		/** Get aura skills by type */
		auraByType: (type: string | undefined | null) => {
			if (!type) return db.auraSkills;
			const t = type.toLowerCase();
			// Handle special case for "Aura" type which might be ambiguous (the subType "Aura" vs the generic term)
			// But based on mapper-aura, "Aura" is a specific subType fallthrough.
			return db.auraSkills.filter((a) => a.subType?.toLowerCase() === t);
		},

		/** Get Keshin (Fighting Spirits) skills */
		keshins: () => db.auraSkills.filter((a) => a.subType === "Keshin"),

		/** Get Soul (Totems) skills */
		souls: () => db.auraSkills.filter((a) => a.subType === "Soul"),

		/** Get Awakening skills */
		awakenings: () => db.auraSkills.filter((a) => a.subType === "Awakening"),

		/** Get Mode Change skills */
		modeChanges: () => db.auraSkills.filter((a) => a.subType === "ModeChange"),

		// ========== PASSIVE SKILLS ==========

		/** Get all passive skills (402 total) */
		passiveAll: () => db.passiveSkills,

		/** Get passive skill by ID */
		passiveGet: (id: string) => db.passiveById.get(id),

		/** Get passive skills by rarity */
		passiveByRarity: (rarity: number) => {
			return db.passiveSkills.filter((p) => p.rarity === rarity);
		},

		/** Get passive skills by effect type */
		passiveByEffect: (effectType: number) => {
			return db.passiveSkills.filter((p) => p.effectType === effectType);
		},

		// ========== PASSIVE SKILLS BY SCOPE ==========

		/** Get team passive skills (affect whole team) */
		passiveTeam: () => db.passiveByScope.get("team") || [],

		/** Get player passive skills (affect individual player) */
		passivePlayer: () => db.passiveByScope.get("player") || [],

		/** Get enemy-targeting passive skills (debuffs) */
		passiveEnemy: () => db.passiveByScope.get("enemy") || [],

		/** Get passive skills by scope */
		passiveByScope: (scope: PassiveScope) => db.passiveByScope.get(scope) || [],

		// ========== PASSIVE SKILLS BY BOOST TYPE ==========

		/** Get breach passive skills (Brèche - breakthrough rate) */
		passiveBreach: () => db.passiveByBoostType.get("breach") || [],

		/** Get justice passive skills (Justice - counter rate) */
		passiveJustice: () => db.passiveByBoostType.get("justice") || [],

		/** Get confrontation passive skills (Affrontement) */
		passiveConfrontation: () => db.passiveByBoostType.get("confrontation") || [],

		/** Get attack passive skills */
		passiveAttack: () => db.passiveByBoostType.get("attack") || [],

		/** Get defense passive skills */
		passiveDefense: () => db.passiveByBoostType.get("defense") || [],

		/** Get shoot passive skills */
		passiveShoot: () => db.passiveByBoostType.get("shoot") || [],

		/** Get dribble passive skills */
		passiveDribble: () => db.passiveByBoostType.get("dribble") || [],

		/** Get block passive skills */
		passiveBlock: () => db.passiveByBoostType.get("block") || [],

		/** Get catch passive skills */
		passiveCatch: () => db.passiveByBoostType.get("catch") || [],

		/** Get speed passive skills */
		passiveSpeed: () => db.passiveByBoostType.get("speed") || [],

		/** Get stamina passive skills */
		passiveStamina: () => db.passiveByBoostType.get("stamina") || [],

		/** Get tension passive skills */
		passiveTension: () => db.passiveByBoostType.get("tension") || [],

		/** Get mixed stat passive skills */
		passiveMixed: () => db.passiveByBoostType.get("mixed") || [],

		/** Get special effect passive skills */
		passiveSpecial: () => db.passiveByBoostType.get("special") || [],

		/** Get passive skills by boost type */
		passiveByBoostType: (boostType: PassiveBoostType) => db.passiveByBoostType.get(boostType) || [],

		/** Search passive skills by name */
		passiveSearch: (query: string) => {
			const q = query.toLowerCase();
			return db.passiveSkills.filter(
				(p) =>
					p.displayName?.toLowerCase().includes(q) ||
					p.name_FR?.toLowerCase().includes(q) ||
					p.desc_FR?.toLowerCase().includes(q)
			);
		},

		// ========== TEAM PASSIVES ==========

		/** Get all team passives (tactics/buffs) */
		teamPassives: () => db.teamPassives,

		/** Get team passive by ID */
		getTeamPassive: (id: string) => db.teamPassiveById.get(id),

		// ========== CONSTANTS ==========

		/** Element names map */
		elements: ELEMENT_NAMES,

		/** Category names map */
		categories: CATEGORY_NAMES,

		/** Passive scope names map */
		passiveScopes: PASSIVE_SCOPE_NAMES,

		/** Passive boost type names map */
		passiveBoostTypes: PASSIVE_BOOST_NAMES,

		/** Raw database access */
		raw: db,
	};
}

export type SkillsAPI = ReturnType<typeof createSkillsAPI>;

// Helper to clean up passive descriptions
function formatPassiveDescription(desc: string | undefined, value?: number): string | undefined {
	if (!desc) return desc;

	let formatted = desc.replace(/[[^]]+/g, ""); // Remove technical tags like [CPASSIVE01]

	if (value !== undefined) {
		// Format value with dot for decimals (1.5) instead of comma
		const formattedValue = value.toLocaleString("en-US", {
			maximumFractionDigits: 1,
			minimumFractionDigits: 0, // No .0 for integers
			useGrouping: false,
		});
		formatted = formatted.replace(/<VALUE>/g, formattedValue);
	} else {
		// Try to keep <VALUE> placeholder clean or replace with generic if unknown
		// But for RAG we prefer clean text.
		formatted = formatted.replace(/<VALUE>/g, "(?)");
	}

	return formatted
		.replace(/\\n/g, "\n") // Fix newlines
		.trim();
}
