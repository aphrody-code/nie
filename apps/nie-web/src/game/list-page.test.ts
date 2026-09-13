/**
 * La pagination d'hôte partagée par les trois écrans.
 *
 * Ces cas vivaient dans `roster.test.ts`, sur une copie privée de `listPage`/`stepCursor` que
 * `roster.ts` portait en double. La copie est partie le 2026-09-13 ; les tests la suivent ici
 * plutôt que de disparaître avec elle — ils étaient la SEULE couverture de ces fonctions, qui
 * n'en avaient aucune sous leur propre nom.
 *
 * ⚠ Ce que ces tests ne prouvent PAS : que le jeu se comporte ainsi. Le binaire fait autre
 * chose (`nie_core::list_view`, prouvé byte-exact contre `dist/nie.exe`) — la vue y défile d'une
 * ligne et garde tête, ancre et sélection séparées. Ce module est une pagination d'HÔTE assumée ;
 * ces tests en fixent le comportement, pas celui du jeu.
 */
import { describe, expect, test } from "bun:test";

import { fold, listPage, stepCursor } from "./list-page";

const ITEMS = ["a", "b", "c", "d"];

describe("listPage", () => {
	test("la page est celle qui contient le curseur", () => {
		expect(listPage(ITEMS, 0, 2)).toMatchObject({ index: 0, count: 2, cursor: 0, cursorInPage: 0 });
		expect(listPage(ITEMS, 3, 2)).toMatchObject({ index: 1, count: 2, cursor: 3, cursorInPage: 1 });
		expect(listPage(ITEMS, 3, 2).items).toEqual(["c", "d"]);
	});

	test("un curseur hors bornes est ramené, jamais bouclé", () => {
		expect(listPage(ITEMS, 99, 2).cursor).toBe(3);
		expect(listPage(ITEMS, -5, 2).cursor).toBe(0);
	});

	test("une liste vide garde une page et n'a pas de curseur", () => {
		expect(listPage([], 0, 24)).toEqual({ index: 0, count: 1, cursor: -1, cursorInPage: -1, items: [] });
	});

	test("une taille de page nulle échoue au lieu de diviser par zéro", () => {
		expect(() => listPage(ITEMS, 0, 0)).toThrow();
	});
});

describe("stepCursor", () => {
	test("les trois pas et l'arrêt aux deux bouts", () => {
		expect(stepCursor(0, 100, "item", 1, 6, 24)).toBe(1);
		expect(stepCursor(0, 100, "row", 1, 6, 24)).toBe(6);
		expect(stepCursor(0, 100, "page", 1, 6, 24)).toBe(24);
		expect(stepCursor(0, 100, "item", -1, 6, 24)).toBe(0);
		expect(stepCursor(99, 100, "page", 1, 6, 24)).toBe(99);
		expect(stepCursor(0, 0, "item", 1, 6, 24)).toBe(-1);
	});
});

describe("fold", () => {
	test("accents et casse disparaissent, les espaces de bord aussi", () => {
		expect(fold("  Élément  ")).toBe("element");
		expect(fold("Ōkami")).toBe("okami");
	});
});
