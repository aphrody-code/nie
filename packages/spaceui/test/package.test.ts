import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");

function declarations(css: string, prefix: "jeu" | "inacord") {
	const values = new Map<string, string>();
	for (const line of css.split("\n")) {
		const match = line.match(new RegExp(`^\\s*--(${prefix}-[a-z-]+):\\s*([^;]+);`));
		if (match) {
			const name = match[1]!;
			const value = match[2]!;
			if (!values.has(name)) values.set(name, value.trim());
		}
	}
	return values;
}

describe("@aphrody/spaceui package", () => {
	test("publishes every declared entrypoint", async () => {
		const manifest = await Bun.file(resolve(packageRoot, "package.json")).json();
		expect(manifest.name).toBe("@aphrody/spaceui");
		expect(manifest.version).toBe("0.2.4-fork.1");
		expect(manifest.publishConfig.access).toBe("public");

		for (const target of Object.values(manifest.exports) as string[]) {
			expect(await Bun.file(resolve(packageRoot, target)).exists()).toBe(true);
		}
	});

	test("keeps the public fork revision in package provenance", async () => {
		const notice = await Bun.file(resolve(packageRoot, "NOTICE")).text();
		expect(notice).toContain("https://github.com/aphrody-code/spaceui");
		expect(notice).toContain("d9983febdf20ca9eb47e7ebd21d5598a8b5d3e36");
		expect(notice).toContain("https://github.com/spacedriveapp/spaceui");
	});
});

describe("NIE token bridge", () => {
	test("copies every selected generated token without changing its value", async () => {
		const canonical = await Bun.file(
			resolve(repositoryRoot, "packages/inacord-ui/src/shell/game-tokens.css")
		).text();
		const vendored = await Bun.file(resolve(packageRoot, "src/tokens.css")).text();
		const expected = new Map([
			...declarations(canonical, "jeu"),
			...declarations(canonical, "inacord"),
		]);
		const actual = new Map([
			...declarations(vendored, "jeu"),
			...declarations(vendored, "inacord"),
		]);

		expect(actual.size).toBe(46);
		for (const [name, value] of actual) {
			expect(expected.has(name)).toBe(true);
			expect(value).toBe(expected.get(name)!);
		}
	});

	test("maps SpaceUI semantic colors only through NIE variables", async () => {
		const css = await Bun.file(resolve(packageRoot, "src/tokens.css")).text();
		const semanticLines = css.split("\n").filter((line) => /^\s*--color-/.test(line));

		expect(semanticLines.length).toBe(48);
		for (const line of semanticLines) {
			expect(line).toMatch(/:\s*var\(--(?:jeu|inacord)-[a-z-]+\);$/);
		}
	});

	test("keeps the static homepage free of literal color values", async () => {
		const css = await Bun.file(resolve(packageRoot, "src/homepage.css")).text();
		expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
		expect(css).not.toMatch(/\b(?:rgb|hsl|oklch)a?\(/i);
	});
});
