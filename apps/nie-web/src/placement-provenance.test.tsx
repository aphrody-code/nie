/**
 * La provenance d'un placement, du côté du LECTEUR.
 *
 * Le garde « un objet non résolu ne se dessine pas » a quitté ce fichier : il vit désormais dans
 * le compositeur lui-même (`nie_formats::menu_layout`, test
 * `an_unresolved_placement_is_never_painted`), qui est le seul à dessiner depuis que le rendu DOM
 * parallèle a disparu. Ce qui reste ici est ce que le navigateur fait encore : LIRE un layout et
 * en rendre compte.
 */
import { describe, expect, test } from "bun:test";
import { bilanLayout, lireLayout } from "@niers/inacord-ui/shell/game-layout";

const canvas = { w: 1280, h: 720 };
const transform = { x: 640, y: 360, scaleX: 1, scaleY: 1, rot: 0, anchorX: 0.5, anchorY: 0.5 };

describe("placement provenance", () => {
	test("keeps unresolved visible objects observable without drawing fake coordinates", () => {
		const layout = lireLayout({ canvas, objects: [
			{ name: "unknown-tab", visible: true, drawPriority: 1, transform: null, placementSource: "unresolved", text: "Unknown placement" },
			{ name: "centered-label", visible: true, drawPriority: 1, transform, placementSource: "g4pkm-pose", text: "Measured center" },
		] });
		const report = bilanLayout(layout);
		expect(report.total).toBe(2);
		expect(report.visibles).toBe(2);
		expect(report.unresolvedVisiblePlacements).toBe(1);
		expect(report.auCentre).toBe(1);
		expect(report.avecTexte).toBe(1);
	});

	test("retains legacy numeric layouts and rejects silently guessed schema values", () => {
		const object = { name: "legacy", visible: true, drawPriority: 1, transform };
		expect(lireLayout({ canvas, objects: [object] }).objects[0]?.transform).toEqual(transform);
		expect(() => lireLayout({ canvas, objects: [{ ...object, transform: null }] })).toThrow();
		expect(() => lireLayout({ canvas, objects: [{ ...object, placementSource: "guessed" }] })).toThrow("unknown placement source");
	});
});
