import { describe, expect, test } from "bun:test";
import {
	advanceOpeningPhase,
	OPENING_FRAMES,
	OPENING_PHASES,
	openingEventForStandardGamepadButton,
} from "./opening-sequence";

describe("opening sequence", () => {
	test("uses component and VFS surfaces in chronological order", () => {
		expect(OPENING_PHASES).toEqual([
			"loading",
			"inazuma-eleven",
			"level5",
			"autosave",
			"start",
			"menu",
		]);
		expect(Object.values(OPENING_FRAMES).map((frame) => frame.surface)).toEqual([
			"loading-layout",
			"title-logo",
			"level5-mark",
			"autosave-notice",
			"start-screen",
		]);
		expect(JSON.stringify(OPENING_FRAMES)).not.toContain(".png");
	});

	test("times only the loading and logo frames", () => {
		expect(OPENING_FRAMES.loading.durationMs).toBeGreaterThan(0);
		expect(OPENING_FRAMES["inazuma-eleven"].durationMs).toBeGreaterThan(0);
		expect(OPENING_FRAMES.level5.durationMs).toBeGreaterThan(0);
		expect(OPENING_FRAMES.autosave.durationMs).toBeNull();
		expect(OPENING_FRAMES.start.durationMs).toBeNull();
	});

	test("ignores confirmation on timed frames and timeouts on interactive frames", () => {
		expect(advanceOpeningPhase("loading", "confirm")).toBe("loading");
		expect(advanceOpeningPhase("autosave", "timeout")).toBe("autosave");
		expect(advanceOpeningPhase("start", "timeout")).toBe("start");
	});

	test("reaches the reconstructed menu only after both confirmations", () => {
		let phase = advanceOpeningPhase("loading", "timeout");
		phase = advanceOpeningPhase(phase, "timeout");
		phase = advanceOpeningPhase(phase, "timeout");
		expect(phase).toBe("autosave");
		phase = advanceOpeningPhase(phase, "confirm");
		expect(phase).toBe("start");
		phase = advanceOpeningPhase(phase, "confirm");
		expect(phase).toBe("menu");
		expect(advanceOpeningPhase("menu", "confirm")).toBe("menu");
	});

	test("accepts only the standard primary gamepad button", () => {
		expect(openingEventForStandardGamepadButton(0)).toBe("confirm");
		expect(openingEventForStandardGamepadButton(1)).toBeNull();
		expect(openingEventForStandardGamepadButton(12)).toBeNull();
	});

	test("ships opening motion with an explicit reduced-motion path", async () => {
		const css = await Bun.file(new URL("../pages/opening.css", import.meta.url)).text();
		expect(css).toContain("opening-surface-in");
		expect(css).toContain("opening-logo-in");
		expect(css).toContain(":hover");
		expect(css).toContain(":focus-visible");
		expect(css).toContain(":active");
		expect(css).toContain("prefers-reduced-motion: reduce");
	});
});
