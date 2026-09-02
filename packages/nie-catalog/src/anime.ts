/**
 * Le gisement **anime** : les épisodes de la série, tels que le crawler IETV les a relevés.
 *
 * 397 épisodes sur 16 saisons et 7 chaînes au dernier relevé. La base est celle qu'alimente
 * `@aphrody/ietv` et que sert le bot Discord — on la lit ici en seule lecture, pour que le
 * catalogue du jeu et celui de la série se répondent sans passer par le bot.
 *
 * Chaque épisode porte son titre français, son titre japonais et son romaji : c'est ce triplet
 * qui permet de raccrocher un épisode à ce que le jeu nomme, lui, en japonais.
 */
import { Database } from "bun:sqlite";
import { sources } from "./sources.ts";

let base: Database | null | undefined;

/** La connexion au cache d'épisodes, ou `null` s'il n'a jamais été alimenté ici. */
export function baseAnime(): Database | null {
	if (base !== undefined) {
		return base;
	}
	const chemin = sources().anime.emplacement;
	if (!chemin) {
		base = null;
		return base;
	}
	try {
		base = new Database(chemin, { readonly: true, strict: true });
	} catch {
		base = null;
	}
	return base;
}

/** Ferme la connexion (tests). */
export function fermerAnime(): void {
	base?.close();
	base = undefined;
}

function requete<T>(sql: string, params: readonly unknown[] = []): T[] {
	const db = baseAnime();
	if (!db) {
		return [];
	}
	try {
		return db.query(sql).all(...(params as never[])) as T[];
	} catch {
		return [];
	}
}

/** Un épisode de la série. */
export interface Episode {
	season: number | null;
	episode: number | null;
	title: string | null;
	titleJp: string | null;
	romaji: string | null;
	videoId: string | null;
	url: string | null;
	thumbnail: string | null;
	publishDate: string | null;
	language: string | null;
	channel: string | null;
}

const CHAMPS =
	"e.season, e.episode, e.title, e.titleJp, e.romaji, e.videoId, e.url, e.thumbnail, e.publishDate, e.language, c.channel";

/** Un épisode précis. Plusieurs chaînes peuvent porter le même : la VF passe en premier. */
export function episode(numeroSaison: number, numero: number): Episode | null {
	return (
		requete<Episode>(
			`SELECT ${CHAMPS} FROM episodes e LEFT JOIN channels c ON c.id = e.channel_id
			 WHERE e.season = ? AND e.episode = ?
			 ORDER BY (e.language = 'vf') DESC, e.publishDate
			 LIMIT 1`,
			[numeroSaison, numero],
		)[0] ?? null
	);
}

/** Les épisodes d'une saison, dans l'ordre. Un seul par numéro — la VF d'abord. */
export function saison(numero: number): Episode[] {
	return requete<Episode>(
		`SELECT ${CHAMPS} FROM episodes e LEFT JOIN channels c ON c.id = e.channel_id
		 WHERE e.season = ?
		 GROUP BY e.episode
		 HAVING e.language = MIN(e.language)
		 ORDER BY e.episode`,
		[numero],
	);
}

/**
 * Cherche un épisode par son texte, dans les trois graphies.
 *
 * Le titre japonais et le romaji sont interrogés au même titre que le français : un nom de
 * technique cité par le jeu apparaît souvent dans le titre japonais de l'épisode qui la montre.
 */
export function chercherEpisodes(texte: string, limite = 20): Episode[] {
	const q = texte.trim();
	if (!q) {
		return [];
	}
	return requete<Episode>(
		`SELECT ${CHAMPS} FROM episodes e LEFT JOIN channels c ON c.id = e.channel_id
		 WHERE e.title LIKE ?1 OR e.titleJp LIKE ?1 OR e.romaji LIKE ?1 OR e.description LIKE ?1
		 ORDER BY e.season, e.episode
		 LIMIT ?2`,
		[`%${q}%`, limite],
	);
}

/** Ce que le gisement contient, pour dire d'un coup s'il est peuplé et jusqu'où. */
export interface EtatAnime {
	episodes: number;
	saisons: number;
	chaines: number;
}

/** Compte ce que la base porte. Tout à zéro = base absente ou jamais rafraîchie. */
export function etatAnime(): EtatAnime {
	const l = requete<EtatAnime>(
		`SELECT (SELECT count(*) FROM episodes) AS episodes,
		        (SELECT count(DISTINCT season) FROM episodes) AS saisons,
		        (SELECT count(*) FROM channels) AS chaines`,
	)[0];
	return l ?? { chaines: 0, episodes: 0, saisons: 0 };
}
