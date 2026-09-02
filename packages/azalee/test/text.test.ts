/**
 * Modules texte PURS (`src/text`) — glossaire FR, mise en forme des descriptions
 * du jeu, romanisation, gaiji. Aucun I/O : ces fonctions doivent tourner
 * à l'identique en webview Tauri, en navigateur et en CLI.
 */

import { describe, expect, test } from "bun:test";

import {
	BUFF_EFFECT_FR,
	downloadName,
	EFFECT_FR,
	formatDescription,
	formatJapaneseName,
	GAIJI,
	GAIJI_ATLAS,
	GROWTH_TYPE_GLYPHS,
	GROWTH_TYPE_LABEL,
	HISSATSU_ELEMENT_FR,
	HISSATSU_TYPE_FR,
	hasUnresolvedTags,
	japaneseToRomaji,
	SHOP_FR,
	TACTIC_FR,
	tacticSlug,
	translateEffect,
	translatePassiveEffect,
} from "../src/text/index";

describe("translations — glossaire FR", () => {
	test("les tables de traduction sont peuplées et non vides", () => {
		for (const table of [SHOP_FR, TACTIC_FR, EFFECT_FR]) {
			expect(Object.keys(table).length).toBeGreaterThan(5);
			for (const [source, cible] of Object.entries(table)) {
				expect(source.length).toBeGreaterThan(0);
				expect(cible.length).toBeGreaterThan(0);
			}
		}
	});

	test("translateEffect : correspondance exacte, sinon identité", () => {
		const [source, cible] = Object.entries(EFFECT_FR)[0]!;
		expect(translateEffect(source)).toBe(cible);
		expect(translateEffect("Effet totalement inconnu")).toBe("Effet totalement inconnu");
		expect(translateEffect("")).toBe("");
	});

	test("chaque entrée de EFFECT_FR est traduite (aucune régression du glossaire)", () => {
		for (const [source, cible] of Object.entries(EFFECT_FR)) {
			expect(translateEffect(source)).toBe(cible);
		}
	});

	test("tacticSlug produit un slug d'URL stable", () => {
		expect(tacticSlug("Catenaccio Counter")).toBe("catenaccio-counter");
		expect(tacticSlug("3D Reflector")).toBe("3d-reflector");
		// Apostrophes supprimées, tout non-alphanumérique devient un tiret,
		// pas de tiret de bord.
		expect(tacticSlug("Against All Odds")).toBe("against-all-odds");
		expect(tacticSlug("  Bull Horns  ")).toBe("bull-horns");
		expect(tacticSlug("!!!")).toBe("");
	});

	test("les noms de tactique EN produisent tous un slug non vide", () => {
		for (const name of Object.keys(TACTIC_FR)) {
			const slug = tacticSlug(name);
			expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		}
	});
});

describe("format-description — tags de nom + furigana", () => {
	test("résout les tags <FST:…> et retire la furigana [kanji/lecture]", () => {
		expect(formatDescription("Salut <FST:MARK> à [雷門/らいもん]", "fr")).toBe("Salut Mark à 雷門");
	});

	test("préserve les sauts de ligne", () => {
		expect(formatDescription("ligne1\nligne2")).toBe("ligne1\nligne2");
	});

	test("un tag inconnu retombe sur son nom capitalisé (jamais le tag brut)", () => {
		const out = formatDescription("<MNT:NAGUMOHARA>", "fr");
		expect(out).toBe("Nagumohara");
		expect(hasUnresolvedTags(out)).toBe(false);
	});

	test("entrée vide → chaîne vide", () => {
		expect(formatDescription(null)).toBe("");
		expect(formatDescription(undefined)).toBe("");
		expect(formatDescription("")).toBe("");
	});

	test("hasUnresolvedTags détecte les tags non résolus", () => {
		expect(hasUnresolvedTags("<FST:MARK> arrive")).toBe(true);
		expect(hasUnresolvedTags("<MNT:NAGUMOHARA>")).toBe(true);
		expect(hasUnresolvedTags("Aucun tag ici")).toBe(false);
	});

	test("formatJapaneseName ne garde que les kanji de la furigana", () => {
		expect(formatJapaneseName("[円堂/えんどう] [守/まもる]")).toBe("円堂 守");
		expect(formatJapaneseName("円堂 守")).toBe("円堂 守");
		expect(formatJapaneseName(null)).toBe("");
	});
});

describe("japanese-romaji — romanisation des noms kana", () => {
	test("katakana → romaji capitalisé, découpe sur le point médian", () => {
		expect(japaneseToRomaji("エンドウ・マモル")).toBe("Endou Mamoru");
		expect(japaneseToRomaji("ゴウエンジ")).toBe("Gouenji");
	});

	test("une entrée sans kana (kanji seuls) → null", () => {
		expect(japaneseToRomaji("円堂")).toBeNull();
		expect(japaneseToRomaji("Mark Evans")).toBeNull();
	});

	test("entrée vide → null", () => {
		expect(japaneseToRomaji("")).toBeNull();
		expect(japaneseToRomaji(null)).toBeNull();
		expect(japaneseToRomaji(undefined)).toBeNull();
	});
});

describe("download-filename — nom de fichier public", () => {
	test("slugifie sans exposer le code interne du jeu", () => {
		expect(downloadName("Tornade de Feu !")).toBe("tornade-de-feu");
		expect(downloadName("L'Étoffe des héros")).toBe("l-etoffe-des-heros");
	});

	test("retombe sur le fallback si le nom ne produit aucun slug", () => {
		expect(downloadName("###")).toBe("fichier");
		expect(downloadName("###", "modele")).toBe("modele");
	});
});

describe("aura-translations — effets de passives", () => {
	test("traduit conditions, portées et stats", () => {
		expect(translatePassiveEffect("For nearby players, Own Shot AT +10")).toStartWith("Proximité : ");
		expect(translatePassiveEffect("Team Bond Power +5")).toContain("Puissance de lien");
	});

	test("un texte sans motif connu est renvoyé tel quel", () => {
		expect(translatePassiveEffect("texte-sans-motif-connu")).toBe("texte-sans-motif-connu");
	});

	test("les tables hissatsu / buff sont peuplées", () => {
		expect(Object.keys(HISSATSU_TYPE_FR).length).toBeGreaterThan(0);
		expect(Object.keys(HISSATSU_ELEMENT_FR).length).toBeGreaterThan(0);
		expect(Object.keys(BUFF_EFFECT_FR).length).toBeGreaterThan(0);
	});
});

describe("gaiji — glyphes de l'atlas du jeu", () => {
	test("l'atlas pointe sur le CDN avec des dimensions réelles", () => {
		expect(GAIJI_ATLAS.url).toStartWith("https://cdn.rosegriffon.fr/");
		expect(GAIJI_ATLAS.width).toBeGreaterThan(0);
		expect(GAIJI_ATLAS.height).toBeGreaterThan(0);
	});

	test("chaque glyphe tient dans l'atlas", () => {
		const cles = Object.keys(GAIJI);
		expect(cles.length).toBeGreaterThan(0);
		for (const cle of cles) {
			const glyphe = GAIJI[cle]!;
			expect(glyphe.x).toBeGreaterThanOrEqual(0);
			expect(glyphe.y).toBeGreaterThanOrEqual(0);
			expect(glyphe.x + glyphe.w).toBeLessThanOrEqual(GAIJI_ATLAS.width);
			expect(glyphe.y + glyphe.h).toBeLessThanOrEqual(GAIJI_ATLAS.height);
		}
	});

	test("chaque type de croissance a un libellé et des glyphes connus", () => {
		for (const [type, glyphes] of Object.entries(GROWTH_TYPE_GLYPHS)) {
			expect(GROWTH_TYPE_LABEL[Number(type)]).toBeString();
			expect(glyphes.length).toBeGreaterThan(0);
			for (const cle of glyphes) {
				expect(GAIJI[cle]).toBeDefined();
			}
		}
	});
});
