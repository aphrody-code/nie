import { describe, expect, test } from "bun:test";
import * as gameLayout from "@niers/inacord-ui/shell/game-layout";
import * as legacyGameLayout from "@niers/inacord-ui/shell/layout-jeu";
import * as legacyMainMenuGeometry from "@niers/inacord-ui/shell/geometrie-mainmenu";
import * as legacyMenuScreen from "@niers/inacord-ui/shell/ecran-menu";
import * as mainMenuGeometry from "@niers/inacord-ui/shell/main-menu-geometry";
import * as menuScreen from "@niers/inacord-ui/shell/menu-screen";

function expectSameModule(
	canonical: Readonly<Record<string, unknown>>,
	legacy: Readonly<Record<string, unknown>>
): void {
	expect(Object.keys(legacy).toSorted()).toEqual(Object.keys(canonical).toSorted());
	for (const key of Object.keys(canonical)) expect(legacy[key]).toBe(canonical[key]);
}

describe("legacy shell module compatibility", () => {
	test("the French game-layout subpath re-exports the canonical module", () => {
		expectSameModule(gameLayout, legacyGameLayout);
	});

	test("the French geometry subpath re-exports the canonical module", () => {
		expectSameModule(mainMenuGeometry, legacyMainMenuGeometry);
	});

	test("the French menu-screen subpath re-exports the canonical module", () => {
		expectSameModule(menuScreen, legacyMenuScreen);
	});
});
