/**
 * Couverture des vignettes d'épisode.
 *
 * Tout ce qui suit porte sur la MISE EN PAGE, qui est pure : `planifierCarte`
 * prend un {@link Mesureur} en paramètre, donc les positions se vérifient au
 * pixel près sans canvas, sans police et sans réseau. C'est là que vivent les
 * vrais défauts d'une carte — texte qui déborde, badge hors cadre, ellipse
 * manquante, bandes noires conservées.
 */

import { describe, expect, it } from "bun:test";

import {
	CARTE,
	CARTE_HAUTEUR,
	POLICES,
	assainirTexte,
	bornerProgression,
	decouperLignes,
	nomVignette,
	planifierCarte,
	recadrerLetterbox,
	variantesVignette,
	type Mesureur,
} from "./vignette.ts";

/**
 * Mesureur déterministe : dix pixels par caractère, quelle que soit la police.
 *
 * Volontairement simpliste — un test de mise en page vérifie la LOGIQUE de
 * coupe et de placement, pas les chasses d'une police. Celles-ci sont mesurées
 * par le canvas en production, ce qui est justement l'objet de la réécriture.
 */
const MESUREUR: Mesureur = (texte) => texte.length * 10;

const BASE = { image: null, titre: "Un titre", sousTitre: "Saison 1 · E01" };

describe("mise en page du texte", () => {
	it("coupe aux espaces et respecte la largeur", () => {
		const lignes = decouperLignes("un deux trois quatre cinq", 100, POLICES.titre, 3, MESUREUR);
		expect(lignes.length).toBeLessThanOrEqual(3);
		for (const ligne of lignes) expect(MESUREUR(ligne, POLICES.titre)).toBeLessThanOrEqual(100);
	});

	it("coupe de force un mot plus long que la ligne", () => {
		// Le laisser déborder sortirait du cadre, ce qui est pire qu'une césure.
		const lignes = decouperLignes("A".repeat(50), 100, POLICES.titre, 2, MESUREUR);
		expect(lignes.length).toBeGreaterThan(0);
		for (const ligne of lignes) expect(MESUREUR(ligne, POLICES.titre)).toBeLessThanOrEqual(100);
	});

	it("termine par une ellipse quand il reste du texte", () => {
		// Compter les lignes ne suffit pas : arrêté pile au maximum, rien ne
		// distinguerait « ça tombait juste » de « il restait huit mots », et la
		// carte se lirait comme un titre complet.
		const lignes = decouperLignes("un deux trois quatre cinq six", 60, POLICES.titre, 1, MESUREUR);
		expect(lignes).toHaveLength(1);
		expect(lignes[0]!.endsWith("…")).toBe(true);
	});

	it("ne pose pas d'ellipse quand tout tient", () => {
		expect(decouperLignes("court", 400, POLICES.titre, 2, MESUREUR)).toEqual(["court"]);
	});

	it("rend une liste vide sur un texte vide", () => {
		expect(decouperLignes("   ", 200, POLICES.titre, 2, MESUREUR)).toEqual([]);
	});
});

describe("assainissement du texte", () => {
	it("retire les emoji qu'aucune police de la carte ne dessine", () => {
		expect(assainirTexte("Saison 3 · 🇫🇷 VF · 2010")).toBe("Saison 3 · VF · 2010");
		// « ▶️ » est un U+25B6 suivi d'un sélecteur : retirer le seul sélecteur
		// laisserait un « ▶ » tout aussi absent des polices.
		expect(assainirTexte("▶️ Épisode")).toBe("Épisode");
	});

	it("garde l'espace autour d'un séparateur légitime", () => {
		expect(assainirTexte("Saison 3 · E01 · VF · 2010-04-14")).toBe(
			"Saison 3 · E01 · VF · 2010-04-14"
		);
	});

	it("fusionne deux séparateurs devenus voisins", () => {
		expect(assainirTexte("a · 🎬 · b")).toBe("a · b");
	});

	it("ne laisse pas de séparateur en tête ni en queue", () => {
		expect(assainirTexte(" · 🇫🇷 · ")).toBe("");
		expect(assainirTexte("· VF")).toBe("VF");
	});

	it("laisse intactes les ponctuations françaises", () => {
		// « » · — … vivent toutes sous U+2190 et ne doivent pas être emportées.
		expect(assainirTexte("« Duel » — la suite… · fin")).toBe("« Duel » — la suite… · fin");
	});
});

describe("plan de la carte", () => {
	it("garde le badge à l'intérieur du cadre", () => {
		// La largeur est MESURÉE, plus devinée : le badge ne peut plus sortir.
		const plan = planifierCarte({ ...BASE, badge: "S03E01" }, MESUREUR);
		expect(plan.badge).not.toBeNull();
		expect(plan.badge!.zone.x + plan.badge!.zone.largeur).toBeLessThanOrEqual(CARTE.largeur);
		expect(plan.badge!.zone.x).toBeGreaterThanOrEqual(CARTE.marge);
	});

	it("borne même un badge absurdement long", () => {
		const plan = planifierCarte({ ...BASE, badge: "X".repeat(80) }, MESUREUR);
		expect(plan.badge!.zone.x + plan.badge!.zone.largeur).toBeLessThanOrEqual(CARTE.largeur);
	});

	it("remonte le badge quand une barre de progression l'attend", () => {
		// Sans ce décalage, le badge et la barre se chevauchent.
		const sans = planifierCarte({ ...BASE, badge: "E01" }, MESUREUR);
		const avec = planifierCarte({ ...BASE, badge: "E01", progression: 0.5 }, MESUREUR);
		expect(avec.badge!.zone.y).toBeLessThan(sans.badge!.zone.y);
	});

	it("n'affiche aucune barre à progression nulle", () => {
		expect(planifierCarte(BASE, MESUREUR).progression).toBeNull();
		const plan = planifierCarte({ ...BASE, progression: 0.5 }, MESUREUR);
		expect(plan.progression!.remplie.largeur).toBe(
			Math.round((CARTE.largeur - CARTE.marge * 2) / 2)
		);
	});

	it("borne une progression aberrante", () => {
		expect(bornerProgression(-1)).toBe(0);
		expect(bornerProgression(4)).toBe(1);
		expect(bornerProgression(Number.NaN)).toBe(0);
		expect(bornerProgression(undefined)).toBe(0);
		expect(bornerProgression(0.42)).toBe(0.42);
	});

	it("garde la barre remplie dans la piste", () => {
		const plan = planifierCarte({ ...BASE, progression: 4 }, MESUREUR);
		expect(plan.progression!.remplie.largeur).toBeLessThanOrEqual(plan.progression!.piste.largeur);
	});

	it("n'affiche la pastille « vu » que si elle est demandée", () => {
		expect(planifierCarte(BASE, MESUREUR).pastilleVu).toBeNull();
		expect(planifierCarte({ ...BASE, vu: true }, MESUREUR).pastilleVu).not.toBeNull();
	});

	it("ne planifie aucun badge sur un libellé vide ou réduit à un emoji", () => {
		expect(planifierCarte({ ...BASE, badge: "" }, MESUREUR).badge).toBeNull();
		expect(planifierCarte({ ...BASE, badge: "🎬" }, MESUREUR).badge).toBeNull();
	});

	it("tient le titre sur deux lignes au plus", () => {
		const plan = planifierCarte({ ...BASE, titre: "mot ".repeat(60) }, MESUREUR);
		expect(plan.lignesTitre.length).toBeLessThanOrEqual(2);
		expect(plan.lignesTitre.at(-1)!.endsWith("…")).toBe(true);
	});

	it("tient le sous-titre sur une seule ligne", () => {
		const plan = planifierCarte({ ...BASE, sousTitre: "mot ".repeat(60) }, MESUREUR);
		expect(plan.sousTitre.endsWith("…")).toBe(true);
	});

	it("garde une carte de dimensions constantes", () => {
		expect(CARTE_HAUTEUR).toBe(CARTE.hauteurImage + CARTE.hauteurTexte);
		// 16/9 exact : c'est ce qui permet de recadrer sans deformer.
		expect(CARTE.largeur / CARTE.hauteurImage).toBeCloseTo(16 / 9, 5);
	});
});

describe("variantes de vignette", () => {
	it("demande d'abord les variantes réellement en 16/9", () => {
		// `hqdefault` fait 480×360 : l'image y est entourée de bandes noires.
		const variantes = variantesVignette("https://img.youtube.com/vi/sDSCxqzXQxE/hqdefault.jpg");
		expect(variantes[0]).toContain("maxresdefault");
		expect(variantes).toContain("https://img.youtube.com/vi/sDSCxqzXQxE/hqdefault.jpg");
	});

	it("laisse intacte une URL qu'elle ne reconnaît pas", () => {
		// Aucune plateforme n'est supposée : une source inconnue passe telle quelle.
		expect(variantesVignette("https://cdn.exemple.test/img/ep1.jpg")).toEqual([
			"https://cdn.exemple.test/img/ep1.jpg",
		]);
	});
});

describe("recadrage des bandes noires", () => {
	it("recadre une image 4/3 sur sa zone 16/9 centrée", () => {
		// 480×360 → la vraie image fait 480×270, centrée : 45 px de bande en haut.
		expect(recadrerLetterbox(480, 360)).toEqual({ left: 0, top: 45, width: 480, height: 270 });
	});

	it("ne touche pas une image déjà en 16/9", () => {
		expect(recadrerLetterbox(1280, 720)).toBeNull();
		expect(recadrerLetterbox(640, 360)).toBeNull();
	});

	it("ne touche pas une image plus large que 16/9", () => {
		expect(recadrerLetterbox(1000, 300)).toBeNull();
	});

	it("refuse des dimensions absurdes plutôt que de calculer dans le vide", () => {
		expect(recadrerLetterbox(0, 0)).toBeNull();
		expect(recadrerLetterbox(-10, 100)).toBeNull();
	});
});

describe("nom de fichier", () => {
	it("nomme par la sous-entité, pas par la source", () => {
		// Un nom tiré du fichier SOURCE ferait se recouvrir tous les
		// téléchargements d'une même page.
		expect(nomVignette(3, 7)).toBe("episode-s03e07.webp");
		expect(nomVignette(10, 127)).toBe("episode-s10e127.webp");
	});
});
