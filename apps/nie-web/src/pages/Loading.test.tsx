import { describe, expect, test } from "bun:test";
import { AssetSourceProvider } from "@niers/inacord-ui";
import { renderToStaticMarkup } from "react-dom/server";
import { Loading, loadingFallbackMessage } from "./Loading";

describe("loading screen evidence boundary", () => {
	test("keeps unknown and in-progress health on the real layout", () => {
		expect(loadingFallbackMessage(null, false)).toBeNull();
		expect(
			loadingFallbackMessage({ capacites: { vfs: "en_cours" } } as never, false),
		).toBeNull();
	});

	test("uses factual neutral messages when VFS pixels cannot be served", () => {
		expect(loadingFallbackMessage(null, true)).toBe("Les ressources ne sont pas joignables.");
		expect(loadingFallbackMessage({ capacites: { vfs: "absent" } } as never, false)).toBe(
			"Les fichiers du jeu ne sont pas disponibles.",
		);
	});

	test("does not render the game layout in the failed fallback", () => {
		const html = renderToStaticMarkup(<Loading health={null} failed />);
		expect(html).toContain('role="alert"');
		expect(html).not.toContain("loading01_01_fade_loading");
		expect(html).not.toContain("/pet/");
	});

	test("renders only the exported loading01 object in the visual layer", () => {
		const source = {
			urlTexture: (path: string) => `/assets/tex/${path}.png`,
		} as never;
		const html = renderToStaticMarkup(
			<AssetSourceProvider source={source}>
				<Loading health={null} />
			</AssetSourceProvider>,
		);

		expect(html).toContain('data-layout="loading01"');
		expect(html).toContain("loading01_01/loading01_01.g4tx.png");
		expect(html).not.toContain("/pet/");
		expect(html).not.toContain("entrées indexées");
	});
});
