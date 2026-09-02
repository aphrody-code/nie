import { resolveAccountTab, type AccountSession, type AccountTabId } from "@rosegriffon/ui";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { auth } from "@/lib/auth";
import { getServerSession } from "@/lib/auth-helpers";
import { createAdminClient } from "@/lib/supabase/admin";

import { AccountClient } from "./account-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	description: "Gère ton profil, tes comptes liés et la sécurité de ton compte Azalée.",
	title: "Paramètres du compte | Azalée",
};

/** Pas d'onglet Adresse : le wiki n'expédie rien. */
const TABS: readonly AccountTabId[] = ["profile", "connections", "security"];

export default async function SettingsPage({
	searchParams,
}: {
	searchParams: Promise<{ tab?: string }>;
}) {
	const session = await getServerSession();
	if (!session?.user) {
		redirect("/login?returnTo=/settings");
	}
	const user = session.user;
	const { tab } = await searchParams;

	// Le profil complet contient des données personnelles : `anon` n'y a plus
	// accès depuis la fermeture PII du 11/8/2026. La session est vérifiée
	// ci-dessus, la lecture se fait donc en service-role, filtrée sur son id.
	const admin = createAdminClient();
	const { data: profileRow, error: profileError } = await admin
		.from("profiles")
		.select("*")
		.eq("id", user.id)
		.maybeSingle();

	if (profileError) {
		console.error("[compte] lecture du profil impossible", profileError);
	}

	const profile = (profileRow ?? {}) as Record<string, unknown>;
	const str = (key: string) => (typeof profile[key] === "string" ? (profile[key] as string) : "");

	const { data: accountRows } = await admin
		.from("account")
		.select("provider_id, created_at, password")
		.eq("user_id", user.id);

	const accounts = (accountRows ?? []).map((row) => {
		const r = row as { provider_id: string; created_at: string };
		return { createdAt: r.created_at, provider: r.provider_id };
	});

	// Un compte purement OAuth n'a pas de ligne `credential` : proposer le
	// changement de mot de passe y renverrait toujours `CREDENTIAL_ACCOUNT_NOT_FOUND`.
	const hasPassword = (accountRows ?? []).some((row) => {
		const r = row as { provider_id: string; password: string | null };
		return r.provider_id === "credential" && Boolean(r.password);
	});

	// `listSessions` renvoie le `token` de chaque session, seule clé acceptée par
	// `revokeSession`.
	let sessions: AccountSession[] = [];
	try {
		const list = await auth.api.listSessions({ headers: await headers() });
		sessions = (list ?? []).map((s) => ({
			createdAt: new Date(s.createdAt).toISOString(),
			current: s.token === session.session.token,
			expiresAt: s.expiresAt ? new Date(s.expiresAt).toISOString() : null,
			ipAddress: s.ipAddress ?? null,
			token: s.token,
			userAgent: s.userAgent ?? null,
		}));
	} catch (error) {
		console.error("[compte] liste des sessions indisponible", error);
	}

	const username = str("username");

	return (
		<AccountClient
			userId={user.id}
			email={user.email}
			initialTab={resolveAccountTab(tab, TABS)}
			avatarUrl={str("avatar_url") || null}
			username={username || null}
			role={str("role") || null}
			twoFactorEnabled={Boolean((user as { twoFactorEnabled?: boolean }).twoFactorEnabled)}
			hasPassword={hasPassword}
			profile={{
				badges: Array.isArray(profile.badges) ? (profile.badges as string[]) : [],
				banner_position: Number((profile as Record<string, unknown>).banner_position ?? 50) || 50,
				poste: str("poste") || null,
				banner_url: str("banner_url"),
				bio: str("bio"),
				full_name: str("full_name"),
				twitter_handle: str("twitter_handle"),
				username,
				website: str("website"),
			}}
			accounts={accounts}
			sessions={sessions}
		/>
	);
}
