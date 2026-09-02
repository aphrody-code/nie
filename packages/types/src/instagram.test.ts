/**
 * Tests des règles Instagram partagées par le site et le cron.
 *
 * DEUX CHOSES SE DÉCIDENT ICI, et les deux échouent en SILENCE si elles se
 * trompent de sens :
 *  1. le SHORTCODE est la clé primaire de `campagne_creations_instagram` — deux
 *     écritures du même post doivent rendre la même clé, sinon un membre qui
 *     redépose son lien depuis un autre appareil crée une seconde carte ;
 *  2. le VERDICT décide si un dépôt est accepté, puis, des heures plus tard, si
 *     la création est retirée de la galerie par le cron. Prendre une panne de
 *     Meta pour un refus viderait la galerie entière sans que personne ne le
 *     sache.
 *
 * ⚠ AUCUNE FIXTURE INVENTÉE : `Db_AxXAlywQ` est le shortcode RÉEL du post
 * d'annonce de la campagne, publié par `@rose_griffonfr`
 * (https://www.instagram.com/rose_griffonfr/p/Db_AxXAlywQ/) ; les réponses
 * oEmbed reproduites sont celles observées le 13/8/2026 sur
 * `graph.facebook.com/v23.0/instagram_oembed`.
 */

import { describe, expect, test } from "bun:test";

import {
	analyserPermalien,
	hashtagDansLegende,
	normaliserPseudo,
	permalienCanonique,
	verdictDepuisReponse,
	verifierPublication,
} from "./instagram";

const CODE = "Db_AxXAlywQ";
const CANONIQUE = `https://www.instagram.com/p/${CODE}/`;

describe("formes acceptées d'un permalien", () => {
	test("la forme canonique", () => {
		expect(analyserPermalien(CANONIQUE)).toEqual({
			permalien: CANONIQUE,
			pseudo: null,
			shortcode: CODE,
		});
	});

	test("la forme AVEC le pseudo — celle du post réel de la campagne", () => {
		expect(analyserPermalien(`https://www.instagram.com/rose_griffonfr/p/${CODE}/`)).toEqual({
			permalien: CANONIQUE,
			pseudo: "rose_griffonfr",
			shortcode: CODE,
		});
	});

	test("un reel, une vidéo IGTV", () => {
		expect(analyserPermalien(`https://www.instagram.com/reel/${CODE}/`)?.shortcode).toBe(CODE);
		expect(analyserPermalien(`https://www.instagram.com/tv/${CODE}/`)?.shortcode).toBe(CODE);
	});

	test("sans protocole, sans www, sans barre finale", () => {
		for (const forme of [
			`instagram.com/p/${CODE}`,
			`https://instagram.com/p/${CODE}`,
			`  https://www.instagram.com/p/${CODE}/  `,
		]) {
			expect(analyserPermalien(forme)?.shortcode).toBe(CODE);
		}
	});

	test("le jeton de traçage `igsh` est RETIRÉ du permalien conservé", () => {
		// Il identifie le partageur, pas la publication : le garder stockerait une
		// donnée de pistage, et deux membres partageant le même post créeraient
		// deux lignes au lieu d'une.
		const r = analyserPermalien(`https://www.instagram.com/p/${CODE}/?igsh=MzRlODBiNWFlZA%3D%3D`);
		expect(r?.permalien).toBe(CANONIQUE);
		expect(r?.permalien).not.toContain("igsh");
	});

	test("deux écritures du même post donnent le MÊME permalien canonique", () => {
		const a = analyserPermalien(`https://www.instagram.com/rose_griffonfr/p/${CODE}/?igsh=abc`);
		const b = analyserPermalien(`instagram.com/p/${CODE}`);
		expect(a?.permalien).toBe(b?.permalien!);
		expect(a?.shortcode).toBe(b?.shortcode!);
	});

	test("le permalien reconstruit depuis le shortcode est celui de l'analyse", () => {
		// Le cron revalide depuis la COLONNE `shortcode` quand `permalink` est
		// douteux : les deux chemins doivent interroger Meta sur la même URL,
		// sinon un lien accepté au dépôt deviendrait « introuvable » le lendemain.
		expect(permalienCanonique(CODE)).toBe(analyserPermalien(CANONIQUE)!.permalien);
	});
});

describe("ce qui est refusé", () => {
	test("un profil n'est pas une publication", () => {
		expect(analyserPermalien("https://www.instagram.com/rose_griffonfr/")).toBeNull();
	});

	test("un autre domaine, même s'il contient le mot instagram", () => {
		expect(analyserPermalien(`https://instagram.com.pirate.example/p/${CODE}/`)).toBeNull();
		expect(analyserPermalien(`https://x.com/p/${CODE}/`)).toBeNull();
	});

	test("un shortcode absent ou hors gabarit", () => {
		expect(analyserPermalien("https://www.instagram.com/p/")).toBeNull();
		expect(analyserPermalien("https://www.instagram.com/p/ab/")).toBeNull(); // trop court
		expect(analyserPermalien("https://www.instagram.com/p/" + "a".repeat(40))).toBeNull();
		expect(analyserPermalien("https://www.instagram.com/p/avec espace/")).toBeNull();
	});

	test("du texte quelconque, du vide", () => {
		expect(analyserPermalien("mon dessin")).toBeNull();
		expect(analyserPermalien("")).toBeNull();
		expect(analyserPermalien("   ")).toBeNull();
	});
});

describe("normalisation du pseudo", () => {
	test("les trois écritures d'un même compte convergent", () => {
		for (const forme of [
			"rose_griffonfr",
			"@rose_griffonfr",
			"https://www.instagram.com/rose_griffonfr/",
			"  @rose_griffonfr  ",
		]) {
			expect(normaliserPseudo(forme)).toBe("rose_griffonfr");
		}
	});

	test("un pseudo impossible rend null plutôt qu'un pseudo faux", () => {
		// La galerie sait afficher « auteur inconnu » ; elle ne sait pas rattraper
		// une attribution erronée.
		expect(normaliserPseudo("")).toBeNull();
		expect(normaliserPseudo("a b c")).toBeNull();
		expect(normaliserPseudo("é".repeat(5))).toBeNull();
		expect(normaliserPseudo(null)).toBeNull();
		expect(normaliserPseudo(undefined)).toBeNull();
	});
});

describe("hashtag dans la légende", () => {
	const HASHTAGS = ["iergday", "inazumargday"];

	test("la graphie exacte apparie", () => {
		expect(hashtagDansLegende("Mon OC #IERGDay !", HASHTAGS)).toBe("iergday");
	});

	test("la casse et le tiret bas ne comptent pas", () => {
		expect(hashtagDansLegende("#IERG_DAY", HASHTAGS)).toBe("iergday");
	});

	test("un hashtag étranger n'apparie pas", () => {
		expect(hashtagDansLegende("#InazumaEleven #fanart", HASHTAGS)).toBeNull();
	});

	test("une légende vide ou sans hashtag n'apparie rien", () => {
		// Le dépôt reste possible sans hashtag — le rattachement vient alors du
		// formulaire lui-même, exactement comme un dépôt dans le salon Discord.
		expect(hashtagDansLegende("Voici mon OC", HASHTAGS)).toBeNull();
		expect(hashtagDansLegende("", HASHTAGS)).toBeNull();
	});
});

/** La réponse réelle de Meta sur un shortcode qui n'existe pas. */
const MEDIA_INTROUVABLE = {
	error: {
		code: 24,
		error_subcode: 2207045,
		message: "Media Not Found",
		type: "OAuthException",
	},
};

describe("publication vérifiée", () => {
	test("un 200 vaut « publique »", () => {
		const r = verdictDepuisReponse(200, { provider_name: "Instagram", type: "rich" });
		expect(r.verdict).toBe("publique");
	});
});

describe("publication refusée", () => {
	test("le code 24 de Meta = introuvable, supprimée ou compte privé", () => {
		const r = verdictDepuisReponse(400, MEDIA_INTROUVABLE);
		expect(r.verdict).toBe("introuvable");
		// Le message parle au déposant, jamais en jargon d'API : « code 24 » ne lui
		// dit pas quoi faire, « ton compte est peut-être en privé » si.
		expect(r.message).toContain("privé");
		expect(r.message).not.toContain("24");
	});

	test("un 400 sans code Meta reste un refus", () => {
		expect(verdictDepuisReponse(400, {}).verdict).toBe("introuvable");
		expect(verdictDepuisReponse(404, null).verdict).toBe("introuvable");
	});
});

describe("vérification impossible", () => {
	test("UNE PANNE DE META N'EST PAS UN REFUS", () => {
		// Refuser une création parce que NOTRE vérification est en panne ferait
		// payer au participant une panne qui n'est pas la sienne. Le dépôt passe,
		// et le staff tranche depuis son salon de suivi. Côté cron, c'est ce qui
		// empêche une coupure de Meta de masquer toute la galerie d'un coup.
		for (const statut of [500, 502, 503, 429]) {
			expect(verdictDepuisReponse(statut, null).verdict).toBe("indeterminee");
		}
	});

	test("un corps illisible ne fait pas basculer le verdict", () => {
		expect(verdictDepuisReponse(500, "pas du json").verdict).toBe("indeterminee");
		expect(verdictDepuisReponse(200, undefined).verdict).toBe("publique");
	});

	test("le message d'attente promet une vérification humaine, pas un succès", () => {
		const r = verdictDepuisReponse(503, null);
		expect(r.message).toContain("équipe");
	});
});

describe("l'appel réseau, contre un bouchon local", () => {
	/** Sert un statut et un corps fixes — aucun appel ne sort de la machine. */
	async function avecBouchon<T>(
		statut: number,
		corps: unknown,
		faire: (base: string, vues: URL[]) => Promise<T>
	): Promise<T> {
		const vues: URL[] = [];
		const serveur = Bun.serve({
			port: 0,
			fetch(req) {
				vues.push(new URL(req.url));
				return new Response(JSON.stringify(corps), {
					headers: { "content-type": "application/json" },
					status: statut,
				});
			},
		});
		try {
			return await faire(`http://127.0.0.1:${serveur.port}/oembed`, vues);
		} finally {
			await serveur.stop(true);
		}
	}

	test("le permalien et `omitscript` partent bien dans la requête", async () => {
		// `omitscript` évite que Meta nous rende un `<script>` tiers ; l'oublier
		// ferait grossir la réponse pour rien, et tenterait de l'embarquer un jour.
		const vues = await avecBouchon(200, { type: "rich" }, async (base, vues) => {
			const r = await verifierPublication(CANONIQUE, { base });
			expect(r.verdict).toBe("publique");
			return vues;
		});
		expect(vues[0]?.searchParams.get("url")).toBe(CANONIQUE);
		expect(vues[0]?.searchParams.get("omitscript")).toBe("true");
	});

	test("un 400 code 24 remonte « introuvable »", async () => {
		const r = await avecBouchon(400, MEDIA_INTROUVABLE, (base) =>
			verifierPublication(CANONIQUE, { base })
		);
		expect(r.verdict).toBe("introuvable");
	});

	test("un point d'entrée injoignable ne LÈVE PAS, il rend « indeterminee »", async () => {
		// Les deux appelants comptent là-dessus : une exception ferait échouer le
		// dépôt d'un membre, ou interromprait la passe de revalidation entière.
		const r = await verifierPublication(CANONIQUE, {
			base: "http://127.0.0.1:1/oembed",
			delaiMs: 500,
		});
		expect(r.verdict).toBe("indeterminee");
	});
});
