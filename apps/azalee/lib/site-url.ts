/**
 * Source de vérité UNIQUE pour l'origin public d'Azalée.
 *
 * Azalée tourne en self-host sur le VPS via `azalee-web.service` (Next 16
 * standalone, `HOSTNAME=0.0.0.0`, `PORT=3003`) DERRIÈRE nginx. Le host interne
 * vu par Next est donc `0.0.0.0:3003` / `127.0.0.1:3003`. Toute URL absolue
 * construite depuis `request.url` / `request.nextUrl.origin` / `url.origin`
 * hérite de ce host interne → un `NextResponse.redirect(new URL("/dashboard",
 * request.url))` renvoie l'utilisateur sur `https://0.0.0.0:3003/dashboard`
 * au lieu de `https://azalee.rosegriffon.fr/dashboard`.
 *
 * On centralise ici l'origin public déterministe : var d'env explicite avec
 * défaut prod codé en dur. Utiliser `getPublicOrigin()` / `absoluteUrl()`
 * PARTOUT où une URL absolue runtime est produite (redirects auth, callbacks,
 * emails, magic-link, etc.).
 */

const FALLBACK_ORIGIN = "https://azalee.rosegriffon.fr";

function normalizeOrigin(value: string | undefined | null): string | null {
	if (!value || value === "undefined" || value === "null") {
		return null;
	}
	const trimmed = value.trim();
	if (!trimmed.startsWith("http")) {
		return null;
	}
	try {
		// Conserve uniquement le scheme + host (+ port éventuel), pas le path.
		return new URL(trimmed).origin;
	} catch {
		return null;
	}
}

/**
 * Origin public canonique d'Azalée (ex. `https://azalee.rosegriffon.fr`).
 *
 * Priorité :
 *   1. `NEXT_PUBLIC_SITE_URL` (inliné au build + dispo runtime)
 *   2. `BETTER_AUTH_URL` (runtime, déjà la base Better Auth)
 *   3. défaut prod `https://azalee.rosegriffon.fr`
 *
 * Ne dérive JAMAIS du host de la requête (= `0.0.0.0:3003` en self-host).
 */
export function getPublicOrigin(): string {
	return (
		normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL) ??
		normalizeOrigin(process.env.BETTER_AUTH_URL) ??
		FALLBACK_ORIGIN
	);
}

/**
 * Construit une URL absolue sur l'origin public à partir d'un chemin relatif.
 * Le chemin peut déjà être absolu (auquel cas il est retourné tel quel s'il
 * pointe sur l'origin public, sinon réécrit sur l'origin public).
 */
export function absoluteUrl(path: string): URL {
	const origin = getPublicOrigin();
	// `new URL(path, origin)` : si `path` est déjà absolu il prime, sinon il est
	// résolu contre l'origin public. On force toujours l'origin public pour ne
	// jamais laisser fuiter `0.0.0.0:3003`.
	const resolved = new URL(path, origin);
	const base = new URL(origin);
	resolved.protocol = base.protocol;
	resolved.host = base.host;
	return resolved;
}
