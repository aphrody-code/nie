/**
 * Le gisement **extrait** : les 68 tables `inagle_*` tirées des fichiers du jeu.
 *
 * Lecture seule, sur le miroir SQLite republié par `nie-miroir`. Le miroir n'est jamais
 * ouvert en écriture — c'est un artefact, pas une base de travail : la vérité est dans les
 * `.cfg.bin` du jeu, et le miroir n'en est qu'une projection interrogeable.
 *
 * Une seule connexion par processus, ouverte paresseusement : la base pèse ~100 Mo et
 * l'ouvrir au chargement du module ferait payer ce coût à tout ce qui importe la façade.
 */
import { Database } from "bun:sqlite";
import { sources } from "./sources.ts";

let base: Database | null | undefined;

/** La connexion au miroir, ou `null` s'il n'est pas publié sur cette machine. */
export function baseExtrait(): Database | null {
	if (base !== undefined) {
		return base;
	}
	const chemin = sources().extrait.emplacement;
	if (!chemin) {
		base = null;
		return base;
	}
	try {
		base = new Database(chemin, { readonly: true, strict: true });
	} catch {
		base = null;
	}
	return base;
}

/** Ferme la connexion (tests, ou après une bascule du miroir). */
export function fermerExtrait(): void {
	base?.close();
	base = undefined;
}

/** Interroge le miroir. Rend `[]` — jamais une exception — quand le miroir est absent. */
export function requete<T = Record<string, unknown>>(
	sql: string,
	params: readonly unknown[] = [],
): T[] {
	const db = baseExtrait();
	if (!db) {
		return [];
	}
	try {
		return db.query(sql).all(...(params as never[])) as T[];
	} catch {
		return [];
	}
}

/** Première ligne, ou `null`. */
export function ligne<T = Record<string, unknown>>(
	sql: string,
	params: readonly unknown[] = [],
): T | null {
	return requete<T>(sql, params)[0] ?? null;
}

/** Les tables `inagle_*` réellement présentes, avec leur nombre de lignes. */
export function tables(): { nom: string; lignes: number }[] {
	const db = baseExtrait();
	if (!db) {
		return [];
	}
	const noms = requete<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'inagle\\_%' ESCAPE '\\' ORDER BY name",
	);
	return noms.map((t) => ({
		lignes: (ligne<{ n: number }>(`SELECT count(*) AS n FROM "${t.name}"`)?.n ?? 0) as number,
		nom: t.name,
	}));
}

/** Un personnage tel que le jeu le décrit. Les colonnes absentes du miroir restent `null`. */
export interface Personnage {
	id: string;
	slug: string | null;
	internal_code: string | null;
	name_fr: string | null;
	name_en: string | null;
	name_ja: string | null;
	element: string | null;
	position: string | null;
	model_id: string | null;
	rarity_label: string | null;
	image_url: string | null;
}

const CHAMPS_PERSONNAGE =
	"id, slug, internal_code, name_fr, name_en, name_ja, element, position, model_id, rarity_label, image_url";

/** Un personnage par slug — l'identifiant stable des URL du wiki. */
export function personnage(slug: string): Personnage | null {
	return ligne<Personnage>(
		`SELECT ${CHAMPS_PERSONNAGE} FROM inagle_characters WHERE slug = ? LIMIT 1`,
		[slug],
	);
}

/**
 * Recherche par nom, dans les trois langues **et** par code interne.
 *
 * `LIKE` sans `%` en tête d'abord (préfixe, indexable), puis en contient : sans cet ordre,
 * chercher « mark » remonterait d'abord les homonymes du milieu de chaîne.
 */
export function chercherPersonnages(requeteTexte: string, limite = 20): Personnage[] {
	const q = requeteTexte.trim();
	if (!q) {
		return [];
	}
	return requete<Personnage>(
		`SELECT ${CHAMPS_PERSONNAGE} FROM inagle_characters
		 WHERE name_fr LIKE ?1 OR name_en LIKE ?1 OR name_ja LIKE ?1
		    OR slug LIKE ?1 OR internal_code LIKE ?1
		 ORDER BY (name_fr LIKE ?2) DESC, name_fr
		 LIMIT ?3`,
		[`%${q}%`, `${q}%`, limite],
	);
}

/** Une technique (`inagle_skills`). */
export interface Technique {
	id: string;
	internal_code: string | null;
	name_fr: string | null;
	name_en: string | null;
	element: string | null;
	category: string | null;
	power_max: number | null;
	has_telop: number | null;
	video_url: string | null;
}

/** Une technique par identifiant ou par code interne. */
export function technique(id: string): Technique | null {
	return ligne<Technique>(
		`SELECT id, internal_code, name_fr, name_en, element, category, power_max, has_telop, video_url
		 FROM inagle_skills WHERE id = ?1 OR internal_code = ?1 LIMIT 1`,
		[id],
	);
}

/**
 * L'index des fichiers du jeu tel que la base le connaît (`inagle_game_assets`, 40 471 lignes).
 *
 * C'est le seul pont existant entre un chemin VFS et la base : il porte `cpk`, `sha256` et
 * `size`, donc il dit dans quel paquet vit un fichier sans ouvrir le VFS.
 */
export interface AssetJeu {
	path: string;
	cpk: string | null;
	kind: string | null;
	sha256: string | null;
	size: number | null;
}

/** Les fichiers du jeu dont le chemin contient `fragment`. */
export function assets(fragment: string, limite = 50): AssetJeu[] {
	return requete<AssetJeu>(
		"SELECT path, cpk, kind, sha256, size FROM inagle_game_assets WHERE path LIKE ? ORDER BY path LIMIT ?",
		[`%${fragment}%`, limite],
	);
}
