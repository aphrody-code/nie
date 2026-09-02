/**
 * Contrat de données de la page « Mon compte », partagée par le site principal
 * (`/dashboard/account`) et le wiki Azalée (`/settings`).
 *
 * Les composants de ce dossier sont purement présentationnels : ils ne
 * connaissent ni `authClient`, ni Supabase, ni les server actions. Chaque app
 * fournit ses gestionnaires, ce qui permet d'avoir la même page des deux côtés
 * alors que les instances Better Auth, les tables et les fournisseurs OAuth
 * diffèrent.
 */

/** Fournisseurs pour lesquels un logo et un libellé sont connus. */
export type AccountProviderId = "discord" | "google" | "twitch" | "patreon";

/** Un compte externe déjà rattaché à l'utilisateur. */
export interface AccountLinkedAccount {
	provider: string;
	createdAt?: string | null;
	scope?: string | null;
}

/**
 * Une session Better Auth.
 *
 * `token` — et pas l'identifiant de la ligne — est la clé attendue par
 * `revokeSession` : l'endpoint fait `findSession(token)` et, s'il ne trouve
 * rien, ne révoque rien tout en répondant `{ status: true }`. Passer un `id`
 * produit donc une révocation qui se déclare réussie sans rien faire.
 */
export interface AccountSession {
	token: string;
	current: boolean;
	createdAt: string;
	expiresAt?: string | null;
	ipAddress?: string | null;
	userAgent?: string | null;
}

/** Champs d'identité publique éditables. */
export interface AccountProfileValues {
	username: string;
	full_name: string;
	bio: string;
	website: string;
	twitter_handle: string;
	banner_url: string;
	/** Cadrage vertical de la bannière, de 0 (haut de l'image) à 100 (bas). */
	banner_position: number;
	/** Poste affiché sur la carte (`GAR`, `DEF`, `MIL`, `ATT`), ou rien. */
	poste: string | null;
	badges: string[];
}

/** Adresse postale — sert aux expéditions boutique, jamais affichée publiquement. */
export interface AccountAddressValues {
	address_line1: string;
	address_line2: string;
	postal_code: string;
	city: string;
	country: string;
}

/** Résultat uniforme d'une action serveur : `{ error }` ou rien. */
export type AccountActionResult = { error?: string | null } | void;

/** Onglets de la page. `address` n'est monté que par les apps qui expédient. */
export type AccountTabId = "profile" | "address" | "connections" | "security";
