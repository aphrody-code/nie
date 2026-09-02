import { headers } from "next/headers";
import { type NextRequest, NextResponse } from "next/server";
import { ADMIN_ROLES } from "@/lib/auth-roles";
import { auth } from "@/lib/auth";
import { absoluteUrl } from "@/lib/site-url";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Résolveur de redirection post-connexion (déterministe, côté serveur).
 *
 * Cible des `callbackURL` OAuth et de la page /login. Lit la session + le rôle
 * réel en base, puis route :
 *   - admin (ADMIN_ROLES) → /dashboard direct (la "page admin")
 *   - sinon → returnTo sûr, jamais une page /dashboard (évite la boucle de rebond)
 *
 * Pourquoi serveur : la page /login calculait la destination depuis un `isAdmin`
 * client qui pouvait courir avant le chargement du profil → admin renvoyé sur "/".
 * Ici la décision est prise une fois la session lisible, sans race.
 */
function sanitizeReturnTo(returnTo: string | null): string {
	if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//")) {
		return "/";
	}
	return returnTo;
}

export async function GET(request: NextRequest) {
	const returnTo = sanitizeReturnTo(request.nextUrl.searchParams.get("returnTo"));

	let session: Awaited<ReturnType<typeof auth.api.getSession>>;
	try {
		const reqHeaders = await headers();
		session = await auth.api.getSession({ headers: reqHeaders });
	} catch {
		session = null;
	}

	if (!session?.user) {
		const dest = `/login?returnTo=${encodeURIComponent(returnTo)}`;
		return NextResponse.redirect(absoluteUrl(dest));
	}

	let role: string | null;
	try {
		const supabase = await createClient();
		const { data } = await supabase
			.from("profiles")
			.select("role")
			.eq("id", session.user.id)
			.maybeSingle();
		role = (data as { role?: string | null } | null)?.role ?? null;
	} catch {
		role = null;
	}

	const isAdmin = ADMIN_ROLES.includes(role as (typeof ADMIN_ROLES)[number]);

	if (isAdmin) {
		// Honore un returnTo déjà dans le dashboard, sinon l'accueil admin.
		const dest = returnTo.startsWith("/dashboard") ? returnTo : "/dashboard";
		return NextResponse.redirect(absoluteUrl(dest));
	}

	// Non-admin : ne jamais renvoyer vers une page admin (boucle middleware → /login).
	const dest = returnTo.startsWith("/dashboard") ? "/" : returnTo;
	return NextResponse.redirect(absoluteUrl(dest));
}
