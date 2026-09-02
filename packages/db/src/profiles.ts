// Colonnes de `public.profiles` lisibles par le rôle `anon`.
//
// Les colonnes personnelles — e-mail, nom complet, adresse postale, identifiant
// Patreon — lui ont été fermées le 11/8/2026 (elles étaient lisibles par
// n'importe qui sur l'internet, la clé `anon` étant publique par conception ;
// cf. apps/website/sql/migrations/20260811_profiles_pii.sql).
//
// Conséquence pratique : demander `select("*")` ou l'une de ces colonnes avec un
// client navigateur ou serveur non privilégié fait échouer la requête ENTIÈRE
// avec un `42501 permission denied for table profiles`. Passer par
// `@rosegriffon/db/service` (service-role) quand la donnée personnelle est
// réellement nécessaire, après avoir vérifié la session.

import type { Database } from "./types.gen";

/** Liste de colonnes prête à passer à `.select()`. */
export const PUBLIC_PROFILE_COLUMNS =
	"id, updated_at, username, avatar_url, role, website, discord_id, bio, banner_url, banner_position, poste, twitter_handle, badges";

/** Profil tel qu'un client non privilégié peut le lire. */
export type PublicProfile = Pick<
	Database["public"]["Tables"]["profiles"]["Row"],
	| "id"
	| "updated_at"
	| "username"
	| "avatar_url"
	| "role"
	| "website"
	| "discord_id"
	| "bio"
	| "banner_url"
	| "banner_position"
	| "poste"
	| "twitter_handle"
	| "badges"
>;
