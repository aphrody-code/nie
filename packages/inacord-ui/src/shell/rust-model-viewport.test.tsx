import { afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RustModelViewport, type RustModelViewer } from "./rust-model-viewport";

let root: Root | null;
let container: HTMLDivElement;
let restores: (() => void)[];
let frames: Map<number, FrameRequestCallback>;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}

function fakeViewer() {
	return {
		load_glb: mock((_bytes: Uint8Array) => {}),
		orbit: mock(() => {}),
		resize: mock(() => {}),
		render: mock(() => true),
		free: mock(() => {}),
	} satisfies RustModelViewer;
}

function mockFetch(implementation: (url: string, options?: RequestInit) => Promise<Response>) {
	const spy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			(input: RequestInfo | URL, options?: RequestInit) => implementation(String(input), options),
			{ preconnect: globalThis.fetch.preconnect }
		)
	);
	restores.push(() => spy.mockRestore());
	return spy;
}

beforeEach(() => {
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	restores = [];
	frames = new Map();
	let nextFrame = 0;
	const schedule = spyOn(globalThis, "requestAnimationFrame").mockImplementation((callback) => {
		frames.set(++nextFrame, callback);
		return nextFrame;
	});
	const cancel = spyOn(globalThis, "cancelAnimationFrame").mockImplementation((id) => {
		frames.delete(id);
	});
	restores.push(
		() => schedule.mockRestore(),
		() => cancel.mockRestore()
	);
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

async function mount(
	url: string | null,
	createViewer: (canvas: HTMLCanvasElement) => Promise<RustModelViewer>
) {
	await act(async () => root?.render(<RustModelViewport url={url} createViewer={createViewer} />));
	const canvas = container.querySelector("canvas")!;
	canvas.getBoundingClientRect = () => ({
		x: 0,
		y: 0,
		width: 320,
		height: 360,
		top: 0,
		left: 0,
		right: 320,
		bottom: 360,
		toJSON() {},
	});
	return canvas;
}

async function presentFrame() {
	const scheduled = frames.entries().next().value;
	expect(scheduled).toBeDefined();
	frames.delete(scheduled![0]);
	await act(async () => {
		scheduled![1](0);
	});
}

test("a viewer resolving after unmount is freed without loading or scheduling frames", async () => {
	const pending = deferred<RustModelViewer>();
	const viewer = fakeViewer();
	const fetch = mockFetch(async () => new Response(new Uint8Array([1])));
	await mount("/model/a.glb", () => pending.promise);
	await act(async () => root?.unmount());
	root = null;
	await act(async () => pending.resolve(viewer));
	expect(viewer.free).toHaveBeenCalledTimes(1);
	expect(viewer.load_glb).not.toHaveBeenCalled();
	expect(fetch).not.toHaveBeenCalled();
	expect(frames.size).toBe(0);
});

test("a delayed stale response cannot replace the current recipe even when transport ignores abort", async () => {
	const old = deferred<Response>();
	const viewer = fakeViewer();
	const createViewer = async () => viewer;
	const signals: AbortSignal[] = [];
	mockFetch(async (url, options) => {
		if (url.endsWith("a.glb")) {
			signals.push(options!.signal!);
			return old.promise;
		}
		return new Response(new Uint8Array([2]));
	});
	await mount("/model/a.glb", createViewer);
	const canvas = await mount("/model/b.glb", createViewer);
	expect(signals[0]?.aborted).toBe(true);
	expect(viewer.load_glb).toHaveBeenCalledTimes(1);
	expect(viewer.load_glb.mock.calls[0][0]).toEqual(new Uint8Array([2]));
	await act(async () => old.resolve(new Response(new Uint8Array([1]))));
	expect(viewer.load_glb).toHaveBeenCalledTimes(1);
	await presentFrame();
	expect(canvas.dataset.modelReady).toBe("true");
	expect(viewer.render).toHaveBeenCalledTimes(1);
	expect(viewer.free).not.toHaveBeenCalled();
});

test("clearing the recipe URL clears readiness and stops presenting the previous model", async () => {
	const viewer = fakeViewer();
	const createViewer = async () => viewer;
	mockFetch(async () => new Response(new Uint8Array([1])));
	const canvas = await mount("/model/a.glb", createViewer);
	await presentFrame();
	expect(canvas.dataset.modelReady).toBe("true");
	await mount(null, createViewer);
	expect(canvas.dataset.modelReady).toBeUndefined();
	expect(container.querySelector("[aria-busy]")?.getAttribute("aria-busy")).toBe("false");
	await presentFrame();
	expect(viewer.render).toHaveBeenCalledTimes(1);
	expect(viewer.load_glb).toHaveBeenCalledTimes(1);
});

test("GPU initialization failure can retry and the successful viewer is freed once", async () => {
	const viewer = fakeViewer();
	const createViewer = mock(async () => viewer);
	createViewer.mockRejectedValueOnce(new Error("GPU unavailable"));
	const fetch = mockFetch(async () => new Response(new Uint8Array([1])));
	await mount("/model/a.glb", createViewer);
	expect(container.querySelector("[role=alert]")).not.toBeNull();
	expect(fetch).not.toHaveBeenCalled();
	await act(async () => container.querySelector("button")!.click());
	expect(createViewer).toHaveBeenCalledTimes(2);
	expect(container.querySelector("[role=alert]")).toBeNull();
	expect(viewer.load_glb).toHaveBeenCalledTimes(1);
	await presentFrame();
	expect(viewer.render).toHaveBeenCalledTimes(1);
	await act(async () => root?.unmount());
	root = null;
	expect(viewer.free).toHaveBeenCalledTimes(1);
	expect(frames.size).toBe(0);
});
