import "server-only";
import type { ConfigVroid } from "./constantes";

/**
 * Configuration de l'application VRoid Hub — **lue exclusivement dans
 * `process.env`, jamais écrite en dur**.
 *
 * Variables attendues (posées dans `.env.local`, hors dépôt ; leurs noms sont
 * documentés dans `.env.example`) :
 *
 * | Variable                | Rôle                                          |
 * |-------------------------|-----------------------------------------------|
 * | `VROID_APPLICATION_ID`  | Application ID (le « ClientID » d'OAuth 2.0)  |
 * | `VROID_SECRET`          | Secret client — jamais exposé au navigateur   |
 * | `VROID_REDIRECT_URI`    | URI de redirection déclarée sur hub.vroid.com |
 * | `VROID_SCOPE`           | Scopes demandés (par défaut `heart default`)  |
 *
 * L'`application_id` pourrait être public, mais il n'est volontairement pas
 * exposé en `NEXT_PUBLIC_*` : rien côté navigateur n'en a besoin, toutes les
 * requêtes VRoid Hub passent par les routes serveur de `app/api/vroid/`.
 *
 * `import "server-only"` en tête : une remontée accidentelle de ce module dans
 * un bundle client casse le build au lieu de fuiter le secret.
 */

/**
 * Lit la configuration OAuth dans l'environnement.
 *
 * @returns la configuration, ou `null` si l'application n'est pas configurée
 *   sur cette instance — l'intégration se dégrade alors proprement (galerie
 *   publique en lecture seule) au lieu de planter.
 */
export function lireConfigVroid(): ConfigVroid | null {
	const applicationId = process.env.VROID_APPLICATION_ID?.trim();
	const secret = process.env.VROID_SECRET?.trim();

	// Une variable posée mais vide n'est pas une configuration.
	if (!applicationId || !secret) return null;

	return {
		applicationId,
		secret,
		redirectUri: process.env.VROID_REDIRECT_URI?.trim() || "https://azalee.rosegriffon.fr/",
		scope: process.env.VROID_SCOPE?.trim() || "heart default",
	};
}

/**
 * Même lecture, mais exige la configuration.
 *
 * @throws {Error} si `VROID_APPLICATION_ID` ou `VROID_SECRET` manque.
 */
export function exigerConfigVroid(): ConfigVroid {
	const config = lireConfigVroid();
	if (!config) {
		throw new Error(
			"VRoid Hub n'est pas configuré : posez VROID_APPLICATION_ID et VROID_SECRET dans l'environnement."
		);
	}
	return config;
}
