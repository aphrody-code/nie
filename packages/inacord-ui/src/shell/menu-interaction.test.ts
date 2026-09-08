import { describe, expect, test } from "bun:test";
import { BOITES, ECART_TUILE, LARGEUR_TUILE } from "./main-menu-geometry";
import {
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
