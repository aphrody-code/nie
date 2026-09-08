import { describe, expect, test } from "bun:test";
import { coverageFailures, geometryFailures, visualFailures, type InventoryReference } from "./menu-acceptance";

describe("interface delivery acceptance", () => {
	test("accepts threshold boundaries in raw RGB units", () => {
		expect(visualFailures({ grayscaleSsim: 0.99, rgbMeanAbsoluteDelta: 2 })).toEqual([]);
		expect(visualFailures({ grayscaleSsim: 1, rgbMeanAbsoluteDelta: 0 })).toEqual([]);
	});
	test("rejects the recorded front-menu baseline and nonfinite metrics", () => {
		expect(visualFailures({ grayscaleSsim: 0.557843, rgbMeanAbsoluteDelta: 70.643163 })).toHaveLength(2);
		for (const n of [NaN, Infinity, -Infinity]) {
			expect(visualFailures({ grayscaleSsim: n, rgbMeanAbsoluteDelta: n })).toHaveLength(2);
		}
		expect(visualFailures({ grayscaleSsim: 1.1, rgbMeanAbsoluteDelta: -1 })).toHaveLength(2);
	});
	test("rejects a two-pixel element shift even when the global image could pass", () => {
		const rect = { x: 20, y: 30, w: 200, h: 60 };
		expect(geometryFailures(rect, { ...rect, x: 21 })).toEqual([]);
		expect(geometryFailures(rect, { ...rect, x: 22 })).toHaveLength(1);
		expect(geometryFailures(rect, { ...rect, w: 0 })).toHaveLength(1);
	});
	test("cannot replace a missing reference with a duplicate", () => {
		const refs = Array.from({ length: 38 }, (_, i) => ({ file: `${i}.png` }) as InventoryReference);
		expect(coverageFailures(refs, refs.map((r) => r.file))).toEqual([]);
		const captured = refs.slice(1).map((r) => r.file);
		captured.push("1.png");
		expect(coverageFailures(refs, captured)).toEqual(["duplicate capture: 1.png", "missing capture: 0.png"]);
		expect(coverageFailures(refs, [])).toHaveLength(38);
		expect(coverageFailures([], [])).toEqual(["inventory must contain 38 unique references"]);
	});
});
