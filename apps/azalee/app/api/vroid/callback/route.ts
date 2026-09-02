/**
 * Retour d'autorisation VRoid Hub.
 *
 * ⚠ L'URI de redirection déclarée sur hub.vroid.com est la **racine du site**
 * (`https://azalee.rosegriffon.fr/`) : VRoid Hub renvoie donc l'internaute sur
 * `/?code=…&state=…`, pas ici. C'est `proxy.ts` qui reconnaît ce retour — à la
 * présence simultanée de `code`, de `state` et du cookie de flux — et le
 * réachemine vers cette route, seule habilitée à poser des cookies et à parler
 * au serveur d'autorisation.
 *
 * L'échange du `code` contre un jeton se fait ici, côté serveur, avec le secret
 * client et le `code_verifier` gardé en cookie chiffré : ni l'un ni l'autre
 * n'a jamais transité par le navigateur.
 *
 * Source : https://developer.vroid.com/en/api/oauth-api.html
 */
import { NextResponse } from "next/server";
import { lireConfigVroid } from "@/lib/vroid/config";
import { echangerCode } from "@/lib/vroid/oauth";
import { consommerFluxAutorisation, poserSession } from "@/lib/vroid/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Renvoie l'internaute sur une page interne, avec un message de résultat. */
function retour(base: URL, chemin: string, statut: string): Response {
	const destination = new URL(chemin, base);
	destination.searchParams.set("vroid", statut);
	return NextResponse.redirect(destination);
}

export async function GET(requete: Request): Promise<Response> {
	const url = new URL(requete.url);
	const code = url.searchParams.get("code");
	const state = url.searchParams.get("state");

	// Le flux est consommé quoi qu'il arrive : un `state` ne sert qu'une fois.
	const flux = await consommerFluxAutorisation();

	// L'internaute a refusé l'autorisation sur hub.vroid.com.
	const refus = url.searchParams.get("error");
	if (refus) return retour(url, flux?.retourVers ?? "/vroid", "refus");

	if (!code || !state || !flux) return retour(url, "/vroid", "flux-perdu");

	// Comparaison en temps constant pour ne rien apprendre par le temps de réponse.
	if (state.length !== flux.state.length || !timingSafeEgal(state, flux.state)) {
		return retour(url, flux.retourVers, "state-invalide");
	}

	const config = lireConfigVroid();
	if (!config) return retour(url, flux.retourVers, "non-configure");

	try {
		await poserSession(await echangerCode(config, code, flux.codeVerifier));
	} catch {
		return retour(url, flux.retourVers, "echange-refuse");
	}

	return retour(url, flux.retourVers, "connecte");
}

/** Compare deux chaînes de même longueur sans court-circuit. */
function timingSafeEgal(a: string, b: string): boolean {
	let difference = 0;
	for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return difference === 0;
}
