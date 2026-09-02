/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Les entrées d'une table `Record<number, T>`, avec la clé en `string`.
 *
 * `Object.entries()` appliqué à un `Record<number, T>` ne se type pas correctement : la clé
 * ressort en `number` (alors qu'à l'exécution JavaScript rend TOUJOURS des clés `string`,
 * d'où les `Number.parseInt(entry[0], 10)` qui ne compilaient plus) et la valeur s'effondre
 * en `never`, ce qui faisait échouer tout accès à `v.en` / `v.fr` / `v.code`.
 *
 * Six recherches inversées « libellé → identifiant » portaient ce défaut, dans `basara/`,
 * `characters/` et `skills/`. Il ne se voyait pas tant que les consommateurs lisaient les
 * types CONSTRUITS de ce paquet (`dist/*.d.ts`) ; depuis qu'il expose ses sources
 * (`main: ./src/index.ts`, exigé par Bun qui lit le TypeScript sans build), `apps/azalee` et
 * `packages/mcp` les compilent et butent dessus.
 *
 * Le rendu à l'exécution est inchangé : cette fonction n'est qu'`Object.entries` correctement
 * décrit.
 */
export function entreesDe<T>(table: Record<number, T>): [string, T][] {
	return Object.entries(table) as [string, T][];
}
