import { describe, expect, test } from "bun:test";
import { CATALOGS, MEDIA_LANDING } from "../entries";
import { gameSection } from "./UnifiedShell";

describe("unified shell navigation", () => {
	test("keeps one Media row active across all canonical catalogue routes", () => {
		for (const route of CATALOGS) {
			const media = gameSection(route).items.find((item) => item.id === MEDIA_LANDING);
			expect(media?.label).toBe("Médias");
			expect(media?.active).toBe(true);
		}
	});
});
