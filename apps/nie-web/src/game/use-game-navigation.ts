import { useCallback, useEffect, useRef, useState } from "react";
import { NATIVE_WINDOW } from "../host";
import { HOME, pathForEntry, splitLanguagePrefix } from "../routing";
import {
	gameNavigationHistory,
	gameNavigationTarget,
	gameNavigationUrl,
	internalGameLink,
	readGameNavigation,
	type GameNavigationState,
} from "./navigation";
import type { OpeningPhase } from "./opening-sequence";
import { writeBrowserHistory, type NavigationOptions } from "@niers/inacord-ui/lib/browser-navigation";

/** One screen state survives route unmounts, history traversal, and page reloads. */
export function useGameNavigation(routes: readonly string[], serverRoute?: string | null) {
	const [navigation, setNavigation] = useState(() =>
		readGameNavigation(routes, window.location, window.history.state, serverRoute),
	);
	const current = useRef(navigation);
	const update = useCallback((next: GameNavigationState) => {
		current.current = next;
		setNavigation(next);
	}, []);

	useEffect(() => {
		const persist = () => {
			// Inside the native window the address bar is not an address: Tauri serves the files of
			// `frontendDist`, with no index fallback, so a path like `/inacord/cinema` written here
			// would 404 the whole application on the next reload. The screen still lives in the
			// history STATE, which is what restores it — only the URL stays put.
			if (NATIVE_WINDOW) {
				writeBrowserHistory(undefined, gameNavigationHistory(window.history.state, current.current));
				return;
			}
			const url = new URL(window.location.href);
			url.pathname = pathForEntry(splitLanguagePrefix(url.pathname).prefix, current.current.view);
			writeBrowserHistory(url, gameNavigationHistory(window.history.state, current.current));
		};
		// Canonicalize the legacy `/menu` alias without restarting the startup sequence.
		persist();
		const restore = () => {
			const next = readGameNavigation(routes, window.location, window.history.state);
			const restoredPhase = next.openingPhase;
			// Older/unmarked root entries must also return from a tool directly to its menu.
			if (next.view === HOME && current.current.view !== HOME) next.openingPhase = "menu";
			update(next);
			const canonical = pathForEntry(splitLanguagePrefix(window.location.pathname).prefix, next.view);
			if (restoredPhase !== next.openingPhase || window.location.pathname !== canonical) persist();
		};
		window.addEventListener("popstate", restore);
		return () => window.removeEventListener("popstate", restore);
	}, [routes, update]);

	const navigate = useCallback((view: string, href?: URL, options?: NavigationOptions) => {
		const next = gameNavigationTarget(view);
		if (NATIVE_WINDOW) {
			// Same reason as `persist`: the state moves, the URL does not. And it REPLACES, never
			// pushes: `readGameNavigation` deliberately ignores a non-root screen found in a history
			// record at `/` (a stale entry must not hijack the game), so pushed entries here would
			// build a Back stack that always came back to the same screen. The native window has no
			// Back button; it had no view history before this merge either.
			writeBrowserHistory(undefined, gameNavigationHistory(window.history.state, next));
			update(next);
			return;
		}
		const location = new URL(window.location.href);
		const url = href ? new URL(href) : gameNavigationUrl(location, next.view);
		url.pathname = pathForEntry(splitLanguagePrefix(url.pathname).prefix, next.view);
		if (options?.replace || url.href === location.href) {
			writeBrowserHistory(url, gameNavigationHistory(window.history.state, next));
		} else {
			writeBrowserHistory(url, gameNavigationHistory(null, next), "push");
		}
		update(next);
		if (options?.scroll !== false && url.pathname !== location.pathname) window.scrollTo(0, 0);
	}, [update]);

	const navigateLink = useCallback((href: string, options?: NavigationOptions) => {
		const target = internalGameLink(href, new URL(window.location.href), routes);
		if (target) navigate(target.view, target.url, options);
		else if (options?.replace) window.location.replace(href);
		else window.location.assign(href);
	}, [navigate, routes]);

	useEffect(() => {
		// Vite's shell is mounted for every public game route. Intercept plain same-origin
		// anchors too (not only the shared Link component) so a menu, gallery or catalogue
		// deep link keeps its React state and never flashes through a full document load.
		const follow = (event: MouseEvent) => {
			if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
			const source = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
			if (!source || source.target || source.hasAttribute("download")) return;
			const href = source.href;
			if (!internalGameLink(href, new URL(window.location.href), routes)) return;
			event.preventDefault();
			navigateLink(href);
		};
		document.addEventListener("click", follow);
		return () => document.removeEventListener("click", follow);
	}, [navigateLink, routes]);

	const setOpeningPhase = useCallback((openingPhase: OpeningPhase) => {
		if (current.current.view !== HOME) return;
		const next = { ...current.current, openingPhase };
		writeBrowserHistory(undefined, gameNavigationHistory(window.history.state, next));
		update(next);
	}, [update]);

	return { ...navigation, navigate, navigateLink, setOpeningPhase };
}
