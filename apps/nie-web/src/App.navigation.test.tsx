import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { loadMenuPresentation } from "./game/bridge";
import { setSettings } from "@niers/inacord-ui/lib/settings";

let root: Root | null;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof spyOn>;

const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

function wasmResponse(url: string): Response | null {
	if (!url.endsWith("/static/game/nie_wasm_bg.wasm")) return null;
	return new Response(Bun.file(new URL("../public/static/game/nie_wasm_bg.wasm", import.meta.url)), {
		headers: { "content-type": "application/wasm" },
	});
}

beforeEach(() => {
	reactEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
	(window as unknown as { happyDOM: { setURL: (url: string) => void } }).happyDOM.setURL("http://localhost:3000/");
	window.history.replaceState(null, "", "/");
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	// Keep the VFS pending: navigation must still expose Return and the Options screen.
	const respond = Object.assign(async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
		const wasm = wasmResponse(url);
		if (wasm) return wasm;
		if (url.endsWith("/api/v1/health")) return Response.json({
			api: "test",
			capacites: { vfs: "en_cours", vfs_entrees: 0, vfs_dump: false, vfs_contenu: false, gisement: false, anime: false, bundle: true },
			vues: [],
		});
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

async function mount(path: string) {
	window.history.replaceState(null, "", path);
	await act(async () => root?.render(<App />));
	if (path === "/menu") {
		await act(async () => { await loadMenuPresentation("title-menu"); });
	}
}

async function click(selector: string) {
	const button = container.querySelector<HTMLButtonElement>(selector);
	expect(button).not.toBeNull();
	await act(async () => button!.click());
}

async function expectMenu(path = "/") {
	await act(async () => { await loadMenuPresentation("title-menu"); });
	expect(window.location.pathname).toBe(path);
	expect(container.querySelector('[data-render-source="vfs-layers"]')).not.toBeNull();
	expect(container.querySelector("[data-opening-phase]")).toBeNull();
}

describe("game navigation in the mounted host", () => {
	test("a held gamepad confirm does not activate the remounted menu after Avatar Return", async () => {
		const pad = { index: 0, id: "route-transition", connected: true, mapping: "standard", axes: [0, 0], buttons: [{ pressed: false }, { pressed: false }] } as unknown as Gamepad;
		const original = Object.getOwnPropertyDescriptor(navigator, "getGamepads");
		Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [pad] });
		const callbacks = new Map<number, FrameRequestCallback>();
		let nextId = 0;
		const raf = spyOn(window, "requestAnimationFrame").mockImplementation(callback => { callbacks.set(++nextId, callback); return nextId; });
		const cancel = spyOn(window, "cancelAnimationFrame").mockImplementation(id => { callbacks.delete(id); });
		const tick = async () => {
			const frame = [...callbacks.values()]; callbacks.clear();
			await act(async () => { for (const callback of frame) callback(0); });
		};
		try {
			await mount("/menu");
			await act(async () => container.querySelector<HTMLButtonElement>('[data-host-action="avatar"] button')!.focus());
			(pad.buttons[0] as { pressed: boolean }).pressed = true;
			await tick();
			expect(window.location.pathname).toBe("/chara_edit_menu");
			await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
			await expectMenu();
			await tick();
			await expectMenu();
			(pad.buttons[0] as { pressed: boolean }).pressed = false;
			await tick();
			await act(async () => container.querySelector<HTMLButtonElement>('[data-host-action="avatar"] button')!.focus());
			(pad.buttons[0] as { pressed: boolean }).pressed = true;
			await tick();
			expect(window.location.pathname).toBe("/chara_edit_menu");
		} finally {
			await act(async () => root?.unmount()); root = null;
			raf.mockRestore(); cancel.mockRestore();
			if (original) Object.defineProperty(navigator, "getGamepads", original);
			else Reflect.deleteProperty(navigator, "getGamepads");
		}
	});
	test("preserves startup for a fresh root", async () => {
		await mount("/");
		expect(container.querySelector('[data-opening-phase="loading"]')).not.toBeNull();
		const requested = (fetchMock.mock.calls as Array<[unknown, ...unknown[]]>).map((call) => String(call[0]));
		// `ensureWasm` is a process-wide singleton: an earlier route may already have compiled it.
		// This mount must still start the health oracle and must not pull heavyweight VFS media.
		expect(requested.some((url: string) => url.includes("/api/v1/health"))).toBeTrue();
		expect(requested.some((url: string) => url.includes("/video/") || url.includes("/runtime/audio"))).toBeFalse();
	});

	test("opens the menu directly after the VFS and both databases are ready", async () => {
		fetchMock.mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
			const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
			const wasm = wasmResponse(url);
			if (wasm) return wasm;
			if (url.endsWith("/api/v1/health")) return Response.json({
				api: "v1",
				capacites: { vfs: "pret", vfs_entrees: 250_800, vfs_dump: false, vfs_contenu: true, gisement: true, anime: true, bundle: true },
				vues: [],
			});
			return new Response(null, { status: 404 });
		}, { preconnect: globalThis.fetch.preconnect }));
		await mount("/");
		await expectMenu();
		const requested = (fetchMock.mock.calls as Array<[unknown, ...unknown[]]>).map((call) => String(call[0]));
		expect(requested.some((url: string) => url.includes("/api/v1/health"))).toBeTrue();
		expect(requested.some((url: string) => url.includes("/video/"))).toBeFalse();
	});

	test("opens the main menu directly through the published alias", async () => {
		await mount("/menu");
		await expectMenu();
	});

	test("Options Return reaches the menu before VFS readiness and stays there after reload", async () => {
		await mount("/ja/setting_menu?tab=display#selection");
		expect(container.querySelector(".game-screen--settings")).not.toBeNull();
		await click(".game-key-hint--back");
		await expectMenu("/ja");
		expect(window.location.search).toBe("");
		expect(window.location.hash).toBe("");
		await act(async () => root?.unmount());
		root = createRoot(container);
		await act(async () => root?.render(<App />));
		await expectMenu("/ja");
	});

	test("every public secondary route is unframed and keeps an immediate menu return", async () => {
		for (const route of ["chara_edit_menu", "setting_menu", "chara_bank_menu", "gallery_menu", "shop_menu"]) {
			await mount(`/${route}`);
			expect(container.querySelector(".tool-shell")).toBeNull();
			expect(container.querySelector('[data-surface-owner="game"]')).not.toBeNull();
			await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
			await expectMenu();
			await act(async () => root?.unmount());
			root = createRoot(container);
		}
	});

	test("the native title menu directly exposes public features and hides authoring tools", async () => {
		await mount("/menu");
		// `team` et non `bank` : la Banque est portée par la bannière MY TEAM du menu natif
		// (`title02_10_my_team_banner`), le seul identifiant que `nativeBinding` sache lier.
		for (const action of ["team", "shop", "avatar", "settings"]) {
			const button = container.querySelector<HTMLButtonElement>(`button[data-host-action="${action}"], [data-host-action="${action}"] button`);
			expect(button).not.toBeNull();
			expect(button?.disabled).toBeFalse();
		}
		for (const hidden of ["media", "explorer", "editor", "search", "data", "modes", "inacord", "mods", "lua", "re"]) {
			expect(container.querySelector(`[data-host-action="${hidden}"]`)).toBeNull();
		}
		// Une entrée liée au menu NATIF *est* le bouton ; une tuile générique en contient un. Le
		// sélecteur accepte les deux, comme la boucle ci-dessus — sinon le test mesure la forme du
		// rendu au lieu de mesurer la navigation.
		await click('button[data-host-action="team"], [data-host-action="team"] button');
		expect(window.location.pathname).toBe("/chara_bank_menu");
	});

	test("browser Back and Forward restore the real menu and Options without replaying loading", async () => {
		await mount("/menu");
		await click('[data-host-action="settings"] button');
		expect(window.location.pathname).toBe("/setting_menu");
		await act(async () => {
			const restored = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
			window.history.back();
			await restored;
		});
		await expectMenu();
		await act(async () => {
			const restored = new Promise((resolve) => window.addEventListener("popstate", resolve, { once: true }));
			window.history.forward();
			await restored;
		});
		expect(container.querySelector(".game-screen--settings")).not.toBeNull();
		await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
		await expectMenu();
	});

	test("Escape returns every direct secondary route to the menu while resources load", async () => {
		for (const route of ["chara_edit_menu", "setting_menu", "chara_bank_menu", "gallery_menu", "shop_menu"]) {
			await mount(`/${route}`);
			await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
			await expectMenu();
			await act(async () => root?.unmount());
			root = createRoot(container);
		}
	});

	test("secondary Escape preserves modal, editable, consumed and modified input", async () => {
		for (const route of ["chara_edit_menu"]) {
			await mount(`/${route}`);
			for (const role of ["dialog", "alertdialog"]) {
				const dialog = document.createElement("div");
				dialog.setAttribute("role", role);
				dialog.setAttribute("aria-modal", "true");
				container.append(dialog);
				await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
				expect(window.location.pathname).toBe(`/${route}`);
				dialog.remove();
			}
			const input = document.createElement("input");
			container.append(input);
			await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
			expect(window.location.pathname).toBe(`/${route}`);
			input.remove();
			for (const modifier of ["altKey", "ctrlKey", "metaKey", "repeat"]) {
				await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, [modifier]: true })));
				expect(window.location.pathname).toBe(`/${route}`);
			}
			const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
			consumed.preventDefault();
			await act(async () => window.dispatchEvent(consumed));
			expect(window.location.pathname).toBe(`/${route}`);
			await act(async () => root?.unmount());
			root = createRoot(container);
		}
	});

	test("Avatar Escape returns to menu while nested dialogs and consumed events retain control", async () => {
		await mount("/chara_edit_menu");
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		container.append(dialog);
		await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
		expect(window.location.pathname).toBe("/chara_edit_menu");
		dialog.remove();
		dialog.setAttribute("role", "alertdialog");
		container.append(dialog);
		await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
		expect(window.location.pathname).toBe("/chara_edit_menu");
		dialog.remove();
		for (const modifier of ["altKey", "ctrlKey", "metaKey", "repeat"]) {
			await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true, [modifier]: true })));
			expect(window.location.pathname).toBe("/chara_edit_menu");
		}
		const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		consumed.preventDefault();
		await act(async () => window.dispatchEvent(consumed));
		expect(window.location.pathname).toBe("/chara_edit_menu");
		await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
		await expectMenu();
	});
});

describe("le texte du jeu est fourni à l'arbre entier", () => {
	test("l'hôte monte GameTextProvider — sinon la substitution est muette", async () => {
		// `useGameText` rend le libellé écrit à la main quand aucun fournisseur n'est monté :
		// retirer `GameTextProvider` de `App` ne casse RIEN de visible, l'interface repasse
		// simplement en français figé et la carte mesurée cesse de servir. C'est exactement la
		// dormance reprochée à `useNativeText`, qui a vécu des semaines sans appelant.
		//
		// Ce test observe la conséquence réseau plutôt que l'arbre : monté avec une locale de
		// jeu autre que celle de la mesure, le fournisseur demande le lot GraphQL. Aucun appel
		// signifie aucun fournisseur.
		setSettings({ gameLocale: "en" });
		try {
			await mount("/menu");
			const appels = fetchMock.mock.calls.map((appel: unknown[]) => String(appel[0]));
			expect(appels.some((url: string) => url.includes("/api/v1/graphql"))).toBe(true);
		} finally {
			setSettings({ gameLocale: "fr" });
		}
	});
});
