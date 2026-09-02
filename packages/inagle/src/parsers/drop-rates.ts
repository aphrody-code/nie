/**
 * @file drop-rates.ts
 * @description Parseur unifié des TAUX de drop réels (poids de loterie) du dump
 * IEVR, depuis trois configs distincts dont AUCUN n'était matérialisé en DB :
 *
 *   1. `item/item_emission_rarity_table_config_*` — par ITEM × rareté d'émission
 *      (emitRarity 1..5) → `weight` (int). L'item est résolu en joignant
 *      `m_itemEmissionRarityTableConfigList[].tableInfo` ([offset,count]) dans
 *      `m_itemEmissionRarityTableConfigInfoList`.
 *   2. `soccer/soccer_drop_config_*` — tirage d'esprit/joueur par
 *      (dropRarity × rarity 1..5) → `weight` (FLOAT, 0.05..83.8), liste
 *      `m_spiritDropDataList`. (Les poids d'item `m_itemDropDataList` sont déjà
 *      couverts par `inagle_drops_tables` ; on ne les redouble pas ici.)
 *   3. `item/win_treasure_lot_table_config_*` — coffres de victoire : chaque
 *      coffre (`ITBL_BASE_n`) référence une tranche [offset,count] de feuilles
 *      `ITBL_ITEMS_n` = [itemId, 1, POIDS, 0, 0] via le nœud frère
 *      `ITBL_BASE_REF_ITEMS_n`. L'ancien `loadDropTablesFromConfig` cherchait
 *      `ITBL_INFO_*` (inexistant) → résultat vide ; on lit les vrais `ITBL_BASE_*`.
 *
 * Anti-hallucination : chaque ligne provient d'un octet réel du config. Aucune
 * dimension « élément-attribut » (feu/vent/bois…) n'existe dans ces octets — les
 * seules dimensions de taux sont item / rareté / coffre. Rien n'est fabriqué.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ConfigNode } from "../core/config-parser.js";
import { toHex } from "../core/data-loader.js";
import { DATA_ROOT } from "../core/paths.js";

export type DropRateSource = "item_emission" | "spirit_drop" | "win_treasure";

/** Une ligne de taux de drop unitaire (un poids = un octet réel du config). */
export interface DropRateRow {
	/**
	 * Clé primaire stable et déterministe = `<source>:<ordinal>` où ordinal est
	 * l'index positionnel de la ligne dans sa source (préserve chaque octet, y
	 * compris les couples (dropRarity,rarity) répétés du tirage d'esprit).
	 */
	id: string;
	/** Discriminant de source : item_emission | spirit_drop | win_treasure. */
	source: DropRateSource;
	/** Identifiant de la source/conteneur du tirage (table crc, coffre crc). */
	sourceId: string;
	/** Identifiant du droppable, si connu (item crc) ; null pour les tirages par rareté. */
	itemId: string | null;
	/** Rareté de l'item tiré (emitRarity / rarity 1..5), null si non applicable. */
	rarity: number | null;
	/** Palier de drop du conteneur (dropRarity : 0/10/20/21), null si non applicable. */
	dropRarity: number | null;
	/** Le TAUX réel (poids de loterie). int ou float selon la source. */
	weight: number;
}

interface ListConfig {
	version?: number;
	lists?: { name: string; typeName?: string; values: Record<string, unknown>[] }[];
}
interface TreeConfig {
	entries: ConfigNode[];
}

function gamedataPath(category: string, filename: string): string {
	return join(DATA_ROOT, "common", "gamedata", category, filename);
}

function readJson<T>(filePath: string): T | null {
	if (!existsSync(filePath)) {
		console.warn(`[DropRates] Config introuvable : ${filePath}`);
		return null;
	}
	try {
		return JSON.parse(readFileSync(filePath, "utf-8")) as T;
	} catch (e) {
		console.error(`[DropRates] Échec parse ${filePath}`, e);
		return null;
	}
}

/**
 * Source 1 — item_emission_rarity_table_config.
 * Joint l'item (m_...ConfigList) à ses entrées (m_...ConfigInfoList) via
 * tableInfo[offset,count]. Une ligne par couple (item, emitRarity).
 */
export function loadItemEmissionRates(
	filename = "item_emission_rarity_table_config_0.00.00.cfg.bin.json"
): DropRateRow[] {
	const cfg = readJson<ListConfig>(gamedataPath("item", filename));
	if (!cfg?.lists) return [];

	const info = cfg.lists.find((l) => l.name === "m_itemEmissionRarityTableConfigInfoList")?.values;
	const items = cfg.lists.find((l) => l.name === "m_itemEmissionRarityTableConfigList")?.values;
	if (!info || !items) return [];

	const rows: DropRateRow[] = [];
	let ord = 0;
	for (const it of items) {
		const itemId = String(it.itemId);
		const tableInfo = it.tableInfo as [number, number] | undefined;
		if (!Array.isArray(tableInfo)) continue;
		const [offset, count] = tableInfo;
		for (let i = offset; i < offset + count && i < info.length; i++) {
			const e = info[i];
			rows.push({
				id: `item_emission:${ord++}`,
				source: "item_emission",
				sourceId: String(e.tableId),
				itemId,
				rarity: Number(e.emitRarity),
				dropRarity: null,
				weight: Number(e.weight),
			});
		}
	}
	return rows;
}

/**
 * Source 2 — soccer_drop_config m_spiritDropDataList.
 * Une ligne par (dropRarity × rarity) → weight (float). sourceId = "spirit"
 * (l'aiguillage table→tranche est dans m_spiritDropTableList, hors-taux).
 */
export function loadSpiritDropRates(
	filename = "soccer_drop_config_5.00.27.00.cfg.bin.json"
): DropRateRow[] {
	const cfg = readJson<ListConfig>(gamedataPath("soccer", filename));
	if (!cfg?.lists) return [];

	const spirit = cfg.lists.find((l) => l.name === "m_spiritDropDataList")?.values;
	if (!spirit) return [];

	// Attribue chaque ligne de m_spiritDropDataList à sa table propriétaire
	// (m_spiritDropTableList.data = [offset,count]) : chaque ligne est référencée
	// EXACTEMENT une fois → sourceId = crc de la table d'esprit (vérifié réel).
	const ownerById = new Map<number, string>();
	const tables = cfg.lists.find((l) => l.name === "m_spiritDropTableList")?.values ?? [];
	for (const t of tables) {
		const data = t.data as [number, number] | undefined;
		if (!Array.isArray(data)) continue;
		const [offset, count] = data;
		for (let j = offset; j < offset + count; j++) ownerById.set(j, String(t.id));
	}

	// dropRarity (0/10/20/21) et rarity (1..5) sont les DEUX dimensions du taux.
	return spirit.map((s, idx) => ({
		id: `spirit_drop:${idx}`,
		source: "spirit_drop" as const,
		sourceId: ownerById.get(idx) ?? "spirit:unbound",
		itemId: null,
		rarity: Number(s.rarity),
		dropRarity: Number(s.dropRarity),
		weight: Number(s.weight),
	}));
}

/**
 * Source 3 — win_treasure_lot_table_config (format arbre).
 * Aplati la liste ITBL_ITEMS_* (feuilles = [itemId, 1, POIDS, 0, 0]), puis
 * tranche par coffre via ITBL_BASE_n + son frère ITBL_BASE_REF_ITEMS_n [off,count].
 * itemId encodé en Int signé → toHex le repasse en crc unsigned 32-bit.
 */
export function loadWinTreasureRates(
	filename = "win_treasure_lot_table_config_0.00.00.cfg.bin.json"
): DropRateRow[] {
	const cfg = readJson<TreeConfig>(gamedataPath("item", filename));
	if (!cfg?.entries) return [];

	const flat: { itemId: string; weight: number }[] = [];
	const baseRoot: ConfigNode[] = [];

	for (const root of cfg.entries) {
		if (root.name.startsWith("ITBL_ITEMS_LIST_BEG")) {
			for (const leaf of root.children ?? []) {
				if (leaf.name.startsWith("ITBL_ITEMS_") && !leaf.name.includes("LIST")) {
					const v = leaf.variables;
					if (v.length >= 3) {
						flat.push({
							itemId: toHex(parseInt(v[0].value, 10)),
							weight: parseInt(v[2].value, 10),
						});
					}
				}
			}
		} else if (root.name.startsWith("ITBL_BASE_LIST_BEG")) {
			baseRoot.push(...(root.children ?? []));
		}
	}

	const rows: DropRateRow[] = [];
	let ord = 0;
	for (let i = 0; i < baseRoot.length; i++) {
		const node = baseRoot[i];
		if (
			node.name.startsWith("ITBL_BASE_") &&
			!node.name.includes("REF") &&
			!node.name.includes("LIST")
		) {
			const ref = baseRoot[i + 1];
			if (!ref || !ref.name.startsWith("ITBL_BASE_REF_ITEMS_")) continue;
			const coffreId = toHex(parseInt(node.variables[0].value, 10));
			const offset = parseInt(ref.variables[0].value, 10);
			const count = parseInt(ref.variables[1].value, 10);
			for (let j = offset; j < offset + count && j < flat.length; j++) {
				rows.push({
					id: `win_treasure:${ord++}`,
					source: "win_treasure",
					sourceId: coffreId,
					itemId: flat[j].itemId,
					rarity: null,
					dropRarity: null,
					weight: flat[j].weight,
				});
			}
		}
	}
	return rows;
}

/** Charge et concatène les trois sources de taux de drop réelles. */
export function loadAllDropRates(): DropRateRow[] {
	return [
		...loadItemEmissionRates(),
		...loadSpiritDropRates(),
		...loadWinTreasureRates(),
	];
}
