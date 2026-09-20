import { describe, expect, test } from "bun:test";
import { WIKI_FAMILIES, wikiFamilyFor, wikiFamilyFromUrl, wikiHrefForFamily, wikiRowsFromResponse } from "./WikiCards";

describe("WikiCards", () => {
	test("mounts eight families, each on a distinct served wiki route", () => {
		expect(WIKI_FAMILIES.map(f => f.id)).toEqual([
			"auras",
			"tactics",
			"quests",
			"shops",
			"coaches",
			"stadiums",
			"capsules",
			"costumes",
		]);
		const paths = WIKI_FAMILIES.map(f => f.path);
		expect(new Set(paths).size).toBe(paths.length);
		for (const family of WIKI_FAMILIES) {
			expect(family.path.startsWith("/api/v1/wiki/")).toBe(true);
			// `measured` est le relevé du 2026-09-20 : une famille à zéro ligne n'aurait pas dû
			// être montée, et l'écrire ici fige la raison de sa présence.
			expect(family.measured).toBeGreaterThan(0);
			expect(family.label.length).toBeGreaterThan(0);
		}
	});

	/**
	 * Les quatre enveloppes REELLES des routes, relevées le 2026-09-20.
	 *
	 * Elles ne se ressemblent pas — tableau nu, `{data}`, `{drops}`, `{trophies}` — et écrire le
	 * nom de champ de chacune aurait donné quatre littéraux à maintenir un par un. Le test tient
	 * les quatre formes plutôt que la règle, pour que l'ajout d'une cinquième soit visible.
	 */
	test("reads the rows out of every envelope the wiki routes actually return", () => {
		expect(wikiRowsFromResponse([{ id: 1 }, { id: 2 }])).toHaveLength(2);
		expect(wikiRowsFromResponse({ data: [{ id: "0x1" }], total: 740, page: 1 })).toEqual([{ id: "0x1" }]);
		expect(wikiRowsFromResponse({ drops: [{ id: 1 }], count: 98 })).toEqual([{ id: 1 }]);
		expect(wikiRowsFromResponse({ trophies: [{ id: "a" }], total: 347 })).toEqual([{ id: "a" }]);
		// Une erreur servie est un objet sans tableau : elle rend zéro ligne, pas une exception.
		expect(wikiRowsFromResponse({ genre: "indisponible", message: "Wiki resource unavailable" })).toEqual([]);
		expect(wikiRowsFromResponse(null)).toEqual([]);
		expect(wikiRowsFromResponse("")).toEqual([]);
		// Un tableau de valeurs scalaires n'est pas une liste de fiches.
		expect(wikiRowsFromResponse({ vars: [1, 2, 3] })).toEqual([]);
	});

	test("round-trips the selected family through the URL, the first one staying implicit", () => {
		expect(wikiFamilyFromUrl("/wiki")).toBe("auras");
		expect(wikiFamilyFromUrl("/wiki?famille=coaches")).toBe("coaches");
		expect(wikiHrefForFamily("https://nie.test/wiki", "coaches")).toBe("/wiki?famille=coaches");
		expect(wikiHrefForFamily("https://nie.test/wiki?famille=coaches", "auras")).toBe("/wiki");
		expect(wikiHrefForFamily("https://nie.test/ja/wiki", "shops")).toBe("/ja/wiki?famille=shops");
	});

	test("falls back to the first family rather than rendering nothing", () => {
		expect(wikiFamilyFor("inexistante").id).toBe("auras");
		expect(wikiFamilyFor(null).id).toBe("auras");
		expect(wikiFamilyFor("costumes").id).toBe("costumes");
	});
});
