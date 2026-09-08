import { describe, expect, test } from "bun:test";
import { grayscaleSsim } from "./image-metrics";

describe("Gaussian grayscale SSIM", () => {
	test("identity is one for a non-square image", () => {
		const pixels = Uint8Array.from({ length: 24 * 16 }, (_, i) => (i * 37) % 256);
		expect(grayscaleSsim(pixels, pixels, 24, 16)).toBeCloseTo(1, 12);
	});
	test("constant-image luminance matches the analytic formula", () => {
		const a = new Uint8Array(16 * 16).fill(50);
		const b = new Uint8Array(16 * 16).fill(100);
		const c1 = (0.01 * 255) ** 2;
		expect(grayscaleSsim(a, b, 16)).toBeCloseTo((2 * 50 * 100 + c1) / (50 ** 2 + 100 ** 2 + c1), 10);
	});
	test("different structure scores below identity and is symmetric", () => {
		const a = Uint8Array.from({ length: 256 }, (_, i) => i % 2 ? 255 : 0);
		const b = Uint8Array.from({ length: 256 }, (_, i) => Math.floor(i / 16) % 2 ? 255 : 0);
		expect(grayscaleSsim(a, b, 16)).toBeLessThan(0.1);
		expect(grayscaleSsim(a, b, 16)).toBeCloseTo(grayscaleSsim(b, a, 16), 12);
	});
	test("rejects empty images and mismatched dimensions", () => {
		expect(() => grayscaleSsim(new Uint8Array(), new Uint8Array(), 0)).toThrow();
		expect(() => grayscaleSsim(new Uint8Array(6), new Uint8Array(5), 3, 2)).toThrow();
	});
});
