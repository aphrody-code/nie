/** Browser location notifications shared by route and query-state adapters. */
const LOCATION_EVENT = "nie-location-change";
export interface NavigationOptions { replace?: boolean; scroll?: boolean }

export function writeBrowserHistory(url: string | URL | undefined, state: unknown, mode: "push" | "replace" = "replace"): void {
	if (mode === "push") window.history.pushState(state, "", url);
	else window.history.replaceState(state, "", url);
	window.dispatchEvent(new Event(LOCATION_EVENT));
}

export function subscribeBrowserLocation(listener: () => void): () => void {
	window.addEventListener(LOCATION_EVENT, listener);
	window.addEventListener("popstate", listener);
	window.addEventListener("hashchange", listener);
	return () => {
		window.removeEventListener(LOCATION_EVENT, listener);
		window.removeEventListener("popstate", listener);
		window.removeEventListener("hashchange", listener);
	};
}

export function browserLocationSnapshot(): string {
	return typeof window === "undefined" ? "/" : window.location.href;
}
