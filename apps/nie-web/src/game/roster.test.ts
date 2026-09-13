import { describe, expect, test } from "bun:test";
import {
	filterRoster,
	PROFILE_LEVEL,
	rosterFamilies,
	rosterFromCharas,
	type RosterChara,
} from "./roster";
import { listPage } from "./list-page";

function chara(name: string, element: string, position: string, team: string | null): RosterChara {
	return {
		chara_param_id: `0x${name}`,
		chara_base_id: `0xB${name}`,
		internal_code: `c${name}`,
		name,
		description: null,
		element,
		main_position: position,
		sub_position: position,
		series: "Victory Road",
		team,
		gender: 1,
		skills: [`Nv 0 — ${name}`],
		stats: { kc: 1, cr: 2, tc: 3, pr: 4, ps: 5, ag: 6, it: 7, total: 28 },
	};
}

const CHARAS = [
	chara("Léon", "Feu", "FW", "Raimon"),
	chara("Mark", "Montagne", "GK", "Raimon"),
	chara("Axel", "Feu", "FW", null),
	chara("Nathan", "Forêt", "DF", "Zeus"),
];

describe("roster binding", () => {
	test("the typed fallback owns every chara at the profile level with its stats and skills", () => {
		const entries = rosterFromCharas(CHARAS);
		expect(entries).toHaveLength(CHARAS.length);
		expect(entries.every((entry) => entry.level === PROFILE_LEVEL)).toBe(true);
		expect(entries.every((entry) => entry.origin === "game-data")).toBe(true);
		expect(entries[0]?.stats).toEqual(CHARAS[0]!.stats);
		expect(entries[0]?.skills).toEqual(CHARAS[0]!.skills);
	});

	test("families are read off the data, counted, and never invented", () => {
		const families = rosterFamilies(rosterFromCharas(CHARAS));
		expect(families.map((family) => family.id)).toEqual(["element", "position", "team"]);
		expect(families[0]?.options).toEqual([
			{ value: "Feu", count: 2 },
			{ value: "Forêt", count: 1 },
			{ value: "Montagne", count: 1 },
		]);
		// `series` holds a single value here, so it is not a choice: the game shows no family
		// that cannot narrow anything.
		expect(families.some((family) => family.id === "series")).toBe(false);
	});

	test("an empty family is « Tout », several families intersect", () => {
		const entries = rosterFromCharas(CHARAS);
		expect(filterRoster(entries, {})).toHaveLength(4);
		expect(filterRoster(entries, { element: [] })).toHaveLength(4);
		expect(filterRoster(entries, { element: ["Feu"] }).map((e) => e.chara.name)).toEqual(["Léon", "Axel"]);
		expect(filterRoster(entries, { element: ["Feu"], team: ["Raimon"] }).map((e) => e.chara.name)).toEqual(["Léon"]);
		expect(filterRoster(entries, { element: ["Feu", "Forêt"] })).toHaveLength(3);
	});

	test("the name search ignores case and accents, and composes with the filter", () => {
		const entries = rosterFromCharas(CHARAS);
		expect(filterRoster(entries, {}, "leon").map((e) => e.chara.name)).toEqual(["Léon"]);
		expect(filterRoster(entries, {}, "  A ").map((e) => e.chara.name)).toEqual(["Mark", "Axel", "Nathan"]);
		expect(filterRoster(entries, { element: ["Feu"] }, "a").map((e) => e.chara.name)).toEqual(["Axel"]);
		expect(filterRoster(entries, {}, "zzz")).toEqual([]);
	});

	test("a page of the real roster keeps the source order", () => {
		// L'algorithme lui-même est couvert par `list-page.test.ts` ; ce qui est vérifié ici est
		// que la découpe appliquée aux VRAIES entrées rend les bons personnages, dans l'ordre.
		const entries = rosterFromCharas(CHARAS);
		expect(listPage(entries, 3, 2).items.map((e) => e.chara.name)).toEqual(["Axel", "Nathan"]);
	});
});
