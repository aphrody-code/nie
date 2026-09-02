/**
 * Couverture de la trousse de présentation.
 *
 * Ce qui est vérifié ici est exactement ce qui, sinon, ne se voit qu'en
 * cliquant dans Discord : le bornage aux limites DURES de l'API (un dépassement
 * fait refuser le message ENTIER), la forme du pied de page, la grammaire des
 * identifiants de bouton et le dessin de la rangée de pagination.
 */
import { describe, expect, test } from "bun:test";

import {
	BUDGET_EMBED,
	COULEURS,
	Fiche,
	LIMITES,
	MARQUE,
	borner,
	bornerPage,
	cle,
	compte,
	creerEmbed,
	decoderEtat,
	decouper,
	echapper,
	encoderEtat,
	entierLisible,
	estEtatDe,
	fiche,
	formaterDuree,
	formaterLatence,
	formaterNombre,
	formaterOctets,
	ilYA,
	joindre,
	MAX_CUSTOM_ID,
	nombreDePages,
	pageDecodee,
	pied,
	pluriel,
	puces,
	rangeePagination,
	tranche,
	urlValide,
} from "./index";

describe("bornage", () => {
	test("laisse un texte court intact", () => {
		expect(borner("court", 10)).toBe("court");
	});

	test("coupe avec une ellipse d'UN caractère, jamais au-delà de la limite", () => {
		const rendu = borner("a".repeat(50), 10);
		expect(rendu).toHaveLength(10);
		expect(rendu.endsWith("…")).toBe(true);
	});

	test("rend une chaîne vide sur une valeur absente", () => {
		expect(borner(null, 10)).toBe("");
		expect(borner(undefined, 10)).toBe("");
	});

	test("échappe le markdown des textes venus de l'extérieur", () => {
		expect(echapper("**gras** [lien](url)")).toBe("\\*\\*gras\\*\\* \\[lien\\]\\(url\\)");
	});

	test("joindre ignore les morceaux vides", () => {
		expect(joindre(["a", null, "", "  ", "b"])).toBe("a · b");
	});

	test("cle rend une chaîne vide quand la valeur manque", () => {
		expect(cle("Niveau", null)).toBe("");
		expect(cle("Niveau", 99)).toBe("**Niveau** 99");
	});

	test("puces borne chaque entrée", () => {
		expect(puces(["a", null, "b"])).toBe("- a\n- b");
		expect(puces(["x".repeat(30)], 10)).toHaveLength(12); // "- " + 10
	});
});

describe("découpe en champs", () => {
	test("coupe sur les sauts de ligne, jamais au milieu d'une ligne courte", () => {
		const texte = Array.from({ length: 10 }, (_, i) => `ligne ${i} ${"x".repeat(100)}`).join("\n");
		const morceaux = decouper(texte, 300, 5);
		expect(morceaux.length).toBeGreaterThan(1);
		for (const morceau of morceaux) {
			expect(morceau.length).toBeLessThanOrEqual(300);
		}
	});

	test("respecte le nombre maximal de champs", () => {
		const texte = Array.from({ length: 40 }, () => "x".repeat(90)).join("\n");
		expect(decouper(texte, 100, 3)).toHaveLength(3);
	});
});

describe("embed", () => {
	test("porte la couleur de marque du profil actif", () => {
		expect(creerEmbed().toJSON().color).toBe(COULEURS.marque);
	});

	test("préfixe le titre de l'icône d'intention", () => {
		expect(creerEmbed({ intention: "succes", titre: "Fait" }).toJSON().title).toBe("✅ Fait");
	});

	test("accepte une icône nommée du lexique", () => {
		expect(creerEmbed({ icone: "agenda", titre: "Semaine" }).toJSON().title).toBe("📅 Semaine");
	});

	test("borne le titre à la limite de l'API", () => {
		const titre = creerEmbed({ titre: "t".repeat(500) }).toJSON().title ?? "";
		expect(titre.length).toBeLessThanOrEqual(LIMITES.titre);
	});

	test("ignore une URL invalide au lieu de lever", () => {
		expect(() => creerEmbed({ titre: "x", url: "pas une url" })).not.toThrow();
		expect(creerEmbed({ titre: "x", url: "pas une url" }).toJSON().url).toBeUndefined();
		expect(urlValide("https://rosegriffon.fr")).toBe(true);
		expect(urlValide("javascript:alert(1)")).toBe(false);
	});

	test("horodate par défaut, et pas quand on le refuse", () => {
		expect(creerEmbed().toJSON().timestamp).toBeDefined();
		expect(creerEmbed({ horodater: false }).toJSON().timestamp).toBeUndefined();
	});
});

describe("pied de page", () => {
	test("porte toujours la marque et son domaine", () => {
		const rendu = pied(creerEmbed()).toJSON().footer;
		expect(rendu?.text).toBe(`${MARQUE.nom} · ${MARQUE.domaine}`);
		expect(rendu?.icon_url).toBe(MARQUE.icone);
	});

	test("compose note, position et marque dans cet ordre", () => {
		const rendu = pied(creerEmbed(), { note: "/agenda semaine", page: 2, pages: 5 }).toJSON().footer
			?.text;
		expect(rendu).toBe(`/agenda semaine · page 2/5 · ${MARQUE.nom} · ${MARQUE.domaine}`);
	});

	test("tait la position sur une liste d'une seule page", () => {
		const rendu = pied(creerEmbed(), { page: 1, pages: 1 }).toJSON().footer?.text;
		expect(rendu).not.toContain("page");
	});
});

describe("Fiche : le budget est tenu à l'ajout", () => {
	test("empile les champs tant qu'ils rentrent", () => {
		const f = fiche({ titre: "Test" }).champ("A", "1").champ("B", "2", { enLigne: true });
		expect(f.embed.toJSON().fields).toHaveLength(2);
		expect(f.tronquee).toBe(false);
	});

	test("ignore un champ vide sans le signaler comme tronqué", () => {
		const f = fiche().champ("Vide", "   ");
		expect(f.embed.toJSON().fields ?? []).toHaveLength(0);
		expect(f.tronquee).toBe(false);
	});

	test("refuse au-delà de 25 champs et le dit", () => {
		const f = new Fiche();
		for (let i = 0; i < 30; i++) {
			f.champ(`C${i}`, "x");
		}
		expect(f.embed.toJSON().fields).toHaveLength(LIMITES.champs);
		expect(f.tronquee).toBe(true);
	});

	test("ne dépasse JAMAIS le budget total, même à coups de champs pleins", () => {
		const f = new Fiche({ titre: "T".repeat(200), description: "D".repeat(2000) });
		for (let i = 0; i < 25; i++) {
			f.champ(`Champ ${i}`, "v".repeat(LIMITES.valeurChamp));
		}
		const rendu = f.finir({ note: "/test" }).toJSON();
		const total =
			(rendu.title?.length ?? 0) +
			(rendu.description?.length ?? 0) +
			(rendu.footer?.text.length ?? 0) +
			(rendu.fields ?? []).reduce((n, champ) => n + champ.name.length + champ.value.length, 0);
		expect(total).toBeLessThanOrEqual(LIMITES.total);
		expect(total).toBeLessThanOrEqual(BUDGET_EMBED + 150);
		expect(f.tronquee).toBe(true);
	});

	test("bloc découpe un texte long en plusieurs champs", () => {
		const texte = Array.from({ length: 60 }, (_, i) => `ligne ${i} ${"y".repeat(60)}`).join("\n");
		const f = new Fiche().bloc("Journal", texte, 3);
		const champs = f.embed.toJSON().fields ?? [];
		expect(champs.length).toBeGreaterThan(1);
		expect(champs[0]?.name).toBe("Journal");
	});
});

describe("chiffres", () => {
	test("entierLisible groupe avec une espace ORDINAIRE (assertable en test)", () => {
		expect(entierLisible(250_800)).toBe("250 800");
		expect(entierLisible(-1234)).toBe("-1 234");
		expect(entierLisible(null)).toBe("—");
	});

	test("formaterNombre suit la locale française", () => {
		expect(formaterNombre(12)).toBe("12");
		expect(formaterNombre(undefined)).toBe("—");
		expect(formaterNombre(1.234, { decimales: 2 })).toBe("1,23");
	});

	test("formaterOctets reste en base 1024", () => {
		expect(formaterOctets(0)).toBe("0 o");
		expect(formaterOctets(1024)).toBe("1,0 Ko");
		expect(formaterOctets(11_494_007)).toBe("11 Mo");
		expect(formaterOctets(-1, "taille inconnue")).toBe("taille inconnue");
	});

	test("latence et durée changent d'unité au bon seuil", () => {
		expect(formaterLatence(999)).toBe("999 ms");
		expect(formaterLatence(1500)).toBe("1,5 s");
		expect(formaterDuree(90_000)).toBe("1 min 30 s");
	});

	test("pluriel et compte s'accordent", () => {
		expect(pluriel(1, "membre")).toBe("membre");
		expect(pluriel(0, "membre")).toBe("membre");
		expect(pluriel(2, "membre")).toBe("membres");
		expect(compte(3, "illustration")).toBe("3 illustrations");
	});
});

describe("pagination : comptage", () => {
	test("il y a toujours au moins une page", () => {
		expect(nombreDePages(0, 10)).toBe(1);
		expect(nombreDePages(-5, 10)).toBe(1);
		expect(nombreDePages(10, 0)).toBe(1);
	});

	test("arrondit au supérieur", () => {
		expect(nombreDePages(21, 10)).toBe(3);
	});

	test("ramène une page hors bornes dans la liste", () => {
		expect(bornerPage(999, 21, 10)).toBe(3);
		expect(bornerPage(0, 21, 10)).toBe(1);
		expect(bornerPage(Number.NaN, 21, 10)).toBe(1);
	});

	test("tranche rend la page demandée", () => {
		const entrees = [1, 2, 3, 4, 5];
		expect(tranche(entrees, 2, 2)).toEqual([3, 4]);
		expect(tranche(entrees, 99, 2)).toEqual([5]);
	});
});

describe("pagination : état porté par le customId", () => {
	test("aller-retour", () => {
		const id = encoderEtat("az", ["galerie", 3, null, "mark"]);
		expect(id).toBe("az|galerie|3||mark");
		expect(decoderEtat("az", id!, 4)).toEqual(["galerie", "3", "", "mark"]);
	});

	test("retire le séparateur des valeurs plutôt que de casser le décodage", () => {
		const id = encoderEtat("tw", ["a|b"])!;
		expect(decoderEtat("tw", id, 1)).toEqual(["a b"]);
	});

	test("rend null au-delà de la limite Discord", () => {
		expect(encoderEtat("az", ["x".repeat(MAX_CUSTOM_ID)])).toBeNull();
	});

	test("refuse un identifiant d'une autre surface ou mal formé", () => {
		expect(decoderEtat("az", "tw|1|2|3|4", 4)).toBeNull();
		expect(decoderEtat("az", "az|1", 4)).toBeNull();
		expect(estEtatDe("az", "az|galerie|1")).toBe(true);
		expect(estEtatDe("az", "azalee|1")).toBe(false);
	});

	test("pageDecodee refuse ce qui n'est pas une page", () => {
		expect(pageDecodee("3")).toBe(3);
		expect(pageDecodee("0")).toBeNull();
		expect(pageDecodee("abc")).toBeNull();
		expect(pageDecodee(undefined)).toBeNull();
	});
});

describe("pagination : boutons", () => {
	const identifiant = (page: number) => encoderEtat("az", ["galerie", page]);

	test("aucune rangée sur une liste d'une seule page", () => {
		expect(rangeePagination({ prefixe: "az", page: 1, pages: 1, identifiant })).toHaveLength(0);
	});

	test("trois composants sous le seuil de sauts", () => {
		const rangees = rangeePagination({ prefixe: "az", page: 2, pages: 3, identifiant });
		const composants = rangees[0]!.toJSON().components;
		expect(composants).toHaveLength(3);
		expect(composants[1]).toMatchObject({ label: "2 / 3", disabled: true });
	});

	test("cinq composants au milieu d'une longue liste", () => {
		const rangees = rangeePagination({ prefixe: "az", page: 10, pages: 20, identifiant });
		const composants = rangees[0]!.toJSON().components;
		expect(composants).toHaveLength(5);
		expect(composants[0]).toMatchObject({ disabled: false });
		expect(composants[4]).toMatchObject({ disabled: false });
	});

	test("aux EXTRÉMITÉS, le saut redondant disparaît — il ferait doublon", () => {
		// ⚠ CE TEST ATTENDAIT 5 COMPOSANTS SUR LA PAGE 1, et validait ainsi le
		// défaut : « ⏮ première » et « ◀ précédente » visent tous deux la page 1,
		// donc portent le MÊME `customId`, et Discord refuse le message entier
		// (400 `COMPONENT_CUSTOM_ID_DUPLICATED`). `/x liste` était cassée en
		// production, sur la première page — celle que tout le monde voit.
		const premiere = rangeePagination({ prefixe: "az", page: 1, pages: 20, identifiant });
		expect(premiere[0]!.toJSON().components).toHaveLength(4);

		const derniere = rangeePagination({ prefixe: "az", page: 20, pages: 20, identifiant });
		expect(derniere[0]!.toJSON().components).toHaveLength(4);
	});

	test("le bouton de lien passe en seconde rangée quand la première est pleine", () => {
		const rangees = rangeePagination({
			prefixe: "az",
			page: 3,
			pages: 20,
			identifiant,
			lien: { libelle: "Ouvrir le wiki", url: "https://azalee.rosegriffon.fr" },
		});
		expect(rangees).toHaveLength(2);
		expect(rangees[1]!.toJSON().components).toHaveLength(1);
	});

	test("aucun bouton si l'état ne tient pas dans un customId", () => {
		const trop = () => "x".repeat(MAX_CUSTOM_ID + 1);
		expect(
			rangeePagination({ prefixe: "az", page: 1, pages: 5, identifiant: () => null })
		).toHaveLength(0);
		expect(trop()).toHaveLength(MAX_CUSTOM_ID + 1);
	});
});

describe("horodatage natif", () => {
	test("rend un jeton Discord recalculé côté client", () => {
		expect(ilYA(new Date(1_700_000_000_000))).toBe("<t:1700000000:R>");
		expect(ilYA(null)).toBe("—");
		expect(ilYA("pas une date")).toBe("—");
	});
});

describe("aucun customId dupliqué dans une rangée", () => {
	/*
	 * Deux boutons d'une même rangée ne peuvent pas partager un `customId` :
	 * Discord refuse alors le message ENTIER (400 `Invalid Form Body`,
	 * `COMPONENT_CUSTOM_ID_DUPLICATED`), embed compris, et le membre ne voit
	 * rien. Constaté en production le 13/8/2026 sur `/x liste`.
	 *
	 * L'identifiant EST l'état : « aller à la page 1 » et « page précédente »
	 * produisent la même chaîne dès que la page précédente est la page 1. La
	 * collision touchait donc les pages 1, 2, N-1 et N — y compris la première,
	 * celle que tout le monde voit.
	 */

	/** Tous les `customId` d'une rangée rendue, à plat. */
	function identifiants(rangees: ReturnType<typeof rangeePagination>): string[] {
		return rangees.flatMap((rangee) =>
			rangee.components.map((bouton) => {
				const donnees = bouton.toJSON() as { custom_id?: string; url?: string };
				return donnees.custom_id ?? donnees.url ?? "";
			})
		);
	}

	test("aucune page d'une liste paginée ne produit de doublon", () => {
		// On balaie toutes les pages de plusieurs tailles de liste, dont celles qui
		// encadrent le seuil d'apparition des sauts.
		for (const pages of [1, 2, 5, 6, 7, 17, 100]) {
			for (let page = 1; page <= pages; page++) {
				const ids = identifiants(
					rangeePagination({
						identifiant: (cible) => encoderEtat("tw", ["liste", cible]),
						page,
						pages,
						prefixe: "tw",
					})
				);
				expect(new Set(ids).size, `pages=${pages} page=${page} → ${ids.join(" ")}`).toBe(
					ids.length
				);
			}
		}
	});

	test("le saut redondant DISPARAÎT au lieu d'être renommé", () => {
		// Sur la page 2, « ⏮ première » mène là où « ◀ précédente » mène déjà :
		// le garder avec un identifiant inerte laisserait un bouton qui ment sur ce
		// qu'il fait.
		const [rangee] = rangeePagination({
			identifiant: (cible) => encoderEtat("tw", ["liste", cible]),
			page: 2,
			pages: 17,
			prefixe: "tw",
		});
		const emojis = rangee!.components.map(
			(b) => (b.toJSON() as { emoji?: { name?: string } }).emoji?.name ?? ""
		);
		expect(emojis).not.toContain("⏮️");
		expect(emojis).toContain("◀️");
		expect(emojis).toContain("⏭️");
	});

	test("au milieu d'une longue liste, les quatre sauts et flèches coexistent", () => {
		const [rangee] = rangeePagination({
			identifiant: (cible) => encoderEtat("tw", ["liste", cible]),
			page: 9,
			pages: 17,
			prefixe: "tw",
		});
		expect(rangee!.components).toHaveLength(5);
	});
});
