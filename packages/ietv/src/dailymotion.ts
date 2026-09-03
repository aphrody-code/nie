/**
 * Dailymotion — l'API DE DONNÉES publique, et le rangement de ses titres.
 *
 * ── POURQUOI UNE API ET PAS UN PARSEUR ─────────────────────────────────────
 * Dailymotion publie une API de données ouverte (`api.dailymotion.com`), sans
 * clé pour les objets publics : `GET /user/<compte>/videos?fields=…` rend du
 * JSON typé, paginé, avec le total. C'est une interface *destinée* à être lue —
 * rien à voir avec le grattage de HTML qu'imposent YouTube et le site officiel.
 * Il n'y a donc aucune bibliothèque à ajouter : `fetch` plus les champs voulus
 * suffisent, et le contrat est documenté par l'éditeur de la plateforme.
 *
 * ── DEUX GISEMENTS DAILYMOTION, QUI NE SE CONFONDENT PAS ───────────────────
 * Mesuré le 2026-09-03 :
 *
 *  1. **Les vidéos intégrées par la plateforme officielle** (les 143 épisodes
 *     hors YouTube). Elles sont RESTREINTES au lecteur du site : l'API répond
 *     `404 This video does not exist or has been deleted` sur `x7v8ls0` comme
 *     sur `x8c1xw5`, alors que le site les joue parfaitement. Elles ne se
 *     lisent que par le lecteur officiel — `dailymotion.com/player/xm8tv.html`.
 *     Leur fabriquer une URL `dailymotion.com/video/<id>` produirait un lien
 *     mort qui aurait l'air valide. C'est pourquoi {@link urlLecteurOfficiel}
 *     existe et que la clé de lecteur est conservée.
 *  2. **Le compte officiel `inaztvfr` (« Inazuma TV FR »)**, 46 vidéos
 *     publiques et interrogeables. Elles sont majoritairement **VOSTFR** — une
 *     langue dont le catalogue ne comptait ZÉRO épisode — et couvrent des arcs
 *     (Chrono Stones, Galaxy) que le site officiel ne sert qu'en doublage.
 *
 * Aucun contournement : on lit l'API publique pour le second gisement, et pour
 * le premier on utilise le lecteur que le site utilise lui-même.
 */

import type { LangueSource } from "./plateformes.ts";

/** Une vidéo telle que l'API de données la rend. */
export interface VideoDailymotion {
	id: string;
	title: string;
	/** Durée en secondes. */
	duration: number | null;
	/** Date de mise en ligne, en secondes epoch. */
	createdTime: number | null;
	thumbnailUrl: string | null;
}

/** Réponse paginée de l'API. */
export interface PageDailymotion {
	list: VideoDailymotion[];
	total: number | null;
	hasMore: boolean;
}

/** Champs demandés — les nommer évite de rapatrier une centaine de colonnes. */
const CHAMPS = "id,title,duration,created_time,thumbnail_url";

/** URL d'une page de vidéos d'un compte. Le maximum accepté est 100 par page. */
export function urlVideosCompte(compte: string, page = 1, parPage = 100): string {
	const p = new URLSearchParams({
		fields: CHAMPS,
		limit: String(Math.min(Math.max(parPage, 1), 100)),
		page: String(Math.max(page, 1)),
		sort: "recent",
	});
	return `https://api.dailymotion.com/user/${encodeURIComponent(compte)}/videos?${p}`;
}

/**
 * Analyse une réponse de l'API — module pur, testable sans réseau.
 *
 * Une réponse d'erreur (`{"error":{…}}`) rend une page vide plutôt qu'une
 * exception : un compte renommé ne doit pas faire tomber la moisson entière.
 */
export function parserPage(charge: unknown): PageDailymotion {
	const objet = charge as Record<string, unknown> | null;
	const liste = objet?.list;
	if (!Array.isArray(liste)) return { list: [], total: null, hasMore: false };

	const list: VideoDailymotion[] = [];
	for (const brut of liste) {
		const v = brut as Record<string, unknown>;
		if (typeof v.id !== "string" || typeof v.title !== "string") continue;
		list.push({
			id: v.id,
			title: v.title,
			duration: typeof v.duration === "number" ? v.duration : null,
			createdTime: typeof v.created_time === "number" ? v.created_time : null,
			thumbnailUrl: typeof v.thumbnail_url === "string" ? v.thumbnail_url : null,
		});
	}
	return {
		list,
		total: typeof objet?.total === "number" ? objet.total : null,
		hasMore: objet?.has_more === true,
	};
}

/**
 * Clé du lecteur Dailymotion utilisée par une page — `xm8tv` pour le site
 * officiel.
 *
 * Sans elle, les 143 épisodes restreints n'ont aucune URL de lecture valide :
 * c'est la clé qui autorise le lecteur à les servir. Rend `null` quand la page
 * n'intègre pas Dailymotion.
 */
export function clePlayer(html: string): string | null {
	const trouve = /dailymotion\.com\/player\/([A-Za-z0-9]+)\.html/.exec(html);
	return trouve ? trouve[1]! : null;
}

/** URL du lecteur officiel — la seule qui joue une vidéo restreinte. */
export function urlLecteurOfficiel(cle: string, videoId: string): string {
	return `https://www.dailymotion.com/player/${cle}.html?video=${videoId}`;
}

/** URL publique d'une vidéo — valable uniquement pour un gisement public. */
export function urlPublique(videoId: string): string {
	return `https://www.dailymotion.com/video/${videoId}`;
}

// ── Ranger un titre Dailymotion dans le catalogue ────────────────────────────

/**
 * Les titres du compte officiel suivent quatre gabarits, tous observés le
 * 2026-09-03 : `INAZUMA ELEVEN - E80 - … (VOSTFR)`, `INAZUMA ELEVEN GO - E1`,
 * `INAZUMA ELEVEN GO CHRONO STONE - E13`, `INAZUMA ELEVEN GO GALAXY - E43`.
 *
 * Le rangement par arc n'est PAS propre à Dailymotion — les flux Atom des
 * chaînes YouTube posent exactement le même problème, et l'avaient résolu de
 * travers en retombant sur « saison 1 ». La logique vit donc dans
 * `plateformes.ts` et se partage. Réexportée ici pour que ce module reste
 * lisible seul.
 */
export { arcDeTitre, type ArcSerie } from "./plateformes.ts";

/**
 * Numéro d'épisode d'un titre Dailymotion (`- E43 -`), `null` s'il n'y en a pas.
 *
 * Le tiret qui suit est exigé : sans lui, le `E` de « ELEVEN » suivi d'un
 * chiffre pourrait passer pour un numéro.
 */
export function numeroDeTitre(titre: string): number | null {
	const trouve = /\bE\s*(\d{1,3})\s*[-–—]/i.exec(titre);
	if (!trouve) return null;
	const n = Number.parseInt(trouve[1]!, 10);
	return n > 0 && n < 1000 ? n : null;
}

/**
 * Langue ANNONCÉE par le titre — le compte officiel la marque explicitement.
 *
 * 42 des 46 vidéos portent `(VOSTFR)` et 4 portent `(VF)`. Rend `unknown`
 * quand le titre ne dit rien : le champ `language` de l'API vaut `"fr"` pour
 * les deux, il ne distingue donc PAS un doublage d'un sous-titrage — s'y fier
 * aurait étiqueté 42 épisodes sous-titrés comme du doublage français.
 */
export function langueDeTitre(titre: string): LangueSource {
	if (/\(\s*VOSTFR\s*\)|VOSTFR/i.test(titre)) return "vostfr";
	if (/\(\s*VF\s*\)/i.test(titre)) return "vf";
	return "unknown";
}

/**
 * Comptes Dailymotion officiels connus.
 *
 * `inaztvfr` porte le même nom d'affichage (« Inazuma TV FR ») que la chaîne
 * YouTube déjà retenue comme officielle par ce dépôt, et sert des épisodes
 * complets — c'est le même diffuseur sur une autre plateforme.
 */
export const COMPTES_DAILYMOTION: readonly { compte: string; titre: string }[] = [
	{ compte: "inaztvfr", titre: "Inazuma TV FR (Dailymotion)" },
];
