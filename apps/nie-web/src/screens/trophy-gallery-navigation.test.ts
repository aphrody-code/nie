import { describe, expect, test } from "bun:test";

import {
	trophyGalleryHistoryMode,
	trophyGalleryHrefForSurface,
} from "./trophy-gallery-navigation";

describe("TrophyGallery surface history", () => {
	test("opens the asset extension with a history entry and closes without a Back loop", () => {
		const native = "/gallery_menu?q=goal&categorie=telop_waza&dossier=fr";
		const assets = trophyGalleryHrefForSurface(native, "assets");
		expect(assets).toBe("/gallery_menu?q=goal&categorie=telop_waza&dossier=fr&display=gallery");
		expect(trophyGalleryHistoryMode("assets")).toBe("push");
		expect(trophyGalleryHrefForSurface(assets, "native")).toBe(native);
		expect(trophyGalleryHistoryMode("native")).toBe("replace");
	});
});
