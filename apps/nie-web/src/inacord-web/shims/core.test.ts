import { afterEach, describe, expect, test } from "bun:test";
import { invoke } from "./core";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

/** Record every URL the adapter asks for and answer with a caller-supplied body. */
function stub(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): string[] {
	const seen: string[] = [];
	globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		seen.push(String(input));
		return handler(String(input), init);
	}) as unknown as typeof fetch;
	return seen;
}

describe("read-only web command adapter", () => {
	test("maps health into desktop VFS statistics", async () => {
		stub(() => Response.json({ capacites: { vfs: "pret", vfs_entrees: 12, vfs_dump: true, vfs_cpks: 0 }, extensions: [{ valeur: "g4tx", total: 7 }] }));
		expect(await invoke<Record<string, unknown>>("vfs_stats")).toEqual({ montage: "dump", total: 12, cpk_count: 0, extra_count: 0, loose_count: 12, top_ext: [["g4tx", 7]] });
	});

	test("maps folder and search DTO field names", async () => {
		const paths = stub(url => url.startsWith("/b")
			? Response.json({ dossiers: ["data/common"], folder_counts: { "data/common": 9 }, fichiers: [{ chemin: "data/a.bin", nom: "a.bin", taille: 4 }], total_fichiers: 1 })
			: Response.json({ fichiers: [{ chemin: "data/a.bin", nom: "a.bin", taille: 4, cpk: "base.cpk" }], total: 1 }));
		expect(await invoke("vfs_ls", { prefix: "data", limit: 20, offset: 0 })).toMatchObject({ dirs: [{ name: "common", count: 9 }], file_total: 1 });
		expect(await invoke("vfs_find_paged", { query: "a", ext: ".bin", limit: 20, offset: 0 })).toMatchObject({ total: 1, files: [{ path: "data/a.bin", cpk: "base.cpk" }] });
		expect(paths[1]).toContain("ext=bin");
	});

	test("preserves typed errors and rejects native commands", async () => {
		stub(() => Response.json({ message: "VFS en cours" }, { status: 503 }));
		await expect(invoke("vfs_stats")).rejects.toBe("VFS en cours");
		await expect(invoke("sqlite_select")).rejects.toThrow("application desktop");
	});
});

describe("byte-carrying commands", () => {
	test("vfs_read_b64 reads /f and round-trips base64", async () => {
		const bytes = new Uint8Array([0, 1, 2, 253, 254, 255]);
		const seen = stub(() => new Response(bytes));
		const encoded = await invoke<string>("vfs_read_b64", { path: "data/common/a b.bin", gameDir: null, maxBytes: null });
		expect(seen[0]).toBe("/f/data/common/a%20b.bin");
		expect(Uint8Array.from(atob(encoded), c => c.charCodeAt(0))).toEqual(bytes);
	});

	test("vfs_read_b64 honours maxBytes like the desktop bound", async () => {
		stub(() => new Response(new Uint8Array([1, 2, 3, 4, 5])));
		expect(atob(await invoke<string>("vfs_read_b64", { path: "a.bin", maxBytes: 2 })).length).toBe(2);
	});

	test("a large payload does not blow the argument limit", async () => {
		stub(() => new Response(new Uint8Array(300_000).fill(7)));
		expect(atob(await invoke<string>("vfs_read_b64", { path: "big.bin", maxBytes: null })).length).toBe(300_000);
	});

	test("texture URLs drop .g4tx and the data/ prefix, keep both for a named texture", async () => {
		const seen = stub(() => new Response(new Uint8Array([1])));
		await invoke("vfs_texture_png_b64", { path: "data/dx11/ui/atlas.g4tx" });
		await invoke("vfs_texture_named_png_b64", { path: "data/dx11/ui/atlas.g4tx", nom: "eq_ac0100101" });
		expect(seen).toEqual(["/assets/tex/dx11/ui/atlas.png", "/assets/tex/data/dx11/ui/atlas.g4tx/eq_ac0100101.png"]);
	});

	test("audio cue extraction carries the AWB id in the query", async () => {
		const seen = stub(() => new Response(new Uint8Array([1])));
		await invoke("vfs_audio_cue_wav_b64", { path: "data/sound/bgm.acb", awbId: 42 });
		expect(seen[0]).toBe("/assets/audio/data/sound/bgm.acb?id=42");
	});
});

describe("dispatch tables", () => {
	test("game_data_* dispatches on the family segment", async () => {
		const seen = stub(() => Response.json([]));
		await invoke("game_data_special_tactics", { gameDir: null });
		await invoke("game_data_capsule_rates", { gameDir: null });
		expect(seen).toEqual(["/api/v1/game-data/special_tactics", "/api/v1/game-data/capsule_rates"]);
	});

	test("game_data_calculate_stats posts the command arguments", async () => {
		let body = "";
		stub((_url, init) => { body = String(init?.body ?? ""); return Response.json({ frappe: 1 }); });
		expect(await invoke<unknown>("game_data_calculate_stats", { charaParamId: "c01", level: 99, rarityCode: 3 })).toEqual({ frappe: 1 });
		expect(JSON.parse(body)).toMatchObject({ charaParamId: "c01", level: 99, rarityCode: 3 });
	});

	test("an unknown game_data family stays unavailable", async () => {
		await expect(invoke("game_data_nonexistent")).rejects.toThrow("application desktop");
	});

	test("wiki_query maps its operations onto /api/v1/wiki/*", async () => {
		const seen = stub(url => url.includes("/wiki/search")
			? Response.json({ results: [{ kind: "chara", id: "c1" }, { kind: "waza", id: "s1" }] })
			: url.includes("/wiki/characters/")
				? Response.json({ skills: [{ id: "s1" }] })
				: Response.json([{ id: "coach" }]));
		expect(await invoke<unknown>("wiki_query", { operation: "search_character", args: { query: "mark" } })).toEqual([{ kind: "chara", id: "c1" }]);
		expect(await invoke<unknown>("wiki_query", { operation: "character_skills", args: { id: "c1" } })).toEqual([{ id: "s1" }]);
		expect(await invoke<unknown>("wiki_query", { operation: "load_staff", args: {} })).toEqual([{ id: "coach" }]);
		expect(seen[0]).toContain("q=mark");
		expect(seen[1]).toBe("/api/v1/wiki/characters/c1");
	});

	test("an unmapped wiki operation names the operation it refused", async () => {
		await expect(invoke("wiki_query", { operation: "mirror_stats", args: {} }))
			.rejects.toContain("mirror_stats");
	});

	test("machine-bound commands say the feature needs the Desktop app", async () => {
		await expect(invoke("viola_pack")).rejects.toThrow(/Viola.*application desktop/su);
		await expect(invoke("live_status")).rejects.toThrow("jeu en cours d’exécution");
	});

	test("set_titlebar_theme stays a silent no-op", async () => {
		expect(await invoke("set_titlebar_theme", { dark: true })).toBeNull();
	});
});
