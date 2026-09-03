/**
 * YouTube Data API v3 — l'énumération COMPLÈTE d'une playlist, avec clé.
 *
 * ```bash
 * bun packages/ietv/src/youtube-api.ts --mesurer          # ne touche pas la base
 * bun packages/ietv/src/youtube-api.ts --ecrire
 * ```
 *
 * ── CE QUE CE MODULE DÉBLOQUE, ET CE QUI BLOQUAIT ──────────────────────────
 * La VO du catalogue plafonnait à **13 épisodes sur 355**, et ce plafond était
 * mesuré, pas supposé : le flux Atom d'une chaîne ne rend que ses quinze
 * dernières mises en ligne (`youtube-feed.ts`), l'onglet `/videos` ne rend plus
 * sa grille, et une page de playlist publique s'arrête à ~21 entrées **sans
 * aucun jeton de continuation** (`playlist-youtube.ts`). Les épisodes VO de
 * `LEVEL5ch【公式】` existaient donc bel et bien, mais plus loin que ce que
 * n'importe quelle lecture sans clé pouvait atteindre.
 *
 * `playlistItems.list` pagine sans plafond. Mesuré le 2026-09-03 sur la
 * playlist des mises en ligne `UUlfhcLqicImW9Se7NKaFADQ` : **25 pages, 1 228
 * vidéos**, dont **101 épisodes de la série d'origine**. La VO passe de 13 à
 * 101 — c'est le déblocage, et il tient entièrement à la clé.
 *
 * ── LE PIÈGE QUI AURAIT FABRIQUÉ 90 ÉPISODES INEXISTANTS ───────────────────
 * `第N話` (« épisode N ») n'est pas propre à Inazuma Eleven : c'est la
 * numérotation japonaise ordinaire. Sur ces 1 228 vidéos, **191** titres
 * portent `第N話`, dont seulement **101** sont Inazuma Eleven. Les 90 autres
 * sont『メガトン級ムサシ』(Megaton Musashi), une TOUTE AUTRE série du même
 * éditeur, elle aussi numérotée de 1 à N. Filtrer sur `第N話` seul aurait rangé
 * 90 épisodes de Megaton Musashi parmi les épisodes d'Inazuma Eleven, avec des
 * numéros parfaitement plausibles et aucune erreur visible.
 *
 * C'est exactement la famille de bug que `ARCS` documente déjà dans
 * `plateformes.ts`. Le filtre porte donc sur le TITRE DE SÉRIE complet,
 * `「イナズマイレブン」第N話`, jamais sur le seul numéro.
 *
 * ── LA CLÉ NE VIT PAS DANS LE CODE ─────────────────────────────────────────
 * Elle est lue dans l'environnement (`YOUTUBE_API_KEY`, sinon `GOOGLE_API_KEY`)
 * et n'est jamais journalisée : les messages n'affichent que sa LONGUEUR, ce
 * qui suffit à diagnostiquer « absente » ou « tronquée » sans la divulguer.
 */

import { IETVCache } from "./cache.ts";
import { situerAbsolu, type ChannelInfo, type VideoRef } from "./index.ts";
import { ARCS_SERIE_ORIGINE, type SourceEpisode } from "./plateformes.ts";

/** Une entrée de playlist telle que l'API la rend. */
export interface EntreeApi {
	videoId: string;
	titre: string;
	/** Date de mise en ligne ISO 8601. */
	publie: string | null;
	vignette: string | null;
}

/** Une page de `playlistItems.list`. */
export interface PageApi {
	items: EntreeApi[];
	pageSuivante: string | null;
}

/**
 * Clé d'API lue dans l'environnement.
 *
 * `YOUTUBE_API_KEY` d'abord : une clé dédiée est préférable à la clé Google
 * généraliste, parce qu'on peut la restreindre à la seule API YouTube. À
 * défaut, `GOOGLE_API_KEY` — c'est elle qui répond aujourd'hui.
 */
export function cleYoutube(env: Record<string, string | undefined> = process.env): string | null {
	const cle = env.YOUTUBE_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim();
	return cle && cle.length > 0 ? cle : null;
}

/** URL d'une page de `playlistItems.list`. */
export function urlPlaylistItems(playlistId: string, cle: string, pageToken?: string): string {
	const p = new URLSearchParams({
		part: "snippet",
		maxResults: "50",
		playlistId,
		key: cle,
	});
	if (pageToken) p.set("pageToken", pageToken);
	return `https://www.googleapis.com/youtube/v3/playlistItems?${p}`;
}

/**
 * Analyse une réponse de l'API — pur, donc testable sans clé ni réseau.
 *
 * Une entrée sans identifiant ou sans titre est ignorée : l'API rend des
 * éléments « privés » ou « supprimés » dont le `snippet` est vide, et les
 * laisser passer créerait des sources sans vidéo.
 */
export function parserPlaylistItems(charge: unknown): PageApi {
	const objet = charge as Record<string, any> | null;
	const brut = objet?.items;
	if (!Array.isArray(brut)) return { items: [], pageSuivante: null };

	const items: EntreeApi[] = [];
	for (const element of brut) {
		const s = element?.snippet;
		const videoId = s?.resourceId?.videoId;
		const titre = s?.title;
		if (typeof videoId !== "string" || typeof titre !== "string" || titre.length === 0) continue;
		// « Private video » / « Deleted video » : l'API garde la place mais pas
		// le contenu. Les compter gonflerait le catalogue de coquilles vides.
		if (titre === "Private video" || titre === "Deleted video") continue;
		items.push({
			videoId,
			titre,
			publie: typeof s.publishedAt === "string" ? s.publishedAt : null,
			vignette: s.thumbnails?.high?.url ?? s.thumbnails?.default?.url ?? null,
		});
	}
	return {
		items,
		pageSuivante: typeof objet?.nextPageToken === "string" ? objet.nextPageToken : null,
	};
}

/**
 * Numéro ABSOLU d'un épisode de la série d'origine, `null` sinon.
 *
 * Le titre de série est exigé — cf. l'en-tête du module et les 90 épisodes de
 * Megaton Musashi qu'un filtre sur `第N話` seul aurait avalés.
 */
export function numeroSerieOrigine(titre: string): number | null {
	const trouve = /「イナズマイレブン」\s*第\s*(\d{1,3})\s*話/.exec(titre);
	if (!trouve?.[1]) return null;
	const n = Number.parseInt(trouve[1], 10);
	return n > 0 && n < 1000 ? n : null;
}

/** Playlist des mises en ligne de `LEVEL5ch【公式】`. */
export const UPLOADS_LEVEL5CH = "UUlfhcLqicImW9Se7NKaFADQ";

/**
 * Énumère une playlist entière.
 *
 * `pagesMax` est une ceinture, pas une limite fonctionnelle : sans elle, un
 * `nextPageToken` qui se répéterait ferait tourner la boucle indéfiniment en
 * consommant le quota.
 */
export async function listerPlaylistComplete(
	playlistId: string,
	cle: string,
	pagesMax = 60
): Promise<EntreeApi[]> {
	const tout: EntreeApi[] = [];
	let jeton: string | undefined;
	/* eslint-disable no-await-in-loop */
	for (let page = 0; page < pagesMax; page++) {
		const reponse = await fetch(urlPlaylistItems(playlistId, cle, jeton));
		if (!reponse.ok) break;
		const lot = parserPlaylistItems(await reponse.json());
		tout.push(...lot.items);
		if (!lot.pageSuivante) break;
		jeton = lot.pageSuivante;
	}
	/* eslint-enable no-await-in-loop */
	return tout;
}

/**
 * Transforme les entrées d'API en épisodes VO situés dans leur saison.
 *
 * La numérotation de `LEVEL5ch` est ABSOLUE (1 à 127) là où le catalogue range
 * par arc : `situerAbsolu` fait la conversion sur les tailles réelles (26, 41,
 * 60). Une vidéo qui n'est pas un épisode de la série d'origine est écartée.
 */
export function episodesVo(entrees: readonly EntreeApi[]): VideoRef[] {
	const videos: VideoRef[] = [];
	const vus = new Set<number>();

	for (const entree of entrees) {
		const absolu = numeroSerieOrigine(entree.titre);
		if (absolu === null || vus.has(absolu)) continue;
		const situe = situerAbsolu(absolu, ARCS_SERIE_ORIGINE);
		if (!situe) continue;
		vus.add(absolu);

		const source: SourceEpisode = {
			plateforme: "youtube",
			sourceId: entree.videoId,
			url: `https://www.youtube.com/watch?v=${entree.videoId}`,
			langue: "vo",
			qualite: null,
			officielle: true,
			// L'API de l'éditeur a rendu cet identifiant pour ce titre : la source
			// est LUE, pas déduite. Son `etat` reste à mesurer par le vérificateur.
			confiance: "verifiee",
			verifieeLe: null,
			origine: "LEVEL5ch【公式】",
			vignette: entree.vignette,
			titre: entree.titre,
		};

		videos.push({
			title: entree.titre,
			videoId: entree.videoId,
			url: source.url,
			description: null,
			thumbnail: entree.vignette,
			publishDate: entree.publie,
			season: situe.season,
			episode: situe.episode,
			language: "vo",
			duration: null,
			viewCount: null,
			titleJp: entree.titre,
			sources: [source],
		} as VideoRef);
	}
	return videos;
}

/** Range des épisodes en `ChannelInfo`, la forme que `saveChannel` attend. */
export function chaineVo(videos: readonly VideoRef[]): ChannelInfo {
	const parSaison = new Map<number, VideoRef[]>();
	for (const v of videos) {
		if (v.season === null) continue;
		const lot = parSaison.get(v.season) ?? [];
		lot.push(v);
		parSaison.set(v.season, lot);
	}
	return {
		channel: "LEVEL5ch",
		title: "LEVEL5ch【公式】",
		description: null,
		avatar: null,
		seasons: [...parSaison.entries()]
			.toSorted((a, b) => a[0] - b[0])
			.map(([season, episodes]) => ({
				season,
				name: `Season ${season}`,
				episodes: episodes.toSorted((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
				totalEpisodes: episodes.length,
			})),
		totalEpisodes: videos.length,
	};
}

// ── Programme ───────────────────────────────────────────────────────────────

if (import.meta.main) {
	const argv = process.argv.slice(2);
	const ecrire = argv.includes("--ecrire");
	const db = argv.includes("--db") ? (argv[argv.indexOf("--db") + 1] ?? "") : "data/anime/episodes.db";

	const cle = cleYoutube();
	if (!cle) {
		console.error(
			"Aucune cle d'API. Poser YOUTUBE_API_KEY ou GOOGLE_API_KEY dans l'environnement."
		);
		process.exit(1);
	}
	console.log(`cle presente (${cle.length} caracteres) — la valeur n'est jamais journalisee`);

	const entrees = await listerPlaylistComplete(UPLOADS_LEVEL5CH, cle);
	console.log(`playlist ${UPLOADS_LEVEL5CH} : ${entrees.length} videos enumerees`);

	const avecNumero = entrees.filter((e) => /第\s*\d{1,3}\s*話/.test(e.titre)).length;
	const videos = episodesVo(entrees);
	console.log(`  titres portant « 第N話 »        : ${avecNumero}`);
	console.log(`  dont serie d'origine Inazuma   : ${videos.length}`);
	console.log(`  ecartes (autre serie du meme editeur) : ${avecNumero - videos.length}`);

	const parSaison = new Map<number, number>();
	for (const v of videos) parSaison.set(v.season ?? 0, (parSaison.get(v.season ?? 0) ?? 0) + 1);
	for (const [s, n] of [...parSaison].toSorted((a, b) => a[0] - b[0])) {
		console.log(`  saison ${s} : ${n} episodes`);
	}

	if (ecrire) {
		const cache = new IETVCache(db);
		cache.saveChannel(chaineVo(videos));
		const vo = cache.couvertureRegardable().find((l) => l.langue === "vo");
		console.log(`\necrit. VO regardable : ${vo?.episodes ?? 0} / 355`);
		cache.close();
	} else {
		console.log("\n(--ecrire absent : rien n'a ete ecrit en base)");
	}
}
