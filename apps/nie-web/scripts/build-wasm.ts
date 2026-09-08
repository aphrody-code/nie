/** Build the Rust game core and refresh the bindings consumed by nie-web. */
import { copyFileSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPOSITORY_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const INPUT_WASM = fileURLToPath(
	new URL("../../../target/wasm32-unknown-unknown/release/nie_wasm.wasm", import.meta.url)
);
const BINDINGS_DIRECTORY = fileURLToPath(new URL("../src/wasm", import.meta.url));
const GENERATED_JAVASCRIPT = fileURLToPath(new URL("../src/wasm/nie_wasm.js", import.meta.url));
const GENERATED_WASM = fileURLToPath(new URL("../src/wasm/nie_wasm_bg.wasm", import.meta.url));
const PUBLIC_WASM = fileURLToPath(
	new URL("../public/static/game/nie_wasm_bg.wasm", import.meta.url)
);

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

await run("cargo", [
	"build",
	"--locked",
	"-p",
	"nie-wasm",
	"--target",
	"wasm32-unknown-unknown",
	"--release",
]);

mkdirSync(BINDINGS_DIRECTORY, { recursive: true });
await run("wasm-bindgen", [INPUT_WASM, "--target", "web", "--out-dir", BINDINGS_DIRECTORY]);

// The browser bridge always passes the public WASM response to `init`. The generated fallback
// URL is therefore intentionally absent beside the JavaScript module; tell Vite not to resolve
// or duplicate it in the bundle. Fail loudly if wasm-bindgen changes the generated shape.
const generatedJavaScript = readFileSync(GENERATED_JAVASCRIPT, "utf8");
const fallbackUrl = "new URL('nie_wasm_bg.wasm', import.meta.url)";
if (!generatedJavaScript.includes(fallbackUrl)) {
	throw new Error("wasm-bindgen fallback URL was not found in the generated JavaScript");
}
writeFileSync(
	GENERATED_JAVASCRIPT,
	generatedJavaScript.replace(
		fallbackUrl,
		"new URL(/* @vite-ignore */ 'nie_wasm_bg.wasm', import.meta.url)"
	)
);

mkdirSync(dirname(PUBLIC_WASM), { recursive: true });
copyFileSync(GENERATED_WASM, PUBLIC_WASM);
unlinkSync(GENERATED_WASM);

console.log(`wasm: refreshed ${PUBLIC_WASM}`);
