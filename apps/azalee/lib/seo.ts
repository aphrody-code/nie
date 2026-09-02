/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Fabrique d'URL canoniques pour les listes filtrables (`/chara`, `/skill`,
 * `/aura/<categorie>`…).
 *
 * Deux défauts constatés sur les canoniques construits à la main :
 *
 * 1. `` `/chara${rawParams ? `?${…}` : ""}` `` — `rawParams` est le résultat
 *    de `await searchParams`, donc **toujours** un objet, donc toujours vrai :
 *    la page nue déclarait `…/chara?` (constaté en production), une URL qui
 *    n'est pas celle servie. Ici, le `?` n'apparaît que s'il reste au moins un
 *    paramètre.
 * 2. Recopier tout `searchParams` fait entrer les paramètres de campagne
 *    (`utm_*`, `gclid`, `fbclid`…) dans le canonique : chaque lien tracké
 *    devient sa propre page canonique, ce qui annule la déduplication. Ici,
 *    seules les clés explicitement autorisées passent.
 *
 * Les valeurs multiples (`?element=feu&element=vent`) sont sérialisées une clé
 * par occurrence, comme le fait le routeur, et les clés sont triées pour que
 * deux URLs équivalentes produisent un canonique identique.
 */
export function buildCanonical(
	path: string,
	params: Record<string, string | string[] | undefined>,
	allowedKeys: readonly string[]
): string {
	const query = new URLSearchParams();
	for (const key of [...allowedKeys].sort()) {
		const value = params[key];
		if (value === undefined) {
			continue;
		}
		for (const one of Array.isArray(value) ? value : [value]) {
			if (one !== "") {
				query.append(key, one);
			}
		}
	}
	const qs = query.toString();
	return qs ? `${path}?${qs}` : path;
}

/**
 * Clés de filtre communes aux listes du wiki (sous-ensemble de
 * `searchParamsSchema` : uniquement celles qui changent réellement le contenu
 * listé, `view`/`tab` étant de la préférence d'affichage).
 *
 * Trois clés ont été retirées de cette liste :
 *
 * - `sort` et `perPage` ne changent pas le CONTENU, seulement son ordre ou son
 *   découpage. Les y laisser faisait de `?sort=name` et `?sort=power` deux pages
 *   canoniques distinctes pour exactement les mêmes lignes.
 * - `q` est une recherche interne : chaque requête tapée devenait une page
 *   canonique de plus, sur un espace non borné. Une page de résultats se
 *   rattache à sa liste.
 *
 * `page` reste : les pages d'une série paginée sont bien des documents
 * différents, chacun canonique de lui-même.
 */
export const LIST_CANONICAL_KEYS = [
	"category",
	"element",
	"gender",
	"grade",
	"page",
	"position",
	"rarity",
	"role",
	"series",
	"type",
] as const;
