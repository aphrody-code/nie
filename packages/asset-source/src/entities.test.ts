import { describe, expect, test } from "bun:test";
import { entityCatalogUrl, entityRowsUrl } from "./entities";

describe("generic entity URLs", () => {
	test("encodes every server filter form and bounds pagination/facets", () => {
		const url = entityRowsUrl("inagle_chara", {
			page: 3,
			perPage: 999,
			q: " Mark ",
			sort: "power_max",
			order: "desc",
			facets: ["element", "position", "rarity"],
			filters: {
				element__in: ["fire", "wind"],
				power_max__min: "400",
				power_max__max: "880",
				video_url: "__present__",
			},
		});
		expect(url).toBe(
			"/api/v1/entites/inagle_chara?page=3&per_page=200&q=Mark&tri=power_max&ordre=desc&facets=element%2Cposition%2Crarity&element__in=fire%2Cwind&power_max__max=880&power_max__min=400&video_url=__present__",
		);
	});

	test("catalogue and CSV share canonical bounded query construction", () => {
		expect(entityCatalogUrl({ page: 0, perPage: -1, q: " shop " })).toBe(
			"/api/v1/entites?page=1&per_page=50&q=shop",
		);
		expect(entityRowsUrl("table/name", {}, "csv")).toBe(
			"/api/v1/entites/table%2Fname?page=1&per_page=50&format=csv",
		);
	});
});
