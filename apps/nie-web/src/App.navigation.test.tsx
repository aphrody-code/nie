import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { App } from "./App";
import { loadMenuPresentation } from "./game/bridge";

let root: Root | null;
let container: HTMLDivElement;
let fetchMock: ReturnType<typeof spyOn>;

const reactEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = reactEnvironment.IS_REACT_ACT_ENVIRONMENT;

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
		if (url.endsWith("/static/game/nie_wasm_bg.wasm")) {
			return new Response(Bun.file(new URL("../public/static/game/nie_wasm_bg.wasm", import.meta.url)), {
				headers: { "content-type": "application/wasm" },
			});
		}
		if (url.endsWith("/api/v1/health")) return Response.json({
			api: "test",
			capacites: { vfs: "en_cours", vfs_entrees: 0, vfs_dump: false, vfs_contenu: false, gisement: false, bundle: true },
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
	test("preserves startup for a fresh root", async () => {
		await mount("/");
		expect(container.querySelector('[data-opening-phase="loading"]')).not.toBeNull();
	});

	test("opens the main menu directly through the published alias", async () => {
		await mount("/menu");
		await expectMenu();
	});

	test("Options Return reaches the menu before VFS readiness and stays there after reload", async () => {
		await mount("/ja/settings?tab=display#selection");
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

	test("every direct secondary route keeps an immediate menu return while resources load", async () => {
		for (const route of ["medias", "avatar", "explorateur", "recherche", "donnees", "textures", "modeles", "sons", "videos"]) {
			await mount(`/${route}`);
			await click("header > button");
			await expectMenu();
			await act(async () => root?.unmount());
			root = createRoot(container);
		}
	});

	test("browser Back and Forward restore the real menu and Options without replaying loading", async () => {
		await mount("/menu");
		await click('[data-host-action="settings"] button');
		expect(window.location.pathname).toBe("/settings");
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

	test("Avatar Escape returns to menu while nested dialogs and consumed events retain control", async () => {
		await mount("/avatar");
		const dialog = document.createElement("div");
		dialog.setAttribute("role", "dialog");
		dialog.setAttribute("aria-modal", "true");
		container.append(dialog);
		await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
		expect(window.location.pathname).toBe("/avatar");
		dialog.remove();
		const consumed = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
		consumed.preventDefault();
		await act(async () => window.dispatchEvent(consumed));
		expect(window.location.pathname).toBe("/avatar");
		await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
		await expectMenu();
	});
});
