import { describe, expect, test } from "bun:test";
import { enterWasmMode, runtimeCommandForMenuIntent, WASM_MODE_INDEX, type WasmMode } from "./WasmGameSurface";

describe("direct WASM mode entry", () => {
	test("opens every supported native mode without navigating to the internal modes page", () => {
		for (const mode of Object.keys(WASM_MODE_INDEX) as WasmMode[]) {
			const commands: string[] = [];
			enterWasmMode({ input: command => commands.push(command) }, mode);
			expect(commands[0]).toBe("CMD_ENTER");
			expect(commands.slice(1, 6)).toEqual(Array(5).fill("CMD_FCS_NEXT"));
			expect(commands[6]).toBe("CMD_ENTER");
			expect(commands.slice(7, -1)).toEqual(Array(WASM_MODE_INDEX[mode]).fill("CMD_FCS_NEXT"));
			expect(commands.at(-1)).toBe("CMD_ENTER");
		}
	});

	test("maps rising gamepad menu intents to the runtime and reserves cancel for host return", () => {
		expect(runtimeCommandForMenuIntent({ type: "move", direction: "up" })).toBe("CMD_FCS_MTX_UP");
		expect(runtimeCommandForMenuIntent({ type: "move", direction: "right" })).toBe("CMD_FCS_MTX_RIGHT");
		expect(runtimeCommandForMenuIntent({ type: "activate" })).toBe("CMD_ENTER");
		expect(runtimeCommandForMenuIntent({ type: "cancel" })).toBeNull();
	});
});
