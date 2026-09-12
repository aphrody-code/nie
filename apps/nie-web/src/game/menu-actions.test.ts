import { describe, expect, test } from "bun:test";
import { AVATAR, BANK, EXPLORER, GALLERY, INACORD, MEDIA, SETTINGS, SHOP, menuEntries } from "../entries";
import { bindMenuActions } from "./menu-actions";

describe("catalogue menu bindings", () => {
	test("preserves catalogue presentation/order and invokes the matching host destination", () => {
		const opened: string[] = [];
		const entries = menuEntries(null);
		const bindings = Object.fromEntries([MEDIA, BANK, GALLERY, SHOP, AVATAR, EXPLORER, INACORD, SETTINGS].map((route) => [
			route, { id: route, onActivate: () => opened.push(route) },
		]));
		const actions = bindMenuActions(entries, bindings);
		expect(actions.map(({ label, glyph }) => ({ label, glyph }))).toEqual(
			entries.map(({ label, glyph }) => ({ label, glyph })),
		);
		for (const action of actions) action.onActivate();
		expect(opened).toEqual(entries.map((entry) => entry.route));
	});

	test("does not invent actions for unbound or inherited destinations", () => {
		const entries = [
			{ route: "unknown", label: "Unknown", glyph: "arbre" as const },
			{ route: "constructor", label: "Constructor", glyph: "arbre" as const },
		];
		expect(bindMenuActions(entries, {})).toEqual([]);
	});
});
