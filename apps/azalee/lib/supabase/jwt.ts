import jwt from "jsonwebtoken";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mint a Supabase-compatible JWT for a given Better Auth user ID.
 * This JWT is accepted by PostgREST so that `auth.uid()` returns the user's UUID
 * and all existing RLS policies continue to work unchanged.
 *
 * Le secret est lu au moment de l'appel (pas en top-level) pour éviter
 * de crasher le build quand l'env var n'est pas disponible côté
 * prerender de routes qui n'utilisent jamais ce module.
 */
export function mintSupabaseJwt(userId: string): string {
	const secret = process.env.SUPABASE_JWT_SECRET;
	if (!secret) {
		throw new Error(
			"CRITICAL: SUPABASE_JWT_SECRET is missing from environment variables. Authentication will fail."
		);
	}
	if (!UUID_RE.test(userId)) {
		throw new Error("mintSupabaseJwt: invalid userId format");
	}
	return jwt.sign(
		{
			aud: "authenticated",
			iss: "supabase",
			role: "authenticated",
			sub: userId,
		},
		secret,
		{ expiresIn: "1h" }
	);
}
