import { describe, expect, test } from "bun:test";
import type { OptionsPage } from "./contract.ts";
import { catalogue, catalogueUrl } from "./nie-site.ts";

describe("URL des catalogues nie-site", () => {
	test("sérialise tous les filtres dans un ordre canonique", () => {
		const options = {
			page: 3,
			parPage: 25,
			q: "  CHR/A & B  ",
			glob: "  data/dx11/**,!**/movie/**  ",
			prefixe: " /data/dx11/menu// ",
			ext: "  ...G4MD  ",
			cpk: "  Common.CPK  ",
			tailleMin: 0,
			tailleMax: 4096,
			tri: "taille",
			ordre: "desc",
		} satisfies OptionsPage;
		expect(catalogueUrl("modeles", options)).toBe(
			"/api/v1/modeles?page=3&per_page=25&q=chr%2Fa+%26+b&glob=data%2Fdx11%2F**%2C%21**%2Fmovie%2F**&prefixe=data%2Fdx11%2Fmenu%2F&ext=g4md&cpk=common.cpk&taille_min=0&taille_max=4096&tri=taille&ordre=desc"
		);
	});

	test("omet les chaînes vides et conserve les valeurs par défaut", () => {
		expect(
			catalogueUrl("textures", {
				q: " \t ",
				glob: "\n",
				prefixe: " ",
				ext: " . ",
				cpk: "\n",
			})
		).toBe("/api/v1/textures?page=1&per_page=60");
	});

	test("normalise le préfixe comme le serveur et conserve le glob verbatim après trim", () => {
		expect(catalogueUrl("textures", { prefixe: "///", glob: "  DATA/**  " })).toBe(
			"/api/v1/textures?page=1&per_page=60&glob=DATA%2F**&prefixe=%2F"
		);
	});

	test("borne la pagination comme le serveur", () => {
		expect(catalogueUrl("sons", { page: -4, parPage: 500 })).toBe(
			"/api/v1/sons?page=1&per_page=200"
		);
		expect(catalogueUrl("sons", { page: 2.9, parPage: 0 })).toBe("/api/v1/sons?page=2&per_page=1");
	});

	test("normalise les bornes de taille u32 et remet les bornes croisées dans l'ordre", () => {
		expect(catalogueUrl("videos", { tailleMin: 4096, tailleMax: 0 })).toBe(
			"/api/v1/videos?page=1&per_page=60&taille_min=0&taille_max=4096"
		);
		expect(catalogueUrl("videos", { tailleMin: -5.8, tailleMax: Number.MAX_SAFE_INTEGER })).toBe(
			"/api/v1/videos?page=1&per_page=60&taille_min=0&taille_max=4294967295"
		);
	});

	test("ignore les bornes non finies au lieu de produire une query refusée", () => {
		expect(
			catalogueUrl("modeles", { tailleMin: Number.NaN, tailleMax: Number.POSITIVE_INFINITY })
		).toBe("/api/v1/modeles?page=1&per_page=60");
	});

	test("catalogue emploie l'URL canonique et transmet le signal", async () => {
		const originalFetch = globalThis.fetch;
		const controller = new AbortController();
		let requestedUrl: string | undefined;
		let requestedSignal: AbortSignal | null | undefined;
		const appliedFilters = {
			q: null,
			glob: "data/**",
			glob_vide: false,
			prefixe: "data/",
			ext: "g4tx",
			ext_inconnue: false,
			cpk: "common.cpk",
			cpk_inconnu: false,
			taille_min: 64,
			taille_max: null,
			tri: "nom" as const,
			ordre: "asc" as const,
		};
		const fetchStub = async (input: URL | RequestInfo, init?: RequestInit) => {
			requestedUrl = String(input);
			requestedSignal = init?.signal;
			return Response.json({
				elements: [],
				page: 1,
				per_page: 60,
				total: 0,
				pages: 0,
				filtres: appliedFilters,
			});
		};
		Object.defineProperty(globalThis, "fetch", {
			configurable: true,
			writable: true,
			value: fetchStub,
		});
		try {
			const result = await catalogue("textures", {
				cpk: "  menu.cpk ",
				tailleMin: 64,
				signal: controller.signal,
			});
			expect(result.filtres).toEqual(appliedFilters);
		} finally {
			Object.defineProperty(globalThis, "fetch", {
				configurable: true,
				writable: true,
				value: originalFetch,
			});
		}

		expect(requestedUrl).toBe("/api/v1/textures?page=1&per_page=60&cpk=menu.cpk&taille_min=64");
		expect(requestedSignal).toBe(controller.signal);
	});
});
