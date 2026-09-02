import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { resolveProfile, isAdmin } from "./index";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@rosegriffon/db";

/**
 * Server-only helpers requiring Next.js runtime.
 */

/**
 * Surface minimale d'une instance Better Auth requise par les guards :
 * seul `api.getSession` est consommé ici. Évite le couplage au type complet
 * (qui diffère entre apps selon les plugins activés).
 */
interface AuthInstanceLike {
	api: {
		getSession: (args: { headers: Headers }) => Promise<{
			user?: { id: string; email?: string | null } | null;
		} | null>;
	};
}

/**
 * Assure l'authentification admin — redirige si non autorisé.
 */
export async function createAdminGuard(
	authInstance: AuthInstanceLike,
	supabase: SupabaseClient<Database>,
	options: { redirectTo?: string; fallbackRole?: string } = {}
) {
	const session = await authInstance.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect(options.redirectTo || "/login");
	}

	const profile = await resolveProfile(supabase, session.user);

	if (!profile || !isAdmin(profile.role)) {
		console.warn("[adminGuard] denied", {
			userId: session.user.id,
			resolvedRole: profile?.role,
		});
		redirect(options.redirectTo || "/dashboard");
	}

	return { user: session.user, profile };
}

/**
 * Assure l'authentification avec un rôle spécifique.
 */
export async function createRoleGuard(
	authInstance: AuthInstanceLike,
	supabase: SupabaseClient<Database>,
	allowedRoles: string[],
	options: { redirectTo?: string } = {}
) {
	const session = await authInstance.api.getSession({
		headers: await headers(),
	});

	if (!session?.user) {
		redirect(options.redirectTo || "/login");
	}

	const profile = await resolveProfile(supabase, session.user);

	if (!profile || !profile.role || !allowedRoles.includes(profile.role)) {
		console.warn("[roleGuard] denied", {
			userId: session.user.id,
			resolvedRole: profile?.role,
			allowedRoles,
		});
		redirect(options.redirectTo || "/dashboard");
	}

	return { user: session.user, profile };
}
