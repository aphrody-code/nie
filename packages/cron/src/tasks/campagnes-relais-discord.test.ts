/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests de la charge envoyée à Discord par le relais de campagne.
 *
 * C'est la seule partie du relais qui se valide sans réseau — et c'est celle qui
 * casse le plus salement : une charge qui viole une limite de l'API fait refuser
 * le message ENTIER, embed compris. Personne ne voit alors rien, pas même une
 * erreur partielle, et la création est silencieusement perdue.
 *
 * Le reste (idempotence, garde `relais_depuis`, plafond par passe) est du SQL et
 * se vérifie par son COUNT réel en base, pas par une simulation de Postgres.
 */

import { describe, expect, test } from "bun:test";

import {
	borner,
	chargeRelais,
	premiereImageDiscord,
	premiereImageTweet,
	urlAsset,
	urlMessageDiscord,
	urlPublication,
	type Creation,
} from "./campagnes-relais-discord.js";

const CAMPAGNE = { slug: "iergday", titre: "Un mois de célébration" };

/** Une création X, telle que la construit `creationsX`. */
function creationX(surcharge: Partial<Creation> = {}): Creation {
	return {
		source: "x",
		reference: "1900000000000000001",
		lien: "https://x.com/yoyo__goat/status/1900000000000000001",
		auteur: "@yoyo__goat",
		texte: "Mon OC pour le #IERGDay !",
		image: "https://rosegriffon.fr/storage/v1/a.jpg",
		hashtag: "iergday",
		publieLe: new Date("2026-08-13T15:00:00Z"),
		masque: false,
		...surcharge,
	};
}

describe("choix de l'image d'un tweet", () => {
	test("l'image RÉ-HÉBERGÉE prime sur l'URL d'origine", () => {
		// Les URL `pbs.twimg.com` expirent : les préférer laisserait, des mois plus
		// tard, un embed cassé dans l'archive du salon.
		expect(
			premiereImageTweet([
				{
					type: "photo",
					media_url_https: "https://pbs.twimg.com/media/x.jpg",
					storage_url: "https://rosegriffon.fr/storage/v1/a.jpg",
				},
			])
		).toBe("https://rosegriffon.fr/storage/v1/a.jpg");
	});

	test("à défaut, l'URL d'origine sert", () => {
		expect(premiereImageTweet([{ type: "photo", media_url_https: "https://pbs.twimg.com/x.jpg" }])).toBe(
			"https://pbs.twimg.com/x.jpg"
		);
	});

	test("une vidéo n'est pas une image", () => {
		expect(premiereImageTweet([{ type: "video", url: "https://video.twimg.com/v.mp4" }])).toBeNull();
	});

	test("un média absent, vide ou mal formé ne casse rien", () => {
		expect(premiereImageTweet(null)).toBeNull();
		expect(premiereImageTweet([])).toBeNull();
		expect(premiereImageTweet("pas un tableau")).toBeNull();
		expect(premiereImageTweet([null, 3, { type: "photo" }])).toBeNull();
	});
});

describe("choix de l'image d'une création Discord", () => {
	test("le chemin du bucket devient une URL ABSOLUE", () => {
		// Discord ne résout pas les chemins relatifs : une URL relative donne un
		// embed sans image, sans erreur.
		expect(urlAsset("campagnes/iergday/a.webp")).toBe(
			"https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/iergday/a.webp"
		);
	});

	test("une recopie encore en échec est sautée au profit de la suivante", () => {
		// `chemin: null` = image pas encore recopiée ; l'URL Discord d'origine est
		// signée et expire, la servir produirait un embed cassé.
		expect(
			premiereImageDiscord([{ chemin: null }, { chemin: "campagnes/iergday/b.webp" }])
		).toBe("https://rosegriffon.fr/storage/v1/object/public/assets/campagnes/iergday/b.webp");
	});

	test("aucune image exploitable rend null", () => {
		expect(premiereImageDiscord([{ chemin: null }])).toBeNull();
		expect(premiereImageDiscord(null)).toBeNull();
		expect(urlAsset(null)).toBeNull();
		expect(urlAsset("   ")).toBeNull();
	});
});

describe("liens vers la création d'origine", () => {
	test("une publication X", () => {
		expect(urlPublication("yoyo__goat", "42")).toBe("https://x.com/yoyo__goat/status/42");
	});

	test("un message Discord", () => {
		expect(urlMessageDiscord("1072991720268111892", "1537458038623965194", "42")).toBe(
			"https://discord.com/channels/1072991720268111892/1537458038623965194/42"
		);
	});
});

describe("bornage", () => {
	test("un texte court passe intact", () => {
		expect(borner("court", 10)).toBe("court");
	});

	test("un texte long est coupé ET la coupe se voit", () => {
		// Couper en silence ferait passer un texte tronqué pour le texte complet.
		expect(borner("abcdefghij", 5)).toBe("abcd…");
	});
});

describe("charge Discord", () => {
	test("les émotes des mascottes sont dans le message, pas seulement dans l'embed", () => {
		// Le `content` est ce que Discord montre en notification : c'est là que la
		// voix de l'association doit s'entendre.
		const charge = chargeRelais(creationX(), CAMPAGNE) as { content: string };
		expect(charge.content).toContain("<:RG_gaelle_hautparleur:1412136626167218286>");
		expect(charge.content).toContain("<:RG_roy_confetti:1412136639303520380>");
		expect(charge.content).toContain("#iergday");
		expect(charge.content).toContain("@yoyo__goat");
	});

	test("la provenance est écrite en clair", () => {
		// Le salon reçoit trois sources : sans le dire, un relais Discord ressemble
		// à un relais X et le staff cherche le post sur le mauvais réseau.
		expect((chargeRelais(creationX(), CAMPAGNE) as { content: string }).content).toContain("sur X");
		expect(
			(chargeRelais(creationX({ source: "discord" }), CAMPAGNE) as { content: string }).content
		).toContain("sur Discord");
	});

	test("AUCUNE mention n'est autorisée", () => {
		// Le texte d'une création peut contenir « @everyone » : sans cette clause,
		// le relais le transmettrait aux deux mille membres du serveur.
		const charge = chargeRelais(
			creationX({ texte: "@everyone regardez mon OC #IERGDay" }),
			CAMPAGNE
		) as { allowed_mentions: { parse: string[] } };
		expect(charge.allowed_mentions).toEqual({ parse: [] });
	});

	test("l'embed porte l'image, l'auteur, la date et le lien", () => {
		const charge = chargeRelais(creationX(), CAMPAGNE) as { embeds: Array<Record<string, any>> };
		const embed = charge.embeds[0]!;
		expect(embed.image.url).toBe("https://rosegriffon.fr/storage/v1/a.jpg");
		expect(embed.author.name).toBe("@yoyo__goat");
		expect(embed.url).toBe("https://x.com/yoyo__goat/status/1900000000000000001");
		expect(embed.timestamp).toBe("2026-08-13T15:00:00.000Z");
		expect(embed.footer.text).toContain("rosegriffon.fr/iergday");
	});

	test("une création sans image reste relayable", () => {
		// Un embed sans clé `image` est valide ; un embed avec `image: {url: undefined}`
		// est refusé par l'API.
		const charge = chargeRelais(creationX({ image: null }), CAMPAGNE) as {
			embeds: Array<Record<string, unknown>>;
		};
		expect(charge.embeds[0]).not.toHaveProperty("image");
	});

	test("un texte à rallonge ne fait pas dépasser la description", () => {
		const charge = chargeRelais(creationX({ texte: "a".repeat(9000) }), CAMPAGNE) as {
			embeds: Array<{ description: string }>;
		};
		expect(charge.embeds[0]!.description.length).toBeLessThanOrEqual(4096);
	});

	test("un nom d'auteur à rallonge ne fait dépasser ni l'auteur ni le contenu", () => {
		const charge = chargeRelais(creationX({ auteur: "z".repeat(4000) }), CAMPAGNE) as {
			content: string;
			embeds: Array<{ author: { name: string } }>;
		};
		expect(charge.embeds[0]!.author.name.length).toBeLessThanOrEqual(256);
		expect(charge.content.length).toBeLessThanOrEqual(2000);
	});

	test("sans hashtag apparié, le titre de la campagne prend le relais", () => {
		// `hashtag_trouve` est ramené à NULL par l'affichage sur les hashtags de
		// rattrapage : le message ne doit pas afficher « # » tout seul.
		const charge = chargeRelais(creationX({ hashtag: null }), CAMPAGNE) as { content: string };
		expect(charge.content).toContain("Un mois de célébration");
		expect(charge.content).not.toContain("**#**");
	});

	test("le bouton vise la création et se nomme selon la source", () => {
		const bouton = (charge: unknown) =>
			(charge as { components: Array<{ components: Array<Record<string, any>> }> }).components[0]!
				.components[0]!;

		const surX = bouton(chargeRelais(creationX(), CAMPAGNE));
		expect(surX.style).toBe(5); // 5 = bouton-lien
		expect(surX.url).toBe("https://x.com/yoyo__goat/status/1900000000000000001");
		expect(surX.label).toBe("Voir la publication");

		const surDiscord = bouton(
			chargeRelais(creationX({ source: "discord", lien: "https://discord.com/channels/1/2/3" }), CAMPAGNE)
		);
		expect(surDiscord.label).toBe("Aller au message");
		expect(surDiscord.url).toBe("https://discord.com/channels/1/2/3");
	});
});
