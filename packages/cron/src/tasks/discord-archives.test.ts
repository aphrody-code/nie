/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests de la mise sous veille des salons d'ARCHIVE.
 *
 * Ce qui est couvert ici est la seule décision purement calculatoire de
 * l'armement : « ce salon-là entre-t-il dans `discord_messages` ? ». Se tromper
 * ne casse rien bruyamment — ça manque une archive en silence, ou ça demande
 * l'historique d'un salon vocal toutes les cinq minutes, indéfiniment.
 *
 * AUCUNE FIXTURE INVENTÉE : les identifiants, types et noms ci-dessous sont
 * ceux relevés le 13/8/2026 sur `GET /guilds/1072991720268111892/channels`
 * (catégorie « Archives » = 1180594177063526441, 29 salons).
 *
 * CE QUE CES TESTS NE FONT PAS : aucune connexion Postgres, aucun appel Discord.
 * `armerSalonsDeCategories` et `armerSalonsDeDepot` se valident par leur COUNT
 * réel en base (`select count(*) from discord_channels where suivi`).
 */

import { describe, expect, test } from "bun:test";

import { CATEGORIES_SUIVIES, categoriesSuivies, estSalonArchivable } from "./discord-messages.js";

/** La catégorie « Archives » du serveur Rose Griffon. */
const ARCHIVES = "1180594177063526441";
/** La catégorie « 🎨 Artistes », où vit le salon de dépôt d'IERG Day. */
const ARTISTES = "1084588726484729886";

describe("registre des catégories", () => {
	test("la catégorie Archives est suivie par défaut, sans variable d'environnement", () => {
		expect(CATEGORIES_SUIVIES).toContain(ARCHIVES);
		expect(categoriesSuivies({})).toEqual([ARCHIVES]);
	});

	test("DISCORD_CATEGORIES_SUIVIES AJOUTE, elle ne remplace pas", () => {
		const resolues = categoriesSuivies({ DISCORD_CATEGORIES_SUIVIES: "1084588726484729886" });
		expect(resolues).toContain(ARCHIVES);
		expect(resolues).toContain(ARTISTES);
	});

	test("une valeur qui n'est pas un flocon est ignorée plutôt qu'armée", () => {
		// Bun n'expanse pas `$VAR` dans un `.env` : la valeur littérale
		// « $DISCORD_ARCHIVES » arrive telle quelle et ne doit rien armer.
		expect(categoriesSuivies({ DISCORD_CATEGORIES_SUIVIES: "$DISCORD_ARCHIVES, oui" })).toEqual([
			ARCHIVES,
		]);
	});

	test("un doublon ne produit pas deux armements", () => {
		expect(categoriesSuivies({ DISCORD_CATEGORIES_SUIVIES: ARCHIVES })).toHaveLength(1);
	});
});

describe("salons archivables", () => {
	const categories = [ARCHIVES];

	test("les salons textuels de la catégorie entrent en veille", () => {
		// ⚡〡inatober-rg, salon de dépôt réel des trois éditions d'Inatober.
		expect(estSalonArchivable({ type: 0, parent_id: ARCHIVES }, categories)).toBe(true);
	});

	test("les salons d'annonces et les forums aussi", () => {
		// ⚡〡faq-souvenir-d-ete est un forum (type 15) de la catégorie.
		expect(estSalonArchivable({ type: 15, parent_id: ARCHIVES }, categories)).toBe(true);
		expect(estSalonArchivable({ type: 5, parent_id: ARCHIVES }, categories)).toBe(true);
	});

	test("le vocal et le stage sont écartés", () => {
		// Demander `GET /channels/{id}/messages` sur un vocal ne rend rien
		// d'exploitable ; l'inclure produirait une erreur à chaque passe.
		expect(estSalonArchivable({ type: 2, parent_id: ARCHIVES }, categories)).toBe(false);
		// 𝐋𝐞𝐬 𝐐𝐮𝐞𝐬𝐭𝐢𝐨𝐧𝐬 𝐩𝐨𝐮𝐫 𝐑𝐆 #𝟏 est un salon de stage (type 13) de la catégorie.
		expect(estSalonArchivable({ type: 13, parent_id: ARCHIVES }, categories)).toBe(false);
	});

	test("un salon textuel d'une AUTRE catégorie n'est pas armé par ce chemin", () => {
		// 🍰〡iergday vit sous « 🎨 Artistes » : il est armé parce que la campagne
		// le déclare en salon de dépôt (`armerSalonsDeDepot`), jamais parce qu'il
		// serait dans l'archive.
		expect(estSalonArchivable({ type: 0, parent_id: ARTISTES }, categories)).toBe(false);
	});

	test("un salon sans catégorie n'est jamais armé", () => {
		expect(estSalonArchivable({ type: 0, parent_id: null }, categories)).toBe(false);
		expect(estSalonArchivable({ type: 0 }, categories)).toBe(false);
	});

	test("un type absent ou inconnu n'est jamais armé", () => {
		expect(estSalonArchivable({ parent_id: ARCHIVES }, categories)).toBe(false);
		expect(estSalonArchivable({ type: 99, parent_id: ARCHIVES }, categories)).toBe(false);
	});
});
