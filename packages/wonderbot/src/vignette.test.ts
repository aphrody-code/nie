/**
 * Couverture des vignettes d'épisode.
 *
 * Tout ce qui suit porte sur la MISE EN PAGE, qui est pure : le SVG se compare
 * au caractère près, sans `sharp`, sans réseau et sans fichier. C'est là que
 * vivent les vrais défauts d'une carte — texte qui déborde, badge hors cadre,
 * titre non échappé, bandes noires conservées.
 */

import { describe, expect, it } from "bun:test";

import {
	CARTE,
	CARTE_HAUTEUR,
	assainirTexte,
	bornerProgression,
	decouperLignes,
	echapperXml,
	largeurApprochee,
	nomVignette,
	recadrerLetterbox,
	svgCarte,
	svgMasqueImage,
	variantesVignette,
} from "./vignette.ts";

const BASE = { image: null, titre: "Un titre", sousTitre: "Saison 1 · E01" };

describe("échappement XML", () => {
	it("échappe ce qui casserait le SVG", () => {
		// Une seule esperluette non échappée rend le document invalide, et le
		// rastériseur ne produit RIEN — pas une carte dégradée, rien.
		expect(echapperXml(`Tom & Jerry <b> "x" 'y'`)).toBe(
			"Tom &amp; Jerry &lt;b&gt; &quot;x&quot; &apos;y&apos;"
		);
	});

	it("échappe les titres réels du catalogue dans la carte", () => {
		const svg = svgCarte({ ...BASE, titre: `L'Académie & le "Onze" <Suprême>` });
		expect(svg).toContain("&amp;");
		expect(svg).toContain("&apos;");
		expect(svg).not.toMatch(/<text[^>]*>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/);
	});
});

describe("mise en page du texte", () => {
	it("mesure plus large les capitales et les chiffres", () => {
		// Les sous-estimer faisait déborder le badge « S03E01 » hors du cadre.
		expect(largeurApprochee("S03E01", 20)).toBeGreaterThan(largeurApprochee("aaaaaa", 20));
		expect(largeurApprochee("iiii", 20)).toBeLessThan(largeurApprochee("MMMM", 20));
		expect(largeurApprochee("", 20)).toBe(0);
	});

	it("compte une chasse pleine pour un idéogramme", () => {
		expect(largeurApprochee("サッカー", 20)).toBe(80);
	});

	it("coupe aux espaces et respecte la largeur", () => {
		const lignes = decouperLignes("un deux trois quatre cinq six sept huit", 200, 20, 3);
		expect(lignes.length).toBeLessThanOrEqual(3);
		for (const ligne of lignes) expect(largeurApprochee(ligne, 20)).toBeLessThanOrEqual(200);
	});

	it("coupe de force un mot plus long que la ligne", () => {
		// Le laisser déborder sortirait du cadre, ce qui est pire qu'une césure.
		const lignes = decouperLignes("A".repeat(200), 100, 20, 2);
		expect(lignes.length).toBeGreaterThan(0);
		for (const ligne of lignes) expect(largeurApprochee(ligne, 20)).toBeLessThanOrEqual(100);
	});

	it("termine par une ellipse quand il reste du texte", () => {
		const lignes = decouperLignes("un deux trois quatre cinq six sept huit neuf dix", 120, 20, 1);
		expect(lignes).toHaveLength(1);
		expect(lignes[0]!.endsWith("…")).toBe(true);
	});

	it("ne pose pas d'ellipse quand tout tient", () => {
		expect(decouperLignes("court", 400, 20, 2)).toEqual(["court"]);
	});

	it("rend une liste vide sur un texte vide", () => {
		expect(decouperLignes("   ", 200, 20, 2)).toEqual([]);
	});
});

describe("assainissement du texte", () => {
	it("retire les emoji que la police ne sait pas dessiner", () => {
		// Un emoji absent de DejaVu Sans sort en rectangle vide — le « tofu ».
		expect(assainirTexte("Saison 3 · 🇫🇷 VF · 2010")).toBe("Saison 3 · VF · 2010");
		expect(assainirTexte("▶️ Épisode")).toBe("Épisode");
	});

	it("garde l'espace autour d'un séparateur légitime", () => {
		// Une première version mangeait l'espace AVANT chaque « · » et écrivait
		// « Saison 3· E01· VF ».
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
});

describe("carte SVG", () => {
	it("annonce les dimensions de la carte", () => {
		const svg = svgCarte(BASE);
		expect(svg).toContain(`width="${CARTE.largeur}"`);
		expect(svg).toContain(`height="${CARTE_HAUTEUR}"`);
		expect(svg.startsWith("<svg")).toBe(true);
		expect(svg.endsWith("</svg>")).toBe(true);
	});

	it("garde le badge à l'intérieur du cadre", () => {
		// Le badge était tronqué à droite : sa boîte est désormais bornée.
		const svg = svgCarte({ ...BASE, badge: "S03E01" });
		for (const trouve of svg.matchAll(/<rect x="(\d+)"[^>]*width="(\d+)"/g)) {
			expect(Number(trouve[1]) + Number(trouve[2])).toBeLessThanOrEqual(CARTE.largeur);
		}
	});

	it("borne même un badge absurdement long", () => {
		const svg = svgCarte({ ...BASE, badge: "X".repeat(80) });
		for (const trouve of svg.matchAll(/<rect x="(\d+)"[^>]*width="(\d+)"/g)) {
			expect(Number(trouve[1]) + Number(trouve[2])).toBeLessThanOrEqual(CARTE.largeur);
		}
	});

	it("n'affiche aucune barre à progression nulle", () => {
		expect(svgCarte(BASE)).not.toContain("#ff0033");
		expect(svgCarte({ ...BASE, progression: 0.5 })).toContain("#ff0033");
	});

	it("borne une progression aberrante", () => {
		expect(bornerProgression(-1)).toBe(0);
		expect(bornerProgression(4)).toBe(1);
		expect(bornerProgression(Number.NaN)).toBe(0);
		expect(bornerProgression(undefined)).toBe(0);
		expect(bornerProgression(0.42)).toBe(0.42);
	});

	it("n'affiche la pastille « vu » que si elle est demandée", () => {
		expect(svgCarte(BASE)).not.toContain(">vu<");
		expect(svgCarte({ ...BASE, vu: true })).toContain(">vu<");
	});

	it("arrondit les coins de l'image, pas ceux du bandeau", () => {
		const masque = svgMasqueImage();
		expect(masque).toContain(`rx="${CARTE.rayon}"`);
		expect(masque).toContain(`height="${CARTE.hauteurImage}"`);
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
