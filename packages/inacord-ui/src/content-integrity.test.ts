import { describe, expect, test } from "bun:test";

const files = [
	new URL("./components/wiki/home/ToolsPreview.tsx", import.meta.url),
	new URL("./components/wiki/wiki/StatCurve.tsx", import.meta.url),
];

describe("visible content integrity", () => {
	test("does not present unsupported counts, completeness, or availability promises", async () => {
		const source = (await Promise.all(files.map((file) => Bun.file(file).text()))).join("\n");

		expect(source).not.toMatch(/\b11 joueurs, 1 coach, 3 manageuses\b/i);
		expect(source).not.toMatch(/\btoutes les entités du jeu\b/i);
		expect(source).not.toMatch(/\barrive(?:nt)? bientôt\b/i);
	});
});
