// Re-export pour compat backward — utiliser directement `@rosegriffon/db/browser` dans les nouveaux modules.
// Cast en SupabaseClient permissif : le typing strict <Database> de `@rosegriffon/db` casse les call
// Sites azalee historiques (colonnes obsolètes, types nullable vs strict). Trade-off assumé.
import { createSupabaseBrowserClient } from "@rosegriffon/db/browser";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Creates a browser Supabase client (anon, no auth).
 * For authenticated requests, use the SupabaseProvider context instead.
 */
export const createClient = (): SupabaseClient =>
	createSupabaseBrowserClient() as unknown as SupabaseClient;
