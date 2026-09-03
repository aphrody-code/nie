import { describe, expect, test } from "bun:test";

import {
	clePlayer,
	langueDeTitre,
	numeroDeTitre,
	parserPage,
	urlLecteurOfficiel,
	urlPublique,
	urlVideosCompte,
} from "./dailymotion.ts";

describe("API de données publique", () => {
	test("l'URL demande les champs utiles et respecte le plafond de 100", () => {
		const url = urlVideosCompte("inaztvfr", 2, 500);
		expect(url).toContain("api.dailymotion.com/user/inaztvfr/videos");
		expect(url).toContain("limit=100"); // 500 est ramené au plafond de l'API
		expect(url).toContain("page=2");
		expect(url).toContain("fields=id%2Ctitle%2Cduration%2Ccreated_time%2Cthumbnail_url");
	});

	test("analyse une réponse telle que l'API la rend", () => {
		// Charge réellement observée le 2026-09-03 sur `/user/inaztvfr/videos`.
		const page = parserPage({
			total: 46,
			has_more: true,
			list: [
				{
					id: "x9tuyb4",
					title: "INAZUMA ELEVEN GO GALAXY - E43 - Le Dernier Tir (VOSTFR)",
					duration: 1356,
					created_time: 1763245561,
					thumbnail_url: "https://s1.dmcdn.net/v/ZRGem1f6ZfjlVUH4X",
				},
			],
		});
		expect(page.total).toBe(46);
		expect(page.hasMore).toBe(true);
		expect(page.list).toHaveLength(1);
		expect(page.list[0]!.duration).toBe(1356);
	});

	test("une réponse d'erreur rend une page vide, pas une exception", () => {
		// L'API répond ainsi sur les 143 vidéos restreintes au lecteur officiel.
		const page = parserPage({
			error: { code: 404, message: "This video does not exist or has been deleted." },
		});
		expect(page.list).toEqual([]);
		expect(page.hasMore).toBe(false);
	});

	test("une entrée sans identifiant ni titre est ignorée, pas fatale", () => {
		const page = parserPage({ list: [{ id: "x1" }, { title: "sans id" }, { id: "x2", title: "ok" }] });
		expect(page.list.map((v) => v.id)).toEqual(["x2"]);
	});
});

describe("lecteur restreint", () => {
	test("la clé du lecteur officiel se lit dans la page", () => {
		const html = '<iframe src="https://www.dailymotion.com/player/xm8tv.html?video=x7v8ls0">';
		expect(clePlayer(html)).toBe("xm8tv");
	});

	test("une page sans Dailymotion n'invente pas de clé", () => {
		expect(clePlayer('<iframe src="https://www.youtube.com/embed/xbpo3u3P9dc">')).toBeNull();
	});

	test("les deux URL ne se confondent pas", () => {
		// L'URL publique est MORTE pour une vidéo restreinte : seule celle du
		// lecteur officiel la joue.
		expect(urlLecteurOfficiel("xm8tv", "x7v8ls0")).toBe(
			"https://www.dailymotion.com/player/xm8tv.html?video=x7v8ls0"
		);
		expect(urlPublique("x9tuyb4")).toBe("https://www.dailymotion.com/video/x9tuyb4");
	});
});

describe("langue et numéro d'un titre", () => {
	test("la langue vient du titre, que le champ `language` de l'API ne distingue pas", () => {
		// L'API rend `language: "fr"` pour les deux : s'y fier étiquetait 42
		// épisodes sous-titrés comme du doublage.
		expect(langueDeTitre("INAZUMA ELEVEN GO GALAXY - E43 - Le Dernier Tir (VOSTFR)")).toBe("vostfr");
		expect(langueDeTitre("INAZUMA ELEVEN - E113 - La conspiration de Zoolan Rice (VF)")).toBe("vf");
		expect(langueDeTitre("INAZUMA ELEVEN - un titre sans marqueur")).toBe("unknown");
	});

	test("le numéro exige le tiret qui le suit", () => {
		expect(numeroDeTitre("INAZUMA ELEVEN - E80 - Le dernier match (VOSTFR)")).toBe(80);
		expect(numeroDeTitre("INAZUMA ELEVEN GO - E1 - Un vent nouveau ! (VOSTFR)")).toBe(1);
		// Sans le tiret, le « E » d'ELEVEN suivi d'un chiffre ne doit pas passer
		// pour un numéro d'épisode.
		expect(numeroDeTitre("INAZUMA ELEVEN 11 saison complète")).toBeNull();
	});
});
