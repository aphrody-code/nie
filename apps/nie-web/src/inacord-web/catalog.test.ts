import { describe, expect, test } from "bun:test";
import { formatBytes, normalizeCatalog } from "./catalog";

describe("download catalog", () => {
	test("normalizes nested products without inventing availability", () => {
		const items = normalizeCatalog({ products: [
			{ kind: "desktop", name: "Inacord desktop", version: "1.2.3", artifacts: [
				{ platform: "Windows", arch: "x86_64", download_url: "/downloads/inacord.exe", size: 2048, sha256: "abc" },
			] },
			{ kind: "mobile", name: "Inacord mobile", status: "planned" },
		] });
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ kind: "desktop", status: "available", version: "1.2.3", url: "/downloads/inacord.exe", bytes: 2048, sha256: "abc" });
		expect(items[1]).toMatchObject({ kind: "mobile", status: "planned", url: undefined });
	});

	test("keeps an entry without a URL unavailable", () => {
		expect(normalizeCatalog({ downloads: [{ name: "CLI", kind: "cli", available: true }] })[0]?.status).toBe("unavailable");
	});

	test("rejects a non-object payload and formats sizes", () => {
		expect(() => normalizeCatalog([])).toThrow();
		expect(formatBytes(2 * 1024 * 1024)).toBe("2.0 Mio");
	});
});
