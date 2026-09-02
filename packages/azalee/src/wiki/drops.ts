/**
 * Accès données pour la section Wiki « Drops / Taux » (route `/drops`).
 *
 * Source de vérité = miroir SQLite embarqué (lecture via le client PostgREST-compatible
 * `@/lib/supabase/server`). Trois tables réelles (vérifiées sur le miroir, db 2026-06-05) :
 *
 *  - `inagle_drop_rates` (177) : table maîtresse. Colonne `source` ∈ {`win_treasure`,
 *    `item_emission`, `spirit_drop`}. Pour `win_treasure`/`item_emission`, `item_id` est
 *    un hash `0x…` qui résout à 100 % vers `inagle_items` (123/123 lignes) → objet concret
 *    + son `weight` (poids relatif dans le groupe `source_id`). Pour `spirit_drop`, `item_id`
 *    est VIDE : la ligne décrit un palier de rareté (`rarity` 0-5 + `drop_rarity` 0/10/20)
 *    et son `weight` — c.-à-d. une probabilité de tier, pas un objet nommé.
 *  - `inagle_drops_battles` (6) : `battle_group_id` → `item_table_id` (hash). Ce hash
 *    référence un `source_id` côté `spirit_drop` (vérifié : 0x81A08AD6 / 0x18A9DB6C ont
 *    chacun 3 lignes `drop_rate`). Donne le lien combat → table de paliers.
 *  - `inagle_drops` (98) : mécanique DISTINCTE = bonus passifs « Fèves » (Beans) des
 *    équipes (séries rétro IE1-IEGO2 + VR). Pas un drop d'objet : équipe, type de fève,
 *    condition, stat, valeur. Exposé en onglet séparé.
 *
 * Anti-hallucination : aucune valeur n'est inventée. Le pourcentage affiché = `weight`
 * normalisé sur le total du groupe `source_id` (somme des poids), ce qui est la sémantique
 * réelle d'une table pondérée. Si un objet n'est pas résoluble (jamais le cas en pratique :
 * 123/123), il est conservé avec son hash brut comme libellé de repli.
 *
 * `inagle_drops_tables` (26) n'est PAS exposé en liste : ses `entries.itemId` sont de
 * petits entiers (0,1,2,3,10,11,20,21) = indices de paliers de rareté, pas des id d'objets
 * (les `inagle_items` sont des hash `0x…`). Aucune résolution fiable → on ne forge rien.
 */

import { createClient } from "../db/provider";
import type {
	DropEntry,
	DropsPageData,
	SpiritGroup,
	SpiritTier,
	TeamBean,
} from "./drops-shared";

// Ré-export des types + helpers purs depuis le module client-safe (compat imports existants).
export type {
	DropEntry,
	DropsCounts,
	DropsPageData,
	SpiritGroup,
	SpiritTier,
	TeamBean,
} from "./drops-shared";
export { dropCategoryLabel, dropSourceLabel } from "./drops-shared";

/** Une ligne brute de `inagle_drop_rates`. */
interface DropRateRow {
	id: string;
	source: string;
	source_id: string | null;
	item_id: string | null;
	rarity: number | null;
	drop_rarity: number | null;
	weight: number | null;
}

/** Une ligne brute de `inagle_items` (colonnes utiles seulement). */
interface ItemRow {
	id: string;
	name_fr: string | null;
	name_en: string | null;
	category: string | null;
	rarity: number | null;
	internal_code: string | null;
	image_url: string | null;
}

/** Une ligne brute de `inagle_drops` (bonus « Fèves »). */
interface BeanRow {
	id: number;
	team: string | null;
	game: string | null;
	fixed_beans: string | null;
	passive_type: string | null;
	no: number | null;
	requirement: string | null;
	stat: string | null;
	value: string | null;
}

const SUPPORTED_CONCRETE_SOURCES = ["win_treasure", "item_emission"] as const;

/** Récupère et résout toutes les sources de drops concrets (objet nommé + taux). */
async function fetchConcreteDrops(): Promise<DropEntry[]> {
	const supabase = await createClient();

	const { data: rateData } = await supabase
		.from("inagle_drop_rates")
		.select("*")
		.in("source", [...SUPPORTED_CONCRETE_SOURCES]);

	const rows = (rateData ?? []) as DropRateRow[];
	const withItem = rows.filter((r) => !!r.item_id);

	// Résolution des objets en un seul `in` (les hash sont distincts et peu nombreux).
	const itemIds = [...new Set(withItem.map((r) => r.item_id as string))];
	const itemMap = new Map<string, ItemRow>();
	if (itemIds.length > 0) {
		const { data: itemData } = await supabase
			.from("inagle_items")
			.select("id,name_fr,name_en,category,rarity,internal_code,image_url")
			.in("id", itemIds);
		for (const it of (itemData ?? []) as ItemRow[]) {
			itemMap.set(it.id, it);
		}
	}

	// Somme des poids par groupe source (= dénominateur du pourcentage).
	const groupTotals = new Map<string, number>();
	for (const r of withItem) {
		const key = `${r.source}:${r.source_id ?? ""}`;
		groupTotals.set(key, (groupTotals.get(key) ?? 0) + (r.weight ?? 0));
	}

	return withItem.map((r): DropEntry => {
		const item = r.item_id ? itemMap.get(r.item_id) : undefined;
		const key = `${r.source}:${r.source_id ?? ""}`;
		const total = groupTotals.get(key) ?? 0;
		const weight = r.weight ?? 0;
		return {
			id: r.id,
			source: r.source as DropEntry["source"],
			sourceId: r.source_id ?? "",
			itemId: r.item_id ?? "",
			itemName: item?.name_fr || item?.name_en || r.item_id || "Inconnu",
			itemCategory: item?.category ?? null,
			itemRarity: item?.rarity ?? null,
			itemInternalCode: item?.internal_code ?? null,
			itemImageUrl: item?.image_url ?? null,
			weight,
			chance: total > 0 ? (weight / total) * 100 : 0,
		};
	});
}

/** Récupère les groupes d'esprit (paliers de rareté) + leurs combats associés. */
async function fetchSpiritGroups(): Promise<SpiritGroup[]> {
	const supabase = await createClient();

	const { data: rateData } = await supabase
		.from("inagle_drop_rates")
		.select("*")
		.eq("source", "spirit_drop");
	const rows = (rateData ?? []) as DropRateRow[];

	// Lien combat → table (item_table_id stocké en INTEGER, reconverti en hash).
	const { data: battleData } = await supabase.from("inagle_drops_battles").select("*");
	const battleByTable = new Map<string, number[]>();
	for (const b of (battleData ?? []) as Array<{
		battle_group_id: number;
		item_table_id: number;
	}>) {
		const hex = `0x${(b.item_table_id >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
		const list = battleByTable.get(hex) ?? [];
		list.push(b.battle_group_id);
		battleByTable.set(hex, list);
	}

	// Regroupement par source_id.
	const bySource = new Map<string, DropRateRow[]>();
	for (const r of rows) {
		const key = r.source_id ?? "";
		const list = bySource.get(key) ?? [];
		list.push(r);
		bySource.set(key, list);
	}

	const groups: SpiritGroup[] = [];
	for (const [sourceId, groupRows] of bySource) {
		// Pour spirit_drop, `weight` EST DÉJÀ un pourcentage absolu réel (0.05..83.8),
		// PAS un poids de loterie : on ne normalise donc PAS par la somme (contrairement
		// aux coffres). La somme des paliers peut être < 100 → le reste = chance de ne
		// rien obtenir (intentionnel). `anyChance` = total = proba d'obtenir un esprit.
		const total = groupRows.reduce((acc, r) => acc + (r.weight ?? 0), 0);
		const tiers = groupRows
			.map((r): SpiritTier => {
				const weight = r.weight ?? 0;
				return {
					id: r.id,
					rarity: r.rarity,
					dropRarity: r.drop_rarity,
					weight,
					chance: weight,
				};
			})
			.sort((a, b) => (a.rarity ?? 0) - (b.rarity ?? 0));
		groups.push({
			sourceId,
			tiers,
			anyChance: total,
			battleGroupIds: battleByTable.get(sourceId) ?? [],
		});
	}

	// Tri stable : groupes avec combats associés d'abord, puis par hash.
	groups.sort((a, b) => {
		const byBattle = b.battleGroupIds.length - a.battleGroupIds.length;
		if (byBattle !== 0) {
			return byBattle;
		}
		return a.sourceId.localeCompare(b.sourceId);
	});
	return groups;
}

/** Récupère les bonus « Fèves » d'équipe (mécanique distincte du drop d'objet). */
async function fetchTeamBeans(): Promise<TeamBean[]> {
	const supabase = await createClient();
	const { data } = await supabase.from("inagle_drops").select("*").order("id");
	const rows = (data ?? []) as BeanRow[];
	return rows.map(
		(r): TeamBean => ({
			id: r.id,
			team: r.team ?? "—",
			game: r.game ?? "—",
			fixedBeans: r.fixed_beans || null,
			passiveType: r.passive_type || null,
			no: r.no,
			requirement: r.requirement || null,
			stat: r.stat || null,
			value: r.value || null,
		})
	);
}

/** Charge l'intégralité des données de la page `/drops` (3 sous-jeux de données réels). */
export async function getDropsData(): Promise<DropsPageData> {
	const [drops, spiritGroups, beans] = await Promise.all([
		fetchConcreteDrops(),
		fetchSpiritGroups(),
		fetchTeamBeans(),
	]);

	// Tri des drops : par source puis taux décroissant.
	drops.sort((a, b) => {
		if (a.source !== b.source) {
			return a.source.localeCompare(b.source);
		}
		if (a.sourceId !== b.sourceId) {
			return a.sourceId.localeCompare(b.sourceId);
		}
		return b.chance - a.chance;
	});

	const categories = [...new Set(drops.map((d) => d.itemCategory).filter((c): c is string => !!c))].sort();
	const beanGames = [...new Set(beans.map((b) => b.game).filter((g) => g && g !== "—"))].sort();

	const dropSources = new Set(drops.map((d) => `${d.source}:${d.sourceId}`)).size;

	return {
		drops,
		spiritGroups,
		beans,
		counts: {
			concreteDrops: drops.length,
			dropSources,
			spiritGroups: spiritGroups.length,
			beans: beans.length,
		},
		categories,
		beanGames,
	};
}
