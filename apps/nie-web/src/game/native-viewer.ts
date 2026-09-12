/**
 * Model viewport host, with a measured fallback chain.
 *
 * `WebGpuViewer` is the reference renderer, but for a long time it was the ONLY one the
 * WebAssembly module exported, and a browser without WebGPU — headless Chromium, Firefox,
 * Safari < 26 — got a rejected promise, an empty canvas and « Le modèle n'a pas pu être
 * affiché » without the GLB ever being fetched. The chain is therefore:
 *
 * 1. `WebGpuViewer` (Rust, `nie-render3d` through `wgpu`), whenever `navigator.gpu` answers;
 * 2. {@link loadLazyViewer}, the SAME Rust renderer on `wgpu`'s WebGL 2 backend, in a module
 *    fetched only when it is needed;
 * 3. {@link createCpuModelViewer}, the Rust CPU rasteriser already in the main module.
 *
 * ## Why tier 2 is a separate module, measured
 *
 * Tier 2 used to be `WebGlModelViewer`: 445 lines of TypeScript re-implementing model viewing in
 * WebGL 2, sharing nothing with the renderer this repository verifies, drifting by construction.
 * Deleting it needed `wgpu/webgl` on `nie-render3d` — which works, and on 2026-09-12 took
 * `nie-wasm` from 4 518 833 to 6 865 774 bytes: 574 318 over the 6 MiB budget that guards what
 * EVERY visitor downloads.
 *
 * So the backend moved into `nie-viewer-web`, a crate carrying only the viewer: 2 855 742 bytes,
 * fetched by browsers without WebGPU and by nobody else. The re-implementation is gone, the main
 * module did not grow by one byte, and all three tiers now run this repository's renderer.
 *
 * Tier 3 costs CPU and honours yaw only (see `model-render.ts`), which is why it sits last.
 */
import { WebGpuViewer } from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";
import { createCpuModelViewer } from "./model-render";

/**
 * A canvas keeps the FIRST context kind it is given: asking for `webgpu` and failing leaves the
 * canvas unable to return a `webgl2` context, which is how a WebGPU attempt used to poison its
 * own fallback. The adapter is therefore probed on `navigator.gpu` — never on the canvas — and
 * the answer is memoised, since it cannot change within a page.
 */
let adapterProbe: Promise<boolean> | null = null;
function hasWebGpu(): Promise<boolean> {
	const gpu = typeof navigator === "undefined" ? undefined : (navigator as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
	if (!gpu) return Promise.resolve(false);
	adapterProbe ??= gpu.requestAdapter().then(adapter => adapter !== null && adapter !== undefined, () => false);
	return adapterProbe;
}

function hasWebGl2(): boolean {
	if (typeof document === "undefined") return false;
	try {
		return Boolean(document.createElement("canvas").getContext("webgl2"));
	} catch { return false; }
}

/** The lazily-fetched viewer module, as `wasm-bindgen` shapes it. */
interface LazyViewerModule {
	initSync(input: { module: BufferSource }): unknown;
	ModelViewer: {
		create(canvas: HTMLCanvasElement): Promise<unknown>;
		create_transparent(canvas: HTMLCanvasElement): Promise<unknown>;
	};
}

/** Where the second module is served, next to the main one. */
const LAZY_VIEWER_URL = "/static/game/nie_viewer_web_bg.wasm";

let lazyViewer: Promise<LazyViewerModule> | null = null;

/**
 * Fetches and initialises the WebGL-capable viewer module, once.
 *
 * The 3 MiB are paid here and only here: a browser with WebGPU never reaches this function, and
 * neither does one that only ever shows menus.
 */
function loadLazyViewer(): Promise<LazyViewerModule> {
	lazyViewer ??= (async () => {
		const [glue, response] = await Promise.all([
			import("../wasm-viewer/nie_viewer_web.js") as Promise<LazyViewerModule>,
			fetch(LAZY_VIEWER_URL),
		]);
		if (!response.ok) throw new Error(`${LAZY_VIEWER_URL} → HTTP ${response.status}`);
		glue.initSync({ module: await response.arrayBuffer() });
		return glue;
	})().catch(error => {
		// A failed fetch must not poison the next attempt: the page may simply have been offline.
		lazyViewer = null;
		throw error;
	});
	return lazyViewer;
}

async function build(canvas: HTMLCanvasElement, transparent: boolean) {
	if (await hasWebGpu()) {
		try {
			await ensureWasm();
			return transparent ? await WebGpuViewer.create_transparent(canvas) : await WebGpuViewer.create(canvas);
		} catch (cause) {
			// The canvas may already hold the failed WebGPU context; the second module then
			// refuses it too, and the original cause is the honest one to report.
			try {
				return await createLazyViewer(canvas, transparent);
			} catch { throw cause; }
		}
	}
	if (hasWebGl2()) {
		try {
			return await createLazyViewer(canvas, transparent);
		} catch {
			// The module may be absent from this deployment, or WebGL 2 may accept a context and
			// still fail to produce an adapter. The CPU rasteriser is in the module already.
			return createCpuModelViewer(canvas);
		}
	}
	// Neither GPU nor WebGL: the processor remains, and it renders the same models. `transparent`
	// has no equivalent there — the rasteriser lays its own background — so nothing simulates it.
	return createCpuModelViewer(canvas);
}

/** Builds a viewer from the lazily-fetched module. */
async function createLazyViewer(canvas: HTMLCanvasElement, transparent: boolean) {
	const module = await loadLazyViewer();
	return (transparent
		? await module.ModelViewer.create_transparent(canvas)
		: await module.ModelViewer.create(canvas)) as Awaited<ReturnType<typeof WebGpuViewer.create>>;
}

export async function createNativeViewer(canvas: HTMLCanvasElement) {
	return build(canvas, true);
}

/** Opaque renderer for standalone model viewports. */
export async function createOpaqueNativeViewer(canvas: HTMLCanvasElement) {
	return build(canvas, false);
}
