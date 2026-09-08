import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ModelViewerSurface, type ModelViewerSurfaceProps } from "./ModelViewerSurface";

let root: Root | null;
let container: HTMLDivElement;
let restores: (() => void)[];
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((accept, fail) => { resolve = accept; reject = fail; });
	return { promise, resolve, reject };
}

beforeEach(() => {
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	restores = [];
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
});

afterEach(async () => {
	await act(async () => root?.unmount());
	root = null;
	container.remove();
	for (const restore of restores.reverse()) restore();
	environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function render(props: Partial<ModelViewerSurfaceProps> & Pick<ModelViewerSurfaceProps, "loadViewer">) {
	await act(async () => root?.render(<ModelViewerSurface src="/first.glb" label="First model" {...props}>
		{state => <output data-loaded={state.loaded} data-error={state.errored} data-visible={state.visible} />}
	</ModelViewerSurface>));
}

function state() {
	const output = container.querySelector("output")!;
	return { loaded: output.dataset.loaded, errored: output.dataset.error, visible: output.dataset.visible };
}

test("a stale loader cannot mount or report an error after the source changes", async () => {
	const first = deferred(), second = deferred();
	const loadViewer = mock().mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
	await render({ loadViewer });
	await render({ loadViewer, src: "/second.glb" });
	await act(async () => second.resolve());
	const current = container.querySelector("model-viewer")!;
	expect(current.getAttribute("src")).toBe("/second.glb");
	await act(async () => first.reject(new Error("Stale loader failure")));
	expect(container.querySelectorAll("model-viewer")).toHaveLength(1);
	expect(container.querySelector("model-viewer")).toBe(current);
	expect(state().errored).toBe("false");
});

test("a loader resolving after unmount does not create a viewer", async () => {
	const pending = deferred();
	const create = spyOn(document, "createElement");
	restores.push(() => create.mockRestore());
	await render({ loadViewer: () => pending.promise });
	await act(async () => root?.unmount());
	root = null;
	await act(async () => pending.resolve());
	expect(create.mock.calls.filter(([name]) => name === "model-viewer")).toHaveLength(0);
});

test("load listeners are attached before src and old element events are ignored after replacement", async () => {
	const original = HTMLElement.prototype.setAttribute;
	const setAttribute = spyOn(HTMLElement.prototype, "setAttribute").mockImplementation(function (this: HTMLElement, name, value) {
		original.call(this, name, value);
		if (this.tagName.toLowerCase() === "model-viewer" && name === "src") this.dispatchEvent(new Event("load"));
	});
	restores.push(() => setAttribute.mockRestore());
	const loadViewer = async () => {};
	await render({ loadViewer });
	const old = container.querySelector("model-viewer")!;
	expect(state().loaded).toBe("true");
	await render({ loadViewer, src: "/second.glb", label: "Second model", autoRotate: false });
	const current = container.querySelector("model-viewer")!;
	expect(old.isConnected).toBe(false);
	expect(current.getAttribute("src")).toBe("/second.glb");
	expect(current.getAttribute("alt")).toBe("Second model");
	expect(current.hasAttribute("auto-rotate")).toBe(false);
	await act(async () => { old.dispatchEvent(new Event("error")); });
	expect(state()).toEqual({ loaded: "true", errored: "false", visible: "true" });
});

test("visibility suspends mounting and tears down the viewer until re-entry", async () => {
	let notify!: (visible: boolean) => void;
	const disconnect = mock(() => {});
	const previous = globalThis.IntersectionObserver;
	globalThis.IntersectionObserver = class {
		constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
			expect(options.rootMargin).toBe("200px");
			notify = visible => callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
		}
		observe() {}
		disconnect = disconnect;
	} as unknown as typeof IntersectionObserver;
	restores.push(() => { globalThis.IntersectionObserver = previous; });
	const loadViewer = mock(async () => {});
	await render({ loadViewer, observeVisibility: true });
	expect(loadViewer).not.toHaveBeenCalled();
	await act(async () => notify(true));
	const first = container.querySelector("model-viewer")!;
	expect(first).not.toBeNull();
	await act(async () => notify(false));
	expect(first.isConnected).toBe(false);
	expect(state()).toEqual({ loaded: "false", errored: "false", visible: "false" });
	await act(async () => notify(true));
	expect(container.querySelector("model-viewer")).not.toBe(first);
	expect(loadViewer).toHaveBeenCalledTimes(2);
	await act(async () => root?.unmount());
	root = null;
	expect(disconnect).toHaveBeenCalledTimes(1);
});

test("close cancels a pending loader and reopening creates one fresh viewer", async () => {
	const pending = deferred();
	const loadViewer = mock().mockImplementationOnce(() => pending.promise).mockResolvedValue(undefined);
	await render({ loadViewer });
	await render({ loadViewer, active: false });
	await act(async () => pending.resolve());
	expect(container.querySelector("model-viewer")).toBeNull();
	await render({ loadViewer, active: true });
	const current = container.querySelector("model-viewer")!;
	expect(current).not.toBeNull();
	await act(async () => { current.dispatchEvent(new Event("error")); });
	expect(state().errored).toBe("true");
	await render({ loadViewer, active: false });
	expect(current.isConnected).toBe(false);
	await render({ loadViewer, active: true });
	expect(state()).toEqual({ loaded: "false", errored: "false", visible: "true" });
	expect(container.querySelectorAll("model-viewer")).toHaveLength(1);
	expect(loadViewer).toHaveBeenCalledTimes(3);
});

test("closing aborts the availability request without starting the loader", async () => {
	let signal: AbortSignal | null | undefined;
	let respond!: (response: Response) => void;
	const request = new Promise<Response>(resolve => { respond = resolve; });
	const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign((_input: RequestInfo | URL, options?: RequestInit) => {
		expect(options?.method).toBe("HEAD");
		signal = options?.signal;
		return request;
	}, { preconnect: globalThis.fetch.preconnect }));
	restores.push(() => fetch.mockRestore());
	const loadViewer = mock(async () => {});
	await render({ loadViewer, checkAvailability: true });
	await render({ loadViewer, checkAvailability: true, active: false });
	expect(signal?.aborted).toBe(true);
	await act(async () => respond(new Response(null, { status: 200 })));
	expect(loadViewer).not.toHaveBeenCalled();
	expect(container.querySelector("model-viewer")).toBeNull();
	expect(state().errored).toBe("false");
});
