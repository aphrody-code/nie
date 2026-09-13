import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Modes } from "./Modes";

/**
 * La page des modes, montée pour de vrai.
 *
 * Ce qu'un test de routage ne couvre pas : que le nom affiché vient bien de `menu_text` et non
 * du catalogue, et que l'écran qui ne se rend pas le DIT au lieu de laisser un cadre. Les deux
 * sont la raison d'être de la page — elle remplace une liste de noms de fichiers par des écrans
 * rendus, sous le nom que le jeu leur donne.
 */

let root: Root | null;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof spyOn>;

const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

/** Deux modes : un que `menu_text` nomme, un qui n'a pas de hash du tout. */
const CATALOGUE = {
	results: {
		pages: 1,
		elements: [
			{
				slug: "victory_road",
				label: "Victory Road",
				official: true,
				prefixes: ["victory_road", "vroad_"],
				icon_region: "mode_base04",
				label_hash: "0x80cd176b",
				note: "Tournoi en ligne en trois phases.",
			},
			{
				slug: "play_guide",
				label: "Guide de jeu",
				official: false,
				prefixes: ["play_guide"],
				icon_region: null,
				label_hash: null,
				note: "Ecrans d'aide.",
			},
		],
	},
};

const FICHE = {
	slug: "victory_road",
	label: "Victory Road",
	label_hash: "0x80cd176b",
	official: true,
	prefixes: ["victory_road"],
	counts: { screens: 2, layers: 235, unreadable: 0 },
	components: [{ type_name: "CMenuAnimation", count: 194 }],
	scripts: [{ path: "data/common/script/lua/x.lua.bin", bytes: 7264, instructions: 698, functions: 18 }],
	screens: [
		{ screen: "victory_road_top_menu", cfg: "a.cfg.bin", bytes: 4912, layers: ["l1", "l2"], focus: 3 },
		{ screen: "victory_road_final_tournament_menu", cfg: "b.cfg.bin", bytes: 1728, layers: ["l3"], focus: 0 },
	],
};

beforeEach(() => {
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	const respond = Object.assign(async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url.includes("/api/v1/modes/")) return Response.json(FICHE);
		if (url.includes("/api/v1/modes")) return Response.json(CATALOGUE);
		if (url.includes("/api/v1/graphql")) {
			// La ligne que le jeu écrit pour ce hash, dans la langue demandée.
			return Response.json({
				data: { texts: [{ family: "menu_text", hash: "0x80cd176b", texts: ["Victory Road"] }] },
			});
		}
		return new Response(null, { status: 404 });
	}, { preconnect: globalThis.fetch.preconnect });
	fetchMock = spyOn(globalThis, "fetch").mockImplementation(respond);
});

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	container.remove();
	fetchMock.mockRestore();
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function mount(route: string) {
	await act(async () => root?.render(<Modes prefix="" route={route} />));
	// Deux effets en chaîne : le catalogue, puis la résolution des libellés.
	await act(async () => { await Promise.resolve(); });
}

describe("la page des modes", () => {
	test("la liste montre chaque mode et mène à sa fiche par son nom du VFS", async () => {
		await mount("modes");
		const texte = container.textContent ?? "";
		expect(texte).toContain("Victory Road");
		expect(texte).toContain("Guide de jeu");
		// Le lien porte le slug du VFS, pas une forme web.
		const liens = [...container.querySelectorAll("a")].map((a) => a.getAttribute("href"));
		expect(liens).toContain("/modes/victory_road");
		expect(liens).toContain("/modes/play_guide");
		expect(liens.some((h) => h?.includes("-"))).toBe(false);
	});

	test("la fiche rend les écrans, et chaque image vise la route de rendu", async () => {
		await mount("modes/victory_road");
		const images = [...container.querySelectorAll("img")].map((i) => i.getAttribute("src"));
		expect(images).toEqual([
			"/api/v1/menu/render/victory_road_top_menu",
			"/api/v1/menu/render/victory_road_final_tournament_menu",
		]);
		// Les comptes affichés sont CEUX DU SERVEUR : la page n'en calcule aucun.
		expect(container.textContent).toContain("235");
	});

	test("un écran que le serveur ne rend pas le dit, au lieu de laisser un cadre", async () => {
		// `victory_road_final_tournament_menu` répond 504 en production : c'est une mesure sur le
		// moteur, pas un trou d'affichage. Une image vide laisserait croire que l'écran est vide.
		await mount("modes/victory_road");
		const cassee = container.querySelectorAll("img")[1]!;
		await act(async () => cassee.dispatchEvent(new Event("error")));
		expect(container.querySelectorAll("img").length).toBe(1);
		expect(container.textContent).toContain("n'a pas rendu cet écran");
	});
});
