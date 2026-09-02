import "server-only";
import { cookies } from "next/headers";
import { exigerConfigVroid } from "./config";
import { rafraichirJeton } from "./oauth";
import type { JetonVroid } from "./types";

/**
 * Session VRoid Hub : le jeton d'accès vit **uniquement côté serveur**, dans un
 * cookie `httpOnly` chiffré en AES-256-GCM.
 *
 * Pourquoi chiffrer et pas seulement signer : un cookie `httpOnly` est
 * invisible au JavaScript de la page, mais reste lisible par quiconque met la
 * main sur le fichier de cookies du navigateur. Un `access_token` VRoid Hub en
 * clair y serait rejouable tel quel contre `hub.vroid.com`.
 *
 * La clé est dérivée par HKDF-SHA-256 de `VROID_SECRET` — la même valeur qui
 * n'existe déjà que côté serveur. Aucun secret n'est écrit dans le dépôt.
 */

/** Cookie de session : le jeton chiffré. */
const COOKIE_SESSION = "vroid_session";

/** Cookie transitoire du flux d'autorisation : `state` + `code_verifier`. */
const COOKIE_FLUX = "vroid_flux";

/** Durée de vie du cookie de flux — le temps d'un aller-retour d'autorisation. */
const DUREE_FLUX_S = 15 * 60;

/** Durée de vie du cookie de session (le `refresh_token` la prolonge). */
const DUREE_SESSION_S = 30 * 24 * 60 * 60;

/**
 * Marge avant expiration en deçà de laquelle on rafraîchit d'avance : évite de
 * partir avec un jeton qui expirera pendant le téléchargement d'un `.vrm`.
 */
const MARGE_RENOUVELLEMENT_MS = 60_000;

/** Ce que porte le cookie de session, une fois déchiffré. */
export interface SessionVroid {
	accessToken: string;
	refreshToken: string;
	/** Instant d'expiration du jeton d'accès, en millisecondes epoch. */
	expireLe: number;
}

/** Ce que porte le cookie de flux pendant l'aller-retour d'autorisation. */
export interface FluxAutorisation {
	state: string;
	codeVerifier: string;
	/** Chemin interne où renvoyer l'internaute après le retour (toujours relatif). */
	retourVers: string;
}

/** Dérive la clé AES-GCM du cookie à partir du secret de l'application. */
async function cleCookie(): Promise<CryptoKey> {
	const { secret } = exigerConfigVroid();
	const matiere = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), "HKDF", false, [
		"deriveKey",
	]);
	return crypto.subtle.deriveKey(
		{
			name: "HKDF",
			hash: "SHA-256",
			// Sel fixe : le secret fournit déjà l'entropie, l'info sépare les usages.
			salt: new TextEncoder().encode("azalee.vroid.cookie.v1"),
			info: new TextEncoder().encode("chiffrement du jeton VRoid Hub"),
		},
		matiere,
		{ name: "AES-GCM", length: 256 },
		false,
		["encrypt", "decrypt"]
	);
}

/** Chiffre une valeur JSON en `base64url(iv ‖ chiffré)`. */
async function chiffrer(valeur: unknown): Promise<string> {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const chiffre = await crypto.subtle.encrypt(
		{ name: "AES-GCM", iv },
		await cleCookie(),
		new TextEncoder().encode(JSON.stringify(valeur))
	);
	const paquet = new Uint8Array(iv.length + chiffre.byteLength);
	paquet.set(iv, 0);
	paquet.set(new Uint8Array(chiffre), iv.length);
	let binaire = "";
	for (const octet of paquet) binaire += String.fromCharCode(octet);
	return btoa(binaire).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Déchiffre une valeur produite par {@link chiffrer}. `null` si altérée. */
async function dechiffrer<T>(encode: string): Promise<T | null> {
	try {
		const binaire = atob(encode.replaceAll("-", "+").replaceAll("_", "/"));
		const paquet = Uint8Array.from(binaire, (c) => c.charCodeAt(0));
		if (paquet.length <= 12) return null;
		const clair = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv: paquet.subarray(0, 12) },
			await cleCookie(),
			paquet.subarray(12)
		);
		return JSON.parse(new TextDecoder().decode(clair)) as T;
	} catch {
		// Cookie forgé, tronqué, ou chiffré avec un ancien secret : on l'ignore.
		return null;
	}
}

/** Options communes des cookies posés par l'intégration. */
function optionsCookie(dureeS: number) {
	return {
		httpOnly: true,
		secure: process.env.NODE_ENV === "production",
		// `lax` et pas `strict` : le retour d'autorisation arrive depuis
		// hub.vroid.com, un cookie `strict` ne serait pas renvoyé.
		sameSite: "lax" as const,
		path: "/",
		maxAge: dureeS,
	};
}

/** Enregistre le flux d'autorisation en cours (avant la redirection). */
export async function poserFluxAutorisation(flux: FluxAutorisation): Promise<void> {
	const magasin = await cookies();
	magasin.set(COOKIE_FLUX, await chiffrer(flux), optionsCookie(DUREE_FLUX_S));
}

/** Relit et consomme le flux d'autorisation. `null` s'il a expiré. */
export async function consommerFluxAutorisation(): Promise<FluxAutorisation | null> {
	const magasin = await cookies();
	const brut = magasin.get(COOKIE_FLUX)?.value;
	magasin.delete(COOKIE_FLUX);
	if (!brut) return null;
	return dechiffrer<FluxAutorisation>(brut);
}

/** Enregistre un jeton fraîchement obtenu. */
export async function poserSession(jeton: JetonVroid): Promise<void> {
	const session: SessionVroid = {
		accessToken: jeton.access_token,
		refreshToken: jeton.refresh_token,
		expireLe: Date.now() + jeton.expires_in * 1000,
	};
	const magasin = await cookies();
	magasin.set(COOKIE_SESSION, await chiffrer(session), optionsCookie(DUREE_SESSION_S));
}

/** Efface la session (déconnexion). */
export async function effacerSession(): Promise<void> {
	const magasin = await cookies();
	magasin.delete(COOKIE_SESSION);
}

/** Relit la session brute, sans renouvellement. */
export async function lireSession(): Promise<SessionVroid | null> {
	const brut = (await cookies()).get(COOKIE_SESSION)?.value;
	if (!brut) return null;
	return dechiffrer<SessionVroid>(brut);
}

/**
 * Renvoie un jeton d'accès valide, en le renouvelant si besoin.
 *
 * @returns le jeton, ou `null` si l'internaute n'a pas lié son compte VRoid Hub
 *   (ou si l'autorisation a été retirée côté hub.vroid.com).
 */
export async function jetonValide(): Promise<string | null> {
	const session = await lireSession();
	if (!session) return null;

	if (session.expireLe - MARGE_RENOUVELLEMENT_MS > Date.now()) {
		return session.accessToken;
	}

	try {
		const renouvele = await rafraichirJeton(exigerConfigVroid(), session.refreshToken);
		await poserSession(renouvele);
		return renouvele.access_token;
	} catch {
		// Autorisation révoquée côté VRoid Hub : la session locale n'a plus de sens.
		await effacerSession();
		return null;
	}
}
