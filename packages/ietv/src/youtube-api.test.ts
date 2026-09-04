/**
 * Tests du module YouTube Data API — sans clé et sans réseau.
 *
 * Ce qui doit être juste ici, c'est le TRI : quelle vidéo est un épisode
 * d'Inazuma Eleven, et sous quel numéro de saison elle se range. Une erreur de
 * tri ne se voit pas en base — elle produit des épisodes d'apparence normale.
 */

import { describe, expect, test } from "bun:test";
import {
	chaineVo,
	cleYoutube,
	episodesVo,
	numeroOuterCode,
	numeroSerieOrigine,
	parserPlaylistItems,
	urlPlaylistItems,
	type EntreeApi,
} from "./youtube-api.ts";

describe("clé d'API", () => {
	test("YOUTUBE_API_KEY prime sur GOOGLE_API_KEY", () => {
		expect(cleYoutube({ YOUTUBE_API_KEY: "a", GOOGLE_API_KEY: "b" })).toBe("a");
		expect(cleYoutube({ GOOGLE_API_KEY: "b" })).toBe("b");
	});

	test("une variable vide vaut absente", () => {
		// Une chaîne vide construirait une URL `key=` que l'API rejette en 400,
		// diagnostic bien plus obscur que « aucune cle ».
		expect(cleYoutube({ GOOGLE_API_KEY: "   " })).toBeNull();
		expect(cleYoutube({})).toBeNull();
	});
});

describe("URL de l'API", () => {
	test("porte la playlist, la clé et la taille de page", () => {
		const url = urlPlaylistItems("UUlfhcLqicImW9Se7NKaFADQ", "SECRET");
		expect(url).toContain("playlistId=UUlfhcLqicImW9Se7NKaFADQ");
		expect(url).toContain("maxResults=50");
		expect(url).not.toContain("pageToken");
	});

	test("ajoute le jeton de page quand il y en a un", () => {
		expect(urlPlaylistItems("UU1", "K", "JETON")).toContain("pageToken=JETON");
	});
});

/** Un élément de réponse de l'API, réduit à ce que le parseur regarde. */
const item = (videoId: string, title: string) => ({
	snippet: { title, resourceId: { videoId }, publishedAt: "2026-01-01T00:00:00Z" },
});

/** Une entrée déjà analysée, pour les tests de tri. */
const entree = (videoId: string, titre: string): EntreeApi => ({
	videoId,
	titre,
	publie: null,
	vignette: null,
});

describe("parserPlaylistItems", () => {
	test("rend les entrées et le jeton suivant", () => {
		const page = parserPlaylistItems({
			items: [item("AAAAAAAAAAA", "un titre")],
			nextPageToken: "SUITE",
		});
		expect(page.items).toHaveLength(1);
		expect(page.items[0]?.videoId).toBe("AAAAAAAAAAA");
		expect(page.pageSuivante).toBe("SUITE");
	});

	test("écarte les vidéos privées ou supprimées", () => {
		// L'API garde la PLACE de ces vidéos mais pas leur contenu : les garder
		// créerait des sources pointant une vidéo qui n'existe plus.
		const page = parserPlaylistItems({
			items: [item("AAAAAAAAAAA", "Private video"), item("BBBBBBBBBBB", "Deleted video")],
		});
		expect(page.items).toEqual([]);
	});

	test("une réponse sans items ne lève pas", () => {
		expect(parserPlaylistItems(null).items).toEqual([]);
		expect(parserPlaylistItems({ error: { code: 403 } }).items).toEqual([]);
	});

	test("l'absence de jeton termine la pagination", () => {
		expect(parserPlaylistItems({ items: [] }).pageSuivante).toBeNull();
	});
});

describe("reconnaissance des épisodes", () => {
	test("la série d'origine exige son titre complet", () => {
		expect(numeroSerieOrigine("「イナズマイレブン」第67話 地上最強のチームへ！")).toBe(67);
	});

	test("『メガトン級ムサシ』n'est PAS Inazuma Eleven", () => {
		// LE piège du gisement : sur 1 228 vidéos, 191 titres portent « 第N話 »
		// mais 84 appartiennent à d'autres séries du même éditeur. Un filtre sur
		// le seul numéro les aurait toutes rangées parmi les épisodes VO.
		expect(numeroSerieOrigine("「メガトン級ムサシ シーズン2」第5話")).toBeNull();
		expect(numeroSerieOrigine("【日常漫画】『大丈夫倶楽部』第3話")).toBeNull();
	});

	test("une bande-annonce n'est pas un épisode", () => {
		expect(numeroSerieOrigine("【PV】『イナズマイレブン 英雄たちのヴィクトリーロード』")).toBeNull();
	});

	test("Outer Code est reconnu par son propre gabarit", () => {
		expect(numeroOuterCode("【イナズマイレブン アウターコード】第6話：ツンツン祭り")).toBe(6);
		expect(numeroOuterCode("「イナズマイレブン」第67話")).toBeNull();
	});
});

describe("episodesVo", () => {
	test("convertit la numérotation absolue en saison et épisode", () => {
		// 55 absolu = saison 2, épisode 29 (la saison 1 fait 26 épisodes).
		const [v] = episodesVo([entree("AAAAAAAAAAA", "「イナズマイレブン」第55話 円堂・新たなる挑戦！")]);
		expect(v?.season).toBe(2);
		expect(v?.episode).toBe(29);
		expect(v?.language).toBe("vo");
	});

	test("Outer Code garde SA numérotation, en saison 7", () => {
		// Sa numérotation est propre à l'arc : la passer par `situerAbsolu`
		// rangerait « épisode 1 » dans la saison 1 de la série d'origine.
		const [v] = episodesVo([entree("BBBBBBBBBBB", "【イナズマイレブン アウターコード】第1話：士郎とアツヤ")]);
		expect(v?.season).toBe(7);
		expect(v?.episode).toBe(1);
	});

	test("Outer Code 1 et l'épisode absolu 1 coexistent", () => {
		// Ils valent tous deux « 1 » : une clé de dédoublonnage sur le seul
		// numéro en aurait perdu un.
		const v = episodesVo([
			entree("AAAAAAAAAAA", "「イナズマイレブン」第1話"),
			entree("BBBBBBBBBBB", "【イナズマイレブン アウターコード】第1話"),
		]);
		expect(v).toHaveLength(2);
	});

	test("chaque source est marquée officielle et attribuée à l'éditeur", () => {
		const [v] = episodesVo([entree("AAAAAAAAAAA", "「イナズマイレブン」第100話")]);
		const source = v?.sources?.[0];
		expect(source?.officielle).toBe(true);
		expect(source?.langue).toBe("vo");
		expect(source?.origine).toBe("LEVEL5ch【公式】");
		// Jamais datée ici : l'API atteste l'existence, pas la lecture. C'est le
		// vérificateur qui pose `verifieeLe`.
		expect(source?.verifieeLe).toBeNull();
	});

	test("ce qui n'est pas un épisode est écarté", () => {
		expect(episodesVo([entree("AAAAAAAAAAA", "【TVCM】『イナズマイレブンGO2』")])).toEqual([]);
	});
});

describe("chaineVo", () => {
	test("groupe par saison et trie les épisodes", () => {
		const videos = episodesVo([
			{ videoId: "BBBBBBBBBBB", titre: "「イナズマイレブン」第30話", publie: null, vignette: null },
			{ videoId: "AAAAAAAAAAA", titre: "「イナズマイレブン」第27話", publie: null, vignette: null },
		]);
		const chaine = chaineVo(videos);
		expect(chaine.channel).toBe("LEVEL5ch");
		expect(chaine.seasons).toHaveLength(1);
		expect(chaine.seasons[0]?.season).toBe(2);
		expect(chaine.seasons[0]?.episodes.map((e) => e.episode)).toEqual([1, 4]);
		expect(chaine.totalEpisodes).toBe(2);
	});
});
