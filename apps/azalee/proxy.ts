import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { absoluteUrl } from "@/lib/site-url";

const PROTECTED_PATHS = ["/dashboard", "/settings"];
const API_PROTECTED_PATHS = ["/api/dashboard"];

/**
 * Reconnaît le retour d'autorisation VRoid Hub.
 *
 * L'URI de redirection déclarée sur hub.vroid.com est la **racine du site**
 * (`VROID_REDIRECT_URI=https://azalee.rosegriffon.fr/`) : le `code` atterrit
 * donc sur `/`, où aucune route ne l'attend. On ne détourne la racine que si
 * les trois marqueurs du flux sont réunis — `code`, `state`, et le cookie de
 * flux posé par `/api/vroid/login`. Une home visitée avec un `?code=` d'origine
 * quelconque n'est donc jamais capturée.
 */
function estRetourVroid(request: NextRequest): boolean {
	if (request.nextUrl.pathname !== "/") return false;
	const parametres = request.nextUrl.searchParams;
	if (!parametres.has("state")) return false;
	if (!parametres.has("code") && !parametres.has("error")) return false;
	return request.cookies.has("vroid_flux");
}

export async function proxy(request: NextRequest) {
	// Le mode maintenance est servi par nginx (location @maintenance sur
	// 502/503/504), pas par l'application : rien à vérifier ici.

	const { pathname } = request.nextUrl;

	if (estRetourVroid(request)) {
		const callback = new URL("/api/vroid/callback", request.nextUrl.origin);
		callback.search = request.nextUrl.search;
		return NextResponse.redirect(callback);
	}

	const isProtectedPage = PROTECTED_PATHS.some((p) => pathname.startsWith(p));
	const isProtectedApi = API_PROTECTED_PATHS.some((p) => pathname.startsWith(p));

	if (!isProtectedPage && !isProtectedApi) {
		return NextResponse.next();
	}

	// Quick guard: check cookie presence (full validation happens server-side in layouts/pages)
	const sessionCookie =
		request.cookies.get("better-auth.session_token") ||
		request.cookies.get("__Secure-better-auth.session_token");

	if (!sessionCookie) {
		if (isProtectedApi) {
			return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
		}

		const loginUrl = absoluteUrl("/login");
		loginUrl.searchParams.set("returnTo", pathname);
		return NextResponse.redirect(loginUrl);
	}

	return NextResponse.next();
}

export const config = {
	// `"/"` est là pour le seul retour d'autorisation VRoid Hub (cf.
	// `estRetourVroid`) : sans la racine dans le matcher, le proxy ne serait
	// jamais appelé sur la page où hub.vroid.com renvoie l'internaute.
	matcher: ["/", "/dashboard/:path*", "/settings/:path*", "/api/dashboard/:path*"],
};
