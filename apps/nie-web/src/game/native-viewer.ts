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
	const gpu = typeof navigator === "undefined" ? undefined : (navigator as {
		gpu?: { requestAdapter(options?: { powerPreference?: "high-performance" }): Promise<unknown> };
	}).gpu;
	if (!gpu) return Promise.resolve(false);
	// The Rust renderer requests the same preference. Probe it here as well so a low-power
	// adapter does not decide the backend before wgpu has a chance to create its surface.
	adapterProbe ??= gpu.requestAdapter({ powerPreference: "high-performance" }).then(adapter => adapter !== null && adapter !== undefined, () => false);
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
		} catch {
			// The canvas may already hold the failed WebGPU context; the second module then
			// refuses it too. The CPU renderer has no GPU adapter requirement and remains
			// the final usable path for browsers that expose `navigator.gpu` but cannot
			// actually construct the wgpu backend.
			try {
				return await createLazyViewer(canvas, transparent);
			} catch {
				return createCpuModelViewer(canvas);
			}
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

/** CPU-only renderer for a new canvas after a GPU context has failed and locked the old one. */
export async function createCpuNativeViewer(canvas: HTMLCanvasElement) {
	return createCpuModelViewer(canvas);
}

/**
 * Viewer d'ÉDITEUR : scène à plusieurs objets, picking, grille, fil de fer, gizmo.
 *
 * La chaîne de repli s'arrête au niveau 2. Le niveau 3 est le rastériseur CPU de `model-render`,
 * qui affiche un modèle isolé et n'a ni `load_scene`, ni `pick_json`, ni gizmo : le proposer ici
 * donnerait un viewport qui se construit puis échoue au premier clic. Mieux vaut refuser
 * franchement — `RustSceneViewport` le dit alors dans son message d'erreur.
 *
 * Un éditeur sans GPU ni WebGL 2 n'est donc pas servi, et c'est un constat, pas un oubli : la
 * manipulation 3D interactive suppose un rendu que le processeur ne soutient pas à la cadence
 * d'un glissement de souris.
 */
export async function createSceneViewer(canvas: HTMLCanvasElement) {
	if (await hasWebGpu()) {
		try {
			await ensureWasm();
			return await WebGpuViewer.create(canvas);
		} catch {
			return await createLazyViewer(canvas, false);
		}
	}
	if (hasWebGl2()) {
		return await createLazyViewer(canvas, false);
	}
	throw new Error(
		"l'éditeur 3D demande WebGPU ou WebGL 2 ; ce navigateur n'expose ni l'un ni l'autre",
	);
}

/** Opaque renderer for standalone model viewports. */
export async function createOpaqueNativeViewer(canvas: HTMLCanvasElement) {
	return build(canvas, false);
}
