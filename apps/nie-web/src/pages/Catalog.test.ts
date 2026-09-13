import { describe, expect, test } from "bun:test";
import { catalogHrefForView, filterStateFromUrl } from "./Catalog";

describe("catalogue URL state", () => {
	test("reads every server filter and pagination control from the URL", () => {
		expect(filterStateFromUrl(
				"?q=chara&glob=data%2Fdx11%2F**&prefixe=data%2Fdx11%2Fmenu&ext=g4tx&cpk=common.cpk&taille_min=0&taille_max=1048576&tri=taille&ordre=desc&per_page=100&page=7",
		)).toEqual({
			q: "chara",
			glob: "data/dx11/**",
			prefixe: "data/dx11/menu",
			ext: "g4tx",
			sort: "taille",
			order: "desc",
			cpk: "common.cpk",
			tailleMin: 0,
			tailleMax: 1_048_576,
			pageSize: 100,
			page: 7,
		});
	});

	test("reads the retired par_page spelling only as compatibility input", () => {
		expect(filterStateFromUrl("?par_page=100").pageSize).toBe(100);
		expect(filterStateFromUrl("?par_page=100&per_page=200").pageSize).toBe(200);
		expect(catalogHrefForView("https://nie.test/textures?par_page=100", "sons")).toBe(
			"/sons?per_page=100",
		);
	});

	test("normalizes invalid bounds and pagination instead of promising unsupported values", () => {
		expect(filterStateFromUrl("?taille_min=-1&taille_max=NaN&per_page=999&page=0")).toMatchObject({
			tailleMin: undefined,
			tailleMax: undefined,
			pageSize: 60,
			page: 1,
		});
	});

	test("changes language-prefixed paths and preserves only filters meaningful to a VFS target", () => {
		const href = catalogHrefForView(
				"https://nie.test/ja/textures?q=hero&glob=data%2F**&prefixe=data%2Fdx11&ext=g4tx&cpk=common.cpk&taille_min=0&taille_max=4096&tri=taille&ordre=desc&per_page=100&page=8&display=gallery&vue=videos",
			"sons",
		);
		const url = new URL(href, "https://nie.test");
		expect(url.pathname).toBe("/ja/sons");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			q: "hero",
			glob: "data/**",
			prefixe: "data/dx11",
			tri: "taille",
			ordre: "desc",
				per_page: "100",
			cpk: "common.cpk",
			taille_min: "0",
			taille_max: "4096",
		});
	});

	test("legacy media migration matches the server and preserves every non-selector parameter", () => {
		const href = catalogHrefForView(
			"https://nie.test/es/medias?vue=modeles&famille=objet&q=ballon&glob=**%2Fchr%2F**&cpk=data.cpk&tri=taille&page=4",
			"modeles",
			{ resetPage: false },
		);
		const url = new URL(href, "https://nie.test");
		expect(url.pathname).toBe("/es/modeles");
		expect(Object.fromEntries(url.searchParams)).toEqual({
			famille: "objet",
			q: "ballon",
			glob: "**/chr/**",
			cpk: "data.cpk",
			tri: "taille",
			page: "4",
		});
	});

	test("legacy media uses the last valid repeated selector, like the HTTP redirect", () => {
		const href = catalogHrefForView(
			"https://nie.test/ja/medias?vue=videos&vue=inconnue&vue=modeles&q=x",
			"modeles",
			{ resetPage: false },
		);
		expect(href).toBe("/ja/modeles?q=x");
	});

	test("keeps a valid type-specific extension only for its destination", () => {
		const audio = new URL(
			catalogHrefForView("https://nie.test/textures?ext=awb", "sons"),
			"https://nie.test",
		);
		const video = new URL(
			catalogHrefForView("https://nie.test/textures?ext=awb", "videos"),
			"https://nie.test",
		);
		const nativeVideo = new URL(
			catalogHrefForView("https://nie.test/sons?ext=webm", "videos"),
			"https://nie.test",
		);
		expect(audio.searchParams.get("ext")).toBe("awb");
		expect(video.searchParams.has("ext")).toBeFalse();
		expect(nativeVideo.searchParams.get("ext")).toBe("webm");
	});
});
