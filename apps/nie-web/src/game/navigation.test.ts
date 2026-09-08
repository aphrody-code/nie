import { describe, expect, test } from "bun:test";
import { recognizedRoutes } from "../entries";
import { HOME } from "../routing";
import {
	gameNavigationHistory,
	gameNavigationTarget,
	gameNavigationUrl,
	internalGameLink,
	readGameNavigation,
} from "./navigation";

const ROUTES = recognizedRoutes(null);

describe("game route state", () => {
	test("starts a fresh root normally and restores a completed menu after reload", () => {
		expect(readGameNavigation(ROUTES, { pathname: "/" }, null)).toEqual({ view: HOME, openingPhase: "loading" });
		const state = gameNavigationHistory(null, { view: HOME, openingPhase: "menu" });
		expect(readGameNavigation(ROUTES, { pathname: "/" }, state)).toEqual({ view: HOME, openingPhase: "menu" });
	});

	test("all direct tools and language-prefixed menu aliases have a menu to return to", () => {
		for (const prefix of ["", "/en", "/ja"]) {
			for (const route of ROUTES) {
				const state = readGameNavigation(ROUTES, { pathname: `${prefix}/${route}` }, null);
				expect(state.view).toBe(route === "menu" ? HOME : route);
				expect(state.openingPhase).toBe("menu");
				expect(gameNavigationTarget(HOME).openingPhase).toBe("menu");
			}
		}
	});

	test("restores explicit title cancellation without forcing menu or loading", () => {
		const state = gameNavigationHistory(null, { view: HOME, openingPhase: "start" });
		expect(readGameNavigation(ROUTES, { pathname: "/ja" }, state).openingPhase).toBe("start");
	});

	test("ignores invalid and stale history records while retaining legacy Return entries", () => {
		for (const state of [null, [], { gameNavigation: "menu" }, { gameNavigation: { version: 2, view: HOME, openingPhase: "menu" } }, { gameNavigation: { version: 1, view: "settings", openingPhase: "menu" } }]) {
			expect(readGameNavigation(ROUTES, { pathname: "/" }, state).openingPhase).toBe("loading");
		}
		for (const stale of ["inazuma-eleven", "level5", "autosave"]) {
			const state = { gameNavigation: { version: 1, view: HOME, openingPhase: stale } };
			expect(readGameNavigation(ROUTES, { pathname: "/" }, state).openingPhase).toBe("loading");
		}
		expect(readGameNavigation(ROUTES, { pathname: "/" }, { vue: HOME }).openingPhase).toBe("menu");
	});

	test("preserves other owners' history data and proxy-provided entry metadata", () => {
		const state = gameNavigationHistory({ filter: "test" }, gameNavigationTarget("settings"));
		expect(state.filter).toBe("test");
		expect(readGameNavigation(ROUTES, { pathname: "/" }, state, "/settings")).toEqual({ view: "settings", openingPhase: "menu" });
	});

	test("returns to a clean canonical menu URL in each language", () => {
		for (const prefix of ["", "/en", "/ja"]) {
			const url = gameNavigationUrl(new URL(`https://example.test${prefix}/settings?tab=display#selection`), HOME);
			expect(url.pathname).toBe(prefix || "/");
			expect(url.search).toBe("");
			expect(url.hash).toBe("");
		}
	});

	test("local root links resume menu while destination query parameters remain intact", () => {
		const current = new URL("https://example.test/ja/settings?tab=display");
		expect(internalGameLink("/ja", current, ROUTES)?.view).toBe(HOME);
		const target = internalGameLink("/ja/textures?q=ball#results", current, ROUTES);
		expect(target?.view).toBe("textures");
		expect(target?.url.search).toBe("?q=ball");
		expect(target?.url.hash).toBe("#results");
	});

	test("leaves foreign origins, language changes, and non-host routes to the browser", () => {
		const current = new URL("https://example.test/settings");
		for (const href of ["https://elsewhere.test/settings", "/ja/settings", "/missing", "mailto:example@example.test"]) {
			expect(internalGameLink(href, current, ROUTES)).toBeNull();
		}
	});
});
