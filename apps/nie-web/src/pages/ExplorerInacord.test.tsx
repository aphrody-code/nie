import { beforeEach, describe, expect, test } from "bun:test";
import type { AssetSource, ContenuDossier } from "@niers/asset-source";
import { AssetSourceProvider } from "@niers/inacord-ui";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { childPath, ExplorerInacord, formatBytes } from "./ExplorerInacord";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const rootContent: ContenuDossier = {
	prefixe: "data/common",
	dossiers: ["data/common/action"],
	folderCounts: { "data/common/action": 12 },
	fichiers: [{ chemin: "data/common/readme.bin", nom: "readme.bin", taille: 2048 }],
	total: 1,
};

const source: AssetSource = {
	hote: "test",
	capacites: async () => ({ vfs: true, texture: true, modele: false, avatar: false, audio: false, video: false, wiki: false, ecriture: false, disque: false, outils: false }),
	sante: async () => ({ api: "ok", capacites: { vfs: "pret", vfs_entrees: 2, vfs_dump: true, vfs_contenu: true, gisement: false, anime: false, bundle: true }, vues: [] }),
	parcourir: async (prefixe) => prefixe === "data/common" ? rootContent : { prefixe, dossiers: [], fichiers: [], total: 0 },
	catalogue: async () => ({ elements: [], page: 1, per_page: 10, total: 0, pages: 0 }),
	urlFichier: (path) => `/f/${path}`,
	urlTexture: (path) => `/texture/${path}`,
};

function byButton(container: ParentNode, label: string): HTMLButtonElement {
	const found = [...container.querySelectorAll("button")].find((element) => element.getAttribute("aria-label") === label || element.textContent?.includes(label));
	if (!(found instanceof HTMLButtonElement)) throw new Error(`Missing ${label}`);
	return found;
}

async function renderExplorer(): Promise<HTMLDivElement> {
	const container = document.createElement("div");
	document.body.append(container);
	await act(async () => {
		createRoot(container).render(<AssetSourceProvider source={source}><ExplorerInacord /></AssetSourceProvider>);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	await act(async () => {
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	});
	return container;
}

beforeEach(() => {
	localStorage.clear();
	window.history.replaceState({}, "", "/explorer?d=data%2Fcommon");
	document.body.replaceChildren();
});

describe("ExplorerInacord", () => {
	test("normalizes paths and byte labels", () => {
		expect(childPath("data/common", "action")).toBe("data/common/action");
		expect(childPath("data/common", "data/common/action")).toBe("data/common/action");
		expect(formatBytes(2048)).toBe("2.0 Ko");
	});

	test("renders real VFS rows, folder counts and the inspector", async () => {
		const container = await renderExplorer();
		expect(container.querySelector(".inacord-explorer-page")).not.toBeNull();
		expect(container.textContent).toContain("action");
		expect(container.textContent).toContain("12");
		expect(container.textContent).toContain("readme.bin");
		act(() => byButton(container, "readme.bin").click());
		expect(container.textContent).toContain("Ouvrir le fichier");
	});

	test("opens the display popover and switches to the grid", async () => {
		const container = await renderExplorer();
		act(() => byButton(container, "Options d'affichage").click());
		expect(container.querySelector('[role="dialog"][aria-label="Options d\'affichage"]')).not.toBeNull();
		act(() => byButton(container, "Grille").click());
		expect(container.querySelector(".inacord-explorer-entries--grid")).not.toBeNull();
	});

	test("supports new, close and cycle tab keyboard shortcuts", async () => {
		const container = await renderExplorer();
		act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true })));
		expect(container.querySelectorAll('[role="tablist"][aria-label="Explorer tabs"] [role="tab"]')).toHaveLength(2);
		act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", ctrlKey: true })));
		expect(container.querySelectorAll('[role="tab"][aria-selected="true"]')).toHaveLength(2); // active Explorer tab + inspector tab
		act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true })));
		expect(container.querySelectorAll('[role="tablist"][aria-label="Explorer tabs"] [role="tab"]')).toHaveLength(1);
	});
});
