// Client Supabase browser-side (Next.js client components).
// Singleton — un seul client par tab.
import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";
import type { Database } from "./types.gen";

let cachedClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function createSupabaseBrowserClient() {
	if (cachedClient) return cachedClient;
	cachedClient = createBrowserClient<Database>(getSupabaseUrl(), getSupabasePublishableKey());
	return cachedClient;
}
