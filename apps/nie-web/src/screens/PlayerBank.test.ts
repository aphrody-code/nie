import { describe, expect, test } from "bun:test";
import {
	normalizeTeamFallback,
	playerBankHref,
	playerBankStateFromUrl,
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
	sort: "rarete",
	order: "desc",
	page: 4,
	perPage: 12,
};

describe("PlayerBank URL state", () => {
	test("round-trips rarity, __in variants, local team and pagination", () => {
		const href = playerBankHref("https://nie.test/banque?host=game#bank", filtered);
		const url = new URL(href, "https://nie.test");
		expect(url.pathname).toBe("/banque");
		expect(url.searchParams.get("host")).toBe("game");
		expect(url.searchParams.get("element__in")).toBe("Feu,Vent");
		expect(url.searchParams.get("rarity__in")).toBe("UR,LEGEND");
		expect(url.searchParams.get("team")).toBe("Raimon");
		expect(url.searchParams.get("gender")).toBe("Garçon");
		expect(url.hash).toBe("#bank");
		expect(playerBankStateFromUrl(url.search)).toEqual(filtered);
	});

	test("restores distinct reload/back snapshots without retaining newer state", () => {
		const first = playerBankHref("https://nie.test/banque", { ...filtered, q: "Mark", rarity: ["UR"], page: 2 });
		const second = playerBankHref(`https://nie.test${first}`, { ...filtered, q: "Jude", rarity: ["SR"], page: 5 });
		expect(playerBankStateFromUrl(new URL(second, "https://nie.test").search)).toMatchObject({
			q: "Jude", rarity: ["SR"], page: 5,
		});
		expect(playerBankStateFromUrl(new URL(first, "https://nie.test").search)).toMatchObject({
			q: "Mark", rarity: ["UR"], page: 2,
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
