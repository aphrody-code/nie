import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { mintSupabaseJwt } from "@/lib/supabase/jwt";
import type { Database } from "@rosegriffon/db";
import { createSqliteClient } from "@rosegriffon/azalee/db";

const PLACEHOLDER_URL = (typeof window === "undefined" ? "http://127.0.0.1:8811" : window.location.origin);
const PLACEHOLDER_ANON_JWT =
	"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlzYmthZWx0dWJxaXR0eXdpYmVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDYyNzUsImV4cCI6MjA5MjEyMjI3NX0.eAyJfqREb8Kh5F_yLf5Jp43S2qOil4qUcqFTLQiExx0";

function isValidHttpUrl(v: string | undefined | null): v is string {
	return Boolean(
		v && v !== "undefined" && v !== "null" && v.startsWith("http") && !v.startsWith("eyJ2Ijo")
	);
}

function isValidKey(v: string | undefined | null): v is string {
	return Boolean(
		v && v !== "undefined" && v !== "null" && !v.startsWith("{") && !v.startsWith("eyJ2Ijo")
	);
}

function pickUrl(...keys: string[]): string {
	for (const k of keys) {
		const v = process.env[k];
		if (isValidHttpUrl(v)) {
			return v;
		}
	}
	return PLACEHOLDER_URL;
}

function pickKey(...keys: string[]): string {
	for (const k of keys) {
		const v = process.env[k];
		if (isValidKey(v)) {
			return v;
		}
	}
	return PLACEHOLDER_ANON_JWT;
}

const supabaseUrl = pickUrl(
	"SUPABASE_INTERNAL_URL",
	"NEXT_PUBLIC_SUPABASE_URL",
	"NEXT_PUBLIC_SUPABASE_PUBLISHABLE_URL"
);
const supabaseAnonKey = pickKey(
	"NEXT_PUBLIC_SUPABASE_ANON_KEY",
	"NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
);

// Skip the Better Auth -> Supabase JWT bridge when the local SUPABASE_JWT_SECRET
// Is desynchronized from Supabase Cloud (minted JWTs rejected with PGRST301).
// Lectures publiques via anon + GRANT SELECT sur schema public (appliqué 2026-04-20).
// Défaut: true. Pour réactiver le bridge après avoir resyncé le secret: DISABLE_SUPABASE_JWT_BRIDGE=false.
const DISABLE_SUPABASE_JWT_BRIDGE = process.env.DISABLE_SUPABASE_JWT_BRIDGE !== "false";

let _hasWarnedMissingBun = false;

/**
 * Creates a Supabase server client.
 * If a Better Auth session exists AND the JWT bridge is enabled, mints a JWT so
 * auth.uid() works in RLS. Otherwise returns an anon client.
 */
export const createClient = async (): Promise<SupabaseClient> => {
	let accessToken: string | undefined;

	if (!DISABLE_SUPABASE_JWT_BRIDGE) {
		try {
			const reqHeaders = await headers();
			const session = await auth.api.getSession({ headers: reqHeaders });

			if (session?.user?.id) {
				accessToken = mintSupabaseJwt(session.user.id);
			}
		} catch {
			// No session or headers not available — use anon client
		}
	}

	let pgClient: SupabaseClient;
	if (accessToken) {
		pgClient = createSupabaseClient<Database>(supabaseUrl, supabaseAnonKey, {
			global: {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			},
		}) as unknown as SupabaseClient;
	} else {
		pgClient = createSupabaseClient<Database>(
			supabaseUrl,
			supabaseAnonKey
		) as unknown as SupabaseClient;
	}

	const sqliteClient = createSqliteClient();

	return new Proxy(pgClient, {
		get(target, prop, receiver) {
			if (prop === "from") {
				return (table: string) => {
					if (table.startsWith("inagle_")) {
						try {
							return sqliteClient.from(table);
						} catch (e: unknown) {
							const msg = e instanceof Error ? e.message : String(e);
							if (
								msg.includes("Cannot find module 'bun:sqlite'") ||
								msg.includes("Failed to load external module bun:sqlite")
							) {
								if (!_hasWarnedMissingBun) {
									console.log(
										"[SQLite Cache] SQLite database cache is unavailable in this environment (falling back to Postgres)."
									);
									_hasWarnedMissingBun = true;
								}
							} else {
								console.warn(`[SQLite Cache] Fallback to Postgres for table ${table}:`, e);
							}
							return target.from(table);
						}
					}
					return target.from(table);
				};
			}
			return Reflect.get(target, prop, receiver);
		},
	}) as unknown as SupabaseClient;
};
