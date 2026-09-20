import { beforeAll, describe, expect, test } from "bun:test";
import init, { crc32 } from "../wasm/nie_wasm.js";
import { createPreloadedVfsLoader, type VfsArchiveReference } from "./preloaded-vfs";
import { VfsResources } from "./vfs-resources";

beforeAll(async () => {
	await init({ module_or_path: await Bun.file(new URL("../../public/static/game/nie_wasm_bg.wasm", import.meta.url)).arrayBuffer() });
});

/** Synthetic container encoder only; parsing, canonical paths and CRC validation run in Rust. */
async function archive(id: string, path: string, text: string, corrupt = false) {
	const payload = new TextEncoder().encode(text);
	const header = new TextEncoder().encode(JSON.stringify({
		schemaVersion: 1,
		kind: "niers.vfs.bundle/v1",
		entries: [{ path, offset: 0, length: payload.length, crc32: crc32(text) }],
	}));
	const bytes = new Uint8Array(12 + header.length + payload.length);
	bytes.set(new TextEncoder().encode("NIEVFS1\0"));
	new DataView(bytes.buffer).setUint32(8, header.length, true);
	bytes.set(header, 12);
	bytes.set(payload, 12 + header.length);
	if (corrupt) bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
	const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
	const reference: VfsArchiveReference = { id, sha256, bytes: bytes.length,
		url: `/static/game/vfs/${id}_${sha256}.nievfs`, paths: [path] };
	return { bytes, reference };
}

describe("actual WASM preloaded VFS integration", () => {
	test("an externally evicted archive is fetched and mounted again despite the same SHA", async () => {
		const cold = await archive("native_tables", "data/test/table", "cold-table");
		const resources = new VfsResources();
		let requests = 0;
		const loader = createPreloadedVfsLoader({
			resources, ensureWasm: async () => {},
			fetchManifest: async () => Response.json({ schemaVersion: 1, screen: "main_menu", locale: "fr", archives: [cold.reference] }),
			fetchArchive: async () => { requests++; return cold.bytes.slice(); },
		});
		try {
			expect(new TextDecoder().decode((await loader.readPreloadedFile("data/test/table"))!)).toBe("cold-table");
			resources.unmount("native_tables");
			expect(resources.read("data/test/table")).toBeNull();
			expect(new TextDecoder().decode((await loader.readPreloadedFile("data/test/table"))!)).toBe("cold-table");
			expect(await loader.mountPreloadedVfs(cold.reference)).toBe(0);
			expect(requests).toBe(2);
		} finally { resources.unmount("native_tables"); }
	});

	test("mounts exact menu bytes and loads a cold archive only on first path demand", async () => {
		const menu = await archive("menu", "data/test/menu", "menu-one");
		const cold = await archive("native_tables", "data/test/table", "cold-table");
		const resources = new VfsResources();
		const requests: string[] = [];
		let manifests = 0;
		const loader = createPreloadedVfsLoader({
			resources, ensureWasm: async () => {},
			fetchManifest: async () => { manifests++; return Response.json({ schemaVersion: 1, screen: "main_menu", locale: "fr", archives: [menu.reference, cold.reference] }); },
			fetchArchive: async (url) => {
				requests.push(url);
				if (url === menu.reference.url) return menu.bytes.slice();
				if (url === cold.reference.url) return cold.bytes.slice();
				throw new Error("unexpected archive fetch");
			},
		});
		try {
			expect(await loader.ensureVfsArchive("menu", "main_menu", "fr")).toBe(1);
			expect(new TextDecoder().decode(resources.read("data/test/menu")!)).toBe("menu-one");
			expect(resources.read("data/test/table")).toBeNull();
			expect(requests).toEqual([menu.reference.url]);
			expect(await loader.ensureVfsArchive("menu", "main_menu", "fr")).toBe(0);
			expect(await loader.mountPreloadedVfs({ bytes: menu.reference.bytes, sha256: menu.reference.sha256,
				url: menu.reference.url, id: menu.reference.id })).toBe(0);
			expect(await loader.readPreloadedFile("data/test/absent")).toBeNull();
			expect(requests).toHaveLength(1);
			expect(new TextDecoder().decode((await loader.readPreloadedFile("data/test/table"))!)).toBe("cold-table");
			expect(new TextDecoder().decode((await loader.readPreloadedFile("data/test/table"))!)).toBe("cold-table");
			expect(requests).toEqual([menu.reference.url, cold.reference.url]);
			expect(manifests).toBe(1);
		} finally { resources.unmount("menu"); resources.unmount("native_tables"); }
	});

	test("a SHA-valid archive with corrupted entry CRC never replaces a healthy mount", async () => {
		const healthy = await archive("menu", "data/test/menu", "healthy");
		const corrupt = await archive("menu", "data/test/menu", "broken", true);
		const resources = new VfsResources();
		const loader = createPreloadedVfsLoader({
			resources, ensureWasm: async () => {}, fetchManifest: async () => new Response(null, { status: 404 }),
			fetchArchive: async (url) => (url === healthy.reference.url ? healthy : corrupt).bytes.slice(),
		});
		try {
			await loader.mountPreloadedVfs(healthy.reference);
			await expect(loader.mountPreloadedVfs(corrupt.reference)).rejects.toThrow("CRC-32 mismatch");
			expect(new TextDecoder().decode(resources.read("data/test/menu")!)).toBe("healthy");
			await expect(loader.mountPreloadedVfs(corrupt.reference)).rejects.toThrow("CRC-32 mismatch");
			expect(new TextDecoder().decode(resources.read("data/test/menu")!)).toBe("healthy");
		} finally { resources.unmount("menu"); }
	});

	test("an older request completing late cannot replace the newest mounted archive", async () => {
		const older = await archive("menu", "data/test/menu", "older");
		const newer = await archive("menu", "data/test/menu", "newer");
		const resources = new VfsResources();
		let finishOlder!: (bytes: Uint8Array) => void;
		const loader = createPreloadedVfsLoader({
			resources, ensureWasm: async () => {}, fetchManifest: async () => new Response(null, { status: 404 }),
			fetchArchive: (url) => url === older.reference.url
				? new Promise((resolve) => { finishOlder = resolve; }) : Promise.resolve(newer.bytes.slice()),
		});
		try {
			const pending = loader.mountPreloadedVfs(older.reference);
			const failure = pending.catch((error: unknown) => String(error));
			expect(loader.mountPreloadedVfs(older.reference)).toBe(pending);
			expect(await loader.mountPreloadedVfs(newer.reference)).toBe(1);
			finishOlder(older.bytes.slice());
			expect(await failure).toContain("superseded");
			expect(new TextDecoder().decode(resources.read("data/test/menu")!)).toBe("newer");
		} finally { resources.unmount("menu"); }
	});

	test("returning to a cached archive supersedes a pending replacement without refetch", async () => {
		const cached = await archive("menu", "data/test/menu", "cached");
		const pending = await archive("menu", "data/test/menu", "pending");
		const resources = new VfsResources();
		let finish!: (bytes: Uint8Array) => void;
		let requests = 0;
		const loader = createPreloadedVfsLoader({
			resources, ensureWasm: async () => {}, fetchManifest: async () => new Response(null, { status: 404 }),
			fetchArchive: (url) => {
				requests++;
				return url === cached.reference.url ? Promise.resolve(cached.bytes.slice())
					: new Promise((resolve) => { finish = resolve; });
			},
		});
		try {
			await loader.mountPreloadedVfs(cached.reference);
			const failure = loader.mountPreloadedVfs(pending.reference).catch((error: unknown) => String(error));
			expect(await loader.mountPreloadedVfs(cached.reference)).toBe(0);
			finish(pending.bytes.slice());
			expect(await failure).toContain("superseded");
			expect(new TextDecoder().decode(resources.read("data/test/menu")!)).toBe("cached");
			expect(requests).toBe(2);
		} finally { resources.unmount("menu"); }
	});
});
