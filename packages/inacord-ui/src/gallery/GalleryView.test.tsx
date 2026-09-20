import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AssetSourceProvider } from "../source";
import { GalleryView } from "./GalleryView";
import type { GalleryServices } from "./contracts";

class PassiveIntersectionObserver {
	observe() {}
	unobserve() {}
	disconnect() {}
	takeRecords(): IntersectionObserverEntry[] { return []; }
	readonly root = null;
	readonly rootMargin = "0px";
	readonly thresholds = [0];
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const previousObserver = globalThis.IntersectionObserver;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;
environment.IS_REACT_ACT_ENVIRONMENT = true;
const source = { capacites: async () => ({ vfs: true }) } as never;

afterEach(async () => {
	if (root) await act(async () => root?.unmount());
	container?.remove();
	root = null;
	container = null;
	globalThis.IntersectionObserver = previousObserver;
	environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("GalleryView pagination", () => {
	test("requests 120-row pages and advances with the current offset", async () => {
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.IntersectionObserver = PassiveIntersectionObserver as unknown as typeof IntersectionObserver;
		const calls: Array<{ prefix: string; limit: number; offset: number }> = [];
		const services: GalleryServices = {
			async ls(prefix) {
				return prefix.endsWith("220_img") ? { dirs: [{ name: "gallery_img2", count: 121 }] } : { dirs: [] };
			},
			async findPaged(prefix, _ext, limit, offset) {
				calls.push({ prefix, limit, offset });
				const count = offset === 0 ? 120 : 1;
				return {
					files: Array.from({ length: count }, (_, index) => ({
						path: `${prefix}img_${offset + index}.g4tx`,
						size: 1,
					})),
					total: 121,
					offset,
				};
			},
			gameDataGallery: () => new Promise(() => undefined),
			texturePngB64: async () => "",
			exportPng: async () => undefined,
			formatBytes: String,
		};

		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		await act(async () => root?.render(
			<AssetSourceProvider source={source}>
				<GalleryView services={services} category="gallery_img2" />
			</AssetSourceProvider>,
		));
		await act(async () => undefined);

		expect(calls[0]).toEqual({
			prefix: "data/dx11/menu/220_img/gallery_img2/",
			limit: 120,
			offset: 0,
		});
		const more = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("Afficher la suite"));
		expect(more).toBeDefined();
		await act(async () => more?.click());
		expect(calls.at(-1)).toEqual({
			prefix: "data/dx11/menu/220_img/gallery_img2/",
			limit: 120,
			offset: 120,
		});
	});

	test("preserves a valid controlled category and subfolder across mount and URL restoration", async () => {
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.IntersectionObserver = PassiveIntersectionObserver as unknown as typeof IntersectionObserver;
		const prefixes: string[] = [];
		const cleared: Array<string | null> = [];
		const services: GalleryServices = {
			async ls(prefix) {
				if (prefix.endsWith("220_img")) return { dirs: [{ name: "gallery_img2", count: 2 }] };
				return { dirs: [{ name: "fr", count: 1 }, { name: "en", count: 1 }] };
			},
			async findPaged(prefix) {
				prefixes.push(prefix);
				return { files: [], total: 0, offset: 0 };
			},
			async gameDataGallery() { return []; },
			async texturePngB64() { return ""; },
			async exportPng() {},
			formatBytes: String,
		};

		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		await act(async () => root?.render(
			<AssetSourceProvider source={source}>
				<GalleryView services={services} category="gallery_img2" subfolder="fr" onSubfolderChange={value => cleared.push(value)} />
			</AssetSourceProvider>,
		));
		await act(async () => undefined);
		expect(prefixes).toContain("data/dx11/menu/220_img/gallery_img2/fr/");
		expect(cleared).toEqual([]);

		await act(async () => root?.render(
			<AssetSourceProvider source={source}>
				<GalleryView services={services} category="gallery_img2" subfolder="en" onSubfolderChange={value => cleared.push(value)} />
			</AssetSourceProvider>,
		));
		await act(async () => undefined);
		expect(prefixes).toContain("data/dx11/menu/220_img/gallery_img2/en/");
		expect(cleared).toEqual([]);
	});

	test("defaults to every category and queries the gallery root", async () => {
		environment.IS_REACT_ACT_ENVIRONMENT = true;
		globalThis.IntersectionObserver = PassiveIntersectionObserver as unknown as typeof IntersectionObserver;
		// Sans catégorie contrôlée, la vue interrogeait la PREMIÈRE renvoyée par `ls`. La galerie
		// complète — 17 085 illustrations — n’était alors atteignable par aucun filtre, et une
		// recherche ne portait que sur ce dossier sans que rien ne le dise.
		const prefixes: string[] = [];
		const services: GalleryServices = {
			async ls(prefix) {
				return prefix.endsWith("220_img")
					? { dirs: [{ name: "activity_photo", count: 3 }, { name: "gallery_img2", count: 17 }] }
					: { dirs: [] };
			},
			async findPaged(prefix) {
				prefixes.push(prefix);
				return { files: [], total: 20, offset: 0 };
			},
			async gameDataGallery() { return []; },
			async texturePngB64() { return ""; },
			async exportPng() {},
			formatBytes: String,
		};

		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		await act(async () => root?.render(
			<AssetSourceProvider source={source}>
				<GalleryView services={services} />
			</AssetSourceProvider>,
		));
		await act(async () => undefined);

		// Un ensemble, pas une liste : l'arrivée de `gallery_config` relance la page courante,
		// donc la racine est demandée deux fois. Ce qui compte ici est qu'AUCUNE catégorie ne
		// soit interrogée à sa place.
		expect([...new Set(prefixes)]).toEqual(["data/dx11/menu/220_img/"]);
		expect(prefixes).not.toContain("data/dx11/menu/220_img/activity_photo/");
		const all = [...container.querySelectorAll("button")]
			.find(button => button.textContent?.includes("Toutes les catégories"));
		expect(all?.textContent).toContain("20");
	});
});
