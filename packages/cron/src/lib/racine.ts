/**
 * Racine du dépôt, résolue à l'exécution — jamais un chemin de machine en dur.
 *
 * Le démon de cron a longtemps porté `/home/ubuntu/rg` dans cinq fichiers. Le code tourne
 * désormais depuis ce dépôt : ces chemins
 * pointaient alors sur l'autre dépôt, silencieusement, et cinq tâches travaillaient
 * sur les mauvais fichiers sans qu'aucune n'échoue.
 *
 * On remonte les ancêtres jusqu'au dossier qui porte **`Cargo.toml` ET `crates/`** —
 * the same signature used by the Rust workspace, so a same-named `packages/` directory
 * encountered on the way is never mistaken for the repository root.
 */
import { existsSync } from "node:fs";
import path from "node:path";

let cache: string | null = null;

export function racineDepot(): string {
	if (cache) return cache;
	let courant = import.meta.dir;
	for (;;) {
		if (existsSync(path.join(courant, "Cargo.toml")) && existsSync(path.join(courant, "crates"))) {
			cache = courant;
			return courant;
		}
		const parent = path.dirname(courant);
		if (parent === courant) break;
		courant = parent;
	}
	// Repli : la racine du monorepo Bun, deux niveaux au-dessus de `packages/cron/src/lib`.
	cache = path.resolve(import.meta.dir, "../../../..");
	return cache;
}

/** Un chemin du dépôt, depuis sa racine. */
export function dansLeDepot(...segments: string[]): string {
	return path.join(racineDepot(), ...segments);
}

/**
 * Racine d'un monorepo éditorial externe, quand une tâche vise une surface qui reste
 * hors de ce dépôt : le site vitrine `apps/website` et le bot communautaire `apps/bot`.
 *
 * Le démon de cron est un **singleton** : il n'y en a qu'un pour les deux dépôts, et il
 * tourne depuis celui-ci. Ces deux tâches doivent donc pouvoir désigner l'autre — par
 * `RG_MONOREPO`, ou par le chemin habituel s'il existe. Quand rien ne répond, la
 * fonction rend `null` et la tâche **le dit** au lieu d'écrire à côté : une tâche qui
 * réussit en n'ayant rien fait est le pire des résultats.
 */
export function depotRoseGriffon(): string | null {
	const candidats = [Bun.env.RG_MONOREPO, "/home/ubuntu/rg"].filter(Boolean) as string[];
	for (const c of candidats) if (existsSync(path.join(c, "package.json"))) return c;
	return null;
}
