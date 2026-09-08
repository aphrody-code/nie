import { describe, expect, test } from "bun:test";
import * as game from "@niers/catalog/game";
import * as legacyGame from "@niers/catalog/jeu";

describe("legacy game module compatibility", () => {
	test("the French shim re-exports the canonical implementation", () => {
		expect(Object.keys(legacyGame).sort()).toEqual(Object.keys(game).sort());
		expect(legacyGame.baseJeu).toBe(game.baseJeu);
		expect(legacyGame.cheminTexture).toBe(game.cheminTexture);
		expect(legacyGame.menuSettingPath).toBe(game.menuSettingPath);
	});
});
