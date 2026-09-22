import { describe, expect, test } from "bun:test";
import { AssetSourceProvider } from "@nie/inacord-ui";
import type { NativeMenuScene } from "@nie/inacord-ui/shell/native-title-menu.ts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import scene from "../../../../crates/engine/nie-formats/src/menu_scenes/title-menu.json";
import { localizeNativeTitleScene, MainMenu, NativeMainMenu, type MainMenuAction } from "./MainMenu";

const ACTIONS: readonly MainMenuAction[] = [
	{ id: "media", label: "Médias", glyph: "image", onActivate: () => {} },
	{ id: "bank", label: "Banque", glyph: "livre", onActivate: () => {} },
	{ id: "gallery", label: "Galerie", glyph: "image", onActivate: () => {}, priority: "primary" },
	{ id: "shop", label: "Boutique", glyph: "cube", onActivate: () => {} },
	{ id: "avatar", label: "Avatar", glyph: "ballon", onActivate: () => {} },
	{ id: "explorer", label: "Explorer", glyph: "arbre", onActivate: () => {}, priority: "primary" },
	{ id: "editor", label: "Éditeur 3D", glyph: "cube", onActivate: () => {}, priority: "primary" },
	{ id: "search", label: "Recherche", glyph: "arbre", onActivate: () => {} },
	{ id: "data", label: "Données", glyph: "livre", onActivate: () => {} },
	{ id: "settings", label: "Options", glyph: "engrenage", onActivate: () => {} },
	...[
		// `play_guide` a quitté cette liste : sa tuile — « Guide joueur », le livre marqué d'un
		// point d'exclamation — ouvre la Galerie des succès, que ce site sert.
		"story_mode", "chronicle_mode", "kizuna_town", "competition", "bb_stadium", "victory_road", "information",
	].map((slug) => ({ id: `mode-${slug}`, label: slug, glyph: "livre" as const, onActivate: () => {}, disabled: true })),
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

	test("renders eleven native tiles plus both measured banners with VFS regions and native masks", () => {
		const html = renderScene();
		expect(html).toContain('data-scene-id="title-menu"');
		// Quinze : les treize contrôles natifs et les entrées du site qui n'en occupent pas un.
		// Une de moins qu'avant, `mode-play_guide` ayant cédé sa place à la Galerie.
		expect(html.match(/data-menu-target=/g)).toHaveLength(15);
		expect(html.match(/data-native-layer="title-item-\d+-icon"/g)).toHaveLength(11);
		expect(html).toContain("title02_01/fr/title02_01.g4tx/logo02.png");
		expect(html).toContain("title00_07.g4tx/icon_btn07.png");
		expect(html).toContain("title00_07.g4tx/btn_base01_msk.png");
		expect(html).not.toContain("<svg");
		expect(html).not.toContain("mainmenu90");
		expect(html).not.toContain("switch2");
		expect(html).not.toContain("main_menu_alt.png");
	});

	test("selects translated packs and the measured unsuffixed Japanese title sprites", () => {
		const localized = localizeNativeTitleScene(scene as NativeMenuScene, "de");
		const paths = localized.layers.map(layer => layer.assetPath);
		expect(paths.some(path => path.includes("/title02_01/de/"))).toBeTrue();
		expect(paths.some(path => path.includes("/title02_10/de/"))).toBeTrue();
		expect(paths.some(path => path.includes("/title02_11/de/"))).toBeTrue();
		expect(paths.some(path => path.includes("/fr/"))).toBeFalse();
		const japanese = localizeNativeTitleScene(scene as NativeMenuScene, "ja").layers.map(layer => layer.assetPath);
		expect(japanese.some(path => path.includes("/title02_01/title02_01.g4tx"))).toBeTrue();
		expect(japanese.some(path => path.includes("/title02_10/title02_10.g4tx"))).toBeTrue();
		expect(japanese.some(path => path.includes("/title02_11/title02_11.g4tx"))).toBeTrue();
		expect(japanese.some(path => /\/title02_(?:01|10|11)\/ja\//u.test(path))).toBeFalse();
	});

	test("binds the public host actions onto native controls and retains native control order", () => {
		const html = renderScene();
		const nativeHtml = html.split('<div class="runtime-main-menu__site-nav">')[0]!;
		const buttons = [...nativeHtml.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
		// Cinq, et non quatre : la Galerie a rejoint le Marché, l'Avatar, les Options et la Banque
		// sur une position native, au lieu de flotter à côté du menu.
		expect(buttons.filter((button) => !button.includes('disabled=""'))).toHaveLength(5);
		expect(buttons.find((button) => button.includes('aria-label="Mode Histoire"'))).toContain('disabled=""');
		expect(buttons.find((button) => button.includes('aria-label="Marché"'))).toContain('aria-current="true"');
		expect(buttons.find((button) => button.includes('aria-label="Créer avatar"'))).not.toContain('disabled=""');
		expect(buttons.find((button) => button.includes('aria-label="Stade BB"'))).toContain('disabled=""');
		expect(buttons.find((button) => button.includes('aria-label="Station Kizuna"'))).toContain('disabled=""');
		expect(buttons.find((button) => button.includes('aria-label="Guide joueur"'))).not.toContain('disabled=""');
		expect(buttons.find((button) => button.includes('aria-label="Informations"'))).toContain('disabled=""');
		expect(buttons.map((button) => button.match(/aria-label="([^"]+)"/)?.[1])).toEqual([
			"Mode Histoire", "Mode Chronique", "Station Kizuna", "Mode Compétition", "Stade BB", "Victory Road", "Marché", "Sauvegarder",
			"Guide joueur", "Options", "Informations", "Votre équipe", "Créer avatar",
		]);
		expect(html).toContain('aria-label="Accès principaux"');
		expect(html).toContain('data-host-action="editor"');
		expect(html).toContain('aria-label="Fonctions secondaires du site"');
		expect(html).not.toContain('data-menu-target="media"');
		expect(html).toContain('data-menu-target="explorer"');
	});

	test("skips a disabled host binding when selecting initial focus", () => {
		const html = renderScene(ACTIONS.map((action) => ({ ...action, disabled: action.disabled || action.id === "settings" })));
		const buttons = [...html.split('<div class="runtime-main-menu__site-nav">')[0]!.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
		expect(buttons.find((button) => button.includes('aria-label="Options"'))).toContain('disabled=""');
		expect(buttons.find((button) => button.includes('aria-label="Marché"'))).toContain('aria-current="true"');
		expect(html.match(/aria-current="true"/g)).toHaveLength(1);
	});

	test("reaches and activates every primary destination from the native graph with keyboard input", async () => {
		const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
		actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
		const activated: string[] = [];
		const actions = ACTIONS.map((action) => ({
			...action,
			onActivate: () => activated.push(action.id),
		}));
		const host = document.createElement("div");
		document.body.append(host);
		const root = createRoot(host);
		await act(async () => root.render(<AssetSourceProvider source={SOURCE}>
			<NativeMainMenu scene={scene as NativeMenuScene} actions={actions} />
		</AssetSourceProvider>));

		const key = async (value: string) => act(async () => {
			window.dispatchEvent(new KeyboardEvent("keydown", { key: value, bubbles: true }));
			await Promise.resolve();
		});
		// Le parcours suit la topologie du menu du JEU, relevée sur le rendu : le focus part du
		// Marché, descend sur les Options, et la Galerie est la tuile à leur GAUCHE — « Guide
		// joueur », le livre marqué d'un point d'exclamation. Elle n'est plus dans la rangée du
		// site, où il fallait auparavant aller la chercher.
		await key("ArrowDown");
		await key("ArrowLeft");
		expect(host.querySelector('[data-menu-target="title-item-6"] [aria-current="true"]')).not.toBeNull();
		await key("Enter");
		await Promise.resolve();
		await key("ArrowDown");
		expect(host.querySelector('[data-host-action="explorer"]')?.getAttribute("aria-current")).toBe("true");
		await key("Enter");
		await Promise.resolve();
		await key("ArrowRight");
		expect(host.querySelector('[data-host-action="editor"]')?.getAttribute("aria-current")).toBe("true");
		await key("Enter");
		await Promise.resolve();
		expect(activated).toEqual(["gallery", "explorer", "editor"]);

		await act(async () => root.unmount());
		host.remove();
		actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
	});
});
