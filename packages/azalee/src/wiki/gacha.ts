/**
 * @file lib/wiki/gacha.ts
 * @description Accès data dédié à la section « Capsules / Gacha + Costumes ».
 *
 * Lit directement le miroir SQLite via le client data partagé d'azalee
 * (`@/lib/supabase/server` → `createSqliteClient`, qui route toute table
 * `inagle_*` vers le miroir embarqué). NE touche PAS `lib/wiki-service.ts`.
 *
 * Tables sources (schéma RÉEL vérifié sur le miroir, rien d'inventé) :
 *
 *  inagle_capsules (740) — entrées CPSL_PRIZE_INFO du config gacha :
 *    - id          TEXT  : hash du lot (= vars[0])
 *    - prize_data  TEXT  : JSON `number[]` de 6 entiers signés int32
 *                          [ id, contentRef, 0, poolRef, poolRef, extraFlag ]
 *    - data        TEXT  : JSON `{ id, vars }` (redondant avec prize_data)
 *
 *  inagle_costumes (576) — entrées CHARA_COSTUME_MODEL :
 *    - id            TEXT     : "costume_<index>"
 *    - costume_index INTEGER  : index 0..575
 *    - type          INTEGER  : 0 | 1 | 2
 *    - model_ref     TEXT     : hash CRC du modèle 3D (ex "0x23337402")
 *    - flag1         INTEGER  : drapeau signé int32 (0 le plus souvent)
 *    - flag2         INTEGER  : drapeau signé int32
 *    - data          TEXT     : JSON redondant
 *
 * IMPORTANT (anti-hallucination) : les refs `contentRef` (vars[1]) ne résolvent
 * vers AUCUNE table extraite (characters/items/emblems/…), et les `model_ref`
 * costumes sont des hashs de modèles 3D, pas des chemins d'image. On expose donc
 * ces valeurs telles quelles (en hexadécimal), sans leur inventer de nom.
 */


import { createClient } from "../db/provider";
import {
	type CapsuleListResult,
	type CapsulePool,
	type CapsulePrize,
	type Costume,
	type CostumeListResult,
	costumeTypeLabel,
	type GachaCounts,
	toHexU32,
} from "./gacha-shared";

// Ré-export des types + helpers purs depuis le module client-safe (compat imports existants).
export {
	type CapsuleListResult,
	type CapsulePool,
	type CapsulePrize,
	COSTUME_TYPE_LABELS,
	type Costume,
	type CostumeListResult,
	costumeTypeLabel,
	type GachaCounts,
	toHexU32,
} from "./gacha-shared";

// ============================================================================
// Helpers
// ============================================================================

function parseVars(raw: unknown): number[] {
	if (Array.isArray(raw)) return raw.filter((v): v is number => typeof v === "number");
	if (typeof raw === "string") {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) {
				return parsed.filter((v): v is number => typeof v === "number");
			}
		} catch {
			/* ignore */
		}
	}
	return [];
}

// ============================================================================
// Capsules / Gacha
// ============================================================================

interface CapsuleListParams {
	page?: number;
	limit?: number;
	/** Recherche sur l'id (hash) du lot. */
	q?: string;
	/** Filtre sur un poolRef précis. */
	pool?: string;
}

type CapsuleRow = {
	id: string;
	prize_data: string | number[] | null;
};

function mapCapsuleRow(row: CapsuleRow): CapsulePrize {
	const vars = parseVars(row.prize_data);
	const contentRef = vars.length > 1 ? toHexU32(vars[1]) : "0x00000000";
	const poolRef = vars.length > 3 ? toHexU32(vars[3]) : "0x00000000";
	const extraFlag = vars.length > 5 ? vars[5] : 0;
	return { id: row.id, contentRef, poolRef, extraFlag, vars };
}

/**
 * Liste paginée des lots de capsules, avec recherche par hash et filtre par pool.
 * Le filtre/pagination sur `pool` se fait en mémoire (le poolRef vit dans le JSON
 * `prize_data`, non indexé en colonne) : on charge l'ensemble (740 lignes, léger).
 */
export async function getCapsuleList(params: CapsuleListParams = {}): Promise<CapsuleListResult> {
	const page = Math.max(1, params.page ?? 1);
	const limit = Math.min(200, Math.max(1, params.limit ?? 48));
	const q = (params.q ?? "").trim().toLowerCase();
	const pool = (params.pool ?? "").trim();

	const supabase = await createClient();
	const { data: rows, error } = await supabase
		.from("inagle_capsules")
		.select("id, prize_data");

	if (error || !rows) {
		return { data: [], total: 0, page, limit, pools: [] };
	}

	const all = (rows as CapsuleRow[]).map(mapCapsuleRow);

	// Recensement des pools (avant filtrage) pour la barre de filtre.
	const poolCounts = new Map<string, number>();
	for (const prize of all) {
		poolCounts.set(prize.poolRef, (poolCounts.get(prize.poolRef) ?? 0) + 1);
	}
	const pools: CapsulePool[] = Array.from(poolCounts.entries())
		.map(([ref, count]) => ({ ref, count }))
		.sort((a, b) => b.count - a.count);

	let filtered = all;
	if (pool) filtered = filtered.filter((p) => p.poolRef === pool);
	if (q) {
		filtered = filtered.filter(
			(p) => p.id.toLowerCase().includes(q) || p.contentRef.toLowerCase().includes(q)
		);
	}

	const total = filtered.length;
	const start = (page - 1) * limit;
	const paged = filtered.slice(start, start + limit);

	return { data: paged, total, page, limit, pools };
}

/** Détail d'un lot par hash. Retourne `null` si introuvable. */
export async function getCapsulePrize(id: string): Promise<CapsulePrize | null> {
	const supabase = await createClient();
	const { data: row, error } = await supabase
		.from("inagle_capsules")
		.select("id, prize_data")
		.eq("id", id)
		.single();

	if (error || !row) return null;
	return mapCapsuleRow(row as CapsuleRow);
}

/**
 * Tous les lots d'un même pool (pour afficher la composition d'un pool en détail).
 */
export async function getCapsulePoolPrizes(poolRef: string): Promise<CapsulePrize[]> {
	const supabase = await createClient();
	const { data: rows, error } = await supabase
		.from("inagle_capsules")
		.select("id, prize_data");

	if (error || !rows) return [];
	return (rows as CapsuleRow[]).map(mapCapsuleRow).filter((p) => p.poolRef === poolRef);
}

// ============================================================================
// Costumes
// ============================================================================

interface CostumeListParams {
	page?: number;
	limit?: number;
	/** Recherche sur l'index ou le hash du modèle. */
	q?: string;
	/** Filtre sur un type (0/1/2). */
	type?: number;
}

type CostumeRow = {
	id: string;
	costume_index: number;
	type: number;
	model_ref: string;
	flag1: number;
	flag2: number;
};

function mapCostumeRow(row: CostumeRow): Costume {
	return {
		id: row.id,
		index: row.costume_index,
		type: row.type,
		typeLabel: costumeTypeLabel(row.type),
		modelRef: row.model_ref,
		flag1: row.flag1,
		flag2: row.flag2,
	};
}

/** Liste paginée des costumes, avec recherche et filtre par type. */
export async function getCostumeList(params: CostumeListParams = {}): Promise<CostumeListResult> {
	const page = Math.max(1, params.page ?? 1);
	const limit = Math.min(200, Math.max(1, params.limit ?? 48));
	const q = (params.q ?? "").trim().toLowerCase();
	const typeFilter = params.type;

	const supabase = await createClient();
	const { data: rows, error } = await supabase
		.from("inagle_costumes")
		.select("id, costume_index, type, model_ref, flag1, flag2");

	if (error || !rows) {
		return { data: [], total: 0, page, limit, types: [] };
	}

	const all = (rows as CostumeRow[]).map(mapCostumeRow).sort((a, b) => a.index - b.index);

	// Recensement des types (avant filtrage).
	const typeCounts = new Map<number, number>();
	for (const c of all) typeCounts.set(c.type, (typeCounts.get(c.type) ?? 0) + 1);
	const types = Array.from(typeCounts.entries())
		.map(([type, count]) => ({ type, label: costumeTypeLabel(type), count }))
		.sort((a, b) => a.type - b.type);

	let filtered = all;
	if (typeof typeFilter === "number" && Number.isFinite(typeFilter)) {
		filtered = filtered.filter((c) => c.type === typeFilter);
	}
	if (q) {
		filtered = filtered.filter(
			(c) => String(c.index).includes(q) || c.modelRef.toLowerCase().includes(q)
		);
	}

	const total = filtered.length;
	const start = (page - 1) * limit;
	const paged = filtered.slice(start, start + limit);

	return { data: paged, total, page, limit, types };
}

// ============================================================================
// Compteurs (pour l'en-tête / les onglets)
// ============================================================================

export async function getGachaCounts(): Promise<GachaCounts> {
	const supabase = await createClient();
	const [{ count: capsules }, { count: costumes }] = await Promise.all([
		supabase.from("inagle_capsules").select("id", { count: "exact" }),
		supabase.from("inagle_costumes").select("id", { count: "exact" }),
	]);
	return { capsules: capsules ?? 0, costumes: costumes ?? 0 };
}
