/**
 * Constantes de l'API VRoid Hub, sans aucun accès à l'environnement.
 *
 * Ce module est volontairement **neutre** (ni `server-only`, ni `process.env`) :
 * il est importable par les helpers purs testés sous `bun test`, alors que
 * `./config` — qui lit le secret — ne l'est pas.
 */

/** Racine de l'API et du serveur d'autorisation VRoid Hub. */
export const BASE_VROID = "https://hub.vroid.com";

/**
 * Version d'API exigée dans l'en-tête `X-Api-Version`.
 *
 * Sans cet en-tête l'API répond `400` (mesuré le 2026-09-02 :
 * `curl https://hub.vroid.com/api/staff_picks?count=1` → HTTP 400 ;
 * la même requête avec `X-Api-Version: 11` → HTTP 200).
 * Source : https://developer.vroid.com/en/api/oauth-api.html
 */
export const VERSION_API_VROID = "11";

/**
 * Hôte du CDN d'images de VRoid Hub — seul hôte relayé par
 * `/api/vroid/image`, qui refuse tout autre domaine.
 */
export const HOTE_IMAGES_VROID = "vroid-hub.pximg.net";

/** Configuration OAuth résolue de l'application VRoid Hub. */
export interface ConfigVroid {
	/** Application ID (le « ClientID » d'OAuth 2.0). Public par nature. */
	applicationId: string;
	/** Secret client — ne doit jamais quitter le serveur. */
	secret: string;
	/** URI de redirection déclarée sur hub.vroid.com. */
	redirectUri: string;
	/** Scopes demandés, séparés par des espaces. */
	scope: string;
}
