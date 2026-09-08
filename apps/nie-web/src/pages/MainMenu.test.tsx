import { describe, expect, test } from "bun:test";
import { AssetSourceProvider } from "@niers/inacord-ui";
import { renderToStaticMarkup } from "react-dom/server";
import { MainMenu, type MainMenuAction } from "./MainMenu";

const ACTIONS: readonly MainMenuAction[] = [
	{ id: "media", label: "Médias", glyph: "image", onActivate: () => {} },
	{ id: "avatar", label: "Avatar", glyph: "ballon", onActivate: () => {} },
	{ id: "explorer", label: "Explorer", glyph: "arbre", onActivate: () => {} },
	{ id: "settings", label: "Options", glyph: "engrenage", onActivate: () => {} },
];

describe("reconstructed main menu", () => {
	test("uses VFS layers and actual controls instead of a captured screen", () => {
		const source = {
			urlTexture: (path: string) => `/assets/tex/${path}.png`,
		} as never;
		const html = renderToStaticMarkup(
			<AssetSourceProvider source={source}>
				<MainMenu actions={ACTIONS} />
			</AssetSourceProvider>,
		);

		expect(html).toContain('data-render-source="vfs-layers"');
		expect(html).toContain("mainmenu90_00/mainmenu90_00.g4tx.png");
		expect(html.match(/data-menu-target=/g)).toHaveLength(ACTIONS.length);
		expect(html.match(/<button/g)).toHaveLength(ACTIONS.length);
		expect(html).not.toContain("captured-reference");
		expect(html).not.toContain("main-menu-reference.png");
		expect(html).not.toContain("Intégration en cours");
	});

	test("ships hover, focus, press, transition, and reduced-motion states", async () => {
		const css = await Bun.file(new URL("./main-menu.css", import.meta.url)).text();
		expect(css).toContain(":hover");
		expect(css).toContain(":focus-visible");
		expect(css).toContain("runtime-main-menu__tile--pressed");
		expect(css).toContain("runtime-menu-enter");
		expect(css).toContain("prefers-reduced-motion: reduce");
	});

	test("keeps unavailable actions disabled and initially focuses the first available action", () => {
		const source = { urlTexture: (path: string) => `/assets/tex/${path}.png` } as never;
		const html = renderToStaticMarkup(
			<AssetSourceProvider source={source}>
				<MainMenu actions={ACTIONS.map((action, index) => ({ ...action, disabled: index === 0 }))} />
			</AssetSourceProvider>,
		);
		expect(html).toMatch(/data-menu-target="media"[^]*?<button[^>]*disabled=""/);
		expect(html).toMatch(/data-menu-target="avatar"[^]*?<button[^>]*aria-current="true"/);
		expect(html.match(/aria-current="true"/g)).toHaveLength(1);
	});
});
