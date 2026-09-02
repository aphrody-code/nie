import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isAdmin, resolveProfile } from "@rosegriffon/auth";
import { MEDAILLE_AZALEE_ROLE_ID } from "@rosegriffon/types";

/**
 * Get the current Better Auth session server-side.
 * Returns { user, session } or null.
 */
export async function getServerSession() {
	try {
		const reqHeaders = await headers();
		const session = await auth.api.getSession({ headers: reqHeaders });
		return session;
	} catch {
		return null;
	}
}

/**
 * Require auth — returns user or null.
 */
export async function requireAuth() {
	const session = await getServerSession();
	if (!session?.user) {
		return null;
	}
	return session.user;
}

/**
 * Require auth or fail with an error (for server actions).
 */
export async function requireAuthOrFail() {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non autorisé");
	}
	return session;
}

/**
 * Require admin role — redirects to "/" if not authorized.
 */
export async function requireAdmin() {
	const user = await requireAuth();
	if (!user) {
		redirect("/login");
	}

	const supabase = await createClient();
	const profile = await resolveProfile(supabase, user);

	if (!profile || !isAdmin(profile.role)) {
		console.warn("[requireAdmin] denied", {
			resolvedRole: profile?.role,
			userId: user.id,
		});
		redirect("/");
	}

	return { profile, session: { user } };
}

/**
 * Same as requireAdmin but throws instead of redirecting.
 */
export async function requireAdminOrFail() {
	const user = await requireAuth();
	if (!user) {
		throw new Error("Non autorisé");
	}

	const supabase = await createClient();
	const profile = await resolveProfile(supabase, user);

	if (!profile || !isAdmin(profile.role)) {
		throw new Error("Accès réservé aux administrateurs");
	}

	return { profile, session: { user } };
}

/**
 * True if the user with the given Discord ID owns the Médaille Azalée role.
 */
export async function hasMedailleAzaleeRole(
	discordId: string | null | undefined
): Promise<boolean> {
	if (!discordId) {
		return false;
	}
	const { createSupabaseServiceClient } = await import("@rosegriffon/db/service");
	const supabase = createSupabaseServiceClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data } = (await (supabase as any)
		.from("discord_members")
		.select("roles")
		.eq("discord_id", discordId)
		.single()) as { data: { roles: unknown } | null };

	if (!data?.roles) {
		return false;
	}

	const roles = Array.isArray(data.roles)
		? (data.roles as string[])
		: (() => {
				try {
					return JSON.parse(String(data.roles)) as string[];
				} catch {
					return [];
				}
			})();

	return roles.includes(MEDAILLE_AZALEE_ROLE_ID);
}

/**
 * Editor-tier guard: ADMIN_ROLES or Médaille Azalée members.
 */
export async function requireEditorOrFail() {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non autorisé");
	}

	const supabase = await createClient();
	const profile = await resolveProfile(supabase, session.user);

	if (!profile) {
		throw new Error("Profil introuvable");
	}

	if (isAdmin(profile.role)) {
		return {
			isAdmin: true as const,
			isMedaille: false as const,
			profile,
			session,
		};
	}

	if (await hasMedailleAzaleeRole(profile.discord_id)) {
		return {
			isAdmin: false as const,
			isMedaille: true as const,
			profile,
			session,
		};
	}

	throw new Error("Accès réservé à l'équipe rédactionnelle");
}
