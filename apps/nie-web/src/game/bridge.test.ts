import { describe, expect, test } from "bun:test";
import {
	canvasDisplaySize,
	compileWasmInWorker,
	commandForKey,
	FIXED_TIME_STEP,
	MAX_FRAME_DELTA,
	sharedFrameView,
	simulationTiming,
	type SharedFrameAccess,
} from "./bridge";

describe("compileWasmInWorker", () => {
	test("returns a compiled module and terminates the one-shot worker", async () => {
		const original = globalThis.Worker;
		const module = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
		let terminated = 0;
		class FakeWorker {
			onmessage: ((event: MessageEvent<{ module: WebAssembly.Module }>) => void) | null = null;
			onerror: (() => void) | null = null;
			postMessage() { queueMicrotask(() => this.onmessage?.({ data: { module } } as MessageEvent<{ module: WebAssembly.Module }>)); }
			terminate() { terminated += 1; }
		}
		Object.defineProperty(globalThis, "Worker", { configurable: true, value: FakeWorker });
		try {
			expect(await compileWasmInWorker("/static/game/nie_wasm_bg.wasm")).toBe(module);
			expect(terminated).toBe(1);
		} finally {
			Object.defineProperty(globalThis, "Worker", { configurable: true, value: original });
		}
	});

	test("falls back when workers are unavailable", async () => {
		const original = globalThis.Worker;
		Object.defineProperty(globalThis, "Worker", { configurable: true, value: undefined });
		try {
			expect(await compileWasmInWorker("/static/game/nie_wasm_bg.wasm")).toBeNull();
		} finally {
			Object.defineProperty(globalThis, "Worker", { configurable: true, value: original });
		}
	});

	test("falls back when policy blocks worker construction", async () => {
		const original = globalThis.Worker;
		class BlockedWorker {
			constructor() { throw new DOMException("Blocked by policy", "SecurityError"); }
		}
		Object.defineProperty(globalThis, "Worker", { configurable: true, value: BlockedWorker });
		try {
			expect(await compileWasmInWorker("/static/game/nie_wasm_bg.wasm")).toBeNull();
		} finally {
			Object.defineProperty(globalThis, "Worker", { configurable: true, value: original });
		}
	});
});

describe("commandForKey", () => {
	test("preserves the command names consumed by nie-app", () => {
		expect(commandForKey("ArrowUp")).toBe("CMD_FCS_MTX_UP");
		expect(commandForKey("Enter")).toBe("CMD_ENTER");
		expect(commandForKey("Escape")).toBe("CMD_BACK");
	});

	test("supports AZERTY and QWERTY without inventing engine commands", () => {
		expect(commandForKey("q")).toBe("CMD_FCS_MTX_LEFT");
		expect(commandForKey("a")).toBe("CMD_FCS_MTX_LEFT");
		expect(commandForKey("z")).toBe("CMD_FCS_MTX_UP");
		expect(commandForKey("w")).toBe("CMD_FCS_MTX_UP");
		expect(commandForKey("x")).toBeNull();
	});
});

describe("simulationTiming", () => {
	test("produces the same fixed steps independently of display refresh", () => {
		const at30Hz = simulationTiming(0, 1 / 30);
		const first144Hz = simulationTiming(0, 1 / 144);
		const accumulated144Hz = simulationTiming(first144Hz.remainder, 1 / 144);
		expect(at30Hz.steps).toBe(2);
		expect(at30Hz.remainder).toBeCloseTo(0, 10);
		expect(first144Hz.steps).toBe(0);
		expect(accumulated144Hz.steps).toBe(0);
		expect(accumulated144Hz.remainder).toBeCloseTo(1 / 72, 10);
	});

	test("bounds resumed tabs and rejects invalid elapsed time", () => {
		const resumed = simulationTiming(0, 60);
		expect(resumed.steps).toBe(Math.floor(MAX_FRAME_DELTA / FIXED_TIME_STEP));
		expect(resumed.steps).toBe(3);
		expect(simulationTiming(0, Number.NaN)).toEqual({ steps: 0, remainder: 0 });
		expect(simulationTiming(0, -1)).toEqual({ steps: 0, remainder: 0 });
	});
});

describe("canvasDisplaySize", () => {
	test("uses integer scaling whenever the source fits", () => {
		expect(canvasDisplaySize(1280, 720, 1920, 1080)).toEqual({ width: 1280, height: 720 });
		expect(canvasDisplaySize(1280, 720, 2560, 1440)).toEqual({ width: 2560, height: 1440 });
	});

	test("downscales proportionally when one source frame cannot fit", () => {
		const size = canvasDisplaySize(1280, 720, 1000, 1000);
		expect(size.width).toBeCloseTo(1000, 10);
		expect(size.height).toBeCloseTo(562.5, 10);
	});
});

describe("sharedFrameView", () => {
	test("views WebAssembly memory without copying the frame", () => {
		const memory = new WebAssembly.Memory({ initial: 1 });
		const offset = 64;
		const pixels = [10, 20, 30, 255];
		const frame: SharedFrameAccess = {
			render_frame: () => new Uint8Array(memory.buffer, offset, pixels.length).set(pixels),
			frame_ptr: () => offset,
			frame_len: () => pixels.length,
		};

		const view = sharedFrameView(frame, memory, pixels.length);
		expect(view.buffer).toBe(memory.buffer);
		expect([...view]).toEqual(pixels);
		view[0] = 99;
		expect(new Uint8Array(memory.buffer)[offset]).toBe(99);
	});

	test("rejects a stale or malformed framebuffer range", () => {
		const memory = new WebAssembly.Memory({ initial: 1 });
		const frame: SharedFrameAccess = {
			render_frame: () => {},
			frame_ptr: () => memory.buffer.byteLength - 2,
			frame_len: () => 4,
		};
		expect(() => sharedFrameView(frame, memory, 4)).toThrow("invalid shared frame");
		expect(() => sharedFrameView({ ...frame, frame_len: () => 3 }, memory, 4)).toThrow(
			"invalid shared frame",
		);
	});
});
