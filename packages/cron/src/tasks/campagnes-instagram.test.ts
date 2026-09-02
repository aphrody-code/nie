/**
 * Tests de la décision de modération de `campagnes:instagram`.
 *
 * C'est la seule partie de la tâche qui peut faire du DÉGÂT, et elle en ferait
 * en silence :
 *   * prendre une panne de Meta pour une suppression viderait la galerie
 *     entière en une passe, sans qu'aucune interface ne dise pourquoi ;
 *   * défaire un masquage humain remettrait en ligne une création que l'équipe
 *     vient de retirer, et le modérateur ne le saurait qu'en repassant dessus.
 *
 * Ces deux fautes sont indétectables à la lecture des logs : d'où des tests.
 */

import { describe, expect, test } from "bun:test";

import { decisionModeration, MOTIF_AUTOMATIQUE } from "./campagnes-instagram";

/** Une ligne jamais touchée par la modération. */
const LIBRE = { masque: false, motif_masquage: null };
/** Une ligne masquée par une PASSE PRÉCÉDENTE de cette même tâche. */
const MASQUEE_AUTO = { masque: true, motif_masquage: MOTIF_AUTOMATIQUE };
/** Une ligne masquée par un humain, avec son motif à lui. */
const MASQUEE_STAFF = { masque: true, motif_masquage: "hors sujet, signalé en réunion" };

describe("une panne de Meta ne retire rien", () => {
	test("`indeterminee` ne masque ni ne restaure, quel que soit l'état", () => {
		// 5xx, quota, réseau coupé : notre vérification est en panne, pas la
		// publication du membre. Ne rien faire est la SEULE réponse correcte.
		for (const ligne of [LIBRE, MASQUEE_AUTO, MASQUEE_STAFF]) {
			expect(decisionModeration("indeterminee", ligne)).toBe("rien");
		}
	});
});

describe("publication disparue", () => {
	test("une création encore visible est masquée", () => {
		expect(decisionModeration("introuvable", LIBRE)).toBe("masquer");
	});

	test("une création DÉJÀ masquée n'est pas re-masquée", () => {
		// Réécrire le masquage écraserait le motif du modérateur par un motif
		// générique, et effacerait la trace de sa décision.
		expect(decisionModeration("introuvable", MASQUEE_STAFF)).toBe("rien");
		expect(decisionModeration("introuvable", MASQUEE_AUTO)).toBe("rien");
	});
});

describe("publication de retour", () => {
	test("ce que CETTE tâche a masqué, elle le restaure", () => {
		// L'auteur a remis son compte en public : il n'a pas à écrire à l'équipe
		// pour retrouver sa place dans la galerie.
		expect(decisionModeration("publique", MASQUEE_AUTO)).toBe("restaurer");
	});

	test("UNE DÉCISION HUMAINE N'EST JAMAIS DÉFAITE", () => {
		// Le cas qui compte : la création est bien en ligne chez Instagram, mais
		// l'équipe l'a retirée du site pour une raison qui n'a rien à voir. Un
		// 200 de Meta ne doit pas la republier.
		expect(decisionModeration("publique", MASQUEE_STAFF)).toBe("rien");
	});

	test("une création en ligne et non masquée n'appelle aucune action", () => {
		expect(decisionModeration("publique", LIBRE)).toBe("rien");
	});
});

describe("le motif automatique est une SIGNATURE", () => {
	test("il distingue le masquage du cron de celui d'un humain", () => {
		// Toute la règle « on ne défait pas une décision humaine » repose sur
		// l'égalité EXACTE de ce texte. Le reformuler sans migrer les lignes
		// existantes les rendrait définitivement non restaurables.
		expect(decisionModeration("publique", { masque: true, motif_masquage: MOTIF_AUTOMATIQUE })).toBe(
			"restaurer"
		);
		expect(
			decisionModeration("publique", { masque: true, motif_masquage: `${MOTIF_AUTOMATIQUE} ` })
		).toBe("rien");
		expect(decisionModeration("publique", { masque: true, motif_masquage: null })).toBe("rien");
	});
});
