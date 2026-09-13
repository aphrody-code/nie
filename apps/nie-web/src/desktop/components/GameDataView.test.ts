import { describe, expect, test } from "bun:test";
import { dataSurfaceUrl, decodedStateFromUrl } from "./GameDataView";

describe("GameDataView URL state", () => {
	test("switching surfaces preserves both SQLite and decoded filters", () => {
		const original = "https://nie.test/donnees?table=inagle_characters&q=Mark&facets=element&decoded_family=shops&decoded_q=jeton";
		const decoded = dataSurfaceUrl(original, "decoded");
		expect(decoded.searchParams.get("surface")).toBe("decoded");
		expect(decoded.searchParams.get("table")).toBe("inagle_characters");
		expect(decoded.searchParams.get("decoded_family")).toBe("shops");
		const database = dataSurfaceUrl(decoded.href, "database");
		expect(database.searchParams.get("surface")).toBeNull();
		expect(database.searchParams.get("q")).toBe("Mark");
		expect(database.searchParams.get("decoded_q")).toBe("jeton");
	});

	test("restores decoded family, search, sort and card layout from the URL", () => {
		expect(decodedStateFromUrl("?decoded_family=shops&decoded_q=jeton&decoded_tri=name&decoded_order=desc&decoded_view=cartes")).toEqual({
			family: "shops",
			query: "jeton",
			sort: { key: "name", dir: "desc" },
			view: "cartes",
		});
	});
});
