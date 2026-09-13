/**
 * Ce que la LECTURE d'un layout doit garantir, verifie sur le VRAI fichier embarque.
 *
 * Ce fichier couvrait aussi un rendu CSS parallele — ordre de peinture, position absolue, URL de
 * texture, balisage de couleur — qui n'avait plus aucun appelant de production depuis que
 * `nie_formats::menu_layout` (WebAssembly) est devenu le seul a peindre. Les aides et leurs tests
 * sont partis avec lui le 2026-09-13 ; les COMPTES, eux, sont restes, exprimes directement sur
 * `LAYOUT.objects`.
 *
 * Les comptes portent sur `data/mainmenu01.layout.json` et NON sur des valeurs recopiees :
 * si un reexport change le layout, ces tests changent de couleur au lieu de laisser une page
 * fausse passer pour juste.
 */
import { describe, expect, test } from "bun:test";

import { echellePourZone, type LayoutJeu, lireLayout } from "@niers/inacord-ui";

import brut from "./layouts/mainmenu01.layout.json";

const LAYOUT: LayoutJeu = lireLayout(brut);

describe("lireLayout", () => {
	test("accepte le fichier embarque", () => {
		expect(LAYOUT.screen).toBe("mainmenu01");
		expect(LAYOUT.canvas).toEqual({ w: 1280, h: 720 });
		expect(LAYOUT.objects.length).toBe(30);
	});

	test("echoue bruyamment sur une forme cassee", () => {
		// Un `as LayoutJeu` ne verifierait rien : un reexport qui renommerait `objects` rendrait
		// une page vide, sans message, avec un typecheck vert.
		expect(() => lireLayout(null)).toThrow("n'est pas un objet");
		expect(() => lireLayout({ objects: [] })).toThrow("canvas");
		expect(() => lireLayout({ canvas: { w: 1280, h: 720 } })).toThrow("objects");
		expect(() => lireLayout({ canvas: { w: 1280, h: 720 }, objects: [{ name: "x" }] })).toThrow(
			"transformation"
		);
	});

	test("normalise les valeurs texte directes du runtime", () => {
		const layout = lireLayout({
			canvas: { w: 1280, h: 720 },
			objects: [
				{
					name: "runtime_text",
					drawPriority: 0,
					visible: true,
					transform: { x: 0, y: 0, anchorX: 0, anchorY: 0, scaleX: 1, scaleY: 1, rot: 0 },
					text: 42,
				},
			],
		});
		expect(layout.objects[0]?.text).toEqual([{ slot: "runtime", text: "42" }]);
	});
});

describe("ce que l'export de mainmenu01 contient", () => {
	// Ces comptes ne decrivent pas un rendu : ils decrivent la DONNEE. Ils tenaient dans
	// `bilanLayout`, une aide de diagnostic dont le panneau appelant avait disparu ; les exprimer
	// ici les rattache au fichier plutot qu'a une fonction que plus personne n'appelait.
	const visibles = LAYOUT.objects.filter((o) => o.visible);

	test("22 objets visibles sur 30, dont 9 sans preuve de placement", () => {
		expect(visibles.length).toBe(22);
		expect(visibles.filter((o) => o.placementSource === "unresolved").length).toBe(9);
	});

	test("21 sprites, tous sous `dx11/`", () => {
		const sprites = LAYOUT.objects
			.map((o) => o.sprite?.logicalPath)
			.filter((p): p is string => Boolean(p));
		expect(sprites.length).toBe(21);
		expect(sprites.every((p) => p.replace(/^\/*(data\/)?/, "").startsWith("dx11/"))).toBe(true);
	});

	test("aucune fente de texte ne laisse passer de balisage de couleur", () => {
		// Le decoupage vit maintenant dans `nie_formats::menu_layout::colour_spans`, du cote qui
		// PEINT. Ce test garde la mesure amont : sur cet ecran, l'export n'en produit aucun.
		for (const objet of LAYOUT.objects) {
			for (const fente of objet.text ?? []) expect(fente.text).not.toInclude("[C");
		}
	});

	test("le runtime ne garde aucun objet visible sans rien a montrer", () => {
		// Les valeurs directes de `SetText` et `SetObjectNum` sont normalisees a la lecture.
		const muets = visibles.filter(
			(o) =>
				o.placementSource !== "unresolved" &&
				!(o.sprite && o.sprite.w > 0 && o.sprite.h > 0) &&
				!(o.text ?? []).some((t) => t.text.trim() !== "")
		);
		expect(muets).toEqual([]);
	});
});

describe("echellePourZone", () => {
	test("le meme rapport sur les deux axes : le menu ne se deforme pas", () => {
		expect(echellePourZone(2560, 1440, { w: 1280, h: 720 })).toBe(2);
		// Zone plus haute que large : c'est la largeur qui contraint.
		expect(echellePourZone(640, 720, { w: 1280, h: 720 })).toBe(0.5);
		// Zone plus large que haute : c'est la hauteur.
		expect(echellePourZone(2560, 360, { w: 1280, h: 720 })).toBe(0.5);
	});

	test("une zone non mesuree rend 0, pas 1", () => {
		// Distinguer « pas encore mesure » de « mesure a 1 » evite d'afficher une frame a la
		// mauvaise taille avant la premiere mesure.
		expect(echellePourZone(0, 0, { w: 1280, h: 720 })).toBe(0);
		expect(echellePourZone(-10, 100, { w: 1280, h: 720 })).toBe(0);
	});
});
