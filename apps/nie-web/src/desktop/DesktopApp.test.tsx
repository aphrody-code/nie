import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DesktopApp } from "./DesktopApp";
import { loadMenuPresentation } from "../game/bridge";

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
	const respond = Object.assign(async (input: RequestInfo | URL) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
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
	await act(async () => root?.render(<DesktopApp />));
}

describe("DesktopApp authoring and explorer navigation", () => {
	test("Explorer Escape dismisses display options before returning to the menu", async () => {
		await mount("/explorateur");
		const trigger = document.querySelector<HTMLButtonElement>('[aria-label="Options d\'affichage"]');
		if (trigger) {
			await act(async () => trigger.click());
			const popover = document.querySelector('[role="dialog"]');
			expect(popover).not.toBeNull();
			await act(async () => popover!.querySelector("button")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })));
			expect(window.location.pathname).toBe("/explorateur");
			expect(document.querySelector('[role="dialog"]')).toBeNull();
		}
	});
});
