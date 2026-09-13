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
let observerOriginal: typeof IntersectionObserver;

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
	// happy-dom FOURNIT `IntersectionObserver` (vérifié, pas supposé) — mais rien n'y déclenche
	// jamais d'intersection, faute de mise en page. Sans ce pilote, la page reste sur son état
	// d'attente et le test lit « Rendu… » en croyant lire un résultat : c'est exactement ce qui
	// s'est produit avant de mesurer. On le remplace par un observateur qui signale l'entrée
	// dans le champ dès qu'on observe un élément, ce que fait un vrai navigateur pour une
	// fiche ouverte en haut de page.
	URL.createObjectURL = () => "blob:rendu";
	URL.revokeObjectURL = () => {};
	observerOriginal = globalThis.IntersectionObserver;
	globalThis.IntersectionObserver = class {
		constructor(private readonly rappel: IntersectionObserverCallback) {}
		observe(cible: Element) {
			this.rappel([{ isIntersecting: true, target: cible } as IntersectionObserverEntry], this);
		}
		disconnect() {}
		unobserve() {}
		takeRecords() { return []; }
		readonly root = null;
		readonly rootMargin = "";
		readonly thresholds = [];
	} as unknown as typeof IntersectionObserver;
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	const respond = Object.assign(async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		if (url.includes("/api/v1/menu/render/")) {
			// Le premier écran a été dessiné, le second ne l'a pas été : c'est la mesure de
			// production, où `victory_road_final_tournament_menu` ne rend rien.
			const dessine = url.includes("victory_road_top_menu");
			return new Response(new Blob([new Uint8Array([137, 80, 78, 71])]), {
				headers: {
					"content-type": "image/png",
					"x-compose-drawn": dessine ? "32" : "0",
					"x-compose-skipped": "0",
				},
			});
		}
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
	globalThis.IntersectionObserver = observerOriginal;
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function mount(route: string) {
	await act(async () => root?.render(<Modes prefix="" route={route} />));
	await flush();
}

/**
 * Vide la file d'attente jusqu'à ce que les effets en chaîne soient retombés.
 *
 * Il y en a plusieurs : le catalogue, puis la résolution des libellés, puis — par écran — le
 * `fetch` du rendu, la lecture de son `Blob` et l'état qui en découle. Un seul
 * `await Promise.resolve()` n'en franchit qu'un, et le test lisait « Rendu… » en croyant lire
 * un résultat.
 */
async function flush() {
	for (let i = 0; i < 8; i += 1) {
		await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
	}
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

	test("un écran dessiné est montré, avec le compte que le moteur publie", async () => {
		await mount("modes/victory_road");
		await flush();
		const images = [...container.querySelectorAll("img")];
		expect(images.length).toBe(1);
		expect(images[0]!.getAttribute("alt")).toBe("victory_road_top_menu");
		expect(container.textContent).toContain("32 objets dessinés");
		// Les comptes de la fiche sont CEUX DU SERVEUR : la page n'en calcule aucun.
		expect(container.textContent).toContain("235");
	});

	test("un écran que le moteur n'a pas dessiné le DIT, au lieu d'une toile vide", async () => {
		// `/api/v1/menu/render/<ecran>` répond 200 avec un PNG entièrement transparent quand la
		// composition ne dessine rien — mesuré : 1280×720, 1 couleur, 0 pixel opaque sur 921 600.
		// Une balise `<img>` l'afficherait comme un rendu ; `x-compose-drawn: 0` dit la vérité.
		await mount("modes/victory_road");
		await flush();
		expect(container.textContent).toContain("n'a dessiné aucun objet");
		// Et surtout : aucune image pour cet écran-là.
		expect(container.querySelectorAll("img").length).toBe(1);
	});
});
