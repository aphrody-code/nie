/**
 * Model viewport host, with a measured fallback chain.
 *
 * `WebGpuViewer` is the reference renderer, but it is the ONLY renderer the WebAssembly module
 * exports, and a browser without WebGPU — headless Chromium, Firefox, Safari < 26 — got a
 * rejected promise, an empty canvas and « Le modèle n'a pas pu être affiché » without the GLB
 * ever being fetched. The chain is therefore:
 *
 * 1. `WebGpuViewer` (Rust, `nie-render3d` through `wgpu`), whenever `navigator.gpu` answers;
 * 2. {@link WebGlModelViewer}, WebGL 2, drawing the same served GLB;
 * 3. an error naming exactly which of the two is missing, which `RustModelViewport` surfaces.
 */
import { WebGpuViewer } from "../wasm/nie_wasm.js";
import { WebGlModelViewer } from "../avatar/webgl-viewer";
import { ensureWasm } from "./bridge";

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

async function build(canvas: HTMLCanvasElement, transparent: boolean) {
	if (await hasWebGpu()) {
		try {
			await ensureWasm();
			return transparent ? await WebGpuViewer.create_transparent(canvas) : await WebGpuViewer.create(canvas);
		} catch (cause) {
			// The canvas may already hold the failed WebGPU context; WebGL 2 then refuses it and
			// the original cause is the honest one to report.
			try { return new WebGlModelViewer(canvas, transparent); } catch { throw cause; }
		}
	}
	if (hasWebGl2()) return new WebGlModelViewer(canvas, transparent);
	throw new Error("Aucun rendu 3D disponible : ni WebGPU (navigator.gpu absent) ni WebGL 2.");
}

export async function createNativeViewer(canvas: HTMLCanvasElement) {
	return build(canvas, true);
}

/** Opaque renderer for standalone model viewports. */
export async function createOpaqueNativeViewer(canvas: HTMLCanvasElement) {
	return build(canvas, false);
}
