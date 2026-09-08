import { afterEach, describe, expect, mock, test } from "bun:test";
import { screenCatalog } from "./screen-catalog";

afterEach(() => mock.restore());

describe("screenCatalog HTTP adapter", () => {
	test("uses the mounted icon and mode routes", async () => {
		const paths: string[] = [];
		globalThis.fetch = mock(async input => {
			paths.push(String(input));
			return Response.json({ results: { items: [] } });
		}) as unknown as typeof fetch;
		await screenCatalog.icons("q=ball");
		await screenCatalog.modes("q=story");
		await screenCatalog.mode("victory-road");
		expect(paths).toEqual(["/api/v1/icons?q=ball", "/api/v1/modes?q=story", "/api/v1/modes/victory-road"]);
	});

	test("does not disguise an unavailable backend as an empty catalogue", async () => {
		globalThis.fetch = mock(async () => new Response("missing VFS", { status: 503 })) as unknown as typeof fetch;
		expect(screenCatalog.icons()).rejects.toThrow("HTTP 503");
	});
});
