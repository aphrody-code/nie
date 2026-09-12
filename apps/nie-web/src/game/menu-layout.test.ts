/**
 * Ce que ce test protège : le protocole en deux tours, et le repli qui ne ment pas.
 *
 * Le constructeur WebAssembly est remplacé par un double : ce qui est vérifié ici n'est pas
 * qu'il calcule bien — ses sept tests vivent dans `nie_formats::menu_screen` — mais que la page
 * lui donne les octets dans le bon ordre, ne lui invente rien, et retombe sur le serveur
 * exactement quand la construction locale n'a rien résolu.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

/** Ce que le double a reçu, dans l'ordre. */
const journal: { files: string[]; companions: [string, string][]; built: string[] } = {
	files: [],
	companions: [],
	built: [],
};

/** Ce que le double rendra à `build`. */
let layoutRendu = JSON.stringify({ objects: [{}], diagnostics: { transformsUnresolved: 0 } });

class MenuScreenBuilderDouble {
	private readonly spec: { items: { layer: string; objbin: string | null }[] };
	constructor(specJson: string) {
		this.spec = JSON.parse(specJson);
	}
	required_files(): string[] {
		return this.spec.items.flatMap(item => (item.objbin === null ? [] : [item.objbin]));
	}
	// Les compagnons ne se connaissent QU'APRÈS le chargement des `.objbin` : le double le
	// reproduit, sinon le test passerait même si la page inversait les deux tours.
	required_companions(): string[] {
		return journal.files.length > 0 ? ["team14_01.g4pkm", "team14_01.g4tx"] : [];
	}
	provide_file(path: string) {
		journal.files.push(path);
	}
	provide_companion(logical: string, path: string) {
		journal.companions.push([logical, path]);
	}
	build(locale: string, menuTextJson: string, visibilityJson: string): string {
		journal.built.push(`${locale}|${menuTextJson}|${visibilityJson}`);
		return layoutRendu;
	}
	free() {}
}

mock.module("../wasm/nie_wasm.js", () => ({ MenuScreenBuilder: MenuScreenBuilderDouble }));
mock.module("./bridge", () => ({ ensureWasm: async () => {} }));

const { buildMenuLayout, loadMenuLayout } = await import("./menu-layout");

/** Le détail d'écran que `/api/v1/screens/{screen}` publie. */
const DETAIL = {
	screen: "chara_bank_menu",
	cfg: "data/common/gamedata/menu/cfg/chara_bank_menu_setting.cfg.bin",
	canvas: [1280, 720],
	layers_missing: ["absent"],
	items: [
		{
			layer: "team14_01_chara_bank_list",
			objbin: "data/common/gamedata/menu/obj/team14_01_chara_bank_list.objbin",
			companions: {
				"team14_01.g4pkm": "data/common/gamedata/menu/pkm/team14_01.g4pkm",
				"team14_01.g4tx": "data/common/gamedata/menu/tex/team14_01.g4tx",
			},
		},
		{ layer: "sans_objbin", objbin: null },
	],
};

/** Les chemins que le faux serveur refuse de rendre. */
let absents = new Set<string>();
let layoutServeur: unknown = { objects: ["du serveur"] };
let serveurAppele = 0;

function installerFetch() {
	journal.files = [];
	journal.companions = [];
	journal.built = [];
	serveurAppele = 0;
	globalThis.fetch = (async (url: string) => {
		const chemin = String(url);
		if (chemin.startsWith("/api/v1/screens/")) return Response.json(DETAIL);
		if (chemin.startsWith("/api/v1/text/")) {
			return Response.json({ results: { elements: [{ hash: 1, text: "Banque" }] } });
		}
		if (chemin.startsWith("/api/v1/menu/layout/")) {
			serveurAppele += 1;
			return Response.json(layoutServeur);
		}
		if (chemin.startsWith("/f/")) {
			const path = chemin.slice("/f/".length);
			if (absents.has(path)) return new Response("", { status: 404 });
			return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
		}
		return new Response("", { status: 404 });
	}) as unknown as typeof fetch;
}

beforeEach(() => {
	absents = new Set();
	layoutRendu = JSON.stringify({ objects: [{}], diagnostics: { transformsUnresolved: 0 } });
	installerFetch();
});

describe("buildMenuLayout", () => {
	test("charge les .objbin AVANT de demander les compagnons", async () => {
		await buildMenuLayout("chara_bank_menu", "fr");
		expect(journal.files[0]).toBe("data/common/gamedata/menu/obj/team14_01_chara_bank_list.objbin");
		expect(journal.companions).toEqual([
			["team14_01.g4pkm", "data/common/gamedata/menu/pkm/team14_01.g4pkm"],
			["team14_01.g4tx", "data/common/gamedata/menu/tex/team14_01.g4tx"],
		]);
		// Les octets des compagnons suivent leur résolution, jamais l'inverse.
		expect(journal.files.slice(1).sort()).toEqual([
			"data/common/gamedata/menu/pkm/team14_01.g4pkm",
			"data/common/gamedata/menu/tex/team14_01.g4tx",
		]);
	});

	test("un calque sans .objbin n'est jamais demandé au VFS", async () => {
		await buildMenuLayout("chara_bank_menu", "fr");
		expect(journal.files.some(path => path.includes("sans_objbin"))).toBe(false);
	});

	test("un fichier que le serveur ne rend pas est COMPTÉ, pas inventé", async () => {
		absents = new Set(["data/common/gamedata/menu/tex/team14_01.g4tx"]);
		const built = await buildMenuLayout("chara_bank_menu", "fr");
		expect(built?.fetched.missing).toEqual(["data/common/gamedata/menu/tex/team14_01.g4tx"]);
		expect(built?.fetched.received).toBe(built!.fetched.requested - 1);
		// Le fichier absent n'est pas passé au constructeur sous une forme vide.
		expect(journal.files).not.toContain("data/common/gamedata/menu/tex/team14_01.g4tx");
	});

	test("la visibilité passe en clés textuelles, comme l'ABI l'attend", async () => {
		await buildMenuLayout("chara_bank_menu", "fr", new Map([[2061252611, true]]));
		expect(journal.built[0]).toContain('{"2061252611":true}');
		expect(journal.built[0]).toStartWith("fr|");
	});

	test("rend null quand le site ne connaît pas l'écran", async () => {
		globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
		expect(await buildMenuLayout("inconnu", "fr")).toBeNull();
	});
});

describe("loadMenuLayout", () => {
	test("garde le layout de la page quand elle a résolu des placements", async () => {
		const layout = (await loadMenuLayout("chara_bank_menu", "fr")) as { objects: unknown[] };
		expect(layout.objects).toHaveLength(1);
		expect(serveurAppele).toBe(0);
	});

	test("retombe sur le serveur quand AUCUN placement n'est résolu", async () => {
		// Le cas d'un serveur qui ne publie pas encore `companions` : le layout local est
		// syntaxiquement valide et visuellement vide.
		layoutRendu = JSON.stringify({
			objects: [{}, {}],
			diagnostics: { transformsUnresolved: 2 },
		});
		const layout = (await loadMenuLayout("chara_bank_menu", "fr")) as { objects: unknown[] };
		expect(layout.objects).toEqual(["du serveur"]);
		expect(serveurAppele).toBe(1);
	});

	test("retombe sur le serveur quand l'écran est inconnu de la page", async () => {
		layoutRendu = JSON.stringify({ objects: [], diagnostics: { transformsUnresolved: 0 } });
		await loadMenuLayout("chara_bank_menu", "fr");
		expect(serveurAppele).toBe(1);
	});
});
