import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./trophy-gallery.css", import.meta.url), "utf8");
const component = readFileSync(new URL("./TrophyGallery.tsx", import.meta.url), "utf8");

describe("TrophyGallery responsive containment", () => {
	test("keeps the native gallery canvas and its hint bar inside the public screen", () => {
		expect(component).toContain('className="trophy-gallery__canvas"');
		expect(css).toContain(".trophy-gallery__canvas");
		expect(css).toContain("flex: 1 1 auto");
		expect(css).toContain(".trophy-gallery__footer");
		expect(css).toContain(".trophy-gallery__hints");
		expect(css).toContain("max-width: 100%; flex: 0 0 auto");
		expect(css).toContain("overflow: hidden");
	});

	test("compacts the actionable hints at the 320 px gate", () => {
		expect(css).toContain("@media (max-width: 480px)");
		expect(css).toContain("gap: 8px 14px !important");
		expect(css).toContain("font-size: 0.875rem");
	});

	test("labels the asset browser as a host extension outside the native canvas", () => {
		expect(component).toContain("Extension de l’hôte");
		expect(component).toContain("Parcourir les assets (VFS — 54 203 textures)");
		expect(component).not.toContain("49 583");
		// La surface « assets » rend la page MÉDIAS entière — la galerie y est un onglet de tête,
		// pas la seule grille : c'est `Catalog` qui porte les bandes d'onglets et les filtres.
		expect(component).toContain('<Catalog view="textures" />');
		expect(component).toContain('aria-modal="true"');
		expect(css).toContain(".trophy-gallery-assets__browser");
	});
});
