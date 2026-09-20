import { expect, test } from "bun:test";
import init, * as wasm from "../src/wasm/nie_wasm.js";
import { verifyAudioErrorRecovery } from "./wasm-audio-smoke";

test("the canonical WASM survives HCA constructor errors and stays reusable", async () => {
	await init({ module_or_path: await Bun.file(new URL("../public/static/game/nie_wasm_bg.wasm", import.meta.url)).arrayBuffer() });
	expect(() => verifyAudioErrorRecovery(wasm)).not.toThrow();
	expect(() => verifyAudioErrorRecovery(wasm)).not.toThrow();
});

test("the build gate never treats memory traps as expected codec rejection", () => {
	expect(() => verifyAudioErrorRecovery({
		audio_to_wav: () => { throw new WebAssembly.RuntimeError("Out of bounds memory access"); },
		detect_format: () => "?",
	})).toThrow(WebAssembly.RuntimeError);
});
