/**
 * Résolution des libellés IEVR — le garde-fou du piège `inagle_skills`.
 *
 * Les valeurs attendues ne sont pas inventées : ce sont celles réellement
 * présentes dans les colonnes texte de la base (relevé du 12/8/2026).
 */
import { describe, expect, test } from "bun:test";

import {
	CATEGORIES_TECHNIQUE_FR,
	ELEMENTS_FR,
	iconeElementUrl,
	normaliserLibelle,
	resoudreCategorieTechnique,
	resoudreElement,
	resoudrePosition,
	resoudreRarete,
	suggerer,
} from "./ievr-labels";

describe("normaliserLibelle", () => {
	test("retire accents, casse et espaces de bord", () => {
		expect(normaliserLibelle("  Forêt ")).toBe("foret");
		expect(normaliserLibelle("DÉFENSE")).toBe("defense");
		expect(normaliserLibelle("Expérimenté")).toBe("experimente");
	});
});

describe("resoudreElement", () => {
	test("rend les cinq valeurs françaises de la colonne `element`", () => {
		expect(ELEMENTS_FR).toEqual(["Feu", "Vent", "Forêt", "Montagne", "Néant"]);
	});

	test("accepte le français tel qu'écrit en base", () => {
		for (const element of ELEMENTS_FR) {
			expect(resoudreElement(element)).toBe(element);
		}
	});

	test("accepte l'anglais de l'API, le japonais et une casse quelconque", () => {
		expect(resoudreElement("Fire")).toBe("Feu");
		expect(resoudreElement("wind")).toBe("Vent");
		expect(resoudreElement("FOREST")).toBe("Forêt");
		expect(resoudreElement("山")).toBe("Montagne");
		expect(resoudreElement("Void")).toBe("Néant");
	});

	test("accepte une saisie sans accent", () => {
		expect(resoudreElement("foret")).toBe("Forêt");
		expect(resoudreElement("neant")).toBe("Néant");
	});

	test("« Aucun » est la seconde écriture du néant en base (9 lignes)", () => {
		expect(resoudreElement("Aucun")).toBe("Néant");
	});

	test("rend null sur une saisie qui ne désigne aucun élément", () => {
		expect(resoudreElement("Ténèbres")).toBeNull();
		expect(resoudreElement("")).toBeNull();
		expect(resoudreElement(undefined)).toBeNull();
	});
});

describe("resoudreCategorieTechnique", () => {
	test("rend les quatre valeurs françaises de la colonne `category`", () => {
		expect(CATEGORIES_TECHNIQUE_FR).toEqual(["Tir", "Dribble", "Défense", "Arrêt"]);
	});

	test("traduit depuis l'anglais et le japonais", () => {
		expect(resoudreCategorieTechnique("shoot")).toBe("Tir");
		expect(resoudreCategorieTechnique("Block")).toBe("Défense");
		expect(resoudreCategorieTechnique("catch")).toBe("Arrêt");
		expect(resoudreCategorieTechnique("ドリブル")).toBe("Dribble");
	});

	test("« arret » sans accent retombe sur « Arrêt »", () => {
		expect(resoudreCategorieTechnique("arret")).toBe("Arrêt");
	});

	test("un identifiant numérique n'est PAS une catégorie", () => {
		// C'est tout l'enjeu : `category_id` est NULL en base, un filtre par id
		// ne renvoie jamais rien. On refuse donc explicitement.
		expect(resoudreCategorieTechnique("1")).toBeNull();
		expect(resoudreCategorieTechnique("shoot_id")).toBeNull();
	});
});

describe("resoudrePosition et resoudreRarete", () => {
	test("les codes du jeu deviennent des postes français", () => {
		expect(resoudrePosition("GK")).toBe("Gardien");
		expect(resoudrePosition("df")).toBe("Défenseur");
		expect(resoudrePosition("MF")).toBe("Milieu");
		expect(resoudrePosition("fw")).toBe("Attaquant");
	});

	test("les raretés collent à `rarity_label`", () => {
		expect(resoudreRarete("Normal")).toBe("Normal");
		expect(resoudreRarete("hero")).toBe("Héros");
		expect(resoudreRarete("basara")).toBe("BASARA");
		expect(resoudreRarete("experimente")).toBe("Expérimenté");
		expect(resoudreRarete("Légendaire")).toBeNull();
	});
});

describe("iconeElementUrl", () => {
	test("rend les webp réellement servis par Azalée", () => {
		expect(iconeElementUrl("Montagne")).toBe(
			"https://azalee.rosegriffon.fr/spirit_type/mountain.webp"
		);
		expect(iconeElementUrl("Fire")).toBe("https://azalee.rosegriffon.fr/spirit_type/fire.webp");
	});

	test("le néant n'a pas d'icône, et une saisie inconnue non plus", () => {
		expect(iconeElementUrl("Néant")).toBeNull();
		expect(iconeElementUrl("Ténèbres")).toBeNull();
		expect(iconeElementUrl(null)).toBeNull();
	});
});

describe("suggerer", () => {
	test("les préfixes passent devant les simples occurrences", () => {
		expect(suggerer(["Renfort", "Forêt", "Force"], "for")).toEqual(["Forêt", "Force", "Renfort"]);
	});

	test("une saisie vide rend le début de la liste", () => {
		expect(suggerer(ELEMENTS_FR, "")).toEqual([...ELEMENTS_FR]);
	});

	test("plafonne à 25 propositions, la limite de Discord", () => {
		const valeurs = Array.from({ length: 60 }, (_, i) => `technique-${i}`);
		expect(suggerer(valeurs, "technique")).toHaveLength(25);
	});

	test("ignore les accents dans la saisie", () => {
		expect(suggerer(CATEGORIES_TECHNIQUE_FR, "defense")).toEqual(["Défense"]);
	});
});
