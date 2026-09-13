/**
 * La pagination d'une liste du menu, en fonctions pures.
 *
 * ## Pourquoi ce module
 *
 * `game/roster.ts` porte la même mécanique pour la grille de la banque, mais typée sur ses
 * personnages. La Galerie et la Boutique manipulent des succès, des films, des musiques et des
 * articles : la découpe est la même, la donnée ne l'est pas. Elle est donc extraite ici, sur un
 * type libre, plutôt que recopiée dans chaque écran — une seconde implémentation de la même
 * règle finirait par diverger sur le cas limite (liste vide, curseur hors bornes).
 *
 * ## ⚠ La règle reproduite ici n'est PAS celle du jeu, en partie
 *
 * Ce module affirmait « le curseur ne défile pas d'une ligne, il change de page dès qu'il sort
 * de la page courante, et il ne boucle pas ». Le binaire a été lu le 2026-09-13
 * (`lives::CMenuListView`, créneau 59 de la vtable, `0x140542B80` dans `dist/nie.exe`) :
 *
 * - « il ne boucle pas » est **confirmé** — les deux branches retournent sans rien changer
 *   quand la liste est déjà en butée ;
 * - « il ne défile pas d'une ligne » est **contredit** — ce chemin déplace la ligne de tête
 *   (`[this+0x12C]`) de exactement ±1, puis borne au dernier écran.
 *
 * Le pas par page existe bel et bien, mais ailleurs : créneau 58, `0x140542840`, qui déplace la
 * vue de l'étendue visible (`[this+0xC0]`/`[this+0xC4]`). Les deux pas coexistent donc.
 *
 * ## L'écart est un MODÈLE, pas une constante
 *
 * Le moteur garde trois champs INDÉPENDANTS : la ligne de tête `[this+0x12C]`, l'index
 * sélectionné `[this+0x138]`, et `[this+0x134]` maintenu à un delta CONSTANT de la tête.
 * `listPage` dérive tout du curseur par `floor(cursor / pageSize)` — or une page dérivée ne peut
 * pas représenter une vue qui défile d'une ligne pendant que la sélection ne bouge pas.
 *
 * Donc : ne pas porter ce module en Rust tel quel. Ce n'est pas une constante à corriger, c'est
 * une structure d'état à reprendre. En attendant, `listPage` reste une pagination d'HÔTE
 * assumée, correcte pour l'usage qu'en font les écrans, et qui ne prétend plus reproduire le
 * jeu. Désassemblage, bornes des fragments et disposition des champs dans `PLAN.md`.
 */

/** Une page de liste : son rang, son contenu, et le curseur ramené dans les bornes. */
export interface ListPage<T> {
	/** Index de la page affichée, à partir de 0. */
	index: number;
	/** Nombre total de pages ; `1` même quand la liste est vide (le jeu montre la liste vide). */
	count: number;
	/** Le curseur dans la liste complète, `-1` quand elle est vide. */
	cursor: number;
	/** Le curseur dans la page, `-1` quand la liste est vide. */
	cursorInPage: number;
	items: readonly T[];
}

/** La page qui contient le curseur, comme la liste du jeu. */
export function listPage<T>(items: readonly T[], cursor: number, pageSize: number): ListPage<T> {
	if (!(pageSize > 0)) throw new Error("listPage: pageSize must be positive");
	const count = Math.max(1, Math.ceil(items.length / pageSize));
	if (items.length === 0) return { index: 0, count, cursor: -1, cursorInPage: -1, items: [] };
	const clamped = Math.min(Math.max(cursor, 0), items.length - 1);
	const index = Math.floor(clamped / pageSize);
	return {
		index,
		count,
		cursor: clamped,
		cursorInPage: clamped - index * pageSize,
		items: items.slice(index * pageSize, index * pageSize + pageSize),
	};
}

/**
 * Le curseur après un déplacement.
 *
 * `item` est le pas des flèches, `row` celui d'une rangée de `columns` éléments, `page` celui
 * des onglets `W`/`C` du jeu. Le curseur s'arrête au premier et au dernier élément.
 */
export function stepCursor(
	cursor: number,
	total: number,
	step: "item" | "row" | "page",
	direction: 1 | -1,
	columns: number,
	pageSize: number,
): number {
	if (total <= 0) return -1;
	const delta = step === "item" ? 1 : step === "row" ? columns : pageSize;
	return Math.min(Math.max(cursor + delta * direction, 0), total - 1);
}

/** Minuscule sans accent — la forme comparée par les recherches par nom des écrans. */
export function fold(value: string): string {
	return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}
