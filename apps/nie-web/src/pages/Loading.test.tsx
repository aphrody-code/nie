import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Loading, loadingFallbackMessage } from "./Loading";

describe("loading screen evidence boundary", () => {
	test("keeps unknown and in-progress health on the readiness screen", () => {
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

	test("renders a zero-asset readiness surface", () => {
		const html = renderToStaticMarkup(<Loading health={null} />);
		expect(html).toContain('role="status"');
		expect(html).toContain("Chargement des données");
		expect(html).not.toContain("img");
		expect(html).not.toContain("video");
		expect(html).not.toContain("audio");
		expect(html).not.toContain("canvas");
	});
});
