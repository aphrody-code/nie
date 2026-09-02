import type { SupabaseClient } from "@supabase/supabase-js";
import { PUBLIC_PROFILE_COLUMNS, type Database, type PublicProfile } from "@rosegriffon/db";
import { ADMIN_ROLES } from "@rosegriffon/types";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/**
 * Common logic to resolve a profile from a Better Auth user,
 * handling the mismatch between Better Auth IDs and Supabase profiles.
 *
 * Ne sélectionne QUE les colonnes publiques : un `select("*")` échoue
 * intégralement en 42501 avec un client anon depuis la fermeture PII des
 * `profiles` (11/8/2026). La fonction sert aux décisions d'autorisation
 * (`requireAdmin`), donc l'échec silencieux renvoyait `null` et refusait
 * l'accès à tous les administrateurs. `role` et `discord_id` — les deux seules
 * colonnes réellement lues par les appelants — sont dans la liste blanche.
 */
export async function resolveProfile(
	supabase: SupabaseClient<Database>,
	user: { id: string; email?: string | null }
): Promise<PublicProfile | null> {
	const tryFetch = async (column: string, value: string): Promise<PublicProfile | null> => {
		const { data } = await supabase
			.from("profiles")
			.select(PUBLIC_PROFILE_COLUMNS)
			.eq(column, value)
			.maybeSingle();
		return (data as PublicProfile | null) ?? null;
	};

	// 1. Direct ID match
	let profile = await tryFetch("id", user.id);

	// 2. Discord account fallback
	if (!profile) {
		const { data: account } = await supabase
			.from("account")
			.select("account_id")
			.eq("user_id", user.id)
			.eq("provider_id", "discord")
			.maybeSingle();

		const discordId = (account as { account_id?: string } | null)?.account_id;
		if (discordId) {
			profile = await tryFetch("discord_id", discordId);
		}
	}

	// 3. Repli e-mail — ne fonctionne qu'avec un client service : `email` est hors
	// liste blanche, donc filtrer dessus est refusé à un client anon (échec
	// silencieux, `data` vaut null, ce qui est le comportement voulu ici).
	if (!profile && user.email) {
		profile = await tryFetch("email", user.email);
	}

	return profile;
}

/**
 * Check if a role is considered 'admin' in the RG ecosystem.
 */
export function isAdmin(role: string | null | undefined): boolean {
	if (!role) return false;
	return (ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * Check if a role is considered 'staff' in the RG ecosystem.
 */
export function isStaff(role: string | null | undefined): boolean {
	return role === "admin" || role === "staff";
}

import { createSupabaseServiceClient } from "@rosegriffon/db/service";

/**
 * Renvoie un pseudo libre dérivé du candidat.
 *
 * Suffixe déterministe tiré de l'identifiant plutôt qu'un compteur : deux
 * inscriptions simultanées sur le même candidat n'obtiennent pas le même
 * suffixe, et un rejeu retombe sur la même valeur.
 */
async function trouverPseudoLibre(
	db: SupabaseClient<Database>,
	candidat: string,
	userId: string
): Promise<string> {
	const propositions = [
		candidat,
		`${candidat.slice(0, 22)}-${userId.replace(/-/g, "").slice(0, 6)}`,
		`membre-${userId.replace(/-/g, "").slice(0, 12)}`,
	];

	for (const proposition of propositions) {
		const { data, error } = await db
			.from("profiles")
			.select("id")
			.eq("username", proposition)
			.maybeSingle();
		// En cas d'erreur de lecture on ne peut pas conclure : passer à la
		// proposition suivante vaut mieux que réserver un pseudo peut-être pris.
		if (!error && !data) {
			return proposition;
		}
	}

	// Dernier recours : l'identifiant complet, unique par construction.
	return `membre-${userId.replace(/-/g, "")}`;
}

/**
 * Ensures a profile exists in Supabase for the given user.
 * Standardizes username generation and initial role assignment.
 */
export async function ensureUserProfile(
	user: {
		id: string;
		name?: string | null;
		email?: string | null;
		image?: string | null;
	},
	supabase?: SupabaseClient<Database>,
	options: { defaultRole?: string; appName?: string } = {}
) {
	const db = supabase || createSupabaseServiceClient();
	try {
		const { data: existing } = await db
			.from("profiles")
			.select("*")
			.eq("id", user.id)
			.maybeSingle();

		// Fetch linked accounts to sync provider IDs
		const { data: accounts } = await db
			.from("account")
			.select("provider_id, account_id")
			.eq("user_id", user.id);

		const discordAccount = accounts?.find((a) => a.provider_id === "discord");
		const patreonAccount = accounts?.find((a) => a.provider_id === "patreon");

		const discordId = discordAccount?.account_id || null;
		const patreonId = patreonAccount?.account_id || null;

		if (existing) {
			// Première connexion sur un profil pré-créé depuis Discord : il devient
			// « réclamé », ce qui le rend visible publiquement (policy « Profils réclamés
			// visibles par tous »). Tant que personne ne s'y connecte, il reste masqué.
			if (!existing.claimed_at) {
				await db
					.from("profiles")
					.update({ claimed_at: new Date().toISOString() })
					.eq("id", user.id);
			}

			// Update avatar/name/provider IDs if changed
			const hasAvatarChanged = user.image !== existing.avatar_url;
			const hasNameChanged = user.name !== existing.full_name;
			const hasDiscordChanged = discordId && discordId !== existing.discord_id;
			const hasPatreonChanged = patreonId && patreonId !== existing.patreon_id;

			if (hasAvatarChanged || hasNameChanged || hasDiscordChanged || hasPatreonChanged) {
				await db
					.from("profiles")
					.update({
						avatar_url: user.image || existing.avatar_url,
						full_name: user.name || existing.full_name,
						discord_id: discordId || existing.discord_id,
						patreon_id: patreonId || existing.patreon_id,
						updated_at: new Date().toISOString(),
					})
					.eq("id", user.id);
			}
			return existing;
		}

		// Adoption d'un profil pré-créé depuis Discord.
		//
		// `profiles_discord_id_key` est UNIQUE : si un profil pré-créé porte déjà ce
		// `discord_id` sous un autre identifiant, l'insertion ci-dessous échouerait en
		// 23505 et la personne se retrouverait sans profil. Un profil non réclamé ne
		// contient que des données issues de Discord (pseudo, avatar) — rien de saisi par
		// un humain — et n'a par construction aucune ligne dépendante, puisque personne ne
		// s'y est jamais authentifié. On le libère donc avant de créer le profil réel.
		if (discordId) {
			// La suppression passe par une fonction SQL et non par un `.delete()`
			// filtré sur `claimed_at`, car ce prédicat seul ne distingue pas un profil
			// pré-créé d'un profil RÉEL mal initialisé : la fonction exige en plus que
			// l'identifiant soit l'uuid v5 dérivé du `discord_id` et que le profil ne
			// porte aucun contenu saisi par un humain.
			const { data: liberes, error: liberation } = await db.rpc(
				"rg_liberer_profil_discord",
				{ p_discord_id: discordId }
			);
			if (liberation) {
				console.error(
					`[@rosegriffon/auth] libération du profil pré-créé ${discordId} impossible:`,
					liberation.message
				);
			} else if (liberes) {
				console.info(`[@rosegriffon/auth] profil pré-créé ${discordId} adopté`);
			}
		}

		// Generate a clean username
		const username =
			user.name
				?.toLowerCase()
				.replace(/[^a-z0-9_]/g, "_")
				.slice(0, 30) ||
			user.email?.split("@")[0]?.slice(0, 30) ||
			`user-${user.id.slice(0, 8)}`;

		// Le pseudo doit être LIBRE avant l'insertion.
		//
		// `onConflict: "id"` ne couvre pas `profiles_username_key` : une collision de
		// pseudo lève un 23505 que le `catch` transforme en `return null`, et les deux
		// appelants ignorent cette valeur — la personne est authentifiée mais n'a aucun
		// profil. Le risque est devenu concret avec la pré-création : 1870 pseudos
		// Discord sont désormais réservés, et Better Auth dérive justement `user.name`
		// du handle Discord. Une inscription Google, Steam ou e-mail par un membre du
		// serveur tombait donc pile dessus.
		const usernameLibre = await trouverPseudoLibre(db, username, user.id);

		const { data: newProfile, error } = await db
			.from("profiles")
			.upsert(
				{
					id: user.id,
					username: usernameLibre,
					full_name: user.name || "",
					avatar_url: user.image || null,
					role: options.defaultRole || "member",
					discord_id: discordId,
					patreon_id: patreonId,
					// Profil réel, par opposition à un profil pré-créé depuis Discord :
					// il est visible publiquement dès maintenant.
					claimed_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
				},
				{ onConflict: "id" }
			)
			.select()
			.single();

		if (error) {
			// Échec bruyant et qualifié : les deux appelants ignorent la valeur de
			// retour, donc un `return null` silencieux laissait une personne
			// authentifiée sans profil, sans que rien ne le signale.
			console.error(
				`[@rosegriffon/auth] création du profil impossible pour ${user.id} (pseudo « ${usernameLibre} », code ${error.code ?? "?"}):`,
				error.message
			);
			return null;
		}

		return newProfile;
	} catch (err) {
		console.error(`[@rosegriffon/auth] Exception in ensureUserProfile for ${user.id}:`, err);
		return null;
	}
}

/**
 * Provider Google partagé par les deux apps.
 *
 * Les apps redéfinissent entièrement `socialProviders` (l'objet remplace celui
 * du spread `...commonAuthOptions`), donc la seule façon de mutualiser un
 * provider est de l'étaler explicitement : `socialProviders: { ...googleProvider, discord: {…} }`.
 *
 * ⚠ Le client OAuth (projet `rgfr-8927d`) est commun aux deux origines : chacune
 * doit déclarer son URI de rappel COMPLET dans la console Google Cloud —
 * `https://rosegriffon.fr/api/auth/callback/google` et
 * `https://azalee.rosegriffon.fr/api/auth/callback/google`. Une origine nue ne
 * suffit pas, Google exige une correspondance exacte (`redirect_uri_mismatch`).
 */
export const googleProvider = {
	google: {
		clientId: process.env.GOOGLE_CLIENT_ID ?? "",
		clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
	},
} as const;

export { deuxFacteurs } from "./two-factor";

export {
	type AccountEmailMessage,
	type AccountEmailSender,
	type AccountOptionsInput,
	createAccountOptions,
} from "./account-options";

/**
 * Common field mappings for Better Auth tables.
 * Ensures consistent column names across all apps.
 */
export const commonAuthOptions = {
	user: {
		fields: {
			emailVerified: "email_verified",
			createdAt: "created_at",
			updatedAt: "updated_at",
			twoFactorEnabled: "two_factor_enabled",
			twoFactorSecret: "two_factor_secret",
			twoFactorBackupCodes: "two_factor_backup_codes",
		},
	},
	session: {
		expiresIn: 60 * 60 * 24 * 30, // 30 days
		updateAge: 60 * 60 * 24, // 1 day
		// cookieCache DÉSACTIVÉ : le cache stocke session+user signés dans un cookie.
		// Avec un user Discord (avatar/email) + le rewrite expiresAt(+10ans) admin du
		// hook session.create.before, le payload peut dépasser 4096 o (droppé par le
		// navigateur) ou échouer la validation à la relecture → get-session renvoie null
		// après le callback OAuth = session non persistée. Désactivé, get-session lit
		// toujours la DB via le session_token (robuste). cf. docs better-auth.
		cookieCache: {
			enabled: false,
		},
		fields: {
			userId: "user_id",
			expiresAt: "expires_at",
			ipAddress: "ip_address",
			userAgent: "user_agent",
			createdAt: "created_at",
			updatedAt: "updated_at",
		},
	},
	account: {
		fields: {
			userId: "user_id",
			accountId: "account_id",
			providerId: "provider_id",
			accessToken: "access_token",
			refreshToken: "refresh_token",
			accessTokenExpiresAt: "access_token_expires_at",
			refreshTokenExpiresAt: "refresh_token_expires_at",
			idToken: "id_token",
			createdAt: "created_at",
			updatedAt: "updated_at",
		},
	},
	verification: {
		fields: {
			expiresAt: "expires_at",
			createdAt: "created_at",
			updatedAt: "updated_at",
		},
	},
	advanced: {
		// Cookies Secure uniquement en prod : en dev local (http://localhost),
		// un cookie Secure n'est jamais renvoyé par le navigateur → login cassé.
		useSecureCookies: process.env.NODE_ENV === "production",
		// crossSubDomainCookies DÉSACTIVÉ : website (rosegriffon.fr) et azalee
		// (azalee.rosegriffon.fr) ont des instances Better Auth séparées (tables
		// users + secrets distincts) → aucune session partagée possible. Activé,
		// il forçait Domain=<host> sur les cookies et cassait la lecture de session
		// après le callback OAuth → boucle de redirection vers /login. Host-only = OK.
		crossSubDomainCookies: {
			enabled: false,
		},
		ipAddress: {
			ipAddressHeaders: ["x-forwarded-for", "x-real-ip"] as string[],
		},
		defaultCookieAttributes: {
			httpOnly: true,
			secure: process.env.NODE_ENV === "production",
			sameSite: "lax" as const,
		},
	},
	rateLimit: {
		enabled: true,
		window: 10,
		max: 100,
	},
} as const;
