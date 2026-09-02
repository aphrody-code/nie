// @ts-nocheck
/**
 * @file item-config.ts
 * @description Parser for item_config files to extract items and link Uniforms
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadJsonAsync } from "../core/async-loader.js";
import type { ConfigNode } from "../core/config-parser.js";
import { findConfigFile, toHex } from "../core/data-loader.js";
import { EntityExporters, type ExportableEntity } from "../core/exporters.js";
import { loadTextFileAsync } from "./text-parser.js";

/**
 * Charge la base communautaire des bonus d'équipement (item-bonus-db.json).
 * Relevé in-game : chaque entrée mappe un nameId (var[2] du leaf) vers ses
 * bonus de stats réels (kick/control/…). Couvre chaussures/bracelets/accessoires.
 * Clé de retour : nameId hex MAJUSCULE sans préfixe `0x`.
 */
function loadItemBonusDb(): Map<string, ItemStatBonuses> {
	const map = new Map<string, ItemStatBonuses>();
	try {
		const here = dirname(fileURLToPath(import.meta.url));
		const dbPath = join(here, "../data/item-bonus-db.json");
		if (!existsSync(dbPath)) return map;
		const entries = JSON.parse(readFileSync(dbPath, "utf-8")) as Array<{
			id: string;
			bonuses?: ItemStatBonuses;
		}>;
		for (const e of entries) {
			if (!e.id || !e.bonuses) continue;
			const key = e.id.toUpperCase().replace(/^0X/, "");
			map.set(key, e.bonuses);
		}
	} catch {
		// best-effort : pas de bonus décodés si le fichier est absent/illisible
	}
	return map;
}

export type ItemCategory =
	| "consume"
	| "shoes"
	| "misanga"
	| "accessory"
	| "special"
	| "formation"
	| "special_tactics"
	| "super_tactics"
	| "special_skill"
	| "title"
	| "fashion"
	| "costume"
	| "emblem"
	| "unique"
	| "craft_obj"
	| "animal"
	| "kizuna_link"
	| "name_plate"
	| "performance"
	| "important";

/**
 * Bonus de statistique décodé (issu de la base communautaire item-bonus-db).
 * Clés possibles : kick, control, technique, intelligence, pressure, agility, physical.
 */
export type ItemStatBonuses = Partial<Record<StatBonusKey, number>>;

export type StatBonusKey =
	| "kick"
	| "control"
	| "technique"
	| "intelligence"
	| "pressure"
	| "agility"
	| "physical";

export interface ParsedItem extends ExportableEntity {
	itemId: string; // Hex
	internalCode?: string; // Asset ID / Filename base
	category: ItemCategory;
	rarity?: number;
	names?: { en?: string; fr?: string; ja?: string };
	descriptions?: { en?: string; fr?: string; ja?: string };
	imageUrl?: string;
	shops?: { en: string[]; fr: string[] };
	price?: number;
	stats?: { stat1: number; stat2: number };
	/**
	 * Bonus de stats RÉELS décodés (kick +6, control +5, …) pour l'équipement
	 * (chaussures/bracelets/accessoires). Joint sur le nameId (var[2]) via
	 * item-bonus-db.json (relevé in-game communautaire). Absent si non décodé.
	 */
	bonuses?: ItemStatBonuses;
	/** Quantité max empilable en inventaire (consommables : var[7]). */
	maxStack?: number;
	// Specific fields
	uniformId?: number; // For fashion items
}

/** Libellés FR des clés de bonus de stats (pour les attributes d'export). */
const STAT_FR_LABELS: Record<string, string> = {
	agility: "Agilité",
	control: "Contrôle",
	intelligence: "Intelligence",
	kick: "Tir",
	physical: "Physique",
	pressure: "Pression",
	technique: "Technique",
};

const CATEGORY_MAP: Record<string, ItemCategory> = {
	ITEM_CONSUME_INFO: "consume",
	ITEM_SHOES_INFO: "shoes",
	ITEM_MISANGA_INFO: "misanga",
	ITEM_ACCESSORY_INFO: "accessory",
	ITEM_SPECIAL_INFO: "special",
	ITEM_FORMATION_INFO: "formation",
	ITEM_SPECIAL_TACTICS_INFO: "special_tactics",
	ITEM_SUPER_TACTICS_INFO: "super_tactics",
	ITEM_SPECIAL_SKILL_INFO: "special_skill",
	ITEM_TITLE_INFO: "title",
	ITEM_FASHION_INFO: "fashion",
	ITEM_COSTUME_INFO: "costume",
	ITEM_EMBLEM_INFO: "emblem",
	ITEM_UNIQUE_INFO: "unique",
	ITEM_CRAFT_OBJ_INFO: "craft_obj",
	ITEM_ANIMAL_INFO: "animal",
	ITEM_KIZUNA_LINK_INFO: "kizuna_link",
	ITEM_NAME_PLATE_INFO: "name_plate",
	ITEM_PERFORMANCE_INFO: "performance",
	ITEM_IMPORTANT_INFO: "important",
};

export async function loadFashionItemMappingAsync(dataPath: string): Promise<Map<number, number>> {
	const filename = findConfigFile("item", "item_config_");
	const mapping = new Map<number, number>();

	if (!filename) return mapping;
	const configPath = join(dataPath, "common", "gamedata", "item", filename);

	try {
		const content = await loadJsonAsync<any>(configPath);
		const entries = content.entries as ConfigNode[];

		function traverse(node: ConfigNode) {
			if (node.name.startsWith("ITEM_FASHION_INFO_")) {
				const vars = node.variables;
				if (vars.length > 0) {
					const itemIdStr = vars[0].value;
					const uniformIdStr = vars[vars.length - 1].value;
					if (itemIdStr && uniformIdStr) {
						mapping.set(
							Number.parseInt(itemIdStr, 10) >>> 0,
							Number.parseInt(uniformIdStr, 10) >>> 0
						);
					}
				}
			}
			if (node.children) node.children.forEach(traverse);
		}
		entries.forEach(traverse);
	} catch (e) {
		console.error("[item-config] Failed to parse item config for mapping", e);
	}
	return mapping;
}

export async function buildItemDatabaseAsync(
	dataPath: string,
	options?: { itemShops?: Map<number, { en: string[]; fr: string[] }> }
) {
	const filename = findConfigFile("item", "item_config_");

	const items: ParsedItem[] = [];
	const byId = new Map<string, ParsedItem>();
	const byCategory = new Map<ItemCategory, ParsedItem[]>();
	const stats = {} as Record<ItemCategory, number>;

	if (!filename) {
		console.warn("[item-config] Config not found");
		return {
			items,
			byId,
			byCategory,
			stats,
			toMarkdown: () => null,
			toReact: () => null,
		};
	}
	const configPath = join(dataPath, "common", "gamedata", "item", filename);

	// Charge la base de bonus décodés (synchrone, fichier statique bundlé).
	const bonusDb = loadItemBonusDb();

	// Load Texts (Parallel).
	// NOTE: il n'existe PAS de fichier `item_explain_text` dans le jeu — les
	// descriptions vivent DANS `item_text`, résolues via le descId (var[3]).
	// On charge donc `item` deux fois (noms ET descriptions partagent la table).
	const [textEn, textFr, textJa] = await Promise.all([
		loadTextFileAsync("item", "en"),
		loadTextFileAsync("item", "fr"),
		loadTextFileAsync("item", "ja"),
	]);
	const descEn = textEn;
	const descFr = textFr;
	const descJa = textJa;

	try {
		const content = await loadJsonAsync<any>(configPath);

		if (!content?.entries) {
			console.error(
				"[ItemParser] Invalid config structure:",
				content ? Object.keys(content) : "null"
			);
			return { items, byId, byCategory, stats, toMarkdown: () => null, toReact: () => null };
		}

		const entries = content.entries as ConfigNode[];

		function traverse(node: ConfigNode) {
			for (const [prefix, category] of Object.entries(CATEGORY_MAP)) {
				if (node.name.startsWith(prefix) && !node.name.includes("_LIST_BEG_")) {
					const vars = node.variables;
					if (vars.length > 0) {
						const itemIdInt = Number.parseInt(vars[0].value, 10) >>> 0;
						const itemIdHex = toHex(itemIdInt);

						const nameIdInt = vars.length > 2 ? Number.parseInt(vars[2].value, 10) : 0;
						const nameIdHex = toHex(nameIdInt);
						// Clé de jointure bonus-db : nameId hex MAJUSCULE sans `0x`.
						const bonusKey = nameIdHex.toUpperCase().replace(/^0X/, "");

						const descIdInt = vars.length > 3 ? Number.parseInt(vars[3].value, 10) : 0;
						const descIdHex = toHex(descIdInt);

						// Names & Desc
						const nameEn = textEn.get(nameIdHex);
						const nameFr = textFr.get(nameIdHex);
						const nameJa = textJa.get(nameIdHex);

						const dEn = descEn.get(descIdHex);
						const dFr = descFr.get(descIdHex);
						const dJa = descJa.get(descIdHex);

						// Asset ID is reliably at index 11
						const internalCode = vars.length > 11 ? vars[11].value : undefined;

						const item: ParsedItem = {
							id: itemIdHex,
							name: nameFr || nameEn || nameJa || `${category}_${itemIdHex}`,
							description: dFr || dEn || dJa,
							itemId: itemIdHex,
							internalCode,
							category,
							names: { en: nameEn, fr: nameFr, ja: nameJa },
							descriptions: { en: dEn, fr: dFr, ja: dJa },
							shops: options?.itemShops?.get(itemIdInt),
							attributes: {
								Catégorie: category,
								ID: itemIdHex,
							},
						};

						// Price extraction (vars[4] is buy price for all item types)
						if (vars.length > 4) {
							const price = Number.parseInt(vars[4].value, 10);
							if (price > 0) {
								item.price = price;
								item.attributes!.Prix = price;
							}
						}

						// Equipment stats extraction (codes bruts var[5]/var[6] — peu lisibles,
						// conservés pour compat ; les vrais bonus arrivent via bonus-db ci-dessous).
						if (
							category === "shoes" ||
							category === "misanga" ||
							category === "accessory" ||
							category === "special" ||
							category === "fashion"
						) {
							if (vars.length > 6) {
								item.stats = {
									stat1: Number.parseInt(vars[5].value, 10),
									stat2: Number.parseInt(vars[6].value, 10),
								};
							}
						}

						// Bonus de stats RÉELS (relevé communautaire) — joint sur le nameId.
						// Couvre chaussures/bracelets/accessoires : kick +6, control +5, …
						const bonuses = bonusDb.get(bonusKey);
						if (bonuses && Object.keys(bonuses).length > 0) {
							item.bonuses = bonuses;
							for (const [stat, val] of Object.entries(bonuses)) {
								if (val) item.attributes![STAT_FR_LABELS[stat] || stat] = val;
							}
						}

						// Quantité max empilable (consommables/craft : var[7]).
						if (
							(category === "consume" || category === "craft_obj") &&
							vars.length > 7
						) {
							const stack = Number.parseInt(vars[7].value, 10);
							if (stack > 0 && stack < 1_000_000) {
								item.maxStack = stack;
							}
						}

						// Fashion logic
						if (category === "fashion") {
							const uniformIdStr = vars[vars.length - 1].value;
							if (uniformIdStr) {
								item.uniformId = Number.parseInt(uniformIdStr, 10) >>> 0;
								item.attributes!["Uniforme ID"] = item.uniformId;
							}
						}

						items.push(item);
						byId.set(itemIdHex, item);
						if (!byCategory.has(category)) byCategory.set(category, []);
						byCategory.get(category)?.push(item);
						stats[category] = (stats[category] || 0) + 1;
					}
				}
			}

			if (node.children) node.children.forEach(traverse);
		}

		entries.forEach(traverse);
	} catch (e) {
		console.error("[item-config] Build failed", e);
	}

	return {
		items,
		byId,
		byCategory,
		stats,
		toMarkdown: (id: string) => {
			const i = byId.get(id);
			return i ? EntityExporters.toMarkdown(i, "Objet") : null;
		},
		toReact: (id: string) => {
			const i = byId.get(id);
			return i ? EntityExporters.toReact(i) : null;
		},
	};
}

// Deprecate sync
export function buildItemDatabase(_dataPath: string) {
	throw new Error("Synchronous buildItemDatabase is deprecated.");
}
export function loadFashionItemMapping(_dataPath: string) {
	throw new Error("Synchronous loadFashionItemMapping is deprecated.");
}
export function loadItemConfig(_dataPath: string) {
	throw new Error("Synchronous loadItemConfig is deprecated.");
}
