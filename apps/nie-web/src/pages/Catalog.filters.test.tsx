import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AssetSource, OptionsPage } from "@nie/asset-source";
import { AssetSourceProvider } from "@nie/inacord-ui";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Catalog } from "./Catalog";

let root: Root | null;
let container: HTMLDivElement;
const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

const catalogue = mock(async (_view: string, options: OptionsPage = {}) => ({
	elements: [],
	page: options.page ?? 1,
	per_page: options.parPage ?? 60,
	total: 0,
	pages: 0,
	filtres: {
		q: options.q ?? null,
		glob: options.glob ?? null,
		glob_vide: false,
		prefixe: options.prefixe ?? null,
		ext: options.ext ?? null,
		ext_inconnue: false,
		cpk: options.cpk ?? null,
		cpk_inconnu: false,
		taille_min: options.tailleMin ?? null,
		taille_max: options.tailleMax ?? null,
		tri: options.tri ?? "nom",
		ordre: options.ordre ?? "asc",
	},
}));

const source = {
	hote: "test",
	capacites: async () => ({
		vfs: true,
		texture: false,
		modele: false,
		avatar: false,
		audio: false,
		video: false,
		wiki: false,
		ecriture: false,
		disque: false,
		outils: false,
	}),
	sante: async () => ({
		api: "test",
		capacites: { vfs: "pret", vfs_entrees: 1, vfs_dump: true, vfs_contenu: true, gisement: false, anime: false, bundle: true },
		vues: [],
	}),
	parcourir: async (prefixe: string) => ({ prefixe, dossiers: [], fichiers: [], total: 0, page: 1, parPage: 60 }),
	catalogue,
	urlFichier: (path: string) => `/f/${path}`,
} as AssetSource;

async function settle(): Promise<void> {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await Promise.resolve();
	});
}

function button(text: string): HTMLButtonElement {
	const found = [...container.querySelectorAll<HTMLButtonElement>("button")]
		.find((candidate) => candidate.getAttribute("aria-label") === text || candidate.textContent?.includes(text));
	if (!found) throw new Error(`Missing button: ${text}`);
	return found;
}

beforeEach(() => {
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
	(window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL(
		"http://localhost:3000/textures?glob=old%2F**&prefixe=data%2Fold&cpk=old.cpk&taille_min=10&taille_max=20",
	);
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	catalogue.mockClear();
});

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	container.remove();
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("catalogue filter panel", () => {
	test("replaces the retired par_page spelling with the canonical per_page key", async () => {
		window.history.replaceState(null, "", "/textures?par_page=100");
		await act(async () => root?.render(
			<AssetSourceProvider source={source}>
				<Catalog view="textures" />
			</AssetSourceProvider>,
		));
		await settle();

		const params = new URLSearchParams(window.location.search);
		expect(params.get("per_page")).toBe("100");
		expect(params.has("par_page")).toBeFalse();
	});

	test("sends all eleven controls and displays the filters confirmed by the backend", async () => {
		window.history.replaceState(
			null,
			"",
				"/textures?q=LOCAL&glob=data%2F**&prefixe=data%2Fdx11&ext=g4tx&cpk=missing.cpk&taille_min=10&taille_max=20&tri=taille&ordre=desc&per_page=100&page=3",
		);
		catalogue.mockImplementationOnce(async (_view, options: OptionsPage = {}) => ({
			elements: [], page: 3, per_page: 100, total: 0, pages: 0,
			filtres: {
				q: "local",
				glob: null,
				glob_vide: true,
				prefixe: "data/dx11/",
				ext: null,
				ext_inconnue: true,
				cpk: null,
				cpk_inconnu: true,
				taille_min: options.tailleMin ?? null,
				taille_max: options.tailleMax ?? null,
				tri: "taille",
				ordre: "desc",
			},
		}));

		await act(async () => root?.render(
			<AssetSourceProvider source={source}>
				<Catalog view="textures" />
			</AssetSourceProvider>,
		));
		await settle();

		expect(catalogue.mock.calls.at(-1)?.[1]).toMatchObject({
			q: "LOCAL",
			glob: "data/**",
			prefixe: "data/dx11",
			ext: "g4tx",
			cpk: "missing.cpk",
			tailleMin: 10,
			tailleMax: 20,
			tri: "taille",
			ordre: "desc",
			parPage: 100,
			page: 3,
		});
		const applied = container.querySelector("[data-catalog-applied-filters]");
		expect(applied?.textContent).toContain("recherche « local »");
		expect(applied?.textContent).not.toContain("recherche « LOCAL »");
		expect(container.querySelectorAll("[data-catalog-filter-warning]")).toHaveLength(3);
	});

	test("reset clears free-form filters before a new value is confirmed", async () => {
		await act(async () => root?.render(
			<AssetSourceProvider source={source}>
				<Catalog view="textures" />
			</AssetSourceProvider>,
		));
		await settle();

		await act(async () => button("Filtres").click());
		await act(async () => button("Réinitialiser").click());
		await act(async () => button("Archive CPK").click());

		const input = container.querySelector<HTMLInputElement>('input[aria-label="Nom exact de l’archive CPK"]');
		expect(input).not.toBeNull();
		await act(async () => {
			Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "new.cpk");
			input!.dispatchEvent(new Event("input", { bubbles: true }));
			input!.dispatchEvent(new Event("change", { bubbles: true }));
		});
		await settle();
		await act(async () => button("Confirmer").click());
		await settle();

		const params = new URLSearchParams(window.location.search);
		expect(params.get("cpk")).toBe("new.cpk");
		expect(params.has("glob")).toBeFalse();
		expect(params.has("prefixe")).toBeFalse();
		expect(params.has("taille_min")).toBeFalse();
		expect(params.has("taille_max")).toBeFalse();
		expect(catalogue.mock.calls.at(-1)?.[1]).toMatchObject({
			cpk: "new.cpk",
			glob: "",
			prefixe: "",
			tailleMin: undefined,
			tailleMax: undefined,
		});
	});
});
