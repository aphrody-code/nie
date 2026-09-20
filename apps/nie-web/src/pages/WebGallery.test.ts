import { describe, expect, spyOn, test } from "bun:test";
import type { AssetSource } from "@niers/asset-source";
import {
	TEXTURE_DOMAINS,
	TEXTURE_TOTAL,
	createWebGalleryServices,
	rootPrefixForDomain,
	webGalleryFiltersForCategory,
	webGalleryFiltersForDomain,
	webGalleryFiltersFromUrl,
	webGalleryHrefForFilters,
	webGalleryTextureHref,
} from "./WebGallery";

describe("createWebGalleryServices", () => {
	test("round-trips q, categorie and dossier while preserving the public gallery surface", () => {
		const href = webGalleryHrefForFilters("https://nie.test/gallery_menu?display=gallery&stale=1", {
			query: "portrait",
			category: "gallery_img2",
			subfolder: "fr",
		});
		expect(href).toBe("/gallery_menu?display=gallery&stale=1&q=portrait&categorie=gallery_img2&dossier=fr");
		expect(webGalleryFiltersFromUrl(href)).toEqual({
			query: "portrait",
			category: "gallery_img2",
			subfolder: "fr",
		});
		expect(webGalleryFiltersForCategory(webGalleryFiltersFromUrl(href), "gallery_img2").subfolder).toBe("fr");
		expect(webGalleryFiltersForCategory(webGalleryFiltersFromUrl(href), "ev_pic").subfolder).toBeNull();
	});

	test("round-trips the editorial selection without changing the broad VFS default", () => {
		const href = webGalleryHrefForFilters("https://nie.test/gallery_menu?display=gallery", {
			query: "chronicle",
			category: "story",
			subfolder: null,
			view: "editorial",
			page: 3,
		});
		expect(href).toBe("/gallery_menu?display=gallery&q=chronicle&categorie=story&view=editorial&page=3");
		expect(webGalleryFiltersFromUrl(href)).toMatchObject({
			query: "chronicle", category: "story", view: "editorial", page: 3,
		});
		expect(webGalleryFiltersFromUrl("/gallery_menu").view).toBeUndefined();
	});

	test("adapts Rust editorial categories and VFS paths without inventing counts", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
			const url = new URL(String(input), "https://nie.test");
			expect(url.searchParams.get("view")).toBe("editorial");
			expect(url.searchParams.get("category")).toBe("story");
			expect(url.searchParams.get("q")).toBe("main");
			return Response.json({
				total: 242, offset: 0,
				records: [{ id: "story-1", vfsPath: "data/dx11/menu/220_img/gallery_img2/img_story_main.g4tx" }],
				categories: [{ id: "story", count: 242 }, { id: "telop_waza", count: 2490 }],
			});
		}, { preconnect: originalFetch.preconnect });
		try {
			const page = await createWebGalleryServices({} as AssetSource).editorialPage!("story", 120, 0, " main ");
			expect(page).toEqual({
				files: [{ path: "data/dx11/menu/220_img/gallery_img2/img_story_main.g4tx", size: 0 }],
				total: 242,
				offset: 0,
				categories: [{ name: "story", count: 242 }, { name: "telop_waza", count: 2490 }],
			});
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("opens an asset in the canonical localized texture catalogue", () => {
		expect(webGalleryTextureHref("https://nie.test/gallery_menu?display=gallery&categorie=ev_pic", "data/dx11/menu/a.g4tx"))
			.toBe("/textures?q=data%2Fdx11%2Fmenu%2Fa.g4tx");
		expect(webGalleryTextureHref("https://nie.test/ja/gallery_menu?display=gallery", "data/dx11/menu/a.g4tx"))
			.toBe("/ja/textures?q=data%2Fdx11%2Fmenu%2Fa.g4tx");
	});

	test("exports the decoded texture through a PNG download", async () => {
		const fetchMock = spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["png"]), { status: 200 }));
		const createUrl = spyOn(URL, "createObjectURL").mockReturnValue("blob:gallery-export");
		const revokeUrl = spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
		const timer = spyOn(globalThis, "setTimeout").mockImplementation(((handler: TimerHandler) => {
			if (typeof handler === "function") handler();
			return 0;
		}) as typeof setTimeout);
		const downloaded: { current: { href: string; name: string } | null } = { current: null };
		const anchorPrototype = Object.getPrototypeOf(document.createElement("a")) as HTMLAnchorElement;
		const click = spyOn(anchorPrototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
			downloaded.current = { href: this.href, name: this.download };
		});
		try {
			const source = { urlTexture: () => "/api/v1/texture/a" } as unknown as AssetSource;
			await createWebGalleryServices(source).exportPng("data/menu/gallery/example.g4tx");
			expect(fetchMock).toHaveBeenCalledWith("/api/v1/texture/a");
			expect(downloaded.current).toEqual({ href: "blob:gallery-export", name: "example.png" });
			expect(revokeUrl).toHaveBeenCalledWith("blob:gallery-export");
		} finally {
			click.mockRestore();
			timer.mockRestore();
			revokeUrl.mockRestore();
			createUrl.mockRestore();
			fetchMock.mockRestore();
		}
	});

	test("lists an exact prefix through one bounded catalogue page", async () => {
		const calls: Array<Record<string, unknown>> = [];
		const source = {
			catalogue: async (_view: string, options: Record<string, unknown>) => {
				calls.push(options);
				return {
					elements: [{ chemin: "data/dx11/menu/220_img/gallery_img2/a.g4tx", nom: "a.g4tx", taille: 42 }],
					page: 2,
					per_page: 60,
					total: 121,
					pages: 3,
					filtres: {},
				};
			},
		} as unknown as AssetSource;

		const page = await createWebGalleryServices(source).findPaged(
			"data/dx11/menu/220_img/gallery_img2",
			"g4tx",
			60,
			60,
		);

		expect(calls).toEqual([{
			prefixe: "data/dx11/menu/220_img/gallery_img2",
			ext: "g4tx",
			page: 2,
			parPage: 60,
		}]);
		expect(page).toEqual({
			files: [{ path: "data/dx11/menu/220_img/gallery_img2/a.g4tx", size: 42 }],
			total: 121,
			offset: 60,
		});
	});

	test("never asks the site for more than its 200-row bound", async () => {
		let requested: Record<string, unknown> | undefined;
		const source = {
			catalogue: async (_view: string, options: Record<string, unknown>) => {
				requested = options;
				return { elements: [], page: 1, per_page: 200, total: 0, pages: 0, filtres: {} };
			},
		} as unknown as AssetSource;

		await createWebGalleryServices(source).findPaged("data/dx11/menu/220_img", "g4tx", 30_000, 0);
		expect(requested?.parPage).toBe(200);
		expect(requested).not.toHaveProperty("q");
	});

	test("passes the visible query to the full server collection", async () => {
		let requested: Record<string, unknown> | undefined;
		const source = {
			catalogue: async (_view: string, options: Record<string, unknown>) => {
				requested = options;
				return { elements: [], dossiers: [], total: 0 };
			},
		} as unknown as AssetSource;
		await createWebGalleryServices(source).findPaged("data/dx11/menu/220_img", "g4tx", 60, 0, undefined, "  goal  ");
		expect(requested?.q).toBe("goal");
	});

	test("finds a gallery asset by its localized visible name", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = Object.assign(async (input: RequestInfo | URL) => {
			expect(String(input)).toContain("/api/v1/wiki/names/search?");
			return Response.json({ records: [{ code: "c01000100" }] });
		}, { preconnect: originalFetch.preconnect });
		try {
			const source = {
				catalogue: async (_view: string, options: { q?: string }) => options.q === "Marc"
					? { elements: [], total: 0, pages: 0 }
					: { elements: [{ chemin: "data/dx11/menu/220_img/gallery_img2/c01000100.g4tx", taille: 42 }], total: 1, pages: 1 },
			} as unknown as AssetSource;
			const page = await createWebGalleryServices(source, undefined, "fr").findPaged(
				"data/dx11/menu/220_img/gallery_img2", "g4tx", 60, 0, undefined, "Marc",
			);
			expect(page.files.map(file => file.path)).toEqual([
				"data/dx11/menu/220_img/gallery_img2/c01000100.g4tx",
			]);
			expect(page.total).toBe(1);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("bounds localized-name expansion and forwards cancellation to every request", async () => {
		const originalFetch = globalThis.fetch;
		const controller = new AbortController();
		let catalogueCalls = 0;
		globalThis.fetch = Object.assign(async (_input: RequestInfo | URL, init?: RequestInit) => {
			expect(init?.signal).toBe(controller.signal);
			return Response.json({ records: Array.from({ length: 30 }, (_, index) => ({ code: `c${index}` })) });
		}, { preconnect: originalFetch.preconnect });
		try {
			const source = {
				catalogue: async (_view: string, options: { signal?: AbortSignal }) => {
					catalogueCalls += 1;
					expect(options.signal).toBe(controller.signal);
					return { elements: [], total: 0, pages: 0 };
				},
			} as unknown as AssetSource;
			await createWebGalleryServices(source).findPaged(
				"data/dx11/menu/220_img", "g4tx", 60, 0, undefined, "Marc", controller.signal,
			);
			// One native-path query plus at most twelve exact-code expansions.
			expect(catalogueCalls).toBe(13);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("partitions the whole texture corpus across its 6 domains", () => {
		expect(TEXTURE_DOMAINS.map(d => d.id)).toEqual([
			"menu",
			"characters",
			"effects",
			"maps",
			"fonts",
			"events",
		]);
		// La somme EST le corpus : une pastille manquante se voit ici, pas sur un écran.
		expect(TEXTURE_DOMAINS.reduce((n, d) => n + d.count, 0)).toBe(TEXTURE_TOTAL);
		// Et les préfixes sont disjoints — sans quoi la somme serait juste par compensation.
		for (const a of TEXTURE_DOMAINS)
			for (const b of TEXTURE_DOMAINS)
				if (a !== b) expect(b.prefix.startsWith(`${a.prefix}/`)).toBe(false);
		expect(rootPrefixForDomain("menu")).toBe("data/dx11/menu");
		expect(rootPrefixForDomain("characters")).toBe("data/dx11/chr");
		expect(rootPrefixForDomain("effects")).toBe("data/dx11/effect");
		expect(rootPrefixForDomain("maps")).toBe("data/dx11/map");
		expect(rootPrefixForDomain("fonts")).toBe("data/dx11/font");
		expect(rootPrefixForDomain("events")).toBe("data/dx11/event");
		expect(rootPrefixForDomain(null)).toBe("data/dx11/menu");
		expect(rootPrefixForDomain("unknown")).toBe("data/dx11/menu");
	});

	test("keeps the two former domains addressable as categories of the menu tree", () => {
		expect(rootPrefixForDomain("illustrations")).toBe("data/dx11/menu");
		expect(rootPrefixForDomain("icons")).toBe("data/dx11/menu");
		expect(webGalleryFiltersFromUrl("/gallery_menu?domaine=illustrations")).toEqual({
			query: "",
			category: "220_img",
			subfolder: null,
			domain: "menu",
		});
		expect(webGalleryFiltersFromUrl("/gallery_menu?domaine=icons")).toEqual({
			query: "",
			category: "200_icon",
			subfolder: null,
			domain: "menu",
		});
		// Une catégorie écrite dans l'URL est plus précise que celle de l'alias : elle gagne.
		expect(webGalleryFiltersFromUrl("/gallery_menu?domaine=illustrations&categorie=ev_pic").category).toBe("ev_pic");
	});

	test("round-trips domaine parameter and resets sub-filters on domain change", () => {
		const href = webGalleryHrefForFilters("https://nie.test/gallery_menu", {
			query: "face",
			category: "_face",
			subfolder: null,
			domain: "characters",
		});
		expect(href).toBe("/gallery_menu?q=face&categorie=_face&domaine=characters");
		expect(webGalleryFiltersFromUrl(href)).toEqual({
			query: "face",
			category: "_face",
			subfolder: null,
			domain: "characters",
		});

		const switched = webGalleryFiltersForDomain(webGalleryFiltersFromUrl(href), "effects");
		expect(switched).toEqual({
			query: "face",
			category: null,
			subfolder: null,
			domain: "effects",
		});

		// Revenir au domaine par défaut EFFACE le paramètre : l'URL la plus courte est la
		// canonique, et deux URL pour une même grille se partagent mal.
		const switchedToDefault = webGalleryFiltersForDomain(switched, "menu");
		expect(switchedToDefault.domain).toBeUndefined();
		expect(webGalleryHrefForFilters("/gallery_menu", switchedToDefault)).toBe("/gallery_menu?q=face");
	});
});
