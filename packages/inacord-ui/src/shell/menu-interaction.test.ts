import { describe, expect, test } from "bun:test";
import { BOITES, ECART_TUILE, LARGEUR_TUILE } from "./main-menu-geometry";
import {
	createStandardGamepadMenuSampler,
	type StandardMenuGamepad,
	initialMenuState,
	keyboardMenuIntent,
	type MenuInteractionItem,
	moveMenuFocus,
	reduceMenuInteraction,
	standardGamepadButtonMenuIntent,
} from "./menu-interaction";

type MeasuredTarget = `primary-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8}` | `secondary-${1 | 2 | 3}`;

const measuredItems: MenuInteractionItem<MeasuredTarget>[] = [
	...Array.from({ length: 8 }, (_, index) => ({
		id: `primary-${index + 1}` as MeasuredTarget,
		rect: {
			x: BOITES.rangee.x + index * (LARGEUR_TUILE + ECART_TUILE),
			y: BOITES.rangee.y,
			width: LARGEUR_TUILE,
			height: BOITES.rangee.h,
		},
	})),
	...Array.from({ length: 3 }, (_, index) => ({
		id: `secondary-${index + 1}` as MeasuredTarget,
		rect: {
			x: BOITES.rangeeBasse.x + index * (LARGEUR_TUILE + ECART_TUILE),
			y: BOITES.rangeeBasse.y,
			width: LARGEUR_TUILE,
			height: BOITES.rangeeBasse.h,
		},
	})),
];

describe("menu interaction model", () => {
	test("uses the measured rectangles for horizontal and vertical navigation", () => {
		expect(moveMenuFocus(measuredItems, "primary-1", "right")).toBe("primary-2");
		expect(moveMenuFocus(measuredItems, "primary-5", "down")).toBe("secondary-2");
		expect(moveMenuFocus(measuredItems, "secondary-2", "up")).toBe("primary-5");
		expect(moveMenuFocus(measuredItems, "primary-1", "left")).toBe("primary-1");
	});

	test("pointer focus and activation emit an id without invoking host behavior", () => {
		const initial = initialMenuState(measuredItems);
		const pointed = reduceMenuInteraction(measuredItems, initial, {
			type: "focus",
			id: "secondary-3",
		});
		expect(pointed.state.focusedId).toBe("secondary-3");
		expect(pointed.activatedId).toBeNull();

		const activated = reduceMenuInteraction(measuredItems, pointed.state, { type: "activate" });
		expect(activated.activatedId).toBe("secondary-3");
		expect(activated.cancelled).toBe(false);
	});

	test("disabled items cannot receive focus or activation", () => {
		const items = measuredItems.map((item) =>
			item.id === "primary-2" ? { ...item, disabled: true } : item,
		);
		expect(moveMenuFocus(items, "primary-1", "right")).toBe("primary-3");

		const update = reduceMenuInteraction(items, { focusedId: "primary-1" }, {
			type: "focus",
			id: "primary-2",
		});
		expect(update.state.focusedId).toBe("primary-1");
	});

	test("keyboard keys map to semantic movement, activation, and cancellation", () => {
		expect(keyboardMenuIntent("ArrowLeft")).toEqual({ type: "move", direction: "left" });
		expect(keyboardMenuIntent("Enter")).toEqual({ type: "activate" });
		expect(keyboardMenuIntent(" ")).toEqual({ type: "activate" });
		expect(keyboardMenuIntent("Escape")).toEqual({ type: "cancel" });
		expect(keyboardMenuIntent("Tab")).toBeNull();
	});

	test("standard gamepad face and d-pad buttons use the same intents", () => {
		expect(standardGamepadButtonMenuIntent(0)).toEqual({ type: "activate" });
		expect(standardGamepadButtonMenuIntent(1)).toEqual({ type: "cancel" });
		expect(standardGamepadButtonMenuIntent(12)).toEqual({ type: "move", direction: "up" });
		expect(standardGamepadButtonMenuIntent(15)).toEqual({ type: "move", direction: "right" });
		expect(standardGamepadButtonMenuIntent(8)).toBeNull();
	});
});

describe("standard gamepad sampling", () => {
	function pad(pressed: number[] = [], axes: number[] = [0, 0]): StandardMenuGamepad {
		return {
			index: 0, id: "controller", connected: true, mapping: "standard", axes,
			buttons: Array.from({ length: 16 }, (_, index) => ({ pressed: pressed.includes(index) })),
		};
	}

	test("held confirmation cannot cross screens and release rearms it", () => {
		const sampler = createStandardGamepadMenuSampler();
		expect(sampler.sample([pad([0])])).toEqual([{ type: "activate" }]);
		expect(sampler.sample([pad([0])])).toEqual([]);
		expect(sampler.sample([pad()])).toEqual([]);
		expect(sampler.sample([pad([0])])).toEqual([{ type: "activate" }]);
	});

	test("deduplicates d-pad and stick and selects the dominant axis", () => {
		const sampler = createStandardGamepadMenuSampler();
		expect(sampler.sample([pad([15], [0.9, 0.7])])).toEqual([{ type: "move", direction: "right" }]);
		expect(sampler.sample([pad([], [0.9, 0.7])])).toEqual([]);
		expect(sampler.sample([pad([], [0.1, -0.8])])).toEqual([{ type: "move", direction: "up" }]);
		expect(sampler.sample([pad([], [0.5, -0.5])])).toEqual([]);
	});

	test("reconnect and explicit reset remove stale held state", () => {
		const sampler = createStandardGamepadMenuSampler();
		sampler.sample([pad([0])]);
		expect(sampler.sample([null])).toEqual([]);
		expect(sampler.sample([pad([0])])).toEqual([{ type: "activate" }]);
		sampler.reset();
		expect(sampler.sample([pad([0])])).toEqual([{ type: "activate" }]);
	});

	test("ignores disconnected, nonstandard and nonfinite axes", () => {
		const sampler = createStandardGamepadMenuSampler();
		expect(sampler.sample([{ ...pad([0]), connected: false }])).toEqual([]);
		expect(sampler.sample([{ ...pad([0]), mapping: "" }])).toEqual([]);
		expect(sampler.sample([pad([], [NaN, Infinity])])).toEqual([]);
	});

	test("tracks independent controllers without duplicate actions", () => {
		const sampler = createStandardGamepadMenuSampler();
		expect(sampler.sample([pad([0]), { ...pad([0]), index: 1 }])).toEqual([{ type: "activate" }]);
		expect(sampler.sample([pad([0]), { ...pad([0]), index: 1 }])).toEqual([]);
		expect(sampler.sample([pad([0]), { ...pad([1]), index: 1 }])).toEqual([{ type: "cancel" }]);
	});

	test("moves focus before simultaneous confirmation", () => {
		const sampler = createStandardGamepadMenuSampler();
		const intents = sampler.sample([pad([0, 15])]);
		let state = initialMenuState(measuredItems);
		let activated: string | null = null;
		for (const intent of intents) {
			const update = reduceMenuInteraction(measuredItems, state, intent);
			state = update.state;
			activated = update.activatedId ?? activated;
		}
		expect(activated).toBe("primary-2");
	});
});
