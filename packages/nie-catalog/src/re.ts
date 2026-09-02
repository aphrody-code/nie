/**
 * Le gisement **reverse** : ce que le dépôt sait de `nie.exe` (`var/niers.sqlite`).
 *
 * Deux `binary_id` coexistent dans cette base : `1` est un index Ghidra désaligné et figé,
 * `2` est `#pdata` — la vérité terrain. On cite le **2** ; le `1` n'est jamais interrogé par
 * défaut, sinon on rapporterait des adresses qui ne correspondent à aucun octet du binaire servi.
 */
import { Database } from "bun:sqlite";
import { sources } from "./sources.ts";

/** L'index de référence : `#pdata`, borné par les entrées `.pdata` du binaire. */
export const BINAIRE_REFERENCE = 2;

let base: Database | null | undefined;

/** La connexion à la base de connaissance, ou `null` si elle n'est pas là. */
export function baseRe(): Database | null {
	if (base !== undefined) {
		return base;
	}
	const chemin = sources().re.emplacement;
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

/** Ferme la connexion (tests). */
export function fermerRe(): void {
	base?.close();
	base = undefined;
}

function requete<T>(sql: string, params: readonly unknown[] = []): T[] {
	const db = baseRe();
	if (!db) {
		return [];
	}
	try {
		return db.query(sql).all(...(params as never[])) as T[];
	} catch {
		return [];
	}
}

/** Une fonction du binaire. */
export interface Fonction {
	vaddr: number;
	size: number | null;
	name: string | null;
	subsystem: string | null;
	n_calls_in: number | null;
	n_calls_out: number | null;
}

/** Les fonctions dont le nom contient `fragment`, les plus appelées d'abord. */
export function fonctions(fragment: string, limite = 25): Fonction[] {
	return requete<Fonction>(
		`SELECT vaddr, size, name, subsystem, n_calls_in, n_calls_out
		 FROM function WHERE binary_id = ? AND name LIKE ?
		 ORDER BY n_calls_in DESC NULLS LAST LIMIT ?`,
		[BINAIRE_REFERENCE, `%${fragment}%`, limite],
	);
}

/** La fonction qui contient l'adresse virtuelle donnée, si le découpage la connaît. */
export function fonctionA(vaddr: number): Fonction | null {
	return (
		requete<Fonction>(
			`SELECT vaddr, size, name, subsystem, n_calls_in, n_calls_out
			 FROM function WHERE binary_id = ? AND vaddr <= ? AND vaddr + COALESCE(size, 0) > ?
			 LIMIT 1`,
			[BINAIRE_REFERENCE, vaddr, vaddr],
		)[0] ?? null
	);
}

/**
 * Les fonctions qui référencent une chaîne donnée.
 *
 * C'est le pont le plus court entre une donnée du jeu et son code : un nom de fichier, un
 * libellé de menu ou un identifiant d'événement apparaît tel quel dans `.rdata`, et
 * `func_str_ref` dit qui le lit.
 */
export function fonctionsCitant(chaine: string, limite = 15): Fonction[] {
	return requete<Fonction>(
		`SELECT f.vaddr, f.size, f.name, f.subsystem, f.n_calls_in, f.n_calls_out
		 FROM func_str_ref r JOIN function f ON f.id = r.function_id
		 WHERE r.binary_id = ? AND r.value LIKE ?
		 ORDER BY f.n_calls_in DESC NULLS LAST LIMIT ?`,
		[BINAIRE_REFERENCE, `%${chaine}%`, limite],
	);
}

/** Une classe RTTI et sa vtable. */
export interface Classe {
	name: string;
	namespace: string | null;
	vtable_vaddr: number | null;
}

/** Les classes RTTI dont le nom contient `fragment`. */
export function classes(fragment: string, limite = 25): Classe[] {
	return requete<Classe>(
		`SELECT name, namespace, vtable_vaddr FROM rtti_class
		 WHERE binary_id = ? AND name LIKE ? ORDER BY name LIMIT ?`,
		[BINAIRE_REFERENCE, `%${fragment}%`, limite],
	);
}

/** L'état de la couverture, tel que la dernière mesure l'a inscrit. */
export interface Couverture {
	total_funcs: number;
	named: number;
	classified: number;
	pct: number;
	ts: string | null;
}

/** La mesure de couverture la plus récente pour le binaire de référence. */
export function couverture(): Couverture | null {
	return (
		requete<Couverture>(
			"SELECT total_funcs, named, classified, pct, ts FROM coverage WHERE binary_id = ? ORDER BY ts DESC LIMIT 1",
			[BINAIRE_REFERENCE],
		)[0] ?? null
	);
}
