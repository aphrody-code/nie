import { expect, test } from "bun:test";
import { mountPreloadedVfs } from "./preloaded-vfs";

test("archive integrity failure is retryable and never reaches the Rust mount", async () => {
	const original = globalThis.fetch;
	let calls = 0;
	globalThis.fetch = (async () => { calls++; return new Response(new Uint8Array([1])); }) as unknown as typeof fetch;
	try {
		const reference = { id: "menu", url: `/static/game/vfs/menu_${"0".repeat(64)}.nievfs`, bytes: 1, sha256: "0".repeat(64) };
		const first = mountPreloadedVfs(reference);
		expect(mountPreloadedVfs(reference)).toBe(first);
		await expect(first).rejects.toThrow("SHA-256 mismatch");
		await expect(mountPreloadedVfs(reference)).rejects.toThrow("SHA-256 mismatch");
		expect(calls).toBe(2);
	} finally { globalThis.fetch = original; }
});

test("archive references reject unbounded data and external or traversal URLs before fetching", async () => {
	const base = { id: "menu", url: `/static/game/vfs/menu_${"0".repeat(64)}.nievfs`, bytes: 1, sha256: "0".repeat(64) };
	for (const patch of [{ bytes: 0 }, { bytes: 513 * 1024 * 1024 }, { bytes: 1.5 },
		{ url: "https://example.test/archive" }, { url: "/static/../archive" }, { sha256: "invalid" }]) {
		await expect(mountPreloadedVfs({ ...base, ...patch })).rejects.toThrow("Invalid VFS archive reference");
	}
});
