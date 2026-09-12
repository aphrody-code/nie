/**
 * Build, optimize and publish the LAZY 3D viewer module.
 *
 * ## Why a second module exists at all
 *
 * `nie-wasm` carries the renderer already, but on `BROWSER_WEBGPU` only. Adding `wgpu/webgl` to
 * it — which would let the SAME Rust renderer serve browsers without WebGPU, and delete a
 * 445-line TypeScript re-implementation — was measured on 2026-09-12: the module went from
 * 4 518 833 to 6 865 774 bytes, 574 318 over the 6 MiB budget `build-wasm.ts` enforces. That
 * budget guards what EVERY visitor downloads.
 *
 * This module carries ONLY the viewer, is fetched only when `navigator.gpu` does not answer, and
 * costs every other visitor nothing. Measured optimized size on first build: 3 153 478 bytes.
 *
 * Its budget is deliberately looser than the main module's (4 MiB against 6 MiB for a module
 * twenty times broader) because it is paid by a minority path — but it is a budget, so the day
 * this doubles, the build says so instead of the network.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INPUT_WASM = fileURLToPath(
	new URL("../../../target/wasm32-unknown-unknown/wasm-release/nie_viewer_web.wasm", import.meta.url)
);
const BINDINGS_DIRECTORY = fileURLToPath(new URL("../src/wasm-viewer", import.meta.url));
const PUBLIC_WASM = fileURLToPath(new URL("../public/static/game/nie_viewer_web_bg.wasm", import.meta.url));
const MAX_WASM_BYTES = 4 * 1024 * 1024;

async function run(command: string, args: string[]): Promise<void> {
	const child = Bun.spawn([command, ...args], { cwd: REPOSITORY_ROOT, stdout: "inherit", stderr: "inherit" });
	if ((await child.exited) !== 0) throw new Error(`${command} exited with ${child.exitCode}`);
}

const temporaryDirectory = mkdtempSync(join(REPOSITORY_ROOT, "target", "viewer-wasm-"));
try {
	await run("cargo", [
		"build",
		"-p",
		"nie-viewer-web",
		"--target",
		"wasm32-unknown-unknown",
		"--profile",
		"wasm-release",
	]);
	await run("wasm-bindgen", [INPUT_WASM, "--target", "web", "--out-dir", temporaryDirectory]);

	const temporaryWasm = join(temporaryDirectory, "nie_viewer_web_bg.wasm");
	const temporaryJavaScript = join(temporaryDirectory, "nie_viewer_web.js");
	const temporaryTypeScript = join(temporaryDirectory, "nie_viewer_web.d.ts");
	const temporaryWasmTypeScript = join(temporaryDirectory, "nie_viewer_web_bg.wasm.d.ts");

	// The host always supplies validated bytes to `initSync`; keeping a fallback URL in the glue
	// makes Vite resolve or duplicate a binary the server already owns.
	const generatedJavaScript = readFileSync(temporaryJavaScript, "utf8");
	const fallbackUrl = "new URL('nie_viewer_web_bg.wasm', import.meta.url)";
	if (generatedJavaScript.includes(fallbackUrl)) {
		Bun.write(
			temporaryJavaScript,
			generatedJavaScript.replace(fallbackUrl, "new URL(/* @vite-ignore */ 'nie_viewer_web_bg.wasm', import.meta.url)")
		);
	}

	const beforeOptimization = statSync(temporaryWasm).size;
	await run("wasm-opt", [
		"-O3",
		"--strip-debug",
		"--enable-mutable-globals",
		"--enable-nontrapping-float-to-int",
		"--enable-simd",
		"--enable-bulk-memory",
		"--enable-sign-ext",
		"--enable-reference-types",
		"--enable-multivalue",
		temporaryWasm,
		"-o",
		temporaryWasm,
	]);
	const optimizedBytes = readFileSync(temporaryWasm);
	if (!WebAssembly.validate(optimizedBytes)) throw new Error("wasm-opt produced an invalid WebAssembly module");
	if (optimizedBytes.byteLength > MAX_WASM_BYTES) {
		throw new Error(`optimized WebAssembly exceeds the ${MAX_WASM_BYTES}-byte budget: ${optimizedBytes.byteLength}`);
	}

	// The viewer needs a canvas and a GPU adapter, so it cannot be exercised here. What CAN be
	// checked without either is that the glue initialises and exports the class the host imports —
	// a module that published without `ModelViewer` would fail in the browser, silently, on the
	// one path that has no other renderer.
	const bindings = await import(`${pathToFileURL(temporaryJavaScript).href}?build=${Date.now()}`);
	const initialized = bindings.initSync({ module: optimizedBytes });
	if (!(initialized.memory instanceof WebAssembly.Memory)) {
		throw new Error("wasm-bindgen smoke test did not expose WebAssembly memory");
	}
	if (typeof bindings.ModelViewer !== "function") {
		throw new Error("the published module does not export ModelViewer");
	}

	mkdirSync(BINDINGS_DIRECTORY, { recursive: true });
	mkdirSync(dirname(PUBLIC_WASM), { recursive: true });
	for (const [source, destination] of [
		[temporaryJavaScript, join(BINDINGS_DIRECTORY, "nie_viewer_web.js")],
		[temporaryTypeScript, join(BINDINGS_DIRECTORY, "nie_viewer_web.d.ts")],
		[temporaryWasmTypeScript, join(BINDINGS_DIRECTORY, "nie_viewer_web_bg.wasm.d.ts")],
		[temporaryWasm, PUBLIC_WASM],
	] as const) {
		// Atomic replacement: a half-written module on the one path that has no fallback would be
		// worse than an old one.
		const next = `${destination}.next-${process.pid}`;
		copyFileSync(source, next);
		renameSync(next, destination);
	}
	const saved = Math.round((1 - optimizedBytes.byteLength / beforeOptimization) * 100);
	console.log(`viewer: validated and published ${optimizedBytes.byteLength} bytes (${saved}% smaller after wasm-opt)`);
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}
