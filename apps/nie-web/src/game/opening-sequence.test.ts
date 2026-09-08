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

	test("waits for measured resources and follows actual completion for native movies", () => {
		expect(OPENING_FRAMES.loading.durationMs).toBeNull();
		expect(OPENING_FRAMES.loading.advanceOn).toBe("resources-ready");
		expect(OPENING_FRAMES["inazuma-eleven"].advanceOn).toBe("media-ended");
		expect(OPENING_FRAMES.level5.advanceOn).toBe("media-ended");
		expect(advanceOpeningPhase("level5", "timeout")).toBe("level5");
		expect(advanceOpeningPhase("level5", "confirm")).toBe("level5");
		expect(OPENING_FRAMES.autosave.durationMs).toBeNull();
		expect(OPENING_FRAMES.start.durationMs).toBeNull();
	});

	test("ignores unrelated events on readiness and interactive frames", () => {
		expect(advanceOpeningPhase("loading", "confirm")).toBe("loading");
		expect(advanceOpeningPhase("loading", "timeout")).toBe("loading");
		expect(advanceOpeningPhase("autosave", "timeout")).toBe("autosave");
		expect(advanceOpeningPhase("start", "timeout")).toBe("start");
	});

	test("reaches the menu directly when every server resource is ready", () => {
		const phase = advanceOpeningPhase("loading", "resources-ready");
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
		expect(css).toContain(":hover");
		expect(css).toContain(":focus-visible");
		expect(css).toContain(":active");
		expect(css).toContain("prefers-reduced-motion: reduce");
	});
});
