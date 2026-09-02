import { describe, expect, test } from "bun:test";
import { decoder, encoder, longueurCode, verifierSpec } from "@/app/avatar/partage";
import type { SpecPartage } from "@/app/avatar/partage";

/** Une spécification minuscule mais conforme, pour exercer le codec sans dépendre du catalogue. */
function specJouet(): SpecPartage {
	const alphabet = Array.from({ length: 64 }, (_, i) => String.fromCodePoint(48 + i));
	return {
		alphabet,
		bits: 12,
		emplacements: [
			{ bits: 1, categorie: 0, emplacement: 0, param: 0, paramSub: 0, valeurs: 2 },
			{ bits: 4, categorie: 1, emplacement: 1, param: 0, paramSub: 0, valeurs: 13 },
			{ bits: 3, categorie: 2, emplacement: 2, param: 0, paramSub: 0, valeurs: 8 },
			{ bits: 4, categorie: 3, emplacement: 3, param: 0, paramSub: 0, valeurs: 15 },
		],
	};
}

describe("code de partage", () => {
	test("une spécification cohérente est acceptée", () => {
		expect(verifierSpec(specJouet())).toBeNull();
	});

	test("une somme de bits fausse est refusée", () => {
		const s = specJouet();
		s.bits = 13;
		expect(verifierSpec(s)).toContain("bits");
	});

	test("un emplacement qui déborde ses bits est refusé", () => {
		const s = specJouet();
		s.emplacements[0]!.valeurs = 5; // 5 valeurs ne tiennent pas sur 1 bit
		expect(verifierSpec(s)).toContain("valeurs");
	});

	test("l'aller-retour rend les valeurs d'origine", () => {
		const s = specJouet();
		const v = [1, 12, 7, 14];
		expect(decoder(s, encoder(s, v))).toEqual(v);
	});

	test("les valeurs limites survivent à l'aller-retour", () => {
		const s = specJouet();
		for (const v of [
			[0, 0, 0, 0],
			[1, 12, 7, 14],
			[0, 12, 0, 14],
		]) {
			expect(decoder(s, encoder(s, v))).toEqual(v);
		}
	});

	test("une valeur hors bornes est ramenée dans les bornes", () => {
		const s = specJouet();
		// 99 dépasse les 13 valeurs admises : le code doit rester valide, borné à 12.
		expect(decoder(s, encoder(s, [0, 99, 0, 0]))).toEqual([0, 12, 0, 0]);
	});

	test("un caractère étranger à l'alphabet est refusé", () => {
		expect(decoder(specJouet(), "««««")).toBeNull();
	});

	test("un code trop court est refusé plutôt qu'interprété", () => {
		expect(decoder(specJouet(), "0")).toBeNull();
	});

	test("la longueur du code suit le nombre de bits", () => {
		expect(longueurCode(specJouet())).toBe(2); // 12 bits / 6
		expect(longueurCode({ ...specJouet(), bits: 410 })).toBe(69);
	});
});

describe("rangement des choix", () => {
	test("un aller-retour rétablit genre, morphologie et parts", () => {
		const cat = {
			categories: [
				{ faceSettingType: 1, parts: [{ id: "A" }, { id: "B" }, { id: "C" }] },
				{ faceSettingType: 4, parts: [{ id: "X" }, { id: "Y" }] },
			],
		} as never as import("@/app/avatar/types").Catalogue;
		const spec: SpecPartage = {
			alphabet: Array.from({ length: 64 }, (_, i) => String.fromCodePoint(48 + i)),
			bits: 24,
			emplacements: Array.from({ length: 4 }, (_, i) => ({
				bits: 6,
				categorie: i,
				emplacement: i,
				param: 0,
				paramSub: 0,
				valeurs: 64,
			})),
		};
		const { valeursDepuisChoix, choixDepuisValeurs } = require("@/app/avatar/partage");
		const v = valeursDepuisChoix(cat, spec, { 1: "C", 4: "Y" }, 1, 5);
		const rendu = choixDepuisValeurs(cat, decoder(spec, encoder(spec, v))!);
		expect(rendu.genre).toBe(1);
		expect(rendu.morphologie).toBe(5);
		expect(rendu.choix).toEqual({ 1: "C", 4: "Y" });
	});
});
