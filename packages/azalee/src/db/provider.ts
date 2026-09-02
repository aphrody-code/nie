/**
 * Fournisseur de client base de données — point d'injection unique de la lib.
 *
 * Par défaut la bibliothèque lit **le miroir SQLite** des tables `inagle_*`
 * (100 % Bun, zéro réseau) : elle est donc utilisable telle quelle en CLI, en
 * test ou dans n'importe quel script.
 *
 * Une application hôte peut injecter son propre client — c'est ce que fait
 * `apps/azalee`, qui fournit le client Supabase enveloppé d'un `Proxy` routant
 * les tables `inagle_*` vers le miroir et **tout le reste** (éditorial, social,
 * `tweets`…) vers PostgREST. Sans injection, seules les tables présentes dans le
 * miroir répondent.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createSqliteClient } from "./sqlite-client";

/** Fabrique de client, synchrone ou asynchrone. */
export type DatabaseClientFactory = () => SupabaseClient | Promise<SupabaseClient>;

let factory: DatabaseClientFactory | null = null;

/**
 * Injecte la fabrique de client utilisée par toute la lib. Passer `null`
 * restaure le comportement par défaut (miroir SQLite seul).
 */
export function setDatabaseProvider(next: DatabaseClientFactory | null): void {
	factory = next;
}

/** Indique si une fabrique a été injectée par l'hôte. */
export function hasDatabaseProvider(): boolean {
	return factory !== null;
}

/**
 * Renvoie le client de lecture des données de jeu. Les modules `wiki/*`
 * n'utilisent que la surface `.from(table).select(...)`, commune au client
 * Supabase et au client miroir.
 */
export async function createClient(): Promise<SupabaseClient> {
	if (factory) return await factory();
	return createSqliteClient() as unknown as SupabaseClient;
}
