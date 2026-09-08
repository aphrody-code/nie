/** Thin WebAssembly host for the Rust game reconstruction renderer. */
import { WebGpuViewer } from "../wasm/nie_wasm.js";
import { ensureWasm } from "./bridge";

export async function createNativeViewer(canvas: HTMLCanvasElement) {
	await ensureWasm();
	return WebGpuViewer.create_transparent(canvas);
}

/** Opaque Rust renderer for standalone model viewports. */
export async function createOpaqueNativeViewer(canvas: HTMLCanvasElement) {
	await ensureWasm();
	return WebGpuViewer.create(canvas);
}
