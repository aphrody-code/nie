/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests de la tolérance aux fautes sur le hashtag d'une campagne.
 *
 * Ce module décide ce qui entre dans la galerie publique. Ses deux façons de se
 * tromper n'ont pas la même gravité :
 *  - trop STRICT : la création d'un participant disparaît sans que personne ne
 *    le sache — ni lui, ni nous ;
 *  - trop LARGE : un post étranger s'affiche sur le mur de la campagne, sous le
 *    nom de l'association.
 * Les cas ci-dessous couvrent les deux bords, avec le hashtag RÉEL de la
 * campagne en cours (`#IERGDay`, `x_campagnes.hashtags`) et sa variante de
 * rattrapage déjà en base (`#InazumaRGday`).
 */

import { describe, expect, test } from "bun:test";

import { estCompteOrganisateur } from "./hashtag-harvest.js";
import {
	apparierHashtag,
	distanceFaute,
	hashtagsDuTexte,
	normaliserHashtag,
	requetesVariantes,
	toleranceFautes,
	variantesRecherche,
} from "./hashtag-variantes.js";

/** Les hashtags réels de la campagne en cours (déclarés + rattrapage). */
const IERGDAY = ["iergday", "inazumargday"];

describe("normalisation", () => {
	test("le croisillon, la casse et les séparateurs disparaissent", () => {
		expect(normaliserHashtag("#IERG_Day")).toBe("iergday");
		expect(normaliserHashtag("IERGDAY")).toBe("iergday");
		expect(normaliserHashtag("#ierg-day")).toBe("iergday");
	});

	test("les accents sont retirés, pas les lettres qu'ils portent", () => {
		expect(normaliserHashtag("#Célébration")).toBe("celebration");
	});

	test("une chaîne sans lettre ni chiffre ne donne rien", () => {
		expect(normaliserHashtag("###")).toBe("");
		expect(normaliserHashtag("")).toBe("");
	});
});

describe("extraction des hashtags d'un texte", () => {
	test("plusieurs hashtags, dans l'ordre d'apparition", () => {
		expect(hashtagsDuTexte("Mon OC pour le #IERGDay ! #InazumaEleven #fanart")).toEqual([
			"IERGDay",
			"InazumaEleven",
			"fanart",
		]);
	});

	test("un hashtag japonais est un hashtag", () => {
		expect(hashtagsDuTexte("#イナズマイレブン")).toEqual(["イナズマイレブン"]);
	});

	test("un « hashtag » purement numérique est écarté", () => {
		// `#1` sur X n'est pas un hashtag : le retenir ferait apparier n'importe
		// quel post contenant un classement.
		expect(hashtagsDuTexte("Top #1 de la semaine")).toEqual([]);
	});

	test("le croisillon d'une URL ne produit pas de hashtag parasite", () => {
		expect(hashtagsDuTexte("https://rosegriffon.fr/iergday")).toEqual([]);
	});
});

describe("distance de faute", () => {
	test("une transposition compte pour UNE faute, pas deux", () => {
		// C'est tout l'intérêt de Damerau : `#IERGDya` est la faute la plus
		// courante, et Levenshtein simple la compterait 2 (donc hors seuil).
		expect(distanceFaute("iergdya", "iergday", 2)).toBe(1);
	});

	test("lettre avalée, lettre doublée, lettre changée : une faute chacune", () => {
		expect(distanceFaute("iergda", "iergday", 2)).toBe(1);
		expect(distanceFaute("ierggday", "iergday", 2)).toBe(1);
		expect(distanceFaute("iergdai", "iergday", 2)).toBe(1);
	});

	test("le plafond coupe court au lieu de rendre la vraie distance", () => {
		expect(distanceFaute("inazumaeleven", "iergday", 1)).toBe(2);
	});

	test("deux chaînes identiques sont à distance nulle", () => {
		expect(distanceFaute("iergday", "iergday", 0)).toBe(0);
	});
});

describe("tolérance selon la longueur", () => {
	test("un hashtag court n'a droit à aucune faute", () => {
		// Sinon `#rg` apparierait `#rp`, `#ra`, `#bg`…
		expect(toleranceFautes(2)).toBe(0);
		expect(toleranceFautes(5)).toBe(0);
	});

	test("un hashtag ordinaire tolère une faute", () => {
		expect(toleranceFautes("iergday".length)).toBe(1);
	});

	test("un hashtag long en tolère deux", () => {
		expect(toleranceFautes("inazumaelevenvictoryroad".length)).toBe(2);
	});
});

describe("appariement d'un post à la campagne", () => {
	test("la graphie exacte apparie", () => {
		const r = apparierHashtag("Mon OC pour le #IERGDay", IERGDAY);
		expect(r).toEqual({ hashtag: "iergday", ecrit: "IERGDay", fautes: 0 });
	});

	test("la casse et le tiret bas n'ont jamais compté pour une faute", () => {
		expect(apparierHashtag("#IERG_DAY", IERGDAY)?.fautes).toBe(0);
		expect(apparierHashtag("#iergday", IERGDAY)?.fautes).toBe(0);
	});

	test("les fautes de frappe réelles apparient, en restant marquées", () => {
		for (const faute of ["#IERGDya", "#IERGDai", "#IERGDy", "#IERGGDay", "#IREGDay"]) {
			const r = apparierHashtag(`Mon OC ${faute}`, IERGDAY);
			expect(r?.hashtag).toBe("iergday");
			expect(r?.fautes).toBe(1);
		}
	});

	test("le hashtag de rattrapage déjà en base apparie aussi", () => {
		expect(apparierHashtag("#InazumaRGday", IERGDAY)?.hashtag).toBe("inazumargday");
	});

	test("la graphie exacte l'emporte sur une variante présente dans le même post", () => {
		// Un participant écrit souvent les deux. Rattacher au hashtag approximatif
		// ferait mentir la colonne `hashtag_trouve`.
		const r = apparierHashtag("#IERGDya et #IERGDay", IERGDAY);
		expect(r?.fautes).toBe(0);
		expect(r?.ecrit).toBe("IERGDay");
	});

	test("un hashtag étranger n'apparie pas", () => {
		expect(apparierHashtag("#InazumaEleven #fanart", IERGDAY)).toBeNull();
		expect(apparierHashtag("#Inatober", IERGDAY)).toBeNull();
	});

	test("un texte sans hashtag n'apparie jamais", () => {
		// Le mot nu ne suffit pas : le règlement demande LE HASHTAG.
		expect(apparierHashtag("Voici mon OC pour l'IERGDay", IERGDAY)).toBeNull();
		expect(apparierHashtag("", IERGDAY)).toBeNull();
	});

	test("une campagne sans hashtag n'apparie rien", () => {
		expect(apparierHashtag("#IERGDay", [])).toBeNull();
	});
});

describe("graphies demandées à X", () => {
	const variantes = variantesRecherche("IERGDay");

	test("la graphie exacte vient en tête", () => {
		expect(variantes[0]).toBe("iergday");
	});

	test("le tiret bas au point de composition est demandé", () => {
		// `#IERG_Day` est la seule forme fautive que l'index de X sait rendre
		// telle quelle : ne pas la demander, c'est la perdre définitivement.
		expect(variantes).toContain("ierg_day");
	});

	test("le millésime spontané est demandé", () => {
		expect(variantes).toContain("iergday2026");
	});

	test("les transpositions sont demandées", () => {
		expect(variantes).toContain("iergdya");
	});

	test("la liste reste bornée — le quota de X est fini", () => {
		expect(variantes.length).toBeLessThanOrEqual(12);
		expect(new Set(variantes).size).toBe(variantes.length);
	});

	test("un hashtag vide ne produit aucune requête", () => {
		expect(variantesRecherche("#")).toEqual([]);
	});
});

describe("empaquetage en requêtes X", () => {
	test("plusieurs graphies tiennent dans un seul groupe OR", () => {
		const requetes = requetesVariantes(["iergday", "iergdya", "ierg_day"]);
		expect(requetes).toHaveLength(1);
		expect(requetes[0]).toBe("(#iergday OR #iergdya OR #ierg_day)");
	});

	test("une graphie seule ne porte pas de parenthèses inutiles", () => {
		expect(requetesVariantes(["iergday"])).toEqual(["#iergday"]);
	});

	test("les filtres de la campagne sont recollés à chaque requête", () => {
		const [requete] = requetesVariantes(["iergday"], "-filter:replies since:2026-07-01");
		expect(requete).toBe("#iergday -filter:replies since:2026-07-01");
	});

	test("au-delà de la longueur maximale, la requête est découpée", () => {
		const requetes = requetesVariantes(["aaaaaaaa", "bbbbbbbb", "cccccccc"], "", 30);
		expect(requetes.length).toBeGreaterThan(1);
		for (const r of requetes) expect(r.length).toBeLessThanOrEqual(40);
	});

	test("aucune graphie, aucune requête", () => {
		expect(requetesVariantes([])).toEqual([]);
	});
});

describe("comptes de l'organisateur", () => {
	// L'annonce d'une campagne porte le hashtag ET l'affiche : sans ce filtre,
	// elle devient la première « création » du mur et le compteur public annonce
	// « 1 création, 1 participant » avant toute participation. Constaté en vrai le
	// 13/8/2026 : le seul post retenu à l'ouverture de #IERGDay était
	// https://x.com/rose_griffon/status/2087918181033574427.
	const CAMPAGNE = { comptes_organisateurs: ["rose_griffon"] };

	test("le compte de l'organisateur est écarté", () => {
		expect(estCompteOrganisateur({ author: { username: "rose_griffon" } }, CAMPAGNE)).toBe(true);
	});

	test("la casse et le @ ne changent rien", () => {
		expect(estCompteOrganisateur({ author: { username: "Rose_Griffon" } }, CAMPAGNE)).toBe(true);
		expect(estCompteOrganisateur({ author: { username: "rose_griffon" } }, {
			comptes_organisateurs: ["@Rose_Griffon"],
		})).toBe(true);
	});

	test("un participant N'EST PAS écarté", () => {
		// La règle doit être étroite : élargir ne serait pas « prudent », ce serait
		// faire disparaître la création d'un membre sans que personne ne le sache.
		expect(estCompteOrganisateur({ author: { username: "yoyo__goat" } }, CAMPAGNE)).toBe(false);
		expect(estCompteOrganisateur({ author: { username: "rose_griffonfr" } }, CAMPAGNE)).toBe(false);
	});

	test("sans liste déclarée, rien n'est écarté", () => {
		expect(estCompteOrganisateur({ author: { username: "rose_griffon" } }, {})).toBe(false);
		expect(
			estCompteOrganisateur({ author: { username: "rose_griffon" } }, { comptes_organisateurs: [] })
		).toBe(false);
	});

	test("un post sans auteur n'est jamais écarté par ce chemin", () => {
		expect(estCompteOrganisateur({}, CAMPAGNE)).toBe(false);
		expect(estCompteOrganisateur({ author: null }, CAMPAGNE)).toBe(false);
	});
});
