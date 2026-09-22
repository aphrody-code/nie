import { describe, expect, test } from "bun:test";
import { AVATAR, BANK, EXPLORER, GALLERY, INACORD, MEDIA_LANDING, MODES, SETTINGS, SHOP, menuEntries } from "../entries";
import { bindMenuActions } from "./menu-actions";

describe("catalogue menu bindings", () => {
	test("preserves catalogue presentation/order and invokes the matching host destination", () => {
		const opened: string[] = [];
		const entries = menuEntries(null);
		const bindings = Object.fromEntries([MEDIA_LANDING, MODES, BANK, GALLERY, SHOP, AVATAR, EXPLORER, SETTINGS].map((route) => [
			route, { id: route, onActivate: () => opened.push(route) },
		]));
		const actions = bindMenuActions(entries, bindings);
		expect(actions.map(({ label, glyph, priority }) => ({ label, glyph, priority }))).toEqual(
			entries.map(({ label, glyph, priority }) => ({ label, glyph, priority })),
		);
		expect(actions.filter(action => action.priority === "primary").map(action => action.id)).toEqual([
			EXPLORER, GALLERY,
		]);
		for (const action of actions) action.onActivate();
		expect(opened).toEqual(entries.map((entry) => entry.route));
		expect(entries.some((entry) => entry.route === INACORD)).toBeFalse();
	});

	test("does not invent actions for unbound or inherited destinations", () => {
		const entries = [
			{ route: "unknown", label: "Unknown", glyph: "arbre" as const },
			{ route: "constructor", label: "Constructor", glyph: "arbre" as const },
		];
		expect(bindMenuActions(entries, {})).toEqual([]);
	});
});
