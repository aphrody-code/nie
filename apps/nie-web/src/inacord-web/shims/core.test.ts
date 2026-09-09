import { afterEach, describe, expect, test } from "bun:test";
import { invoke } from "./core";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("read-only web command adapter", () => {
	test("maps health into desktop VFS statistics", async () => {
		globalThis.fetch = (async () => Response.json({ capacites: { vfs: "pret", vfs_entrees: 12, vfs_dump: true, vfs_cpks: 0 }, extensions: [{ valeur: "g4tx", total: 7 }] })) as unknown as typeof fetch;
		expect(await invoke<Record<string, unknown>>("vfs_stats")).toEqual({ montage: "dump", total: 12, cpk_count: 0, extra_count: 0, loose_count: 12, top_ext: [["g4tx", 7]] });
	});

	test("maps folder and search DTO field names", async () => {
		const paths: string[] = [];
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			paths.push(String(input));
			return String(input).startsWith("/b")
				? Response.json({ dossiers: ["data/common"], folder_counts: { "data/common": 9 }, fichiers: [{ chemin: "data/a.bin", nom: "a.bin", taille: 4 }], total_fichiers: 1 })
				: Response.json({ fichiers: [{ chemin: "data/a.bin", nom: "a.bin", taille: 4, cpk: "base.cpk" }], total: 1 });
		}) as unknown as typeof fetch;
		expect(await invoke("vfs_ls", { prefix: "data", limit: 20, offset: 0 })).toMatchObject({ dirs: [{ name: "common", count: 9 }], file_total: 1 });
		expect(await invoke("vfs_find_paged", { query: "a", ext: ".bin", limit: 20, offset: 0 })).toMatchObject({ total: 1, files: [{ path: "data/a.bin", cpk: "base.cpk" }] });
		expect(paths[1]).toContain("ext=bin");
	});

	test("preserves typed errors and rejects native commands", async () => {
		globalThis.fetch = (async () => Response.json({ message: "VFS en cours" }, { status: 503 })) as unknown as typeof fetch;
		await expect(invoke("vfs_stats")).rejects.toBe("VFS en cours");
		await expect(invoke("vfs_write_b64")).rejects.toThrow("application desktop");
	});
});
