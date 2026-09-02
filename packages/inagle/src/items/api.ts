/**
 * Items API - Complete items, capsules, and gallery data
 *
 * Uses parsers for item_config_*.cfg.bin.json:
 * - Equipment (shoes, misanga, accessory)
 * - Cosmetics (fashion, costume)
 * - Badges (emblem, title, name plate)
 * - Consumables
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { toHex } from "../core/data-loader.js";
import { createImageAPI } from "../core/images.js";
import { DATA_ROOT, PATHS } from "../core/paths.js";
import {
	buildItemDatabaseAsync,
	type ItemCategory,
	type ParsedItem,
} from "../parsers/item-config.js";
import { loadShopConfig } from "../parsers/shop-config.js";
import { loadTextFileAsync } from "../parsers/text-parser.js";
import type { CapsuleInfo, GalleryInfo } from "../types/gamedata.js";

// Data paths
const GAMEDATA_PATH = PATHS.allGamedata;

/**
 * Prefix → G4TX base filename mapping from menu_icon_manage_config.
 * Maps item internal code prefixes to their G4TX texture atlas file.
 */
const G4TX_PREFIX_MAP: Record<string, string> = {
	eq_sh: "icon_item03",
	eq_mi: "icon_item04",
	eq_ac: "icon_item05",
	eq_sp: "icon_item08",
	gd: "icon_item01",
	btl_re: "icon_item02",
	tk_hr: "icon_item10",
	tk_tr: "icon_item10",
	tk_si: "icon_item10",
	tk_ki: "icon_item10",
	tk_vi: "icon_item10",
	tk_bb: "icon_item10",
	tk_st: "icon_item10",
	uni: "icon_item07",
	ke: "icon_item01",
	ex: "icon_item01",
	abl: "icon_item01",
	perf: "icon_item01",
	cos: "icon_item01",
	coi: "icon_item02",
	coa: "icon_item02",
	spirit: "icon_item01",
	fm: "icon_item01",
	test_gd: "icon_item01",
	ds: "icon_item01",
};

/**
 * Build a mapping from item internalCode to actual G4TX-extracted icon file path.
 * Scans the iecode extraction directory for webp files and matches them to items
 * using the prefix→G4TX mapping and suffix matching.
 */
function buildItemIconMapping(): Map<string, string> {
	const mapping = new Map<string, string>();

	// Find the iecode extraction directory (PATHS.root = packages/inagle/data)
	const iecodeDirs = [
		resolve(PATHS.root, "../../../packages/iecode/menu/200_icon/02_icon_item"),
		resolve(PATHS.root, "../../iecode/menu/200_icon/02_icon_item"),
	];
	let iconDir: string | null = null;
	for (const d of iecodeDirs) {
		if (existsSync(d)) {
			iconDir = d;
			break;
		}
	}
	if (!iconDir) return mapping;

	const files = readdirSync(iconDir).filter((f) => f.endsWith(".webp"));

	// Group files by G4TX basename
	const filesByG4tx = new Map<string, { file: string; suffix: string }[]>();
	for (const f of files) {
		const m = f.match(/^(icon_(?:item|common|test)\d*)_(.+)\.webp$/);
		if (m) {
			const [, g4tx, suffix] = m;
			if (!filesByG4tx.has(g4tx)) filesByG4tx.set(g4tx, []);
			filesByG4tx.get(g4tx)!.push({ file: f, suffix });
		}
	}

	return { get: (code: string) => resolveItemIcon(code, filesByG4tx) } as Map<string, string>;
}

function resolveItemIcon(
	code: string,
	filesByG4tx: Map<string, { file: string; suffix: string }[]>
): string | undefined {
	let g4tx: string | null = null;
	let prefix: string | null = null;
	for (const [p, g] of Object.entries(G4TX_PREFIX_MAP)) {
		if (code.startsWith(p) && (!prefix || p.length > prefix.length)) {
			g4tx = g;
			prefix = p;
		}
	}
	if (!g4tx || !prefix) return undefined;

	const candidates = filesByG4tx.get(g4tx) || [];
	const codeSuffix = code.slice(prefix.length);

	const match =
		candidates.find((c) => c.suffix === code) ||
		candidates.find((c) => c.suffix === codeSuffix) ||
		candidates.find(
			(c) => c.suffix.length >= 3 && !c.suffix.startsWith("texture_") && code.endsWith(c.suffix)
		) ||
		candidates.find(
			(c) =>
				c.suffix.length >= 3 && !c.suffix.startsWith("texture_") && c.suffix.endsWith(codeSuffix)
		) ||
		(codeSuffix.length >= 4
			? candidates.find(
					(c) =>
						c.suffix.length >= 3 &&
						!c.suffix.startsWith("texture_") &&
						codeSuffix.endsWith(c.suffix)
				)
			: null);

	return match ? `200_icon/02_icon_item/${match.file}` : undefined;
}

/** Item category display names */
export const ITEM_CATEGORY_NAMES: Record<ItemCategory, { en: string; ja: string; fr: string }> = {
	consume: { en: "Consumable", ja: "消費アイテム", fr: "Consommable" },
	shoes: { en: "Shoes", ja: "シューズ", fr: "Chaussures" },
	misanga: { en: "Bracelet", ja: "ミサンガ", fr: "Bracelet" },
	accessory: { en: "Accessory", ja: "アクセサリー", fr: "Accessoire" },
	special: { en: "Special", ja: "スペシャル", fr: "Spécial" },
	formation: { en: "Formation", ja: "フォーメーション", fr: "Formation" },
	special_tactics: {
		en: "Sp. Tactics",
		ja: "必殺タクティクス",
		fr: "Tact. spéciale",
	},
	super_tactics: {
		en: "Super Tactics",
		ja: "超必殺タクティクス",
		fr: "Super tactique",
	},
	special_skill: { en: "Special Skill", ja: "とくぎ", fr: "Compétence sp." },
	title: { en: "Title", ja: "称号", fr: "Titre" },
	fashion: { en: "Fashion", ja: "ファッション", fr: "Mode" },
	costume: { en: "Costume", ja: "コスチューム", fr: "Costume" },
	emblem: { en: "Emblem", ja: "エンブレム", fr: "Emblème" },
	unique: { en: "Unique", ja: "ユニーク", fr: "Unique" },
	craft_obj: { en: "Craft Item", ja: "素材", fr: "Matériau" },
	animal: { en: "Animal", ja: "アニマル", fr: "Animal" },
	kizuna_link: { en: "Kizuna Link", ja: "きずなリンク", fr: "Lien Kizuna" },
	name_plate: { en: "Name Plate", ja: "ネームプレート", fr: "Plaque" },
	performance: { en: "Performance", ja: "パフォーマンス", fr: "Performance" },
	important: { en: "Key Item", ja: "重要アイテム", fr: "Objet clé" },
};

/** Equipment categories */
export const EQUIPMENT_CATEGORIES: ItemCategory[] = ["shoes", "misanga", "accessory"];

/** Cosmetic categories */
export const COSMETIC_CATEGORIES: ItemCategory[] = ["fashion", "costume"];

/** Badge categories */
export const BADGE_CATEGORIES: ItemCategory[] = ["emblem", "title", "name_plate"];

/** Items database */
export interface ItemsDatabase {
	generatedAt: string;
	items: ParsedItem[];
	capsules: CapsuleInfo[];
	gallery: GalleryInfo[];
	byItemId: Map<string, ParsedItem>;
	byCategory: Map<ItemCategory, ParsedItem[]>;
	byCapsuleId: Map<string, CapsuleInfo>;
	byGalleryId: Map<string, GalleryInfo>;
	stats: {
		totalItems: number;
		totalCapsules: number;
		totalGallery: number;
		byCategory: Record<ItemCategory, number>;
		byRarity: Record<number, number>;
	};
}

/**
 * Build items database asynchronously
 */
export async function buildItemsDatabaseAsync(options?: {
	gamedataPath?: string;
	dataPath?: string;
}): Promise<ItemsDatabase> {
	const gamedataPath = options?.gamedataPath || GAMEDATA_PATH;
	const dataPath = options?.dataPath || DATA_ROOT;

	// Initialize Image API
	const images = createImageAPI();

	// Load shop data (sync currently, could be asyncified later)
	const shops = loadShopConfig(dataPath);

	// Load shop texts async
	const [shopTextEn, shopTextFr] = await Promise.all([
		loadTextFileAsync("shop", "en"),
		loadTextFileAsync("shop", "fr"),
	]);

	// Build map: ItemId -> { en: string[], fr: string[] }
	const itemShops = new Map<number, { en: string[]; fr: string[] }>();

	for (const shop of shops) {
		const shopNameEn = shopTextEn.get(toHex(shop.nameHash));
		const shopNameFr = shopTextFr.get(toHex(shop.nameHash));

		if (shopNameEn && shopNameFr) {
			for (const itemId of shop.items) {
				if (!itemShops.has(itemId)) {
					itemShops.set(itemId, { en: [], fr: [] });
				}
				const entry = itemShops.get(itemId)!;
				if (!entry.en.includes(shopNameEn)) entry.en.push(shopNameEn);
				if (!entry.fr.includes(shopNameFr)) entry.fr.push(shopNameFr);
			}
		}
	}

	// Load items from item_config parser
	const itemDb = await buildItemDatabaseAsync(dataPath, { itemShops });

	// Auto-resolve item icons using G4TX-extracted files
	const iconMapping = buildItemIconMapping();
	for (const item of itemDb.items) {
		const code = item.internalCode || "";
		const mapped = iconMapping.get(code);
		if (mapped) {
			item.imageUrl = mapped;
		} else {
			const iconPath = images.item(code) || images.item(item.itemId);
			if (iconPath) item.imageUrl = iconPath;
		}
	}

	// Load capsules (from gamedata if available)
	const capsules: CapsuleInfo[] = [];

	// Load gallery
	let gallery: GalleryInfo[] = [];
	const gamedataGallery = join(gamedataPath, "GalleryInfo.json");
	if (existsSync(gamedataGallery)) {
		const gd = JSON.parse(readFileSync(gamedataGallery, "utf-8"));
		gallery = gd.data || gd;
	}

	// Build capsule index
	const byCapsuleId = new Map<string, CapsuleInfo>();
	for (const c of capsules) {
		byCapsuleId.set(c.capsuleId, c);
		if (c.capsuleIdStr) byCapsuleId.set(c.capsuleIdStr, c);
	}

	// Build gallery index
	const byGalleryId = new Map<string, GalleryInfo>();
	for (const g of gallery) {
		byGalleryId.set(g.galleryId, g);
		if (g.galleryIdStr) byGalleryId.set(g.galleryIdStr, g);
	}

	// Stats
	const stats = {
		totalItems: itemDb.items.length,
		totalCapsules: capsules.length,
		totalGallery: gallery.length,
		byCategory: itemDb.stats,
		byRarity: {} as Record<number, number>,
	};

	for (const c of capsules) {
		stats.byRarity[c.rarity] = (stats.byRarity[c.rarity] || 0) + 1;
	}

	return {
		generatedAt: new Date().toISOString(),
		items: itemDb.items,
		capsules,
		gallery,
		byItemId: itemDb.byId,
		byCategory: itemDb.byCategory,
		byCapsuleId,
		byGalleryId,
		stats,
	};
}

/**
 * Create Empty Items API (Fallback)
 */
function createEmptyItemsAPI() {
	return {
		meta: {
			generatedAt: new Date().toISOString(),
			stats: {
				totalItems: 0,
				totalCapsules: 0,
				totalGallery: 0,
				byCategory: {} as Record<ItemCategory, number>,
				byRarity: {},
			},
		},
		allItems: () => [],
		getItem: (_: string) => undefined,
		byCategory: (_: ItemCategory) => [],
		equipment: () => [],
		cosmetics: () => [],
		badges: () => [],
		consumables: () => [],
		keyItems: () => [],
		searchItems: (_: string) => [],
		allCapsules: () => [],
		getCapsule: (_: string) => undefined,
		capsulesByRarity: (_: number) => [],
		allGallery: () => [],
		getGalleryItem: (_: string) => undefined,
		galleryByCategory: (_: number) => [],
		categoryNames: ITEM_CATEGORY_NAMES,
	};
}

/**
 * Create Items API Asynchronously
 */
export async function createItemsAPIAsync(options?: { gamedataPath?: string; dataPath?: string }) {
	let db: ItemsDatabase;

	try {
		db = await buildItemsDatabaseAsync(options);
	} catch (error) {
		console.warn(
			"[Inagle] Failed to build items database (missing files?). Running in fallback mode.",
			error instanceof Error ? error.message : String(error)
		);
		return createEmptyItemsAPI();
	}

	return {
		/** Database metadata */
		meta: {
			generatedAt: db.generatedAt,
			stats: db.stats,
		},

		// === ITEMS ===

		/** Get all items */
		allItems: () => db.items,

		/** Get item by ID */
		getItem: (id: string) => db.byItemId.get(id),

		/** Get items by category */
		byCategory: (category: ItemCategory) => db.byCategory.get(category) || [],

		/** Get equipment items (shoes, misanga, accessory) */
		equipment: () => {
			const result: ParsedItem[] = [];
			for (const cat of EQUIPMENT_CATEGORIES) {
				result.push(...(db.byCategory.get(cat) || []));
			}
			return result;
		},

		/** Get cosmetic items (fashion, costume) */
		cosmetics: () => {
			const result: ParsedItem[] = [];
			for (const cat of COSMETIC_CATEGORIES) {
				result.push(...(db.byCategory.get(cat) || []));
			}
			return result;
		},

		/** Get badge items (emblem, title, name_plate) */
		badges: () => {
			const result: ParsedItem[] = [];
			for (const cat of BADGE_CATEGORIES) {
				result.push(...(db.byCategory.get(cat) || []));
			}
			return result;
		},

		/** Get consumable items */
		consumables: () => db.byCategory.get("consume") || [],

		/** Get key/important items */
		keyItems: () => db.byCategory.get("important") || [],

		/** Search items by name */
		searchItems: (query: string, options?: { lang?: "en" | "ja" | "fr"; limit?: number }) => {
			const q = query.toLowerCase();
			const lang = options?.lang;
			const limit = options?.limit || 50;

			const results: ParsedItem[] = [];

			for (const item of db.items) {
				if (!item.names) continue;

				let match = false;
				if (!lang || lang === "en") {
					match = match || (item.names.en?.toLowerCase().includes(q) ?? false);
				}
				if (!lang || lang === "ja") {
					match = match || (item.names.ja?.includes(q) ?? false);
				}
				if (!lang || lang === "fr") {
					match = match || (item.names.fr?.toLowerCase().includes(q) ?? false);
				}

				if (match) {
					results.push(item);
					if (results.length >= limit) break;
				}
			}

			return results;
		},

		// === CAPSULES ===

		/** Get all capsules */
		allCapsules: () => db.capsules,

		/** Get capsule by ID */
		getCapsule: (id: string) => db.byCapsuleId.get(id),

		/** Get capsules by rarity */
		capsulesByRarity: (rarity: number) => db.capsules.filter((c) => c.rarity === rarity),

		// === GALLERY ===

		/** Get all gallery items */
		allGallery: () => db.gallery,

		/** Get gallery item by ID */
		getGalleryItem: (id: string) => db.byGalleryId.get(id),

		/** Get gallery by category */
		galleryByCategory: (categoryId: number) =>
			db.gallery.filter((g) => g.categoryId === categoryId),

		// === CATEGORY NAMES ===

		/** Category display names */
		categoryNames: ITEM_CATEGORY_NAMES,
	};
}

export type ItemsAPI = Awaited<ReturnType<typeof createItemsAPIAsync>>;

// Deprecated sync
export function createItemsAPI() {
	throw new Error("createItemsAPI is deprecated. Use createItemsAPIAsync instead.");
}
export function buildItemsDatabase() {
	throw new Error("buildItemsDatabase is deprecated. Use buildItemsDatabaseAsync instead.");
}
