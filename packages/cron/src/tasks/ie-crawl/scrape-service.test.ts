/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests de `scrape-service.ts` — la logique qui NE sort PAS sur le réseau.
 *
 * Ce qui est couvert ici est ce qui peut casser silencieusement : la validation
 * des entrées venues de Discord (dont le refus du réseau interne), le bornage
 * des charges avant la traversée de la socket, le masquage des secrets, la
 * limitation de débit (horloge injectée, donc aucune attente réelle) et les
 * analyseurs purs (SERP DuckDuckGo, fiche X, technologies, liens).
 *
 * Les fragments HTML et JSON utilisés en fixture sont des extraits FIDÈLES de
 * réponses réelles relevées le 13/8/2026 (`html.duckduckgo.com/html/`,
 * opération GraphQL `UserByScreenName`), pas des maquettes inventées.
 *
 * Les appels réseau eux-mêmes sont vérifiés en direct (voir le rapport de
 * livraison) : les tester ici rendrait la suite dépendante de l'état d'un site
 * tiers.
 */

import { describe, expect, it } from "bun:test";
import {
	analyserSerpDuckDuckGo,
	bornerEntier,
	bornerPostX,
	bornerTexte,
	charsetDepuisTypeContenu,
	dateXVersIso,
	deplierLienDuckDuckGo,
	detecterTechnologies,
	enReponse,
	ErreurScrape,
	estVerbeScrape,
	extraireEntetes,
	extraireLiens,
	ficheDepuisResultatX,
	LIMITE_LIENS_EXEMPLES,
	LimiteurDebit,
	lireCorpsBorne,
	nettoyerMessage,
	servirVerbeScrape,
	tailleOctets,
	validerPseudo,
	validerRequete,
	validerUrl,
	VERBES_SCRAPE,
} from "./scrape-service";

describe("validerUrl", () => {
	it("accepte une adresse publique en http et en https", () => {
		expect(validerUrl("https://www.inazuma.jp/victory-road/fr/").hostname).toBe("www.inazuma.jp");
		expect(validerUrl("  http://rosegriffon.fr/  ").protocol).toBe("http:");
	});

	it("refuse un schéma qui n'est pas http(s)", () => {
		for (const brut of ["file:///etc/passwd", "ftp://exemple.fr/", "gopher://exemple.fr/"]) {
			expect(() => validerUrl(brut)).toThrow(ErreurScrape);
		}
	});

	it("refuse le réseau interne du serveur", () => {
		const internes = [
			"http://localhost:8807/api/characters",
			"http://127.0.0.1:8809/",
			"http://0.0.0.0/",
			"http://[::1]:3003/",
			"http://192.168.1.10/",
			"http://10.8.0.1:4001/",
			"http://172.20.0.5/",
			"http://169.254.169.254/latest/meta-data/",
			"http://azalee.local/",
			"http://api.localhost/",
		];
		for (const brut of internes) {
			expect(() => validerUrl(brut)).toThrow(/réseau interne/);
		}
	});

	it("laisse passer une adresse publique proche d'une plage privée", () => {
		expect(validerUrl("http://172.32.4.4/").hostname).toBe("172.32.4.4");
		expect(validerUrl("http://51.77.147.152/").hostname).toBe("51.77.147.152");
	});

	it("refuse une entrée vide ou illisible", () => {
		expect(() => validerUrl("")).toThrow(ErreurScrape);
		expect(() => validerUrl(undefined)).toThrow(ErreurScrape);
		expect(() => validerUrl("pas une url")).toThrow(ErreurScrape);
	});

	it("classe ses refus en « requete_invalide »", () => {
		try {
			validerUrl("http://127.0.0.1/");
			throw new Error("aurait dû lever");
		} catch (err) {
			expect(err).toBeInstanceOf(ErreurScrape);
			expect((err as ErreurScrape).code).toBe("requete_invalide");
		}
	});
});

describe("validerRequete", () => {
	it("accepte et rogne une requête normale", () => {
		expect(validerRequete("  Inazuma Eleven Victory Road  ")).toBe("Inazuma Eleven Victory Road");
	});

	it("refuse une requête trop courte", () => {
		expect(() => validerRequete("a")).toThrow(ErreurScrape);
		expect(() => validerRequete(42)).toThrow(ErreurScrape);
	});

	it("borne une requête interminable", () => {
		expect(validerRequete("x".repeat(500)).length).toBeLessThanOrEqual(200);
	});
});

describe("validerPseudo", () => {
	it("accepte les formes usuelles", () => {
		expect(validerPseudo("inazuma_project")).toBe("inazuma_project");
		expect(validerPseudo("@Azalee_IE")).toBe("Azalee_IE");
		expect(validerPseudo("https://x.com/AkihiroHino")).toBe("AkihiroHino");
		expect(validerPseudo("https://twitter.com/LEVEL5_times/status/123")).toBe("LEVEL5_times");
	});

	it("refuse ce qui n'est pas un pseudo X", () => {
		for (const brut of ["", "a b", "trop_long_pour_x_com", "éclair", "@", 12]) {
			expect(() => validerPseudo(brut)).toThrow(ErreurScrape);
		}
	});
});

describe("bornage des charges", () => {
	it("borne un texte et signale la coupe", () => {
		expect(bornerTexte("court", 100)).toBe("court");
		const coupe = bornerTexte("a".repeat(50), 10);
		expect(coupe).toHaveLength(10);
		expect(coupe.endsWith("…")).toBe(true);
	});

	it("retire les caractères de largeur nulle", () => {
		expect(bornerTexte("Inazuma​Eleven﻿", 100)).toBe("InazumaEleven");
	});

	it("borne un entier dans son intervalle avec repli", () => {
		expect(bornerEntier(undefined, 5, 1, 10)).toBe(5);
		expect(bornerEntier("7", 5, 1, 10)).toBe(7);
		expect(bornerEntier(99, 5, 1, 10)).toBe(10);
		expect(bornerEntier(-3, 5, 1, 10)).toBe(1);
		expect(bornerEntier("abc", 5, 1, 10)).toBe(5);
		expect(bornerEntier(3.9, 5, 1, 10)).toBe(3);
	});
});

describe("nettoyerMessage", () => {
	it("masque la session X", () => {
		const sale = "échec sur Cookie: auth_token=abcdef123456; ct0=deadbeef99";
		const propre = nettoyerMessage(sale);
		expect(propre).not.toContain("abcdef123456");
		expect(propre).not.toContain("deadbeef99");
		expect(propre).toContain("auth_token=***");
		expect(propre).toContain("ct0=***");
	});

	it("masque un jeton porteur", () => {
		expect(nettoyerMessage("401 avec Bearer AAAAAAAAAAAAAAAAAAAAANRILgAA")).toBe("401 avec Bearer ***");
	});

	it("borne la longueur du message", () => {
		expect(nettoyerMessage("z".repeat(2000)).length).toBe(400);
	});
});

describe("LimiteurDebit", () => {
	it("n'autorise qu'un scraping lourd à la fois", () => {
		const limiteur = new LimiteurDebit("essai", 1, 10);
		limiteur.reserver();
		expect(limiteur.enVol).toBe(1);
		expect(() => limiteur.reserver()).toThrow(ErreurScrape);
		try {
			limiteur.reserver();
		} catch (err) {
			expect((err as ErreurScrape).code).toBe("occupe");
		}
		limiteur.liberer();
		expect(limiteur.enVol).toBe(0);
		limiteur.reserver(); // de nouveau possible une fois libéré
		limiteur.liberer();
	});

	it("applique un plafond par minute glissant", () => {
		let horloge = 1_000_000;
		const limiteur = new LimiteurDebit("essai", 5, 3, () => horloge);

		for (let i = 0; i < 3; i++) {
			limiteur.reserver();
			limiteur.liberer();
			horloge += 1_000;
		}
		expect(limiteur.consommeDansLaMinute).toBe(3);

		try {
			limiteur.reserver();
			throw new Error("aurait dû lever");
		} catch (err) {
			expect((err as ErreurScrape).code).toBe("trop_de_requetes");
		}

		// Une minute plus tard, la fenêtre s'est vidée.
		horloge += 61_000;
		expect(limiteur.consommeDansLaMinute).toBe(0);
		limiteur.reserver();
		limiteur.liberer();
	});

	it("libère sans jamais descendre sous zéro", () => {
		const limiteur = new LimiteurDebit("essai", 1, 10);
		limiteur.liberer();
		limiteur.liberer();
		expect(limiteur.enVol).toBe(0);
	});
});

describe("lecture bornée du corps", () => {
	it("compte des octets, pas des caractères", () => {
		expect(tailleOctets("abc")).toBe(3);
		expect(tailleOctets("Azalée")).toBe(7); // « é » pèse 2 octets en UTF-8
		expect(tailleOctets("イナズマイレブン")).toBe(24);
	});

	it("lit un corps entier sous le plafond", async () => {
		const reponse = new Response("<html><title>Azalée</title></html>", {
			headers: { "content-type": "text/html; charset=utf-8" },
		});
		const lu = await lireCorpsBorne(reponse, 1_000_000);
		expect(lu.tronque).toBe(false);
		expect(lu.texte).toContain("Azalée");
		expect(lu.octets).toBe(tailleOctets("<html><title>Azalée</title></html>"));
	});

	it("s'arrête au plafond au lieu de tout charger", async () => {
		// 4 Mo servis en morceaux : sans plafond, tout finirait en mémoire.
		const morceau = new TextEncoder().encode("x".repeat(64 * 1024));
		let restants = 64;
		const flux = new ReadableStream<Uint8Array>({
			pull(controleur) {
				if (restants-- <= 0) {
					controleur.close();
					return;
				}
				controleur.enqueue(morceau);
			},
		});
		const lu = await lireCorpsBorne(new Response(flux), 200_000);
		expect(lu.tronque).toBe(true);
		expect(lu.octets).toBeGreaterThanOrEqual(200_000);
		expect(lu.octets).toBeLessThan(300_000);
		expect(restants).toBeGreaterThan(50); // le reste n'a jamais été lu
	});

	it("rend un corps vide sur une réponse sans corps", async () => {
		const lu = await lireCorpsBorne(new Response(null, { status: 204 }), 1000);
		expect(lu).toEqual({ texte: "", octets: 0, tronque: false });
	});

	it("décode selon le jeu de caractères annoncé", async () => {
		// « Société » en windows-1252 : 0xE9 pour « é ».
		const octets = new Uint8Array([0x53, 0x6f, 0x63, 0x69, 0xe9, 0x74, 0xe9]);
		const reponse = new Response(octets, { headers: { "content-type": "text/html; charset=windows-1252" } });
		expect((await lireCorpsBorne(reponse, 1000)).texte).toBe("Société");
	});

	it("réduit un jeu de caractères absent ou inconnu à utf-8", () => {
		expect(charsetDepuisTypeContenu(null)).toBe("utf-8");
		expect(charsetDepuisTypeContenu("text/html")).toBe("utf-8");
		expect(charsetDepuisTypeContenu('text/html; charset="ISO-8859-1"')).toBe("iso-8859-1");
		expect(charsetDepuisTypeContenu("text/html; charset=charabia-42")).toBe("utf-8");
	});
});

describe("extraireEntetes", () => {
	it("ne retient que les en-têtes d'infrastructure", () => {
		const entetes = new Headers({
			server: "openresty",
			"content-type": "text/html; charset=UTF-8",
			"cache-control": "max-age=300",
			"set-cookie": "session=secret-a-ne-pas-divulguer",
			authorization: "Bearer secret",
			"x-interne": "valeur",
		});
		const retenus = extraireEntetes(entetes);
		expect(retenus.server).toBe("openresty");
		expect(retenus["cache-control"]).toBe("max-age=300");
		expect(retenus).not.toHaveProperty("set-cookie");
		expect(retenus).not.toHaveProperty("authorization");
		expect(retenus).not.toHaveProperty("x-interne");
	});
});

describe("detecterTechnologies", () => {
	it("reconnaît une pile Next.js derrière nginx", () => {
		const technos = detecterTechnologies(
			{ server: "nginx", "strict-transport-security": "max-age=63072000" },
			'<html><body><script src="/_next/static/chunks/main.js"></script></body></html>'
		);
		expect(technos).toContain("Next.js");
		expect(technos).toContain("nginx");
		expect(technos).toContain("HSTS");
	});

	it("reconnaît le site officiel Inazuma (openresty + jQuery + GTM)", () => {
		const technos = detecterTechnologies(
			{ server: "openresty" },
			'<script src="/common/js/jquery-3.6.0.min.js"></script><script src="https://www.googletagmanager.com/gtm.js?id=GTM-KX7QTFN"></script>'
		);
		expect(technos).toContain("OpenResty");
		expect(technos).toContain("jQuery");
		expect(technos).toContain("Google Tag Manager");
	});

	it("relève la balise generator et ne renvoie aucun doublon", () => {
		const technos = detecterTechnologies(
			{},
			'<meta name="generator" content="WordPress 6.5"><link href="/wp-content/themes/x/style.css">'
		);
		expect(technos).toContain("WordPress");
		expect(technos).toContain("WordPress 6.5");
		expect(new Set(technos).size).toBe(technos.length);
	});

	it("ne détecte rien sur une page nue", () => {
		expect(detecterTechnologies({}, "<html><body>bonjour</body></html>")).toEqual([]);
	});
});

describe("extraireLiens", () => {
	it("sépare internes et externes, dédoublonne et résout le relatif", () => {
		const html = `
			<a href="/victory-road/fr/character/">Personnages</a>
			<a href="/victory-road/fr/character/">Personnages (doublon)</a>
			<a href="https://www.inazuma.jp/victory-road/fr/news/">Actus</a>
			<a href="https://zukan.inazuma.jp/fr/">Codex</a>
			<a href="#ancre">Ancre</a>
			<a href="mailto:contact@exemple.fr">Courriel</a>
			<a href="javascript:void(0)">Rien</a>
		`;
		const liens = extraireLiens(html, "https://www.inazuma.jp/victory-road/fr/");
		expect(liens.total).toBe(3);
		expect(liens.internes).toBe(2);
		expect(liens.externes).toBe(1);
		expect(liens.exemples[0]).toBe("https://www.inazuma.jp/victory-road/fr/character/");
	});

	it("borne le nombre d'exemples", () => {
		const html = Array.from({ length: 40 }, (_, i) => `<a href="/p${i}">p${i}</a>`).join("");
		const liens = extraireLiens(html, "https://rosegriffon.fr/");
		expect(liens.total).toBe(40);
		expect(liens.exemples).toHaveLength(LIMITE_LIENS_EXEMPLES);
	});
});

// Extrait fidèle de `html.duckduckgo.com/html/?q=inazuma+eleven+victory+road`
// (13/8/2026) : un bloc publicitaire puis deux résultats organiques.
const SERP_DUCKDUCKGO = `
<div id="links" class="results">
  <div class="result results_links results_links_deep result--ad ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fduckduckgo.com%2Fy.js%3Fad_domain%3Didealo.fr&amp;rut=31b2">Précommandez les nouveaux jeux</a>
    </h2>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.inazuma.jp%2Fvictory%2Droad%2Fen%2F&amp;rut=70afb1">INAZUMA ELEVEN: <b>Victory Road</b></a>
    </h2>
    <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.inazuma.jp%2Fvictory%2Droad%2Fen%2F">Relive past <b>Inazuma</b> <b>Eleven</b> matches with Victorio, the boy from the future.</a>
  </div>
  <div class="result results_links results_links_deep web-result ">
    <h2 class="result__title">
      <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fazalee.rosegriffon.fr%2F&amp;rut=aa11">Azal&eacute;e &mdash; le wiki</a>
    </h2>
    <a class="result__snippet" href="#">Le wiki fran&ccedil;ais d&#39;Inazuma Eleven: Victory Road.</a>
  </div>
</div>`;

describe("analyserSerpDuckDuckGo", () => {
	it("extrait les résultats organiques en écartant la publicité", () => {
		const resultats = analyserSerpDuckDuckGo(SERP_DUCKDUCKGO, 10);
		expect(resultats).toHaveLength(2);
		expect(resultats[0]?.url).toBe("https://www.inazuma.jp/victory-road/en/");
		expect(resultats[0]?.titre).toBe("INAZUMA ELEVEN: Victory Road");
		expect(resultats[0]?.extrait).toContain("Victorio");
		expect(resultats.some((r) => r.url.includes("duckduckgo.com"))).toBe(false);
	});

	it("décode les entités HTML des titres et des extraits", () => {
		const resultats = analyserSerpDuckDuckGo(SERP_DUCKDUCKGO, 10);
		expect(resultats[1]?.titre).toBe("Azalée — le wiki");
		expect(resultats[1]?.extrait).toBe("Le wiki français d'Inazuma Eleven: Victory Road.");
	});

	it("respecte la limite demandée", () => {
		expect(analyserSerpDuckDuckGo(SERP_DUCKDUCKGO, 1)).toHaveLength(1);
	});

	it("rend une liste vide sur un HTML sans résultat", () => {
		expect(analyserSerpDuckDuckGo("<html><body>rien</body></html>", 5)).toEqual([]);
	});
});

describe("deplierLienDuckDuckGo", () => {
	it("déplie la redirection uddg", () => {
		expect(deplierLienDuckDuckGo("//duckduckgo.com/l/?uddg=https%3A%2F%2Frosegriffon.fr%2F&amp;rut=1")).toBe(
			"https://rosegriffon.fr/"
		);
	});

	it("laisse passer une URL déjà directe et refuse le reste", () => {
		expect(deplierLienDuckDuckGo("https://azalee.rosegriffon.fr/")).toBe("https://azalee.rosegriffon.fr/");
		expect(deplierLienDuckDuckGo("javascript:void(0)")).toBeNull();
		expect(deplierLienDuckDuckGo("")).toBeNull();
	});
});

// Extrait fidèle de `data.user.result` (opération `UserByScreenName`, 13/8/2026).
const RESULTAT_X_AZALEE = {
	__typename: "User",
	rest_id: "1391462345197686789",
	is_blue_verified: true,
	core: { name: "Azalée 🌸 | Inazuma Eleven FR", screen_name: "Azalee_IE" },
	avatar: { image_url: "https://pbs.twimg.com/profile_images/1932460448755949568/6-Ul-rMi_normal.jpg" },
	legacy: {
		description: "Médias et informations sur l'univers d'Inazuma Eleven en français.",
		followers_count: 13701,
		friends_count: 26,
		created_at: "Sun May 09 18:37:38 +0000 2021",
		profile_image_url_https: "https://pbs.twimg.com/profile_images/1932460448755949568/6-Ul-rMi_normal.jpg",
	},
};

describe("ficheDepuisResultatX", () => {
	it("construit la fiche depuis la réponse GraphQL réelle", () => {
		const fiche = ficheDepuisResultatX(RESULTAT_X_AZALEE, "Azalee_IE");
		expect(fiche).not.toBeNull();
		expect(fiche?.id).toBe("1391462345197686789");
		expect(fiche?.pseudo).toBe("Azalee_IE");
		expect(fiche?.nom).toBe("Azalée 🌸 | Inazuma Eleven FR");
		expect(fiche?.abonnes).toBe(13701);
		expect(fiche?.abonnements).toBe(26);
		expect(fiche?.certifie).toBe(true);
		expect(fiche?.creeLe).toBe("2021-05-09T18:37:38.000Z");
		expect(fiche?.url).toBe("https://x.com/Azalee_IE");
	});

	it("rend null quand X ne renvoie pas de compte", () => {
		expect(ficheDepuisResultatX(null, "inconnu")).toBeNull();
		expect(ficheDepuisResultatX({}, "inconnu")).toBeNull();
		expect(ficheDepuisResultatX({ legacy: { name: "sans identifiant" } }, "inconnu")).toBeNull();
	});
});

describe("dateXVersIso", () => {
	it("convertit le format publié par X", () => {
		expect(dateXVersIso("Mon Jul 06 08:21:03 +0000 2026")).toBe("2026-07-06T08:21:03.000Z");
	});

	it("rend null plutôt qu'une date inventée", () => {
		expect(dateXVersIso(undefined)).toBeNull();
		expect(dateXVersIso("")).toBeNull();
		expect(dateXVersIso("pas une date")).toBeNull();
	});
});

describe("bornerPostX", () => {
	it("met un post à la forme bornée attendue par l'embed", () => {
		const post = bornerPostX(
			{
				id: "2074045952747548797",
				text: "t".repeat(900),
				author: { username: "inazuma_project", name: "イナズマイレブン公式" },
				created_at: "Mon Jul 06 08:21:03 +0000 2026",
				like_count: 1142,
				retweet_count: 300,
				reply_count: 12,
				view_count: 98_000,
				media: [{ id: "1" }, { id: "2" }],
			},
			"inazuma_project"
		);
		expect(post).not.toBeNull();
		expect(post?.url).toBe("https://x.com/inazuma_project/status/2074045952747548797");
		expect(post?.texte).toHaveLength(400);
		expect(post?.likes).toBe(1142);
		expect(post?.vues).toBe(98_000);
		expect(post?.medias).toBe(2);
		expect(post?.date).toBe("2026-07-06T08:21:03.000Z");
	});

	it("retombe sur le pseudo demandé quand l'auteur n'est pas hydraté", () => {
		const post = bornerPostX({ id: "1", text: "salut" }, "Azalee_IE");
		expect(post?.auteur).toBe("Azalee_IE");
		expect(post?.auteurNom).toBe("Azalee_IE");
		expect(post?.vues).toBeNull();
		expect(post?.medias).toBe(0);
	});

	it("écarte ce qui n'est pas un post", () => {
		expect(bornerPostX(null, "x")).toBeNull();
		expect(bornerPostX({ text: "sans identifiant" }, "x")).toBeNull();
	});
});

describe("enReponse", () => {
	it("conserve le code d'une ErreurScrape", () => {
		expect(enReponse(new ErreurScrape("delai_depasse", "trop long"))).toEqual({
			success: false,
			error: "trop long",
			code: "delai_depasse",
		});
	});

	it("nettoie et classe toute autre exception", () => {
		const reponse = enReponse(new Error("échec avec ct0=secret123"));
		expect(reponse.success).toBe(false);
		expect(reponse.code).toBe("erreur_scraping");
		expect(reponse.error).not.toContain("secret123");
	});
});

describe("routage des verbes", () => {
	it("annonce exactement les six verbes du contrat", () => {
		expect([...VERBES_SCRAPE].sort()).toEqual([
			"scrape.google",
			"scrape.page",
			"scrape.recon",
			"x.posts",
			"x.profil",
			"x.recherche",
		]);
		for (const verbe of VERBES_SCRAPE) {
			expect(estVerbeScrape(verbe)).toBe(true);
		}
		expect(estVerbeScrape("task.run")).toBe(false);
	});

	it("refuse un verbe inconnu sans lever", async () => {
		const reponse = await servirVerbeScrape("scrape.inexistant", {});
		expect(reponse.success).toBe(false);
		expect(reponse.code).toBe("verbe_inconnu");
	});

	it("rend une réponse d'erreur — jamais une exception — sur une entrée invalide", async () => {
		const sansPseudo = await servirVerbeScrape("x.profil", {});
		expect(sansPseudo.success).toBe(false);
		expect(sansPseudo.code).toBe("requete_invalide");

		const urlInterne = await servirVerbeScrape("scrape.recon", { url: "http://127.0.0.1:8809/" });
		expect(urlInterne.success).toBe(false);
		expect(urlInterne.code).toBe("requete_invalide");

		const profilInconnu = await servirVerbeScrape("scrape.page", {
			url: "https://rosegriffon.fr/",
			profil: "chromium",
		});
		expect(profilInconnu.success).toBe(false);
		expect(profilInconnu.code).toBe("requete_invalide");
	});

	it("libère ses jetons après un refus : le verbe reste appelable", async () => {
		for (let i = 0; i < 4; i++) {
			const reponse = await servirVerbeScrape("x.recherche", { requete: "a" });
			expect(reponse.code).toBe("requete_invalide");
		}
	});
});
