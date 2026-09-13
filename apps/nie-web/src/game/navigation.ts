import { MENU, sectionEntry } from "../entries";
import { HOME, pathForEntry, requestedEntry, splitLanguagePrefix } from "../routing";
import { OPENING_PHASES, type OpeningPhase } from "./opening-sequence";

/** Browser route state, independent of VFS availability and of a mounted game screen. */
export interface GameNavigationState {
	view: string;
	openingPhase: OpeningPhase;
}

type NavigationHistory = { version: 1 } & GameNavigationState;

function historyRecord(state: unknown): Record<string, unknown> {
	return state && typeof state === "object" && !Array.isArray(state)
		? (state as Record<string, unknown>)
		: {};
}

/** A direct tool/menu entry has a main menu to return to; only a fresh root starts loading. */
export function readGameNavigation(
	routes: readonly string[],
	location: { pathname: string },
	historyState: unknown,
	serverRoute?: string | null,
): GameNavigationState {
	// Une fiche de section (`modes/victory-road`) n'est pas dans le catalogue des entrées —
	// elle est PORTÉE par l'une d'elles. Sans ce repli, le serveur sert la page et le client
	// affiche l'accueil : la même adresse existe pour un moteur et pas pour un visiteur.
	const requested = requestedEntry(routes, location, serverRoute)
		?? sectionEntry(location.pathname)
		?? HOME;
	if (requested !== HOME) {
		return { view: requested === MENU ? HOME : requested, openingPhase: "menu" };
	}
	const record = historyRecord(historyState);
	const saved = historyRecord(record.gameNavigation);
	if (
		saved.version === 1 && saved.view === HOME &&
		(saved.openingPhase === "loading" || saved.openingPhase === "start" || saved.openingPhase === "menu") &&
		(OPENING_PHASES as readonly unknown[]).includes(saved.openingPhase)
	) {
		return { view: HOME, openingPhase: saved.openingPhase as OpeningPhase };
	}
	// Previous hosts wrote this marker only when navigating back to the root.
	return { view: HOME, openingPhase: record.vue === HOME ? "menu" : "loading" };
}

/** Preserve unrelated history data used by catalogue filters and other host components. */
export function gameNavigationHistory(
	state: unknown,
	navigation: GameNavigationState,
): Record<string, unknown> & { gameNavigation: NavigationHistory } {
	const saved: NavigationHistory = { version: 1, ...navigation };
	return { ...historyRecord(state), gameNavigation: saved };
}

/** Root links and the published `/menu` alias resume the menu during host navigation. */
export function gameNavigationTarget(view: string): GameNavigationState {
	return { view: view === MENU ? HOME : view, openingPhase: "menu" };
}

/** Route changes start with a clean URL; page-specific filters must not leak into the menu. */
export function gameNavigationUrl(location: URL, view: string): URL {
	return new URL(pathForEntry(splitLanguagePrefix(location.pathname).prefix, view), location.origin);
}

/** Only same-origin, same-language routes belong to this mounted host. */
export function internalGameLink(
	href: string,
	current: URL,
	routes: readonly string[],
): { view: string; url: URL } | null {
	const url = new URL(href, current);
	const target = splitLanguagePrefix(url.pathname);
	if (url.origin !== current.origin || target.prefix !== splitLanguagePrefix(current.pathname).prefix) {
		return null;
	}
	const view = target.route === "/" ? HOME : requestedEntry(routes, url) ?? sectionEntry(url.pathname);
	if (!view) return null;
	return { view, url };
}
