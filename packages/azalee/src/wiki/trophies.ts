/**
 * @file lib/wiki/trophies.ts
 * @description Accès data DÉDIÉ à la section « Succès » (`inagle_trophies`, 228 lignes).
 *
 * Vérité terrain (miroir SQLite, db-2026-06-05) : chaque ligne porte un `code`
 * (= `trophy_id`) et des colonnes plates `name_{en,fr,ja}` / `desc_{en,fr,ja}`.
 * Les noms FR sont remplis à 100 % ; les descriptions sont parfois vides côté
 * `activity_*` (objectifs de progression sans texte d'explication) — on n'invente
 * donc rien, on rend ce qui existe. La colonne JSON `data` ne contient que des
 * doublons des colonnes plates (`names`/`descriptions`).
 *
 * Fichier ISOLÉ — ne dépend PAS de `lib/wiki-service.ts`. Lit la DB via le client
 * Supabase-compatible (`@/lib/supabase/server`), comme `stadiums.ts`/`quests.ts`.
 */


import { createClient } from "../db/provider";
import {
	type Trophy,
	type TrophyCategory,
	groupLabel,
	trophyCategory,
	trophyGroup,
} from "./trophies-shared";

/** Ligne brute `inagle_trophies` telle que stockée dans le miroir. */
interface TrophyRow {
	trophy_id: string;
	code: string;
	name_en: string | null;
	name_fr: string | null;
	name_ja: string | null;
	desc_en: string | null;
	desc_fr: string | null;
	desc_ja: string | null;
}

const COLUMNS = "trophy_id, code, name_en, name_fr, name_ja, desc_en, desc_fr, desc_ja";

/** Nettoie une cellule texte (trim, null → ""). */
function clean(v: string | null | undefined): string {
	return (v ?? "").trim();
}

/** Convertit une ligne brute en `Trophy` normalisé (champs réels uniquement). */
function rowToTrophy(row: TrophyRow): Trophy {
	const code = row.code || row.trophy_id;
	const names = {
		fr: clean(row.name_fr),
		en: clean(row.name_en),
		ja: clean(row.name_ja),
	};
	const descriptions = {
		fr: clean(row.desc_fr),
		en: clean(row.desc_en),
		ja: clean(row.desc_ja),
	};
	const group = trophyGroup(code);
	return {
		id: code,
		code,
		category: trophyCategory(code),
		group,
		groupLabel: groupLabel(group),
		name: names.fr || names.en || names.ja || code,
		desc: descriptions.fr || descriptions.en || descriptions.ja || "",
		names,
		descriptions,
	};
}

/** Tri stable : catégorie (trophées d'abord), puis groupe, puis code. */
function byCategoryThenCode(a: Trophy, b: Trophy): number {
	if (a.category !== b.category) {
		return a.category === "trophy" ? -1 : 1;
	}
	if (a.group !== b.group) {
		return a.group.localeCompare(b.group);
	}
	return a.code.localeCompare(b.code);
}

let _cache: Trophy[] | null = null;

/** Charge et normalise tous les succès (228) depuis le miroir. Cache process-local. */
export async function getAllTrophies(): Promise<Trophy[]> {
	if (_cache) return _cache;
	const supabase = await createClient();
	const { data, error } = await supabase
		.from("inagle_trophies")
		.select(COLUMNS)
		.limit(2000);

	if (error || !data) {
		return [];
	}

	const trophies = (data as TrophyRow[]).map(rowToTrophy).sort(byCategoryThenCode);
	_cache = trophies;
	return trophies;
}

export interface TrophyListResult {
	trophies: Trophy[];
	total: number;
	counts: { all: number; trophy: number; activity: number };
}

/**
 * Liste filtrable (recherche plein-texte multilingue + filtre catégorie).
 * Filtrage en mémoire — 228 lignes, pas de pagination nécessaire.
 */
export async function getTrophiesList(params?: {
	q?: string;
	cat?: TrophyCategory | "all";
}): Promise<TrophyListResult> {
	const all = await getAllTrophies();
	const trophy = all.filter((x) => x.category === "trophy").length;
	const activity = all.length - trophy;

	let trophies = all;
	const cat = params?.cat ?? "all";
	if (cat === "trophy" || cat === "activity") {
		trophies = trophies.filter((x) => x.category === cat);
	}

	const q = params?.q?.trim().toLowerCase();
	if (q) {
		trophies = trophies.filter(
			(x) =>
				x.names.fr.toLowerCase().includes(q) ||
				x.names.en.toLowerCase().includes(q) ||
				x.names.ja.toLowerCase().includes(q) ||
				x.descriptions.fr.toLowerCase().includes(q) ||
				x.code.toLowerCase().includes(q)
		);
	}

	return {
		trophies,
		total: all.length,
		counts: { all: all.length, trophy, activity },
	};
}

/** Récupère un succès par `id` (= code), ou `null` si introuvable. */
export async function getTrophy(id: string): Promise<Trophy | null> {
	const all = await getAllTrophies();
	const norm = id.trim().toLowerCase();
	return all.find((x) => x.id.toLowerCase() === norm) ?? null;
}

/** Succès adjacents (précédent/suivant dans l'ordre de tri) pour la nav du détail. */
export async function getTrophyNeighbors(
	id: string
): Promise<{ prev: Trophy | null; next: Trophy | null }> {
	const all = await getAllTrophies();
	const idx = all.findIndex((x) => x.id.toLowerCase() === id.trim().toLowerCase());
	if (idx === -1) return { prev: null, next: null };
	return {
		prev: idx > 0 ? all[idx - 1] : null,
		next: idx < all.length - 1 ? all[idx + 1] : null,
	};
}
