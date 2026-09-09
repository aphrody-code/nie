/**
 * Database client provider — the library's single injection point.
 *
 * Hosts inject a compatible read-only client. The Rust wiki is the canonical
 * IEVR data owner; this module remains only for legacy host integrations.
 *
 * ## Pourquoi il n'y a plus de défaut (lot J2, 2026-09-05)
 *
 * La bibliothèque retombait d'elle-même sur le miroir SQLite quand personne
 * n'injectait rien. Ce défaut était invisible et dangereux : sur Vercel le
 * fichier n'existe pas, et l'erreur ne survenait qu'au moment d'une requête, à
 * l'intérieur d'une page — donc sous la forme d'une page vide plutôt que d'un
 * démarrage refusé. Un hôte doit maintenant DIRE d'où viennent ses données.
 */

/** Minimal query surface required by the legacy host modules. */
export type DatabaseClient = {
	// The Rust API is canonical. This untyped chain exists only while the legacy
	// host adapter is being retired; it carries no database implementation.
	from(table: string): any;
};

/** Synchronous or asynchronous client factory. */
export type DatabaseClientFactory = () => DatabaseClient | Promise<DatabaseClient>;

let factory: DatabaseClientFactory | null = null;
let defaut: DatabaseClientFactory | null = null;

/**
 * Set the fallback source used when no explicit factory is injected.
 *
 * Elle n'existe que si un hôte la fournit : `@niers/azalee-tools` y met le miroir SQLite,
 * parce qu'une CLI ou une suite hors ligne lit légitimement un fichier local. Le wiki
 * serverless, lui, n'en pose aucune — sans injection explicite, ses lectures lèvent, ce qui
 * est le but du lot J2.
 *
 * La distinction compte : `setDatabaseProvider(null)` veut dire « retire MON client », pas
 * « supprime toute source ». Sans ce second niveau, les `afterEach` d'hygiène qui remettent
 * `null` — un usage parfaitement sain — condamnaient tous les fichiers de test suivants.
 */
export function setDefaultDatabaseProvider(next: DatabaseClientFactory | null): void {
	defaut = next;
}

/**
 * Set the client factory used by the legacy host modules. Passing `null` removes it.
 */
export function setDatabaseProvider(next: DatabaseClientFactory | null): void {
	factory = next;
}

/** Return whether a host factory has been injected. */
export function hasDatabaseProvider(): boolean {
	return factory !== null;
}

/**
 * Return the injected read-only game-data client.
 */
export async function createClient(): Promise<DatabaseClient> {
	const choisie = factory ?? defaut;
	if (!choisie) {
		throw new Error(
			"No data client injected: call setDatabaseProvider() before reading wiki data.",
		);
	}
	return await choisie();
}
