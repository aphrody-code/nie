import { useSyncExternalStore } from "react";

export function useMediaQuery(query: string) {
	const subscribe = (callback: () => void) => {
		const matchMedia = window.matchMedia(query);
		matchMedia.addEventListener("change", callback);
		return () => matchMedia.removeEventListener("change", callback);
	};

	const getSnapshot = () => window.matchMedia(query).matches;

	const getServerSnapshot = () => false;

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
