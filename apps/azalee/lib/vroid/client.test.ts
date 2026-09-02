/// <reference types="bun" />
/**
 * Vérifie les deux normalisations que le client applique aux réponses de
 * VRoid Hub, et qui viennent toutes deux d'écarts **mesurés** entre la doc et
 * l'API réelle (appels du 2026-09-02) :
 *
 *  1. `/api/staff_picks` renvoie un enrobage `{ id, created_at,
 *     character_model }` là où la doc annonce `CharacterModelSerializer[]`,
 *     alors que `/api/search/character_models` renvoie bien les modèles à plat ;
 *  2. le lien de page suivante de la recherche porte **plusieurs**
 *     `search_after[]` et se termine par un `&` orphelin.
 */
import { describe, expect, test } from "bun:test";
import { curseurSuivant, deballerModeles } from "./client";
import type { ModeleVroid, ReponseVroid } from "./types";

/** Modèle minimal : seul `id` est lu par `deballerModeles`. */
function modele(id: string): ModeleVroid {
	return { id } as ModeleVroid;
}

describe("deballerModeles", () => {
	test("accepte la forme plate de la recherche", () => {
		expect(deballerModeles([modele("1"), modele("2")]).map((m) => m.id)).toEqual(["1", "2"]);
	});

	test("déballe la forme enrobée de staff_picks et hearts", () => {
		const data = [
			{ id: "enrobage-a", created_at: "2026-08-25T08:18:35.000+09:00", character_model: modele("1") },
			{ id: "enrobage-b", created_at: "2026-08-25T08:18:36.000+09:00", character_model: modele("2") },
		];
		// L'identifiant retenu est celui du MODÈLE, pas celui de l'enrobage :
		// c'est lui qui adresse `/api/character_models/{id}`.
		expect(deballerModeles(data).map((m) => m.id)).toEqual(["1", "2"]);
	});

	test("tolère un mélange des deux formes", () => {
		const data = [modele("1"), { id: "e", created_at: "", character_model: modele("2") }];
		expect(deballerModeles(data).map((m) => m.id)).toEqual(["1", "2"]);
	});

	test("écarte les entrées sans identifiant plutôt que de les rendre", () => {
		expect(deballerModeles([modele(""), modele("3")]).map((m) => m.id)).toEqual(["3"]);
	});

	test("rend un tableau vide quand `data` n'en est pas un", () => {
		expect(deballerModeles(null)).toEqual([]);
		expect(deballerModeles(undefined)).toEqual([]);
	});
});

describe("curseurSuivant", () => {
	test("rend la chaîne de requête d'une liste paginée par max_id", () => {
		const reponse: ReponseVroid<unknown> = {
			data: null,
			_links: { next: { href: "/api/staff_picks?count=2&max_id=12922238" } },
		};
		expect(curseurSuivant(reponse)).toBe("count=2&max_id=12922238");
	});

	test("préserve les deux search_after[] de la recherche et coupe le & orphelin", () => {
		const reponse: ReponseVroid<unknown> = {
			data: null,
			_links: {
				next: {
					href: "/api/search/character_models?count=3&keyword=soccer&search_after[]=11.53335&search_after[]=1954231&",
				},
			},
		};
		const curseur = curseurSuivant(reponse);
		// Un curseur scalaire (`max_id`) perdrait la seconde borne et ferait
		// boucler la pagination sur la même page.
		expect(curseur).toBe("count=3&keyword=soccer&search_after[]=11.53335&search_after[]=1954231");
		expect(new URLSearchParams(curseur ?? "").getAll("search_after[]")).toEqual(["11.53335", "1954231"]);
	});

	test("rend null sur la dernière page", () => {
		expect(curseurSuivant({ data: null })).toBeNull();
		expect(curseurSuivant({ data: null, _links: {} })).toBeNull();
		expect(curseurSuivant({ data: null, _links: { next: { href: "/api/staff_picks" } } })).toBeNull();
	});
});
