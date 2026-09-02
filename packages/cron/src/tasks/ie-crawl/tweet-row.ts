/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Helpers PARTAGÉS de conversion d'un tweet X vers une ligne de `public.tweets`.
//
// Ce module n'existe que pour supprimer une duplication stricte : `mapMedia` et
// `snowflakeToIso` étaient recopiés à l'identique dans `harvest-search.ts` et
// `twitter.ts`, et la récolte de campagnes (`hashtag-harvest.ts`) en avait besoin
// à son tour. Trois copies d'une conversion de schéma, c'est trois occasions de
// diverger silencieusement sur la forme du jsonb `media`.
//
// AUCUNE I/O ici : ni base, ni réseau, ni disque. Uniquement de la transformation
// pure, ce qui rend le module trivialement testable et importable partout.
//
// ⚠ `twitter.ts` n'est VOLONTAIREMENT pas migré sur ce module : sa branche
// « thread » agrège `raw_tweets`, recalcule `tweet_count` et déduplique les médias
// par `url`. Ce code n'est pas superposable à `tweetToRow` (qui produit un tweet
// isolé, `is_thread: false`) et perdrait sa garde anti-régression.

import type { Tweet } from "@aphrody-code/x";
import type { Json } from "@rosegriffon/db";

/**
 * Média tel que stocké dans le jsonb `tweets.media`.
 * L'index-signature est SCALAIRE à dessein : `storage_path` / `storage_url` sont
 * des chaînes, jamais des sous-objets. Y imbriquer une structure casserait les
 * consommateurs existants (`process-tweets.ts`, `refetch-tweet-media.ts`).
 */
export type MediaItem = {
	id: string;
	type: string;
	url?: string;
	original_url?: string;
	video_url?: string;
	preview_url?: string;
	width?: number;
	height?: number;
	storage_path?: string;
	storage_url?: string;
	[key: string]: string | number | boolean | null | undefined;
};

/** Média brut tel que renvoyé par le parseur de `@aphrody-code/x`. */
export type MediaBrut = {
	id?: string;
	type?: string;
	url?: string;
	video_url?: string;
	preview_url?: string;
	width?: number;
	height?: number;
};

/**
 * Normalise un média brut de X vers la forme stockée en base.
 *
 * ⚠ `original_url` est écrasé par `m.url`. C'est correct sur un tweet FRAÎCHEMENT
 * reçu de X (l'URL est alors bien celle de pbs.twimg.com), mais destructeur sur un
 * média DÉJÀ ré-hébergé : on y perdrait l'URL d'origine, seule source permettant de
 * reconstruire le bucket. Ne jamais rappeler `mapMedia`/`tweetToRow` sur une ligne
 * relue de la base.
 */
export function mapMedia(m: MediaBrut): MediaItem {
	const out: MediaItem = {
		id: m.id ?? "",
		type: m.type ?? "",
		url: m.url,
		original_url: m.url,
	};
	if (m.video_url) out.video_url = m.video_url;
	if (m.preview_url) out.preview_url = m.preview_url;
	if (typeof m.width === "number") out.width = m.width;
	if (typeof m.height === "number") out.height = m.height;
	return out;
}

/**
 * Date de publication depuis l'ID Snowflake (epoch Twitter = 1288834974657 ms),
 * en repli quand `created_at` manque — ne JAMAIS retomber sur la date de crawl,
 * qui rendrait tout tri chronologique faux.
 */
export function snowflakeToIso(id: string): string {
	const ms = (BigInt(id) >> 22n) + 1288834974657n;
	return new Date(Number(ms)).toISOString();
}

/** Ligne de `public.tweets` telle qu'insérée par les récolteurs. */
export type DBTweetRow = {
	id: string;
	author_id: string;
	author_name: string;
	author_username: string;
	created_at: string;
	text: string;
	is_thread: boolean;
	tweet_count: number;
	metrics: Json | null;
	media: Json | null;
	quoted_tweets: Json | null;
	raw_tweets: Json | null;
	updated_at: string;
};

/**
 * Convertit un tweet X isolé en ligne de base.
 * `is_thread: false` et `raw_tweets: null` : ce module ne fabrique jamais de fil.
 */
export function tweetToRow(t: Tweet): DBTweetRow {
	const createdAtIso = t.created_at
		? new Date(t.created_at).toISOString()
		: snowflakeToIso(t.id);
	const media = ((t.media ?? []) as MediaBrut[]).map(mapMedia);
	return {
		id: t.id,
		// ⚠ PAS de repli sur `t.author.id` : le schéma `Author` de `@aphrody/x` ne
		// porte QUE `username` et `name`. Le repli qui figurait ici lisait un champ
		// inexistant — toujours `undefined`, donc toujours la chaîne vide au bout,
		// en donnant l'illusion d'un second chemin. Le pseudo n'est pas un
		// identifiant : le mettre là ferait diverger deux lignes du même compte
		// renommé.
		author_id: t.author_id || "",
		author_name: t.author?.name || t.author?.username || "",
		author_username: t.author?.username || "",
		created_at: createdAtIso,
		text: t.text || "",
		is_thread: false,
		tweet_count: 1,
		metrics: {
			reply_count: t.reply_count,
			retweet_count: t.retweet_count,
			like_count: t.like_count,
			quote_count: t.quote_count,
			view_count: t.view_count,
		},
		media,
		quoted_tweets: t.quoted_tweet ? JSON.parse(JSON.stringify(t.quoted_tweet)) : null,
		raw_tweets: null,
		updated_at: new Date().toISOString(),
	};
}

/** URL canonique publique d'un post X. */
export function urlTweet(username: string, id: string): string {
	return `https://x.com/${username}/status/${id}`;
}

/** Forme minimale commune à `MediaBrut` et `MediaItem`, seule lue par les prédicats. */
type MediaLisible = {
	type?: string;
	url?: string;
	preview_url?: string;
	original_url?: string;
	storage_url?: string;
};

/**
 * Le média est-il une IMAGE RÉELLEMENT AFFICHABLE ?
 *
 * Deux conditions, et pas une seule : le type `photo` (une vidéo ou un GIF animé
 * n'est pas une illustration au sens d'une campagne de créations, et
 * `video.twimg.com` n'est pas servi par l'optimiseur d'images du site) ET au moins
 * une URL exploitable.
 *
 * ⚠ La seconde condition n'est PAS cosmétique : `extraireImages()` côté site
 * (`apps/website/src/lib/x-campagnes/types.ts`) écarte les entrées sans aucune URL.
 * Se contenter de `type === "photo"` ici ferait retenir des posts que la galerie
 * afficherait en pictogramme de repli, et surtout gonflerait `nb_images` et le
 * compteur public « publications avec image » avec des images inexistantes.
 */
export function estImageAffichable(media: MediaLisible | null | undefined): boolean {
	if (!media || media.type !== "photo") return false;
	return [media.storage_url, media.url, media.preview_url, media.original_url].some(
		(u) => typeof u === "string" && u.trim().length > 0
	);
}

/** Le post porte-t-il au moins une image affichable ? */
export function porteUneImage(t: Tweet): boolean {
	const media = (t.media ?? []) as MediaBrut[];
	return media.some((m) => estImageAffichable(m));
}

/** Nombre d'images d'un tableau de médias (pour l'aperçu « +N » sans relire le jsonb). */
export function compterImages(media: MediaItem[] | MediaBrut[] | null | undefined): number {
	if (!Array.isArray(media)) return 0;
	return (media as MediaLisible[]).filter((m) => estImageAffichable(m)).length;
}
