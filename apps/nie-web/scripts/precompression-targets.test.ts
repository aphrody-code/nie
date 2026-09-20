import { describe, expect, test } from "bun:test";
import { isPrecompressionTarget, PRECOMPRESSION_EXTENSIONS } from "./precompression-targets";

describe("precompression targets", () => {
	test("includes the native WebAssembly and VFS runtime payloads", () => {
		expect(PRECOMPRESSION_EXTENSIONS).toContain(".wasm");
		expect(PRECOMPRESSION_EXTENSIONS).toContain(".nievfs");
		expect(isPrecompressionTarget("static/game/aphrody_lean-fr.nievfs")).toBe(true);
	});

	test("does not recompress image and GPU texture containers", () => {
		expect(isPrecompressionTarget("static/game/icon.png")).toBe(false);
		expect(isPrecompressionTarget("static/game/icon_item03.g4tx")).toBe(false);
	});
});
