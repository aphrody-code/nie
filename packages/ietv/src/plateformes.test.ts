import { describe, expect, test } from "bun:test";

import {
	ARCS_SERIE_ORIGINE,
	arcDeTitre,
	cleSource,
	fusionnerSources,
	idDailymotionDeUrl,
	idYoutubeDeUrl,
	numeroEpisodeDeTitre,
	reconnaitre,
	saisonDeSlug,
	urlIntegration,
	type SourceEpisode,
} from "./plateformes.ts";
import { situerAbsolu } from "./index.ts";

/** Une source minimale, pour n'écrire dans chaque test que ce qu'il éprouve. */
function source(p: Partial<SourceEpisode> = {}): SourceEpisode {
	return {
		plateforme: "youtube",
		sourceId: "xbpo3u3P9dc",
		url: "https://www.youtube.com/watch?v=xbpo3u3P9dc",
		langue: "vf",
		qualite: null,
		officielle: true,
		confiance: "declaree",
		verifieeLe: null,
		origine: "test",
		vignette: null,
		titre: null,
		...p,
	};
}

describe("identifiants de plateforme", () => {
	test("reconnaît les formes d'URL YouTube réellement présentes en base", () => {
		// Les trois premières viennent du corpus (`url` et `thumbnail` des 212
		// épisodes YouTube) ; les deux autres sont les formes que produisent
		// respectivement l'intégration du site officiel et un partage.
		expect(idYoutubeDeUrl("https://www.youtube.com/watch?v=xbpo3u3P9dc")).toBe("xbpo3u3P9dc");
		expect(idYoutubeDeUrl("https://img.youtube.com/vi/xbpo3u3P9dc/hqdefault.jpg")).toBe(
			"xbpo3u3P9dc"
		);
		expect(idYoutubeDeUrl("https://i.ytimg.com/vi/xbpo3u3P9dc/hqdefault.jpg")).toBe("xbpo3u3P9dc");
		expect(idYoutubeDeUrl("https://www.youtube.com/embed/xbpo3u3P9dc")).toBe("xbpo3u3P9dc");
		expect(idYoutubeDeUrl("https://youtu.be/xbpo3u3P9dc")).toBe("xbpo3u3P9dc");
	});

	test("ne prend pas un jeton local pour un identifiant YouTube", () => {
		// `off-galaxy-1` est ce que la base porte pour 143 épisodes : le confondre
		// avec un identifiant YouTube produisait une URL de lecture morte.
		expect(idYoutubeDeUrl("off-galaxy-1")).toBeNull();
		expect(reconnaitre("off-galaxy-1")).toBeNull();
	});

	test("lit l'identifiant Dailymotion des trois formes servies par le site", () => {
		expect(idDailymotionDeUrl("https://www.dailymotion.com/thumbnail/video/x7v8ls0")).toBe(
			"x7v8ls0"
		);
		expect(idDailymotionDeUrl("https://www.dailymotion.com/player/xm8tv.html?video=x7v8ls0")).toBe(
			"x7v8ls0"
		);
		expect(idDailymotionDeUrl("https://www.dailymotion.com/video/x9tuyb4")).toBe("x9tuyb4");
	});

	test("la page d'un épisode officiel n'est ni YouTube ni Dailymotion", () => {
		// Elle doit retomber sur `page` : « ça s'ouvre là, on ne sait pas
		// l'intégrer » est vrai, alors qu'un identifiant inventé aurait l'air
		// jouable.
		expect(reconnaitre("https://inazuma-eleven.fr/tv/watch/saison3/ep-12?lang=fr")).toBeNull();
	});

	test("l'intégration n'existe pas pour une source de type page", () => {
		expect(urlIntegration(source({ plateforme: "page", sourceId: "https://x" }))).toBeNull();
		expect(urlIntegration(source())).toContain("youtube-nocookie.com/embed/xbpo3u3P9dc");
		expect(urlIntegration(source({ plateforme: "dailymotion", sourceId: "x7v8ls0" }))).toContain(
			"dailymotion.com/embed/video/x7v8ls0"
		);
	});
});

describe("rangement d'un titre dans le catalogue", () => {
	test("le slug donne la saison, pas le rang de la catégorie", () => {
		// L'index anglais met les films en position 4 et le français en position
		// 10 : prendre le rang rangeait les films anglais dans « GO ».
		expect(saisonDeSlug("films")).toBe(10);
		expect(saisonDeSlug("go")).toBe(4);
		expect(saisonDeSlug("galaxy")).toBe(6);
		expect(saisonDeSlug("arc-inconnu")).toBeNull();
	});

	test("les arcs les plus spécifiques l'emportent sur « GO »", () => {
		// « GO GALAXY » et « GO CHRONO STONE » contiennent « GO » : un mauvais
		// ordre rangerait tout Galaxy en saison 4.
		expect(arcDeTitre("INAZUMA ELEVEN GO GALAXY - E43 - Le Dernier Tir (VOSTFR)")?.saison).toBe(6);
		expect(arcDeTitre("INAZUMA ELEVEN GO CHRONO STONE - E13 - …")?.saison).toBe(5);
		expect(arcDeTitre("INAZUMA ELEVEN GO - E1 - Un vent nouveau ! (VOSTFR)")?.saison).toBe(4);
	});

	test("un titre sans nom d'arc désigne la série d'origine, en numérotation absolue", () => {
		expect(arcDeTitre("INAZUMA ELEVEN VF - EP59 - Destination : Académie Alius")).toEqual({
			saison: null,
			absolu: true,
		});
		// Le titre japonais de LEVEL5ch : c'est la même série, et la seule source VO.
		expect(arcDeTitre("「イナズマイレブン」第67話 地上最強のチームへ！")).toEqual({
			saison: null,
			absolu: true,
		});
	});

	test("les quatre conventions de numérotation observées sont lues", () => {
		expect(numeroEpisodeDeTitre("「イナズマイレブン」第67話 …")).toBe(67);
		expect(numeroEpisodeDeTitre("INAZUMA ELEVEN VF - EP59 - Destination")).toBe(59);
		expect(numeroEpisodeDeTitre('Inazuma Eleven France - Épisode 127 "…"')).toBe(127);
		expect(numeroEpisodeDeTitre('Inazuma Eleven Go Galaxy - 25 - "Le Côté obscur"')).toBe(25);
	});

	test("un titre sans numéro n'est pas un épisode", () => {
		// Le flux d'une chaîne officielle mêle bandes-annonces et épisodes.
		expect(numeroEpisodeDeTitre("INAZUMA ELEVEN VICTORY ROAD - PV8 (VOSTFR)")).toBeNull();
		expect(numeroEpisodeDeTitre("LEVEL5 VISION 2026")).toBeNull();
	});

	test("RÉGRESSION : un numéro absolu ne doit pas atterrir en saison 1", () => {
		// Le repli `?? 1` avait fabriqué 23 épisodes inexistants — dont
		// « saison 1, épisode 59 », alors que la saison 1 en compte 26.
		expect(situerAbsolu(59, ARCS_SERIE_ORIGINE)).toEqual({ season: 2, episode: 33 });
		expect(situerAbsolu(67, ARCS_SERIE_ORIGINE)).toEqual({ season: 2, episode: 41 });
		expect(situerAbsolu(100, ARCS_SERIE_ORIGINE)).toEqual({ season: 3, episode: 33 });
		// Au-delà des 127 épisodes connus : non classé plutôt que classé au hasard.
		expect(situerAbsolu(500, ARCS_SERIE_ORIGINE)).toBeNull();
	});
});

describe("fusion des sources", () => {
	test("la même vidéo vue par deux sources ne compte qu'une fois", () => {
		// 211 des 355 épisodes sont référencés à la fois par le site officiel et
		// par une chaîne : sans dédoublonnage, le catalogue les compterait deux
		// fois.
		const fusion = fusionnerSources([source({ origine: "site" }), source({ origine: "chaîne" })]);
		expect(fusion).toHaveLength(1);
	});

	test("la source la mieux établie l'emporte, quel que soit l'ordre d'arrivée", () => {
		const lue = source({ confiance: "verifiee", origine: "page lue" });
		const annoncee = source({ confiance: "declaree", origine: "flux" });
		expect(fusionnerSources([annoncee, lue])[0]!.origine).toBe("page lue");
		expect(fusionnerSources([lue, annoncee])[0]!.origine).toBe("page lue");
	});

	test("deux langues de la même vidéo restent deux sources", () => {
		const fr = source({ langue: "vf" });
		const es = source({ langue: "es" });
		expect(cleSource(fr)).not.toBe(cleSource(es));
		expect(fusionnerSources([fr, es])).toHaveLength(2);
	});
});
