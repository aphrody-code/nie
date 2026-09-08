/** Build, optimize, smoke-test and atomically publish the browser WebAssembly bindings. */
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INPUT_WASM = fileURLToPath(
	new URL("../../../target/wasm32-unknown-unknown/wasm-release/nie_wasm.wasm", import.meta.url)
);
const BINDINGS_DIRECTORY = fileURLToPath(new URL("../src/wasm", import.meta.url));
const GENERATED_JAVASCRIPT = fileURLToPath(new URL("../src/wasm/nie_wasm.js", import.meta.url));
const GENERATED_TYPESCRIPT = fileURLToPath(new URL("../src/wasm/nie_wasm.d.ts", import.meta.url));
const GENERATED_WASM_TYPESCRIPT = fileURLToPath(
	new URL("../src/wasm/nie_wasm_bg.wasm.d.ts", import.meta.url)
);
const PUBLIC_WASM = fileURLToPath(
	new URL("../public/static/game/nie_wasm_bg.wasm", import.meta.url)
);
const MAX_WASM_BYTES = 6 * 1024 * 1024;

const workspaceManifest = readFileSync(new URL("../../../Cargo.toml", import.meta.url), "utf8");
const wasmBindgenPin = workspaceManifest.match(
	/^wasm-bindgen\s*=\s*\{[^}]*version\s*=\s*"=([^"]+)"[^}]*\}/m
)?.[1];
if (wasmBindgenPin === undefined) {
	throw new Error("exact wasm-bindgen workspace version was not found in Cargo.toml");
}

async function run(command: string, args: string[]): Promise<void> {
	const process = Bun.spawn([command, ...args], {
		cwd: REPOSITORY_ROOT,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await process.exited;
	if (exitCode !== 0) {
		throw new Error(`${command} exited with code ${exitCode}`);
	}
}

const versionProcess = Bun.spawn(["wasm-bindgen", "--version"], {
	cwd: REPOSITORY_ROOT,
	stdout: "pipe",
	stderr: "inherit",
});
const versionOutput = (await new Response(versionProcess.stdout).text()).trim();
if ((await versionProcess.exited) !== 0) {
	throw new Error("wasm-bindgen --version failed");
}
const wasmBindgenCliVersion = versionOutput.match(/^wasm-bindgen\s+([^\s]+)/)?.[1];
if (wasmBindgenCliVersion !== wasmBindgenPin) {
	throw new Error(
		`wasm-bindgen CLI ${wasmBindgenCliVersion ?? "unknown"} does not match workspace pin ${wasmBindgenPin}`
	);
}

mkdirSync(BINDINGS_DIRECTORY, { recursive: true });
const temporaryDirectory = mkdtempSync(join(BINDINGS_DIRECTORY, ".build-"));
const temporaryJavaScript = join(temporaryDirectory, "nie_wasm.js");
const temporaryTypeScript = join(temporaryDirectory, "nie_wasm.d.ts");
const temporaryWasm = join(temporaryDirectory, "nie_wasm_bg.wasm");
const temporaryWasmTypeScript = join(temporaryDirectory, "nie_wasm_bg.wasm.d.ts");

try {
	await run("cargo", [
		"build",
		"--locked",
		"-p",
		"nie-wasm",
		"--features",
		"webgpu",
		"--target",
		"wasm32-unknown-unknown",
		"--profile",
		"wasm-release",
	]);
	await run("wasm-bindgen", [INPUT_WASM, "--target", "web", "--out-dir", temporaryDirectory]);

	// The browser bridge always supplies a validated Response to `init`. Keeping a fallback URL in
	// generated glue makes Vite resolve or duplicate a binary that the server already owns.
	const generatedJavaScript = readFileSync(temporaryJavaScript, "utf8");
	const fallbackUrl = "new URL('nie_wasm_bg.wasm', import.meta.url)";
	if (!generatedJavaScript.includes(fallbackUrl)) {
		throw new Error("wasm-bindgen fallback URL was not found in the generated JavaScript");
	}
	writeFileSync(
		temporaryJavaScript,
		generatedJavaScript.replace(
			fallbackUrl,
			"new URL(/* @vite-ignore */ 'nie_wasm_bg.wasm', import.meta.url)"
		)
	);

	const beforeOptimization = statSync(temporaryWasm).size;
	// Keep Binaryen's validator aligned with Rust's wasm32 generic CPU plus the SIMD routines
	// present in image/render dependencies. Explicit flags avoid `--all-features`, which could let
	// optimization passes introduce proposals outside the browser compatibility contract.
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
	if (!WebAssembly.validate(optimizedBytes)) {
		throw new Error("wasm-opt produced an invalid WebAssembly module");
	}
	if (optimizedBytes.byteLength > MAX_WASM_BYTES) {
		throw new Error(
			`optimized WebAssembly exceeds the ${MAX_WASM_BYTES}-byte budget: ${optimizedBytes.byteLength}`
		);
	}

	// Exercise the generated `web` glue exactly as Bun-based validation tools consume it: explicit
	// bytes, no implicit URL and no bundler-specific WebAssembly ESM integration.
	const bindings = await import(`${pathToFileURL(temporaryJavaScript).href}?build=${Date.now()}`);
	const initialized = bindings.initSync({ module: optimizedBytes });
	if (!(initialized.memory instanceof WebAssembly.Memory)) {
		throw new Error("wasm-bindgen smoke test did not expose WebAssembly memory");
	}
	if (bindings.detect_format(new Uint8Array()) !== "?") {
		throw new Error("wasm-bindgen smoke test returned an unexpected empty-buffer format");
	}

	mkdirSync(dirname(PUBLIC_WASM), { recursive: true });
	for (const [source, destination] of [
		[temporaryJavaScript, GENERATED_JAVASCRIPT],
		[temporaryTypeScript, GENERATED_TYPESCRIPT],
		[temporaryWasmTypeScript, GENERATED_WASM_TYPESCRIPT],
		[temporaryWasm, PUBLIC_WASM],
	] as const) {
		const next = `${destination}.next-${process.pid}`;
		copyFileSync(source, next);
		renameSync(next, destination);
	}

	const afterOptimization = optimizedBytes.byteLength;
	const reduction = Math.round(
		((beforeOptimization - afterOptimization) * 100) / beforeOptimization
	);
	console.log(
		`wasm: validated and published ${afterOptimization} bytes (${reduction}% smaller after wasm-opt)`
	);
} finally {
	rmSync(temporaryDirectory, { recursive: true, force: true });
}
