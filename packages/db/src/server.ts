// Client Supabase server-side (Next.js server components, Route Handlers, Server Actions).
// Lit/écrit les cookies Next via `next/headers` — donc nécessite Next runtime.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { getSupabasePublishableKey, getSupabaseUrl } from "./env";

export interface CookieStore {
	getAll: () => Array<{ name: string; value: string }>;
	set?: (name: string, value: string, options?: CookieOptions) => void;
}

export function createSupabaseServerClient(cookies: CookieStore) {
	return createServerClient(getSupabaseUrl(), getSupabasePublishableKey(), {
		cookies: {
			getAll() {
				return cookies.getAll();
			},
			setAll(
				cookiesToSet: Array<{
					name: string;
					value: string;
					options?: CookieOptions;
				}>
			) {
				try {
					for (const { name, value, options } of cookiesToSet) {
						cookies.set?.(name, value, options);
					}
				} catch {
					// Server Component context — cookies are read-only. Middleware refreshes la session.
				}
			},
		},
	});
}
