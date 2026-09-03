/**
 * Tests du vérificateur — la partie qui décide, sans réseau.
 *
 * Les sondes sont volontairement coupées en deux (bâtir l'URL / lire la
 * réponse) précisément pour que ces cas-là s'écrivent sans serveur : ce qui
 * doit être juste ici, c'est la RÈGLE, et une règle testée contre un vrai
 * serveur ne teste que la disponibilité du serveur.
 */

import { describe, expect, test } from "bun:test";
import {
	classerApiDailymotion,
	classerOembed,
	classerPage,
	estLecteurOfficiel,
	grouperCibles,
	lireOptions,
	urlApiDailymotion,
	urlOembed,
	verdictDeForme,
} from "./verifier.ts";

describe("URL des sondes", () => {
	test("l'oEmbed encode l'URL de la vidéo, il ne la colle pas", () => {
		// Coller l'URL sans l'encoder produit un `?url=https://…?v=…` dont le
		// second `?` est ignoré : la sonde interrogerait une autre vidéo.
		expect(urlOembed("xbpo3u3P9dc")).toBe(
			"https://www.youtube.com/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dxbpo3u3P9dc&format=json"
		);
	});

	test("l'API Dailymotion demande les champs qui servent au verdict", () => {
		const url = urlApiDailymotion("x8reu53");
		expect(url).toContain("api.dailymotion.com/video/x8reu53");
		for (const champ of ["private", "allow_embed", "status"]) expect(url).toContain(champ);
	});
});

describe("verdict YouTube", () => {
	test("200 est vivante", () => {
		expect(classerOembed(200).etat).toBe("vivante");
	});

	test("401, 403 et 404 sont des morts", () => {
		for (const code of [401, 403, 404]) expect(classerOembed(code).etat).toBe("morte");
	});

	test("une panne de YouTube n'est PAS une mort", () => {
		// Un 500 inscrit comme `morte` effacerait des sources valides au premier
		// hoquet du serveur, et rien ne les rétablirait ensuite.
		for (const code of [0, 500, 502, 429]) expect(classerOembed(code).etat).toBe("non_testable");
	});
});

describe("verdict Dailymotion", () => {
	const publiee = { id: "x8reu53", private: false, allow_embed: true, status: "published" };

	test("une video publiee et integrable est vivante", () => {
		expect(classerApiDailymotion(200, publiee).etat).toBe("vivante");
	});

	test("404 est une mort", () => {
		expect(classerApiDailymotion(404, { error: { code: 404 } }).etat).toBe("morte");
	});

	test("privee ou non integrable est morte, meme en 200", () => {
		expect(classerApiDailymotion(200, { ...publiee, private: true }).etat).toBe("morte");
		expect(classerApiDailymotion(200, { ...publiee, allow_embed: false }).etat).toBe("morte");
	});

	test("un statut autre que publie est une mort, et la raison le nomme", () => {
		const v = classerApiDailymotion(200, { ...publiee, status: "processing" });
		expect(v.etat).toBe("morte");
		expect(v.raison).toBe("api_statut_processing");
	});

	test("une reponse 200 illisible ne conclut rien", () => {
		expect(classerApiDailymotion(200, null).etat).toBe("non_testable");
		expect(classerApiDailymotion(200, { rien: 1 }).etat).toBe("non_testable");
	});
});

describe("verdict d'une page", () => {
	test("2xx vivante, 404 et 410 mortes", () => {
		expect(classerPage(200).etat).toBe("vivante");
		expect(classerPage(204).etat).toBe("vivante");
		expect(classerPage(404).etat).toBe("morte");
		expect(classerPage(410).etat).toBe("morte");
	});

	test("403 ne conclut pas : une page peut filtrer sans avoir disparu", () => {
		expect(classerPage(403).etat).toBe("non_testable");
	});
});

describe("controle de forme", () => {
	test("un identifiant YouTube bien forme ne declenche rien", () => {
		expect(verdictDeForme("youtube", "xbpo3u3P9dc")).toBeNull();
	});

	test("un jeton local est refuse sans requete", () => {
		const v = verdictDeForme("youtube", "off-galaxy-1");
		expect(v?.etat).toBe("morte");
		expect(v?.codeHttp).toBeNull();
	});

	test("`off-films-4` fait ONZE caracteres et passe la forme", () => {
		// Le piège du contrôle de forme : ce jeton local a exactement la
		// longueur et l'alphabet d'un identifiant YouTube. Seule la sonde réseau
		// l'a démasqué (404 sur l'oEmbed). Le test fige ce constat pour qu'on ne
		// croie jamais que la regex suffit à valider une ligne.
		expect("off-films-4".length).toBe(11);
		expect(verdictDeForme("youtube", "off-films-4")).toBeNull();
	});

	test("un identifiant Dailymotion mal forme est refuse", () => {
		expect(verdictDeForme("dailymotion", "off-galaxy-1")?.etat).toBe("morte");
		expect(verdictDeForme("dailymotion", "x8reu53")).toBeNull();
	});
});

/** Une ligne de `episode_sources` réduite à ce que le groupement regarde. */
const ligne = (id: number, plateforme: any, sourceId: string, url: string) => ({
	id,
	plateforme,
	sourceId,
	url,
});

describe("groupement des cibles", () => {
	test("la meme video vue par deux sources ne fait qu'UN appel", () => {
		const cibles = grouperCibles([
			ligne(1, "youtube", "xbpo3u3P9dc", "https://www.youtube.com/watch?v=xbpo3u3P9dc"),
			ligne(2, "youtube", "xbpo3u3P9dc", "https://inazuma-eleven.fr/tv/watch/saison1/ep-1?lang=fr"),
		]);
		expect(cibles).toHaveLength(1);
		expect(cibles[0]?.ids).toEqual([1, 2]);
	});

	test("deux pages distinctes restent deux cibles", () => {
		const cibles = grouperCibles([
			ligne(1, "page", "a", "https://inazuma-eleven.fr/tv/watch/saison1/ep-1?lang=fr"),
			ligne(2, "page", "b", "https://inazuma-eleven.fr/tv/watch/saison1/ep-1?lang=es"),
		]);
		expect(cibles).toHaveLength(2);
	});

	test("le lecteur officiel est groupe par URL, pas par identifiant", () => {
		// C'est la clé du LECTEUR qui autorise la lecture : deux vidéos servies
		// par deux clés différentes ne sont pas la même cible.
		const cibles = grouperCibles([
			ligne(1, "dailymotion", "x7v8ls0", "https://www.dailymotion.com/player/xm8tv.html?video=x7v8ls0"),
			ligne(2, "dailymotion", "x7v8ls0", "https://www.dailymotion.com/player/autre.html?video=x7v8ls0"),
		]);
		expect(cibles).toHaveLength(2);
	});
});

describe("reconnaissance du lecteur officiel", () => {
	test("distingue le lecteur d'une page video ordinaire", () => {
		expect(estLecteurOfficiel("https://www.dailymotion.com/player/xm8tv.html?video=x7v8ls0")).toBe(
			true
		);
		expect(estLecteurOfficiel("https://www.dailymotion.com/video/x8reu53")).toBe(false);
	});
});

describe("lecture des arguments", () => {
	test("sans argument, rien n'est ecrit en base", () => {
		expect(lireOptions([]).ecrire).toBe(false);
	});

	test("une plateforme inconnue est ignoree plutot que passee a SQL", () => {
		expect(lireOptions(["--plateforme", "vimeo"]).plateforme).toBeUndefined();
		expect(lireOptions(["--plateforme", "dailymotion"]).plateforme).toBe("dailymotion");
	});
});
