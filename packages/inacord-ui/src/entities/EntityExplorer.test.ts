import { describe, expect, test } from "bun:test";
import { entityStateFromUrl } from "./EntityExplorer";

describe("EntityExplorer URL state", () => {
	test("restores schema, paging, sort, facets and every generic filter form", () => {
		expect(entityStateFromUrl(
			"?table=inagle_chara&catalog_page=2&table_q=chara&page=3&per_page=100&q=mark&tri=power_max&ordre=desc&facets=element,rarity&element__in=fire,wind&power_max__min=400&video_url=__present__",
		)).toEqual({
			table: "inagle_chara",
			catalogPage: 2,
			tableQuery: "chara",
			page: 3,
			perPage: 100,
			q: "mark",
			sort: "power_max",
			order: "desc",
			facets: ["element", "rarity"],
			filters: {
				element__in: "fire,wind",
				power_max__min: "400",
				video_url: "__present__",
			},
		});
	});
});
