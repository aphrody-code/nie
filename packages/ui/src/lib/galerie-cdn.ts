/**
 * Galerie d'illustrations du jeu — le contrat, sans React.
 *
 * ── POURQUOI UN MODULE PUR, COMME `adsense.ts` ─────────────────────────────
 * Ces constantes sont lues côté SERVEUR (la route qui relaie l'API) autant que
 * côté client (la popup de sélection). Les poser dans le composant `"use
 * client"` transformerait chaque export en référence client, et un handler de
 * route qui y lirait une chaîne se prendrait « Cannot access … on the server ».
 * C'est exactement le piège déjà documenté pour AdSense ; on ne le repose pas.
 *
 * ── LES IMAGES VIENNENT DU JEU, PAS D'UN GÉNÉRATEUR ────────────────────────
 * Les bannières proposées jusqu'ici étaient deux images générées par IA posées
 * dans `public/images/banners/`. Elles ne montraient pas le jeu : un griffon
 * dans un cadre dans un cadre, un stade au texte illisible. Le CDN sert les
 * VRAIES illustrations d'Inazuma Eleven: Victory Road, décodées en direct
 * depuis les archives du jeu — il n'y a aucune raison d'afficher autre chose.
 */

/** Une illustration de la galerie, telle que l'API la rend. */
export interface IllustrationGalerie {
	/** Identifiant stable (hash du jeu ou chemin de menu). */
	id: string;
	/** Titre lisible, déjà mis en forme par l'API. */
	titre: string;
	/** Catégorie brute (`story`, `chronicle`, `special`…). */
	categorie: string;
	/** Vignette légère (≈ 400 px de large, webp) — pour la grille. */
	vignette: string;
	/** Version large (≈ 1600 px, webp) — c'est ce qu'on enregistre. */
	pleine: string;
}

/** Une page de résultats. */
export interface PageGalerie {
	illustrations: IllustrationGalerie[];
	total: number;
	page: number;
	parPage: number;
}

/**
 * Catégories offertes dans la popup.
 *
 * ⚠ L'API sert DEUX sources qu'aucune requête ne réunit : la table
 * `inagle_gallery` (360 illustrations d'histoire, de chronique et spéciales) et
 * le manifeste des images de menu extraites des archives (3 579 visuels).
 * **Sans catégorie, on n'obtient que les 360** — le chip « Toutes » du wiki
 * annonce 3 939 et la ligne dessous en affiche 360, c'est le même piège. On
 * nomme donc les deux mines séparément plutôt que de promettre un « tout » qui
 * n'existe pas.
 *
 * Sous-ensemble volontaire de `GALLERY_CATEGORIES` : ni cartes de route, ni
 * écrans d'aide, ni télops de technique — ce sont des éléments d'interface, pas
 * des illustrations, et ils feraient une bannière illisible.
 */
export const CATEGORIES_GALERIE = [
	{ valeur: "", libelle: "Illustrations" },
	{ valeur: "story", libelle: "Histoire" },
	{ valeur: "chronicle", libelle: "Chroniques" },
	{ valeur: "special", libelle: "Spéciales" },
	{ valeur: "menu", libelle: "Images du jeu" },
	{ valeur: "gallery_img2", libelle: "Galerie" },
	{ valeur: "ev_pic", libelle: "Événements" },
	{ valeur: "stadium", libelle: "Stades" },
] as const;

/** Route que les apps exposent pour relayer la galerie (même origine, zéro CORS). */
export const ROUTE_GALERIE = "/api/galerie";

/** Illustrations par page dans la popup. Douze : trois lignes de quatre. */
export const GALERIE_PAR_PAGE = 12;

/** Construit l'URL de la page demandée. */
export function urlPageGalerie(
	base: string,
	options: { page?: number; parPage?: number; categorie?: string; recherche?: string } = {}
): string {
	const parametres = new URLSearchParams();
	parametres.set("page", String(Math.max(1, options.page ?? 1)));
	parametres.set("limite", String(options.parPage ?? GALERIE_PAR_PAGE));
	if (options.categorie) {
		parametres.set("categorie", options.categorie);
	}
	if (options.recherche && options.recherche.trim().length > 0) {
		parametres.set("q", options.recherche.trim());
	}
	return `${base}?${parametres.toString()}`;
}

/**
 * Normalise une réponse de l'API headless du wiki.
 *
 * L'API rend des clés anglaises (`thumb`, `full`, `title`) parce qu'elle sert
 * aussi le wiki ; le reste du monorepo parle français. La traduction se fait
 * ici, une fois, plutôt que dans chaque composant — et une entrée sans image
 * exploitable est écartée au lieu d'afficher un cadre vide.
 */
export function lireReponseGalerie(charge: unknown): PageGalerie {
	const objet = (charge ?? {}) as Record<string, unknown>;
	const brutes = Array.isArray(objet.data) ? objet.data : [];
	const illustrations: IllustrationGalerie[] = [];
	for (const entree of brutes) {
		const ligne = (entree ?? {}) as Record<string, unknown>;
		const pleine = typeof ligne.full === "string" ? ligne.full : null;
		const vignette = typeof ligne.thumb === "string" ? ligne.thumb : pleine;
		const id = typeof ligne.id === "string" ? ligne.id : null;
		if (!pleine || !vignette || !id) {
			continue;
		}
		illustrations.push({
			categorie: typeof ligne.category === "string" ? ligne.category : "",
			id,
			pleine,
			titre: typeof ligne.title === "string" && ligne.title ? ligne.title : id,
			vignette,
		});
	}
	return {
		illustrations,
		page: nombre(objet.page, 1),
		parPage: nombre(objet.limit, GALERIE_PAR_PAGE),
		total: nombre(objet.total, illustrations.length),
	};
}

function nombre(valeur: unknown, defaut: number): number {
	const n = typeof valeur === "number" ? valeur : Number.parseInt(String(valeur ?? ""), 10);
	return Number.isFinite(n) && n > 0 ? n : defaut;
}

/**
 * Normalise une bannière enregistrée pour l'affichage.
 *
 * Les illustrations du jeu sont livrées en letterbox : deux bandes noires
 * horizontales que le CDN sait retirer avec `crop=bandes`. Les bannières
 * choisies AVANT que ce paramètre n'existe ne le portent pas — elles
 * s'afficheraient donc avec leurs bandes, en travers d'une carte de profil.
 * Plutôt que de réécrire la base à chaque évolution du CDN, on l'ajoute au
 * moment du rendu : une URL déjà recadrée est renvoyée telle quelle, une URL
 * étrangère au CDN n'est pas touchée.
 */
export function urlBanniereAffichable(url: string | null | undefined): string | null {
	if (!url) {
		return null;
	}
	if (!/\/(dx11|g4tx)\//.test(url) || url.includes("crop=bandes")) {
		return url;
	}
	return `${url}${url.includes("?") ? "&" : "?"}crop=bandes`;
}
