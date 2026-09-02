/**
 * Départ du flux d'autorisation VRoid Hub.
 *
 * Tire un `state` et un `code_verifier` (PKCE S256), les met à l'abri dans un
 * cookie `httpOnly` chiffré, puis redirige vers `hub.vroid.com/oauth/authorize`.
 * Le secret client ne quitte jamais le serveur : il n'intervient qu'à l'étape
 * suivante, dans `/api/vroid/callback`.
 *
 * Source du flux : https://developer.vroid.com/en/api/oauth-api.html
 */
import { NextResponse } from "next/server";
import { lireConfigVroid } from "@/lib/vroid/config";
import { genererCodeChallenge, genererCodeVerifier, genererState, urlAutorisation } from "@/lib/vroid/oauth";
import { poserFluxAutorisation } from "@/lib/vroid/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Ne garde qu'un chemin interne : un `retour` absolu serait une redirection ouverte. */
function retourSur(brut: string | null): string {
	if (!brut || !brut.startsWith("/") || brut.startsWith("//")) return "/vroid";
	return brut;
}

export async function GET(requete: Request): Promise<Response> {
	const config = lireConfigVroid();
	if (!config) {
		return NextResponse.json(
			{ erreur: "VRoid Hub n'est pas configuré sur cette instance." },
			{ status: 503 }
		);
	}

	const url = new URL(requete.url);
	const codeVerifier = genererCodeVerifier();
	const state = genererState();

	await poserFluxAutorisation({
		state,
		codeVerifier,
		retourVers: retourSur(url.searchParams.get("retour")),
	});

	return NextResponse.redirect(urlAutorisation(config, state, await genererCodeChallenge(codeVerifier)));
}
