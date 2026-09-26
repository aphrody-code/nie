import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();
const luminance = (hex: string) => {
	const channels = hex.match(/[0-9a-f]{2}/gi)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
	return channels.reduce((sum, value, index) => {
		const linear = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
		return sum + linear * [0.2126, 0.7152, 0.0722][index]!;
	}, 0);
};
const contrast = (a: string, b: string) => {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (light! + 0.05) / (dark! + 0.05);
};

describe("single game theme contract", () => {
	test("appearance preferences never rewrite measured game tokens", async () => {
		const css = await read("./base.css");
		expect(css).not.toContain('html[data-theme="dark"]');
		expect(css).toContain("color-scheme: light");
	});

	test("the host role adapter is sourced from measured menu roles", async () => {
		const css = await read("./inacord/shell/inacord-tool-theme.css");
		expect(css).toContain("--color-app: var(--screen-canvas-pale)");
		expect(css).toContain("--color-accent: var(--screen-header-blue)");
		expect(css).not.toContain("var(--inacord-");
		for (const legacyRole of ["ciel-clair", "nuit-profonde", "tuile-haut", "texte-vif", "accent-ambre"]) {
			expect(css).toMatch(new RegExp(`--jeu-${legacyRole}: var\\(--screen-`));
		}
	});

	test("the shared Explorer cannot reinstall its former dark palette", async () => {
		const css = await read("./inacord/explorer/explorer-surface.css");
		expect(css).toContain("--app-bg: var(--screen-canvas-pale)");
		expect(css).toContain("color-scheme: light");
		expect(css).not.toContain("#211b17");
	});

	test("measured navigation text and its asset fallback meet normal-text contrast", () => {
		// Hex values are copied from the generated `game-screens.css` provenance comments.
		expect(contrast("#4B6D97", "#FEFFFF")).toBeGreaterThanOrEqual(4.5);
		expect(contrast("#4B6D97", "#E0FAFF")).toBeGreaterThanOrEqual(4.5);
		expect(contrast("#FEFFFF", "#0048B9")).toBeGreaterThanOrEqual(4.5);
	});

	test("small faint labels use the measured accessible role", async () => {
		const css = await read("./inacord/shell/inacord-tool-theme.css");
		expect(css).toContain("--color-ink-faint: var(--screen-section-title)");
		expect(css).toContain("--color-sidebar-ink-faint: var(--screen-section-title)");
	});

	test("every consumed screen token is defined by the measured game palette", async () => {
		const tokenCss = await read("./inacord/shell/game-screens.css");
		const defined = new Set([...tokenCss.matchAll(/--(screen-[a-z0-9-]+)\s*:/gu)].map(match => match[1]));
		const roots = [
			fileURLToPath(new URL("./", import.meta.url)),
			fileURLToPath(new URL("./inacord/", import.meta.url)),
		];
		const consumed = new Set<string>();
		for (const cwd of roots) {
			for await (const path of new Bun.Glob("**/*.css").scan({ cwd, absolute: true })) {
				const css = await Bun.file(path).text();
				for (const match of css.matchAll(/var\(--(screen-[a-z0-9-]+)/gu)) consumed.add(match[1]!);
			}
		}
		expect([...consumed].filter(token => !defined.has(token))).toEqual([]);
	});
});
