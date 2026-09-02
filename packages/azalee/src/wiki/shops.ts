
import { createClient } from "../db/provider";
import {
	type ShopDetail,
	type ShopItem,
	type ShopSummary,
} from "./shops-shared";

// Ré-export des types + constante depuis le module client-safe (compat imports existants).
export {
	SHOP_CATEGORY_FR,
	type ShopDetail,
	type ShopItem,
	type ShopSummary,
} from "./shops-shared";

/**
 * Accès données dédié à la section « Boutiques » (table `inagle_shops`, 2331 lignes).
 *
 * Vérité terrain (PRAGMA + lignes réelles du miroir) :
 *  - 1 ligne `inagle_shops` = 1 (boutique × objet vendu). 15 boutiques distinctes.
 *  - Colonnes : shop_id, name_fr/en/ja (nom boutique), item_id/item_hex,
 *    item_name_fr/en/ja (souvent vides), item_db_id (= `inagle_items.id`), slot_index.
 *  - PAS de prix / monnaie / condition dans le schéma (vérifié : aucun champ price/cost
 *    dans `data` JSON). On expose donc « qui vend quoi », pas un coût.
 *  - item_db_id matche `inagle_items.id` pour ~1217 lignes → on JOIN pour récupérer
 *    nom FR + catégorie + icône. Le reste reste un objet « brut » (hex), encore lié à
 *    /item/[id] (la page item gère l'absence).
 */

/** Noms FR canoniques (corrige les libellés EN du dump + nomme les boutiques sans nom). */
const SHOP_NAME_FR: Record<number, string> = {
	1314944986: "Centre commercial Chronique",
	2615185778: "Boutique VS",
	1526934762: "Marché aux esprits",
	1192581557: "BB Mart",
	3908984051: "Footech (Odaiba)",
	2683923557: "Footech (Salle d'arcade)",
	2973445077: "Boutique Kizuna",
	4019427562: "Goal-Marché (Odaiba)",
	27130310: "Goal-Marché (Salle d'arcade)",
	2559879292: "Goal-Marché (Gare de Nagumohara)",
	1912016201: "L'Étoffe des héros (Nagumo)",
	116407775: "L'Étoffe des héros (Odaiba)",
	1723005414: "Repaire des indomptables",
	// Boutiques sans nom dans le dump (name_fr vide) — nommées par leur contenu réel.
	485633447: "Échange de jetons VS",
	1629770002: "Récompenses Chronique",
};

function resolveShopName(shopId: number, dbNameFr: string | null): string {
	return SHOP_NAME_FR[shopId] || dbNameFr || `Boutique ${shopId}`;
}

interface RawShopRow {
	shop_id: number;
	name_fr: string | null;
	name_en: string | null;
	name_ja: string | null;
	item_db_id: string | null;
	item_name_fr: string | null;
	item_name_en: string | null;
	slot_index: number | null;
}

interface RawItemRow {
	id: string;
	name_fr: string | null;
	name_en: string | null;
	category: string | null;
	image_url: string | null;
	internal_code: string | null;
}

/** Charge toutes les lignes `inagle_shops` (pagination interne pour dépasser la limite 1000). */
async function fetchAllShopRows(): Promise<RawShopRow[]> {
	const supabase = await createClient();
	const rows: RawShopRow[] = [];
	const pageSize = 1000;
	for (let from = 0; ; from += pageSize) {
		const { data, error } = await supabase
			.from("inagle_shops")
			.select("shop_id, name_fr, name_en, name_ja, item_db_id, item_name_fr, item_name_en, slot_index")
			.range(from, from + pageSize - 1);
		if (error) {
			console.error("[shops] fetch error:", error.message);
			break;
		}
		const batch = (data || []) as unknown as RawShopRow[];
		rows.push(...batch);
		if (batch.length < pageSize) break;
	}
	return rows;
}

/** Index `inagle_items.id` → métadonnées (nom FR, catégorie, icône) pour un set d'ids. */
async function fetchItemsByIds(ids: string[]): Promise<Map<string, RawItemRow>> {
	const map = new Map<string, RawItemRow>();
	if (ids.length === 0) return map;
	const supabase = await createClient();
	const chunkSize = 300;
	for (let i = 0; i < ids.length; i += chunkSize) {
		const chunk = ids.slice(i, i + chunkSize);
		const { data, error } = await supabase
			.from("inagle_items")
			.select("id, name_fr, name_en, category, image_url, internal_code")
			.in("id", chunk);
		if (error) {
			console.error("[shops] items fetch error:", error.message);
			continue;
		}
		for (const row of (data || []) as unknown as RawItemRow[]) {
			map.set(row.id, row);
		}
	}
	return map;
}

/** Liste de toutes les boutiques avec compteurs + répartition par catégorie. */
export async function getShopsList(): Promise<ShopSummary[]> {
	const rows = await fetchAllShopRows();
	const itemIds = Array.from(
		new Set(rows.map((r) => r.item_db_id).filter((v): v is string => !!v))
	);
	const itemMap = await fetchItemsByIds(itemIds);

	const byShop = new Map<number, { name_fr: string | null; name_en: string | null; name_ja: string | null; cats: Map<string, number>; count: number }>();

	for (const r of rows) {
		let entry = byShop.get(r.shop_id);
		if (!entry) {
			entry = {
				name_fr: r.name_fr,
				name_en: r.name_en,
				name_ja: r.name_ja,
				cats: new Map(),
				count: 0,
			};
			byShop.set(r.shop_id, entry);
		}
		entry.count++;
		const item = r.item_db_id ? itemMap.get(r.item_db_id) : undefined;
		const cat = item?.category || null;
		if (cat) entry.cats.set(cat, (entry.cats.get(cat) || 0) + 1);
	}

	const list: ShopSummary[] = Array.from(byShop.entries()).map(([shopId, e]) => ({
		shopId,
		name: resolveShopName(shopId, e.name_fr),
		nameEn: e.name_en || null,
		nameJa: e.name_ja || null,
		itemCount: e.count,
		categories: Array.from(e.cats.entries())
			.map(([category, count]) => ({ category, count }))
			.sort((a, b) => b.count - a.count),
	}));

	list.sort((a, b) => b.itemCount - a.itemCount);
	return list;
}

/** Détail d'une boutique : métadonnées + liste complète des objets vendus. */
export async function getShop(shopId: number): Promise<ShopDetail | null> {
	if (!Number.isFinite(shopId)) return null;
	const supabase = await createClient();
	const { data, error } = await supabase
		.from("inagle_shops")
		.select("shop_id, name_fr, name_en, name_ja, item_db_id, item_name_fr, item_name_en, slot_index")
		.eq("shop_id", shopId)
		.order("slot_index", { ascending: true });

	if (error) {
		console.error("[shops] getShop error:", error.message);
		return null;
	}
	const rows = (data || []) as unknown as RawShopRow[];
	if (rows.length === 0) return null;

	const itemIds = Array.from(
		new Set(rows.map((r) => r.item_db_id).filter((v): v is string => !!v))
	);
	const itemMap = await fetchItemsByIds(itemIds);

	const seen = new Set<string>();
	const items: ShopItem[] = [];
	const cats = new Map<string, number>();

	for (const r of rows) {
		const dbId = r.item_db_id || r.item_name_fr || `${r.shop_id}:${r.slot_index ?? ""}`;
		// déduplication (un même objet peut apparaître plusieurs fois)
		const key = `${dbId}:${r.slot_index ?? ""}`;
		if (seen.has(key)) continue;
		seen.add(key);

		const item = r.item_db_id ? itemMap.get(r.item_db_id) : undefined;
		const resolved = !!item;
		const name =
			item?.name_fr ||
			item?.name_en ||
			r.item_name_fr ||
			r.item_name_en ||
			(r.item_db_id ? `Objet ${r.item_db_id}` : "Objet inconnu");
		const category = item?.category || null;
		if (category) cats.set(category, (cats.get(category) || 0) + 1);

		items.push({
			id: r.item_db_id || "",
			name,
			category,
			icon: item?.image_url || null,
			internalCode: item?.internal_code || null,
			slotIndex: r.slot_index ?? 0,
			resolved,
		});
	}

	const first = rows[0];
	return {
		shopId,
		name: resolveShopName(shopId, first?.name_fr ?? null),
		nameEn: first?.name_en || null,
		nameJa: first?.name_ja || null,
		itemCount: items.length,
		categories: Array.from(cats.entries())
			.map(([category, count]) => ({ category, count }))
			.sort((a, b) => b.count - a.count),
		items,
	};
}
