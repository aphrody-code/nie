import { describe, expect, test } from "bun:test";
import {
	heptagone,
	normalizeTeamFallback,
	hasUnsupportedCatalogueFallback,
	movesetLabels,
	playerBankHref,
	playerBankStateFromUrl,
	shouldUseServerPage,
	type PlayerBankUrlState,
} from "./PlayerBank";

const filtered: PlayerBankUrlState = {
	q: "Axel",
	element: ["Feu", "Vent"],
	position: ["FW"],
	rarity: ["UR", "LEGEND"],
	series: ["GO"],
	team: ["Raimon"],
	gender: ["Garçon"],
	playstyle: ["Lien", "Justice"],
	ageGroup: ["middle_school"],
	schoolYear: ["8"],
	playable: true,
	incomplete: false,
	detail: "0x12B74634",
	sort: "rarete",
	order: "desc",
	page: 4,
	perPage: 12,
};

describe("PlayerBank URL state", () => {
	test("native radar preserves Pr physical and Ps pressure rather than French abbreviation guesses", () => {
		expect(heptagone({ kc: 238, cr: 258, tc: 250, pr: 210, ps: 211, ag: 195, it: 230, total: 1592 }))
			.toEqual({ kick: 238, control: 258, technique: 250, physical: 210, pressure: 211, agility: 195, intelligence: 230 });
	});
	test("keeps exact detail above unresolved native composition without duplicating fallback blocks", async () => {
		const css = await Bun.file(new URL("./player-bank.css", import.meta.url)).text();
		expect(css).toContain(".player-bank__detail[data-wiki-card=\"true\"] > .player-bank__stats");
		expect(css).toContain("left: 512px; top: 73px");
		expect(css).toContain("background: var(--screen-row-white)");
		expect(css).toContain("color: var(--screen-row-label)");
		expect(css).toMatch(/\.player-bank__filters\s*\{[^}]*z-index:\s*50/s);
	});

	test("projects source-authored normal and BASARA movesets without substituting slots", () => {
		expect(movesetLabels([{ skillId: "waza_normal" }, { nameFr: "Instant céleste" }])).toEqual([
			"waza_normal",
			"Instant céleste",
		]);
		expect(movesetLabels([{ skill_id: "waza_basara" }, null, {}])).toEqual(["waza_basara"]);
		expect(movesetLabels({ skillId: "not-an-array" })).toEqual([]);
	});

	test("falls back to the loaded game roster when the HTTP catalogue fails", () => {
		expect(shouldUseServerPage(true, false, false)).toBeTrue();
		expect(shouldUseServerPage(true, false, true)).toBeFalse();
		expect(shouldUseServerPage(true, true, false)).toBeFalse();
	});

	test("refuses a misleading local fallback for server-only facets", () => {
		expect(hasUnsupportedCatalogueFallback(filtered)).toBeTrue();
		expect(hasUnsupportedCatalogueFallback({
			...filtered,
			rarity: [], playstyle: [], ageGroup: [], schoolYear: [], team: [], playable: null, incomplete: null,
		})).toBeFalse();
	});

	test("round-trips rarity, __in variants, local team and pagination", () => {
		const href = playerBankHref("https://nie.test/banque?host=game#bank", filtered);
		const url = new URL(href, "https://nie.test");
		expect(url.pathname).toBe("/banque");
		expect(url.searchParams.get("host")).toBe("game");
		expect(url.searchParams.get("element__in")).toBe("Feu,Vent");
		expect(url.searchParams.get("rarity__in")).toBe("UR,LEGEND");
		expect(url.searchParams.get("team_id")).toBe("Raimon");
		expect(url.searchParams.get("gender")).toBe("Garçon");
		expect(url.searchParams.get("playstyle__in")).toBe("Lien,Justice");
		expect(url.searchParams.get("age_group")).toBe("middle_school");
		expect(url.searchParams.get("school_year")).toBe("8");
		expect(url.searchParams.get("playable")).toBe("true");
		expect(url.searchParams.get("incomplete")).toBe("false");
		expect(url.searchParams.get("chara")).toBe("0x12B74634");
		expect(url.hash).toBe("#bank");
		expect(playerBankStateFromUrl(url.search)).toEqual(filtered);
	});

	test("restores exact Byron BASARA identity or slug from a shareable Bank URL", () => {
		expect(playerBankStateFromUrl("?chara=0x12B74634").detail).toBe("0x12B74634");
		expect(playerBankStateFromUrl("?chara=byron-love-aphrody").detail).toBe("byron-love-aphrody");
		expect(playerBankHref("https://nie.test/chara_bank_menu", filtered)).toContain("chara=0x12B74634");
	});

	test("restores distinct reload/back snapshots without retaining newer state", () => {
		const first = playerBankHref("https://nie.test/banque", {
			...filtered, q: "Mark", rarity: ["UR"], page: 2, detail: "byron-love-aphrody",
		});
		const second = playerBankHref(`https://nie.test${first}`, {
			...filtered, q: "Jude", rarity: ["SR"], page: 5, detail: "0x12B74634",
		});
		expect(playerBankStateFromUrl(new URL(second, "https://nie.test").search)).toMatchObject({
			q: "Jude", rarity: ["SR"], page: 5, detail: "0x12B74634",
		});
		expect(playerBankStateFromUrl(new URL(first, "https://nie.test").search)).toMatchObject({
			q: "Mark", rarity: ["UR"], page: 2, detail: "byron-love-aphrody",
		});
	});

	test("normalizes invalid page, per-page and sort tokens", () => {
		expect(playerBankStateFromUrl("?page=0&per_page=500&tri=drop_table&ordre=sideways")).toMatchObject({
			page: 1,
			perPage: 24,
			sort: "zukan",
			order: "asc",
		});
	});

	test("team fallback preserves every locally evaluable filter and URL control", () => {
		expect(normalizeTeamFallback(filtered)).toEqual({
			...filtered,
			rarity: [],
			sort: "zukan",
		});
		expect(normalizeTeamFallback({ ...filtered, sort: "code" })).toMatchObject({
			q: "Axel",
			element: ["Feu", "Vent"],
			position: ["FW"],
			series: ["GO"],
			team: ["Raimon"],
			sort: "code",
			order: "desc",
			page: 4,
			perPage: 12,
		});
	});
});
