/**
 * Host-independent interaction model for measured game-menu layouts.
 *
 * The host owns event listeners and side effects. This module only turns keyboard, pointer,
 * touch, or standard-gamepad input into focus and activation updates. Spatial navigation uses
 * the rectangles supplied by the caller, so it works with the measured `mainmenu01` geometry
 * without introducing another layout or a second list of menu entries.
 */

export type MenuDirection = "up" | "down" | "left" | "right";

export type MenuIntent<Id extends string = string> =
	| { type: "move"; direction: MenuDirection }
	| { type: "focus"; id: Id }
	| { type: "activate" }
	| { type: "cancel" };

export interface MenuRect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface MenuInteractionItem<Id extends string = string> {
	id: Id;
	rect: MenuRect;
	disabled?: boolean;
}

export interface MenuInteractionState<Id extends string = string> {
	focusedId: Id | null;
}

export interface MenuInteractionUpdate<Id extends string = string> {
	state: MenuInteractionState<Id>;
	activatedId: Id | null;
	cancelled: boolean;
}

interface Point {
	x: number;
	y: number;
}

function center(rect: MenuRect): Point {
	return {
		x: rect.x + rect.width / 2,
		y: rect.y + rect.height / 2,
	};
}

function isInDirection(from: Point, to: Point, direction: MenuDirection): boolean {
	switch (direction) {
		case "up":
			return to.y < from.y;
		case "down":
			return to.y > from.y;
		case "left":
			return to.x < from.x;
		case "right":
			return to.x > from.x;
	}
}

function squaredDistance(a: Point, b: Point): number {
	const dx = a.x - b.x;
	const dy = a.y - b.y;
	return dx * dx + dy * dy;
}

function enabledItem<Id extends string>(
	items: readonly MenuInteractionItem<Id>[],
	id: Id | null,
): MenuInteractionItem<Id> | undefined {
	return id === null ? undefined : items.find((item) => item.id === id && !item.disabled);
}

/** Selects the requested enabled item, or the first enabled item when it is unavailable. */
export function initialMenuState<Id extends string>(
	items: readonly MenuInteractionItem<Id>[],
	preferredId: Id | null = null,
): MenuInteractionState<Id> {
	return {
		focusedId: enabledItem(items, preferredId)?.id ?? items.find((item) => !item.disabled)?.id ?? null,
	};
}

/**
 * Finds the nearest enabled item whose centre lies in the requested half-plane.
 *
 * Distance is Euclidean and ties preserve declaration order. There is deliberately no wrap,
 * angle cutoff, or layout-specific weight: such constants would be host policy rather than
 * measured menu data.
 */
export function moveMenuFocus<Id extends string>(
	items: readonly MenuInteractionItem<Id>[],
	focusedId: Id | null,
	direction: MenuDirection,
): Id | null {
	const current = enabledItem(items, focusedId);
	if (!current) return initialMenuState(items).focusedId;

	const origin = center(current.rect);
	let nearest: MenuInteractionItem<Id> | undefined;
	let nearestDistance = Number.POSITIVE_INFINITY;

	for (const item of items) {
		if (item.disabled || item.id === current.id) continue;
		const target = center(item.rect);
		if (!isInDirection(origin, target, direction)) continue;
		const distance = squaredDistance(origin, target);
		if (distance < nearestDistance) {
			nearest = item;
			nearestDistance = distance;
		}
	}

	return nearest?.id ?? current.id;
}

/** Applies one semantic input while leaving navigation side effects to the host. */
export function reduceMenuInteraction<Id extends string>(
	items: readonly MenuInteractionItem<Id>[],
	state: MenuInteractionState<Id>,
	intent: MenuIntent<Id>,
): MenuInteractionUpdate<Id> {
	let focusedId = enabledItem(items, state.focusedId)?.id ?? initialMenuState(items).focusedId;
	let activatedId: Id | null = null;
	let cancelled = false;

	switch (intent.type) {
		case "move":
			focusedId = moveMenuFocus(items, focusedId, intent.direction);
			break;
		case "focus":
			focusedId = enabledItem(items, intent.id)?.id ?? focusedId;
			break;
		case "activate":
			activatedId = focusedId;
			break;
		case "cancel":
			cancelled = true;
			break;
	}

	return { state: { focusedId }, activatedId, cancelled };
}

/** Maps `KeyboardEvent.key` to the shared semantic input understood by the model. */
export function keyboardMenuIntent(key: string): MenuIntent | null {
	switch (key) {
		case "ArrowUp":
			return { type: "move", direction: "up" };
		case "ArrowDown":
			return { type: "move", direction: "down" };
		case "ArrowLeft":
			return { type: "move", direction: "left" };
		case "ArrowRight":
			return { type: "move", direction: "right" };
		case "Enter":
		case " ":
			return { type: "activate" };
		case "Escape":
			return { type: "cancel" };
		default:
			return null;
	}
}

/** Maps buttons from a browser `Gamepad` with `mapping === "standard"`. */
export function standardGamepadButtonMenuIntent(buttonIndex: number): MenuIntent | null {
	switch (buttonIndex) {
		case 0:
			return { type: "activate" };
		case 1:
			return { type: "cancel" };
		case 12:
			return { type: "move", direction: "up" };
		case 13:
			return { type: "move", direction: "down" };
		case 14:
			return { type: "move", direction: "left" };
		case 15:
			return { type: "move", direction: "right" };
		default:
			return null;
	}
}

/** Minimal browser-independent view of a connected standard controller. */
export interface StandardMenuGamepad {
	index: number;
	id: string;
	mapping: string;
	connected: boolean;
	buttons: readonly { pressed: boolean }[];
	axes: readonly number[];
}

/**
 * Samples semantic rising edges. Keep one sampler across screen transitions so a held
 * confirm cannot activate the next screen. Disconnects discard controller history.
 * Analog navigation uses a host input dead zone, not a claim about native game timing.
 */
export function createStandardGamepadMenuSampler() {
	let previous = new Map<string, Set<string>>();
	return {
		reset(): void {
			previous.clear();
		},
		sample(gamepads: readonly (StandardMenuGamepad | null)[]): MenuIntent[] {
			const next = new Map<string, Set<string>>();
			const emitted = new Map<string, MenuIntent>();
			for (const pad of gamepads) {
				if (!pad?.connected || pad.mapping !== "standard") continue;
				const identity = `${pad.index}:${pad.id}`;
				const active = new Map<string, MenuIntent>();
				const add = (intent: MenuIntent | null) => {
					if (intent) active.set(intent.type === "move" ? intent.direction : intent.type, intent);
				};
				for (let index = 0; index < pad.buttons.length; index++) {
					if (pad.buttons[index]?.pressed) add(standardGamepadButtonMenuIntent(index));
				}
				const x = pad.axes[0] ?? 0;
				const y = pad.axes[1] ?? 0;
				if (Number.isFinite(x) && Number.isFinite(y)) {
					if (Math.abs(x) >= Math.abs(y) && Math.abs(x) > 0.5) {
						add({ type: "move", direction: x < 0 ? "left" : "right" });
					} else if (Math.abs(y) > 0.5) {
						add({ type: "move", direction: y < 0 ? "up" : "down" });
					}
				}
				const held = previous.get(identity);
				for (const [key, intent] of active) {
					if (!held?.has(key)) emitted.set(key, intent);
				}
				next.set(identity, new Set(active.keys()));
			}
			previous = next;
			// Navigate before confirming when a stick/d-pad and face button rise together.
			return [...emitted.values()].sort(
				(a, b) => Number(a.type !== "move") - Number(b.type !== "move"),
			);
		},
	};
}
