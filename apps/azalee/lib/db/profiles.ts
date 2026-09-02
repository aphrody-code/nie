import { getPgPool } from "@/lib/db/pg";

// Lecture Postgres DIRECTE (bypass le Data API PostgREST de Supabase) — cf.
// lib/db/pg.ts. Utilisé par la page de profil public `/profil/[username]`
// (visitable par tout visiteur non-connecté). `profiles.username` porte une
// contrainte UNIQUE (cf. data/schema-snapshot) → LIMIT 1 reproduit fidèlement
// le `.single()` Supabase pour le cas nominal.

export interface ProfileMeta {
	bio: string | null;
}

// Projection explicite sur les colonnes publiques.
//
// Ces requêtes passent par `getPgPool()`, qui se connecte avec le rôle propriétaire
// `rg` : elles contournent donc À LA FOIS la RLS et les droits par colonne posés par la
// fermeture PII du 11/8/2026. Un `SELECT *` republiait ici, sur une page sans
// authentification, l'e-mail, le nom réel, l'adresse postale et l'identifiant Patreon.
// La restriction ne peut pas venir de la base sur ce chemin : elle doit être écrite ici.
//
// `claimed_at IS NOT NULL` exclut les profils pré-créés depuis Discord : ils existent
// pour être réclamés à la première connexion, pas pour publier 2043 pages au nom de
// personnes qui ne se sont jamais inscrites.
export interface ProfileRow {
	id: string;
	updated_at: string | null;
	username: string | null;
	avatar_url: string | null;
	role: string | null;
	website: string | null;
	discord_id: string | null;
	bio: string | null;
	banner_url: string | null;
	twitter_handle: string | null;
	badges: string[] | null;
	/**
	 * Date de réclamation du compte — ce que la page affiche comme « a rejoint ».
	 *
	 * `profiles` n'a PAS de colonne `created_at` (vérifié en base) : la page la
	 * lisait quand même et affichait donc « A rejoint en Date inconnue » à tout
	 * le monde, depuis toujours. `claimed_at` est la vraie date : celle où la
	 * personne a pris possession de son profil.
	 */
	claimed_at: string | null;
}

/** Les mêmes colonnes que `PUBLIC_PROFILE_COLUMNS` de `@rosegriffon/db`. */
const COLONNES_PUBLIQUES =
	"id, updated_at, claimed_at, username, avatar_url, role, website, discord_id, bio, banner_url, twitter_handle, badges";

/** Utilisé par `generateMetadata` — mêmes colonnes que l'ancien `.select("full_name, bio")`. */
export async function getProfileMetaByUsername(username: string): Promise<ProfileMeta | null> {
	try {
		const pool = getPgPool();
		const { rows } = await pool.query<ProfileMeta>(
			"SELECT bio FROM profiles WHERE username = $1 AND claimed_at IS NOT NULL LIMIT 1",
			[username]
		);
		return rows[0] ?? null;
	} catch (error) {
		console.error(`Error fetching profile meta for ${username}:`, error);
		return null;
	}
}

/** Utilisé par la page — mêmes colonnes que l'ancien `.select("*")`. */
export async function getProfileByUsername(username: string): Promise<ProfileRow | null> {
	try {
		const pool = getPgPool();
		const { rows } = await pool.query<ProfileRow>(
			`SELECT ${COLONNES_PUBLIQUES} FROM profiles WHERE username = $1 AND claimed_at IS NOT NULL LIMIT 1`,
			[username]
		);
		return rows[0] ?? null;
	} catch (error) {
		console.error(`Error fetching profile for ${username}:`, error);
		return null;
	}
}
