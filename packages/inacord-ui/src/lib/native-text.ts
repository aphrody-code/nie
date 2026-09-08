import { useEffect, useSyncExternalStore } from "react";
import type { GameLocale } from "./settings";

/** A single decoded occurrence, retaining its VFS provenance. */
export interface NativeTextOccurrence {
	file: string;
	text: string;
}

/** Exact result returned by the native text endpoint for one family/hash pair. */
export interface NativeTextMatches {
	language: string;
	family: string;
	hash: number;
	hash_hex: string;
	total: number;
	occurrences: NativeTextOccurrence[];
}

/** Host adapter. Browser, Tauri and Wasm use their own VFS transport behind this contract. */
export type NativeTextResolver = (locale: GameLocale, family: string, hash: string) => Promise<NativeTextMatches>;

/**
 * Browser adapter for the measured server VFS catalogue. It never carries a copy of game text.
 */
export const fetchNativeText: NativeTextResolver = async (locale, family, hash) => {
	const response = await fetch(`/api/v1/text/${encodeURIComponent(locale)}/${encodeURIComponent(family)}/${encodeURIComponent(hash)}`);
	if (!response.ok) throw new Error("Native text is unavailable");
	return response.json() as Promise<NativeTextMatches>;
};

interface Entry { value?: NativeTextMatches; pending?: Promise<void>; }
function createStore() {
	const entries = new Map<string, Entry>();
	const listeners = new Set<() => void>();
	let revision = 0;
	return {
		entries,
		subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
		snapshot: () => revision,
		notify() { revision += 1; listeners.forEach(listener => listener()); },
	};
}
const stores = new WeakMap<NativeTextResolver, ReturnType<typeof createStore>>();
const keyOf = (locale: GameLocale, family: string, hash: string) => JSON.stringify([locale, family, hash.toLowerCase()]);

/**
 * Resolves text only through an explicit `(locale, family, hash)` reference.
 *
 * A hash may have multiple occurrences. This hook returns that ambiguity intact; callers must
 * select an occurrence only when their native layout identifies one, rather than taking the
 * first text that happens to share the hash.
 */
export function useNativeText(resolver: NativeTextResolver | undefined, locale: GameLocale, family: string | undefined, hash: string | undefined): NativeTextMatches | undefined {
	const active = resolver;
	let store = active && stores.get(active);
	if (active && !store) { store = createStore(); stores.set(active, store); }
	const current = store;
	useSyncExternalStore(current ? current.subscribe : () => () => {}, current ? current.snapshot : () => 0, () => 0);
	const key = family && hash ? keyOf(locale, family, hash) : undefined;
	useEffect(() => {
		if (!active || !current || !key || !family || !hash) return;
		const existing = current.entries.get(key);
		if (existing?.value || existing?.pending) return;
		const entry: Entry = {};
		entry.pending = active(locale, family, hash).then(value => { entry.value = value; }).catch(() => undefined).finally(() => {
			entry.pending = undefined;
			current.notify();
		});
		current.entries.set(key, entry);
	}, [active, current, family, hash, key, locale]);
	return current && key ? current.entries.get(key)?.value : undefined;
}

/** Returns a unique occurrence or leaves an ambiguous native reference unresolved. */
export function uniqueNativeText(matches: NativeTextMatches | undefined): NativeTextOccurrence | undefined {
	return matches?.total === 1 ? matches.occurrences[0] : undefined;
}
