/**
 * Le routage de nie : l'entrée courante vit dans le CHEMIN, pas dans un paramètre.
 *
 * ## Pourquoi ce changement
 *
 * L'entrée vivait dans `?vue=textures`. Le serveur, lui, annonçait depuis le début quatre URL
 * distinctes — `/textures`, `/modeles`, `/sons`, `/videos` — avec pour chacune son `<title>`,
 * sa description, son canonique et son entrée au plan du site. Les deux ne se rencontraient
 * jamais : `https://nie.aphrody.com/textures` servait les métadonnées des textures et affichait
 * l'accueil. Quatre URL indexées, un seul contenu rendu, et aucun message d'erreur nulle part.
 *
 * Un paramètre de requête n'est de toute façon pas une page distincte pour un moteur, et il ne
 * se traduit pas : `/ja/textures` doit désigner la version japonaise du catalogue de textures.
 *
 * ## Une seule compatibilité `?vue=` subsiste à la frontière
 *
 * Les routes canoniques ne la lisent jamais. Seule l'ancienne page agrégée `/medias?vue=...`
 * est comprise par `Catalog`, puis immédiatement remplacée par `/textures`, `/modeles`, `/sons`
 * ou `/videos`. Cela préserve les liens déjà partagés sans laisser deux états concurrents vivre
 * après le premier rendu. Une URL inconnue mène à l'accueil, comme n'importe quelle autre.
 */

/**
 * Les préfixes de langue servis par `nie-site`. Le français est à la racine, sans préfixe.
 *
 * L'espagnol s'est ajouté le 2026-09-13 : le jeu en livre 91 familles et 70 555 lignes, autant
 * qu'en français (`GET /api/v1/text`). La liste doit rester celle du serveur — un préfixe connu
 * ici et pas là-bas donne une page que le client rend et que le serveur marque `noindex`.
 */
export const LANGUAGE_PREFIXES = ["/en", "/es", "/ja"] as const;

/** Une des langues que ce site sert sous forme d'URL. */
export type SiteLocale = "fr" | "en" | "es" | "ja";

/** La langue que sert un préfixe : `""` est le français. */
export function localeFromPrefix(prefix: string): SiteLocale {
	if (prefix === "/en") return "en";
	if (prefix === "/es") return "es";
	if (prefix === "/ja") return "ja";
	return "fr";
}

/** Le préfixe qui sert une langue — l'inverse de [`localeFromPrefix`]. */
export function prefixForLocale(locale: SiteLocale): string {
	return locale === "fr" ? "" : `/${locale}`;
}

/** Ce qu'un chemin dit de la langue et de la route. */
export interface SplitPath {
	/** `""` pour le français, `/en` ou `/ja` sinon. */
	prefix: string;
	/** La route sans son préfixe de langue, commençant toujours par `/`. */
	route: string;
}

/**
 * Sépare un chemin en préfixe de langue et route nue.
 *
 * La comparaison porte sur le SEGMENT entier : sans cela, `/enemy` serait lu comme de l'anglais
 * et sa route tronquée à `emy`.
 */
export function splitLanguagePrefix(path: string): SplitPath {
	for (const prefix of LANGUAGE_PREFIXES) {
		if (path === prefix) {
			return { prefix, route: "/" };
		}
		if (path.startsWith(`${prefix}/`)) {
			return { prefix, route: path.slice(prefix.length) };
		}
	}
	return { prefix: "", route: path === "" ? "/" : path };
}

/**
 * The game startup is not a catalogue entry: it lives at the root.
 *
 * Le jeton existe pour que l'état de l'application ait toujours une valeur, y compris sur `/`.
 * Sans lui, l'accueil serait `null`, et chaque lecture devrait décider ce que `null` veut dire
 * — ce qui finit toujours par diverger d'un endroit à l'autre.
 */
export const HOME = "home";

/**
 * Canonical path of an entry in the current language. The game renders at `/` (or `/ja`).
 */
export function pathForEntry(prefix: string, entry: string): string {
	if (entry === HOME) return prefix || "/";
	return `${prefix}/${entry}`;
}

/**
 * L'entrée demandée par l'URL courante, ou `null` si l'URL n'en désigne aucune.
 *
 * Deux sources, dans cet ordre : le chemin (la forme canonique), puis l'attribut `data-route`
 * posé par le serveur — qui a déjà fait la séparation, et fait autorité si le chemin a été
 * réécrit par un proxy.
 */
export function requestedEntry(
	entries: readonly string[],
	location: { pathname: string },
	serverRoute?: string | null
): string | null {
	const candidates = [
		splitLanguagePrefix(location.pathname).route.replace(/^\//, "").replace(/\/$/, ""),
		(serverRoute ?? "").replace(/^\//, "").replace(/\/$/, ""),
	];
	for (const candidate of candidates) {
		if (candidate && entries.includes(candidate)) {
			return candidate;
		}
	}
	return null;
}
