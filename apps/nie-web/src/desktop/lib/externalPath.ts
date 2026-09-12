/**
 * The file opened from outside the application — « Ouvrir avec », or a second launch forwarded
 * by the single-instance guard.
 *
 * ## Why it is a store and not a `useState`
 *
 * Two unrelated parts of the merged interface read it. The host adapter WRITES it: it is the one
 * that takes the cold-start argv (`api.takePendingOpen`) and listens to the `open-path` event.
 * The workspace body READS it to draw the external file instead of its views, and the shell READS
 * it to stop highlighting a sidebar place that is no longer on screen.
 *
 * Before the merge those three lived in one component, so a `useState` was enough. Lifting it to
 * the host and passing it back down would have meant threading a prop through the shell, which
 * has no use for it beyond the highlight — the store keeps each reader independent, exactly like
 * `explorerTabs`.
 */
import { useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** The path currently opened from outside, or `null` when the workspace shows its own views. */
export function getExternalPath(): string | null {
	return current;
}

/** Opens (or closes, with `null`) an external file. */
export function setExternalPath(path: string | null): void {
	if (current === path) return;
	current = path;
	for (const listener of listeners) listener();
}

/** Reactive read of {@link getExternalPath}. */
export function useExternalPath(): string | null {
	return useSyncExternalStore(subscribe, getExternalPath, () => null);
}
