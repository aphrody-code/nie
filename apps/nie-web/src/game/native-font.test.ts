import { expect, test } from "bun:test";

test("font replacement retains all pending raster users before freeing the old atlas", () => {
	// Keep WASM and fetch mocks in a separate process: other suites import the real bridge.
	const wasmPath = new URL("../wasm/nie_wasm.js", import.meta.url).pathname;
	const bridgePath = new URL("./bridge.ts", import.meta.url).pathname;
	const fontPath = new URL("./native-font.ts", import.meta.url).pathname;
	const script = `
		import { mock } from "bun:test";
		const events = [];
		let requests = 0;
		class WasmBitmapFont {
			width = 1; height = 1; disposed = false;
			constructor(config) { this.id = config[0]; events.push([this.id, "construct"]); }
			free() {
				if (this.disposed) throw new Error("font freed twice");
				this.disposed = true; events.push([this.id, "free"]);
			}
			render(text, color) {
				if (this.disposed) throw new Error("render after free");
				events.push([this.id, "render"]);
				return new Uint8Array([this.id, text.length, color & 255, 255]);
			}
		}
		mock.module(${JSON.stringify(wasmPath)}, () => ({ WasmBitmapFont }));
		mock.module(${JSON.stringify(bridgePath)}, () => ({ ensureWasm: async () => {} }));
		globalThis.fetch = async url => {
			requests++;
			return new Response(new Uint8Array([url.startsWith("A:") ? 1 : 2]));
		};
		const { nativeTextRaster } = await import(${JSON.stringify(fontPath)});
		const source = prefix => ({ urlFichier: path => prefix + path });
		const frames = await Promise.all([
			nativeTextRaster(source("A:"), "é", 0xffffffff),
			nativeTextRaster(source("A:"), "œ", 0xffffff80),
			nativeTextRaster(source("B:"), "B", 0xffffff40),
		]);
		console.log(JSON.stringify({ requests, events,
			frames: frames.map(frame => ({ ...frame, rgba: [...frame.rgba] })) }));
	`;
	const result = Bun.spawnSync([process.execPath, "--eval", script], {
		stdout: "pipe",
		stderr: "pipe",
		timeout: 5000,
	});
	expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);
	const report = JSON.parse(new TextDecoder().decode(result.stdout));
	expect(report.requests).toBe(4);
	expect(report.events.filter(([id]: [number, string]) => id === 1)).toEqual([
		[1, "construct"],
		[1, "render"],
		[1, "render"],
		[1, "free"],
	]);
	expect(report.events.filter(([id]: [number, string]) => id === 2)).toEqual([
		[2, "construct"],
		[2, "render"],
	]);
	expect(report.frames).toEqual([
		{ width: 1, height: 1, rgba: [1, 1, 255, 255] },
		{ width: 1, height: 1, rgba: [1, 1, 128, 255] },
		{ width: 1, height: 1, rgba: [2, 1, 64, 255] },
	]);
});
