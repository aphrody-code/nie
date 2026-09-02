import "server-only";

/**
 * Branchement de la bibliothèque `@rosegriffon/azalee` sur le runtime Next.
 *
 * La lib lit par défaut le **miroir SQLite** seul (mode CLI / sidecar Tauri).
 * Dans le wiki web on injecte le client Supabase enveloppé du `Proxy` maison :
 * les tables `inagle_*` partent sur le miroir, tout le reste (éditorial,
 * social, `tweets`…) reste sur PostgREST, avec repli Postgres si le miroir est
 * indisponible. Sémantique strictement identique à l'avant-extraction.
 *
 * Ce module est importé par chaque façade serveur de `lib/` : l'injection est
 * donc garantie avant le premier accès données, quelle que soit la route.
 */

import { setDatabaseProvider } from "@rosegriffon/azalee/db";
import { createClient } from "@/lib/supabase/server";

setDatabaseProvider(createClient);

export { createClient };
