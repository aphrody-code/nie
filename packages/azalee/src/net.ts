/**
 * Récupération HTTP portable, avec cache TTL en mémoire de processus.
 *
 * Les tables de configuration du jeu (croissance, `chara_param`, taux
 * d'invocation…) sont servies en JSON par le CDN. Côté Next on utilisait le
 * hint propriétaire `fetch(url, { next: { revalidate } })` ; ici on garde la
 * même sémantique de fraîcheur avec un cache process-local, valable sous
 * n'importe quel runtime (Bun CLI, sidecar Tauri, serveur Next).
 */

interface CacheEntry {
	at: number;
	value: unknown;
}

const memo = new Map<string, CacheEntry>();

/** Options de récupération. */
export interface FetchJsonOptions {
	/** Durée de fraîcheur du cache, en secondes (0 = pas de cache). */
	revalidate?: number;
	/** Signal d'annulation. */
	signal?: AbortSignal;
}

/**
 * Récupère un JSON et le met en cache pour `revalidate` secondes. Renvoie
 * `null` sur erreur réseau ou statut non-2xx — les appelants dégradent
 * proprement (liste vide, stats non résolues) plutôt que de propager.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T | null> {
	const { revalidate = 0, signal } = options;
	const now = Date.now();

	if (revalidate > 0) {
		const hit = memo.get(url);
		if (hit && now - hit.at < revalidate * 1000) return hit.value as T;
	}

	try {
		const res = await fetch(url, signal ? { signal } : undefined);
		if (!res.ok) return null;
		const value = (await res.json()) as T;
		if (revalidate > 0) memo.set(url, { at: now, value });
		return value;
	} catch {
		return null;
	}
}

/** Vide le cache HTTP process-local (tests, rafraîchissement forcé). */
export function clearFetchCache(): void {
	memo.clear();
}
