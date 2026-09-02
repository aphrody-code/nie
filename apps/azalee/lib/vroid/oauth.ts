/**
 * Flux OAuth 2.0 de VRoid Hub : « authorization code » **avec PKCE (S256)**.
 *
 * VRoid Hub rend `state`, `code_challenge` et `code_challenge_method`
 * obligatoires sur `/oauth/authorize`, et `code_verifier` obligatoire sur
 * `/oauth/token` — ce ne sont pas des options.
 * Source : https://developer.vroid.com/en/api/oauth-api.html
 *
 * Mesuré le 2026-09-02 : le grant `client_credentials` n'existe pas
 * (`POST /oauth/token grant_type=client_credentials` → HTTP 400
 * `unsupported_grant_type`). Sans un utilisateur qui autorise l'application,
 * aucun jeton n'est délivrable.
 *
 * Module **neutre** : il ne lit pas `process.env`, la configuration lui est
 * passée en paramètre. Les fonctions de dérivation PKCE sont donc testables
 * directement sous `bun test`.
 */
import { BASE_VROID, VERSION_API_VROID, type ConfigVroid } from "./constantes";
import type { JetonVroid } from "./types";

/** Longueur du `code_verifier` généré (RFC 7636 impose 43 à 128 caractères). */
const LONGUEUR_VERIFIER = 64;

/** Alphabet `unreserved` autorisé pour le `code_verifier` (RFC 7636 §4.1). */
const ALPHABET_VERIFIER = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** Encode un buffer en base64url **sans remplissage** (RFC 7636 §4.2). */
export function base64url(octets: ArrayBuffer | Uint8Array): string {
	const vue = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
	let binaire = "";
	for (const octet of vue) binaire += String.fromCharCode(octet);
	return btoa(binaire).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Tire un `code_verifier` conforme à la RFC 7636.
 *
 * @param longueur nombre de caractères (43 à 128).
 * @returns une chaîne aléatoire de l'alphabet `unreserved`.
 */
export function genererCodeVerifier(longueur = LONGUEUR_VERIFIER): string {
	if (longueur < 43 || longueur > 128) {
		throw new RangeError("code_verifier : la RFC 7636 impose 43 à 128 caractères.");
	}
	const octets = crypto.getRandomValues(new Uint8Array(longueur));
	// Modulo sur 64 valeurs, taille exacte de l'alphabet : pas de biais.
	return Array.from(octets, (o) => ALPHABET_VERIFIER[o % ALPHABET_VERIFIER.length]).join("");
}

/**
 * Dérive le `code_challenge` d'un `code_verifier` par SHA-256 + base64url.
 *
 * @param verifier le `code_verifier` conservé côté serveur.
 * @returns le `code_challenge` à envoyer à `/oauth/authorize`.
 */
export async function genererCodeChallenge(verifier: string): Promise<string> {
	const empreinte = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return base64url(empreinte);
}

/** Tire une valeur `state` anti-CSRF. */
export function genererState(): string {
	return base64url(crypto.getRandomValues(new Uint8Array(24)));
}

/**
 * Construit l'URL d'autorisation vers laquelle rediriger l'internaute.
 *
 * @param config identifiants et URI de redirection de l'application.
 * @param state valeur anti-CSRF à retrouver au retour.
 * @param codeChallenge dérivé du `code_verifier` gardé côté serveur.
 * @returns l'URL absolue `https://hub.vroid.com/oauth/authorize?…`.
 */
export function urlAutorisation(config: ConfigVroid, state: string, codeChallenge: string): string {
	const url = new URL("/oauth/authorize", BASE_VROID);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("client_id", config.applicationId);
	url.searchParams.set("redirect_uri", config.redirectUri);
	url.searchParams.set("scope", config.scope);
	url.searchParams.set("state", state);
	url.searchParams.set("code_challenge", codeChallenge);
	url.searchParams.set("code_challenge_method", "S256");
	return url.toString();
}

/** Échec d'un appel au serveur d'autorisation, avec le corps renvoyé. */
export class ErreurOauthVroid extends Error {
	constructor(
		message: string,
		readonly statut: number,
		readonly corps: string
	) {
		super(message);
		this.name = "ErreurOauthVroid";
	}
}

/** Envoie un formulaire à `/oauth/*` et décode la réponse. */
async function posterFormulaire(chemin: string, champs: Record<string, string>): Promise<Response> {
	return fetch(new URL(chemin, BASE_VROID), {
		method: "POST",
		headers: {
			"X-Api-Version": VERSION_API_VROID,
			"Content-Type": "application/x-www-form-urlencoded",
			Accept: "application/json",
		},
		body: new URLSearchParams(champs),
		cache: "no-store",
	});
}

/**
 * Échange le `code` reçu au retour d'autorisation contre un jeton d'accès.
 *
 * @param config identifiants de l'application (le secret ne quitte pas le serveur).
 * @param code le paramètre `code` reçu sur l'URI de redirection.
 * @param codeVerifier le `code_verifier` conservé côté serveur pour ce flux.
 * @throws {ErreurOauthVroid} si VRoid Hub refuse l'échange.
 */
export async function echangerCode(
	config: ConfigVroid,
	code: string,
	codeVerifier: string
): Promise<JetonVroid> {
	const reponse = await posterFormulaire("/oauth/token", {
		client_id: config.applicationId,
		client_secret: config.secret,
		redirect_uri: config.redirectUri,
		grant_type: "authorization_code",
		code,
		code_verifier: codeVerifier,
	});

	if (!reponse.ok) {
		throw new ErreurOauthVroid(
			"Échange du code d'autorisation refusé par VRoid Hub.",
			reponse.status,
			await reponse.text()
		);
	}
	return (await reponse.json()) as JetonVroid;
}

/**
 * Renouvelle un jeton expiré à partir de son `refresh_token`.
 *
 * @throws {ErreurOauthVroid} si le rafraîchissement est refusé (jeton révoqué,
 *   autorisation retirée par l'internaute…).
 */
export async function rafraichirJeton(
	config: ConfigVroid,
	refreshToken: string
): Promise<JetonVroid> {
	const reponse = await posterFormulaire("/oauth/token", {
		client_id: config.applicationId,
		client_secret: config.secret,
		redirect_uri: config.redirectUri,
		grant_type: "refresh_token",
		refresh_token: refreshToken,
	});

	if (!reponse.ok) {
		throw new ErreurOauthVroid(
			"Renouvellement du jeton refusé par VRoid Hub.",
			reponse.status,
			await reponse.text()
		);
	}
	return (await reponse.json()) as JetonVroid;
}

/**
 * Révoque un jeton d'accès (`POST /oauth/revoke`).
 *
 * La doc exige à la fois le paramètre `token` et l'en-tête
 * `Authorization: Bearer ${access_token}`.
 *
 * @returns `true` si VRoid Hub a accepté la révocation.
 */
export async function revoquerJeton(config: ConfigVroid, accessToken: string): Promise<boolean> {
	const reponse = await fetch(new URL("/oauth/revoke", BASE_VROID), {
		method: "POST",
		headers: {
			"X-Api-Version": VERSION_API_VROID,
			"Content-Type": "application/x-www-form-urlencoded",
			Authorization: `Bearer ${accessToken}`,
		},
		body: new URLSearchParams({
			client_id: config.applicationId,
			client_secret: config.secret,
			token: accessToken,
		}),
		cache: "no-store",
	});
	return reponse.ok;
}
