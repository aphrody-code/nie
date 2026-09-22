import { describe, expect, test } from "bun:test";
import { createHybridGameTextResolver } from "./hybrid-text-resolver";
import type { GameTextRef, GameTextResolver } from "@nie/inacord-ui/lib/game-text";

describe("hybridGameTextResolver", () => {
	test("delegates to fallback resolver when local VFS does not have the text table", async () => {
		const mockFallback: GameTextResolver = async (locale, refs) => {
			const map = new Map<string, readonly string[]>();
			for (const ref of refs) {
				map.set(`${ref.family}/${ref.hash}`, [`Translated:${ref.hash}`]);
			}
			return map;
		};

		const resolver = createHybridGameTextResolver(mockFallback);
		const refs: GameTextRef[] = [
			{ family: "menu_text", hash: "100001" },
			{ family: "menu_text", hash: "100002" },
		];

		const resolved = await resolver("en", refs);
		expect(resolved.get("menu_text/100001")).toEqual(["Translated:100001"]);
		expect(resolved.get("menu_text/100002")).toEqual(["Translated:100002"]);
	});

	test("handles fallback failure gracefully without throwing", async () => {
		const failingFallback: GameTextResolver = async () => {
			throw new Error("Network unreachable");
		};

		const resolver = createHybridGameTextResolver(failingFallback);
		const refs: GameTextRef[] = [{ family: "menu_text", hash: "100001" }];

		const resolved = await resolver("ja", refs);
		expect(resolved.size).toBe(0);
	});
});
