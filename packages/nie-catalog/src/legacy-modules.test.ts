import { describe, expect, test } from "bun:test";
import * as excerpt from "@niers/catalog/excerpt";
import * as legacyExcerpt from "@niers/catalog/extrait";
import * as legacySynergy from "@niers/catalog/synergie";
import * as synergy from "@niers/catalog/synergy";

describe("legacy catalog module compatibility", () => {
	test("the French excerpt shim re-exports the canonical implementation", () => {
		expect(Object.keys(legacyExcerpt).toSorted()).toEqual(Object.keys(excerpt).toSorted());
		expect(legacyExcerpt.tables).toBe(excerpt.tables);
		expect(legacyExcerpt.personnage).toBe(excerpt.personnage);
	});

	test("the French synergy shim re-exports the canonical implementation", () => {
		expect(Object.keys(legacySynergy).toSorted()).toEqual(Object.keys(synergy).toSorted());
		expect(legacySynergy.chercher).toBe(synergy.chercher);
		expect(legacySynergy.personnage).toBe(synergy.personnage);
	});
});
