import { useCallback, useEffect, useRef, useState } from "react";
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
			const url = new URL(window.location.href);
			url.pathname = pathForEntry(splitLanguagePrefix(url.pathname).prefix, current.current.view);
			window.history.replaceState(gameNavigationHistory(window.history.state, current.current), "", url);
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

	const navigate = useCallback((view: string, href?: URL) => {
		const next = gameNavigationTarget(view);
		const location = new URL(window.location.href);
		const url = href ? new URL(href) : gameNavigationUrl(location, next.view);
		url.pathname = pathForEntry(splitLanguagePrefix(url.pathname).prefix, next.view);
		if (url.href === location.href) {
			window.history.replaceState(gameNavigationHistory(window.history.state, next), "", url);
		} else {
			window.history.pushState(gameNavigationHistory(null, next), "", url);
		}
		update(next);
	}, [update]);

	const navigateLink = useCallback((href: string) => {
		const target = internalGameLink(href, new URL(window.location.href), routes);
		if (target) navigate(target.view, target.url);
		else window.location.assign(href);
	}, [navigate, routes]);

	const setOpeningPhase = useCallback((openingPhase: OpeningPhase) => {
		if (current.current.view !== HOME) return;
		const next = { ...current.current, openingPhase };
		window.history.replaceState(gameNavigationHistory(window.history.state, next), "");
		update(next);
	}, [update]);

	return { ...navigation, navigate, navigateLink, setOpeningPhase };
}
