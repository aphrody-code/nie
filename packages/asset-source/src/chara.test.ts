import { describe, expect, test } from "bun:test";
import { charaCatalogUrl } from "./chara";

describe("character catalogue URL", () => {
	test("serializes exact rarity and every page/sort control", () => {
		const url = new URL(charaCatalogUrl({
			page: 3,
			perPage: 48,
			q: "Axel",
			element: "Feu",
			position: "FW",
			rarity: "UR",
			series: "GO",
			sort: "rarete",
			order: "desc",
		}), "https://nie.test");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			page: "3", per_page: "48", q: "Axel", element: "Feu", position: "FW",
			rarity: "UR", series: "GO", tri: "rarete", ordre: "desc",
		});
	});

	test("uses __in only for real multi-value filters", () => {
		const url = new URL(charaCatalogUrl({
			elements: ["Feu", "Vent", "Feu"],
			positions: ["FW"],
			rarities: ["UR", "LEGEND"],
			seriesList: ["GO", "ARES"],
		}), "https://nie.test");
		expect(url.searchParams.get("element__in")).toBe("Feu,Vent");
		expect(url.searchParams.get("position")).toBe("FW");
		expect(url.searchParams.get("rarity__in")).toBe("UR,LEGEND");
		expect(url.searchParams.get("series__in")).toBe("GO,ARES");
	});
});
