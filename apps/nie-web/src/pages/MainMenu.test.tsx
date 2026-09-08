import { describe, expect, test } from "bun:test";
import { AssetSourceProvider } from "@niers/inacord-ui";
import type { NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu.ts";
import { renderToStaticMarkup } from "react-dom/server";
import scene from "../../../../crates/engine/nie-formats/src/menu_scenes/title-menu.json";
import { MainMenu, NativeMainMenu, type MainMenuAction } from "./MainMenu";

const ACTIONS: readonly MainMenuAction[] = [
	{ id: "media", label: "Médias", glyph: "image", onActivate: () => {} },
	{ id: "avatar", label: "Avatar", glyph: "ballon", onActivate: () => {} },
	{ id: "explorer", label: "Explorer", glyph: "arbre", onActivate: () => {} },
	{ id: "settings", label: "Options", glyph: "engrenage", onActivate: () => {} },
];
const SOURCE = { urlTexture: (path: string) => `/assets/tex/${path}.png` } as never;
function renderScene(actions = ACTIONS) {
	return renderToStaticMarkup(<AssetSourceProvider source={SOURCE}>
		<NativeMainMenu scene={scene as NativeMenuScene} actions={actions} />
	</AssetSourceProvider>);
}

describe("native title-menu presentation", () => {
	test("waits for the WASM scene before presenting controls", () => {
		const html = renderToStaticMarkup(<MainMenu actions={ACTIONS} />);
		expect(html).toContain('aria-busy="true"');
		expect(html).not.toContain("data-menu-target");
	});

	test("renders eleven native tiles and the avatar with VFS regions and native masks", () => {
		const html = renderScene();
		expect(html).toContain('data-scene-id="title-menu"');
		expect(html.match(/data-menu-target=/g)).toHaveLength(12);
		expect(html.match(/data-native-layer="title-item-\d+-icon"/g)).toHaveLength(11);
		expect(html).toContain("title02_01/fr/title02_01.g4tx/logo02.png");
		expect(html).toContain("title00_07.g4tx/icon_btn07.png");
		expect(html).toContain("title00_07.g4tx/btn_base01_msk.png");
		expect(html).not.toContain("<svg");
		expect(html).not.toContain("mainmenu90");
		expect(html).not.toContain("switch2");
		expect(html).not.toContain("main_menu_alt.png");
	});

	test("binds only documented host actions and retains native labels and order", () => {
		const html = renderScene();
		const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
		expect(buttons.filter((button) => !button.includes('disabled=""'))).toHaveLength(2);
		expect(buttons.find((button) => button.includes('aria-label="Options"'))).toContain('aria-current="true"');
		expect(buttons.find((button) => button.includes('aria-label="Créer avatar"'))).not.toContain('disabled=""');
		expect(buttons.find((button) => button.includes('aria-label="Mode Histoire"'))).toContain('aria-disabled="true"');
		expect(buttons.map((button) => button.match(/aria-label="([^"]+)"/)?.[1])).toEqual([
			"Mode Histoire", "Mode Chronique", "Station Kizuna", "Mode Compétition", "Stade BB", "Victory Road", "Marché", "Sauvegarder",
			"Guide joueur", "Options", "Informations", "Créer avatar",
		]);
		expect(html).not.toContain('data-menu-target="media"');
		expect(html).not.toContain('data-menu-target="explorer"');
	});

	test("skips a disabled host binding when selecting initial focus", () => {
		const html = renderScene(ACTIONS.map((action) => ({ ...action, disabled: action.id === "settings" })));
		const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
		expect(buttons.find((button) => button.includes('aria-label="Options"'))).toContain('disabled=""');
		expect(buttons.find((button) => button.includes('aria-label="Créer avatar"'))).toContain('aria-current="true"');
		expect(html.match(/aria-current="true"/g)).toHaveLength(1);
	});
});
