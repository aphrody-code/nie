/**
 * Tests de la façade.
 *
 * Deux natures, séparées volontairement :
 *
 * * ce qui doit tenir **partout** — la résolution des sources, la tolérance à l'absence d'un
 *   gisement, la forme des jointures ;
 * * ce qui n'a de sens que sur une machine **peuplée** — les jointures réelles. Ces cas se
 *   sautent en l'annonçant, plutôt que de passer en vert sans rien avoir vérifié : un test muet
 *   qui ne s'exécute pas est un faux vert, et le dépôt en a déjà payé le prix sur ses goldens.
 */
import { describe, expect, test } from "bun:test";
import { catalogue, etat } from "./index.ts";
import { racineDepot, sources } from "./sources.ts";
import { chercher, film, personnage } from "./synergie.ts";

describe("sources", () => {
	test("la racine du dépôt porte Cargo.toml et crates/", () => {
		const racine = racineDepot(import.meta.dir);
		expect(racine).toBeTruthy();
		expect(Bun.file(`${racine}/Cargo.toml`).size).toBeGreaterThan(0);
	});

	test("les quatre gisements sont annoncés, présents ou non", () => {
		const s = sources();
		expect(Object.keys(s).toSorted()).toEqual(["anime", "extrait", "jeu", "racine", "re"]);
		// Le jeu est une URL : il se résout toujours, même sans réseau.
		expect(s.jeu.emplacement).toStartWith("http");
	});

	test("une source absente porte la trace de ce qui a été essayé", () => {
		const s = sources();
		for (const gisement of [s.extrait, s.re, s.anime]) {
			if (gisement.emplacement === null) {
				expect(gisement.essais.length).toBeGreaterThan(0);
			}
		}
	});
});

describe("état", () => {
	test("chaque gisement dit s'il est peuplé, pas seulement présent", () => {
		const gisements = etat();
		expect(gisements.map((g) => g.nom)).toEqual(["jeu", "extrait", "re", "anime"]);
		for (const g of gisements) {
			expect(typeof g.disponible).toBe("boolean");
			expect(g.contenu.length).toBeGreaterThan(0);
		}
	});
});

describe("tolérance à l'absence", () => {
	test("une recherche rend les quatre listes, même vides", () => {
		const r = chercher("xyzzy-qui-n-existe-nulle-part");
		expect(r.personnages).toEqual([]);
		expect(r.episodes).toEqual([]);
		expect(r.fichiers).toEqual([]);
		expect(Array.isArray(r.fonctions)).toBe(true);
	});

	test("un personnage inconnu rend null, pas une exception", () => {
		expect(personnage("ce-slug-n-existe-pas")).toBeNull();
	});

	test("une cinématique sans événement rend un lien vide, pas un échec", () => {
		const f = film("L5logo");
		expect(f.evenement.valeur).toBeNull();
		expect(f.video).toContain("L5logo");
		expect(f.bandeSon).toContain("track=audio");
	});
});

describe("jointures réelles", () => {
	const gisements = new Map(etat().map((g) => [g.nom, g.disponible]));

	test.skipIf(!gisements.get("extrait"))(
		"un personnage réunit sa fiche, son code et sa série",
		() => {
			const p = personnage("mark-evans-0x06E25622");
			expect(p).not.toBeNull();
			expect(p?.fiche.internal_code).toBe("c11901150");
			// La charnière est le code interne, et elle est annoncée comme telle.
			expect(p?.fichiers.par).toBe("c11901150");
			expect(p?.fichiers.confiance).toBe("prefixe");
			// Le rapprochement avec la série est textuel : il ne se présente jamais comme une clé.
			expect(p?.episodes.confiance).toBe("texte");
		},
	);

	test.skipIf(!gisements.get("extrait"))(
		"une cinématique d'événement retrouve ses répliques par une vraie clé",
		() => {
			const f = film("ev01_00050");
			expect(f.evenement.confiance).toBe("cle");
			expect(f.evenement.valeur).not.toBeNull();
			expect(f.repliques.valeur.length).toBeGreaterThan(0);
		},
	);

	test.skipIf(!gisements.get("anime"))("la série répond par titre français", () => {
		const episodes = catalogue.anime.chercherEpisodes("football", 5);
		expect(episodes.length).toBeGreaterThan(0);
		expect(episodes[0]?.season).toBeGreaterThan(0);
	});

	test.skipIf(!gisements.get("re"))("le reverse cite le binaire de référence", () => {
		const c = catalogue.re.couverture();
		expect(c).not.toBeNull();
		expect(c?.total_funcs).toBeGreaterThan(10_000);
	});
});

describe("URL du jeu", () => {
	test("une texture perd son .g4tx — le garder donne un 404", () => {
		expect(catalogue.jeu.urlTexture("data/dx11/chr/x.g4tx")).toEndWith("/tex/data/dx11/chr/x.png");
	});

	test("un export nomme la sous-entité, sinon tous se recouvrent", () => {
		const url = catalogue.jeu.urlExport("data/common/a.acb", "wav", 12);
		expect(url).toContain("format=wav");
		expect(url).toContain("id=12");
	});
});
