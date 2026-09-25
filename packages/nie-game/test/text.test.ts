import { describe, expect, test } from "bun:test";
import {
	BUFF_EFFECT_FR,
	EFFECT_FR,
	GAIJI,
	GAIJI_ATLAS,
	GAIJI_ATLAS_VFS,
	GROWTH_TYPE_GLYPHS,
	GROWTH_TYPE_LABEL,
	HISSATSU_ELEMENT_FR,
	TACTIC_FR,
	containsJapanese,
	downloadName,
	escapeRegExp,
	formatDescription,
	formatJapaneseName,
	hasUnresolvedTags,
	japaneseToRomaji,
	stripRubyAnnotations,
	tacticSlug,
	translateEffect,
	translatePassiveEffect,
} from "../src/text";

describe("formatDescription", () => {
	test("resolves character and place tags per language", () => {
		const text = "<FST:TENMA> rejoint <MNT:RAIMON> avec <FLC:GOENJI>.";
		expect(formatDescription(text)).toBe("Arion rejoint Raimon avec Axel.");
		expect(formatDescription("<FST:FUBUKI>", "fr")).toBe("Shawn");
		expect(formatDescription("<FST:FUBUKI>", "en")).toBe("Fubuki");
		expect(formatDescription("<FST:FUBUKI>", "jp")).toBe("Shirou");
		expect(formatDescription("<MNT:TEIKOKU>", "ja")).toBe("帝国");
		expect(formatDescription("<MNT:SHIROSHIKA>", "fr")).toBe("Cerf Blanc");
	});

	test("Spanish falls back to the English column: no proper noun is ever translated", () => {
		expect(formatDescription("<FST:FUBUKI> <MNT:SHIROSHIKA>", "es")).toBe("Fubuki White Deer");
	});

	test("tags are matched case-insensitively and unknown names keep a readable form", () => {
		expect(formatDescription("<fst:tenma>")).toBe("Arion");
		expect(formatDescription("<MNT:NOWHERE_FC>")).toBe("Nowhere_fc");
	});

	test("furigana keeps the base text only, line breaks survive", () => {
		expect(formatDescription("[必殺技/ひっさつわざ]を\n使う")).toBe("必殺技を\n使う");
	});

	test("empty input gives an empty string", () => {
		expect(formatDescription(undefined)).toBe("");
		expect(formatDescription(null)).toBe("");
		expect(formatDescription("")).toBe("");
	});

	test("hasUnresolvedTags reports raw tags and is not stateful across calls", () => {
		expect(hasUnresolvedTags("<FUL:ARTHUR> scores")).toBe(true);
		expect(hasUnresolvedTags("<FUL:ARTHUR> scores")).toBe(true);
		expect(hasUnresolvedTags(formatDescription("<FUL:ARTHUR> scores"))).toBe(false);
		expect(hasUnresolvedTags("<XYZ:ARTHUR>")).toBe(false);
	});
});

describe("Japanese helpers", () => {
	test("formatJapaneseName and stripRubyAnnotations keep the ruby base", () => {
		expect(formatJapaneseName("[円堂/えんどう] [守/まもる]")).toBe("円堂 守");
		expect(formatJapaneseName(null)).toBe("");
		expect(stripRubyAnnotations("  [雷門/らいもん]中  ")).toBe("雷門中");
	});

	test("containsJapanese spots kana, kanji and half-width katakana only", () => {
		expect(containsJapanese("エンドウ")).toBe(true);
		expect(containsJapanese("円堂")).toBe(true);
		expect(containsJapanese("ｴﾝﾄﾞｳ")).toBe(true);
		expect(containsJapanese("Endou Mamoru")).toBe(false);
		expect(containsJapanese("Pégase")).toBe(false);
	});

	test("japaneseToRomaji splits on the middle dot and spaces and capitalises each part", () => {
		expect(japaneseToRomaji("エンドウ・マモル")).toBe("Endou Mamoru");
		expect(japaneseToRomaji("ごうえんじ しゅうや")).toBe("Gouenji Shuuya");
		// No kana: kanji alone cannot be read without a dictionary, so there is no guess.
		expect(japaneseToRomaji("円堂")).toBeNull();
		expect(japaneseToRomaji("")).toBeNull();
		expect(japaneseToRomaji(undefined)).toBeNull();
	});

	test("escapeRegExp neutralises every metacharacter", () => {
		const raw = "a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o";
		expect(new RegExp(`^${escapeRegExp(raw)}$`).test(raw)).toBe(true);
		expect(new RegExp(escapeRegExp("a.b")).test("axb")).toBe(false);
	});
});

describe("translations", () => {
	test("passive effects: condition, scope and stat are translated together", () => {
		expect(translatePassiveEffect("For nearby players, Team Shot AT +10%")).toBe("Proximité : Équipe Tir ATT +10%");
		expect(translatePassiveEffect("On your half of the pitch, Own Save rate +5%")).toBe("Camp allié : Personnel Taux d'arrêt +5%");
		expect(translatePassiveEffect("Transforms into an ally player on the field when X")).toBe(
			"Se transforme en joueur allié sur le terrain",
		);
		expect(translatePassiveEffect("Untranslated effect")).toBe("Untranslated effect");
	});

	test("tactic effects translate by exact match only", () => {
		expect(translateEffect("AT +15%")).toBe("ATT +15%");
		expect(translateEffect("Geogylph: AT +15%")).toBe("Géoglyphe : ATT +15%");
		expect(translateEffect("AT +16%")).toBe("AT +16%");
		expect(translateEffect("")).toBe("");
		for (const [english, french] of Object.entries(EFFECT_FR)) {
			expect(translateEffect(english)).toBe(french);
			expect(french.trim()).toBe(french);
			expect(french.length).toBeGreaterThan(0);
		}
	});

	test("tactic slugs are URL-safe and stable for every translated tactic", () => {
		expect(tacticSlug("Sky's the Limit")).toBe("skys-the-limit");
		expect(tacticSlug("Three-Pronged Attack")).toBe("three-pronged-attack");
		const slugs = Object.keys(TACTIC_FR).map(tacticSlug);
		for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		expect(new Set(slugs).size).toBe(slugs.length);
	});

	test("element and buff tables map the Japanese-annotated variants too", () => {
		expect(HISSATSU_ELEMENT_FR["火 (Fire)"]).toBe(HISSATSU_ELEMENT_FR["Fire"]);
		expect(HISSATSU_ELEMENT_FR["無 (Void)"]).toBe("Néant");
		expect(BUFF_EFFECT_FR["Totems/Souls"]).toBe("Totems");
	});

	test("downloadName never exposes an internal code and falls back when nothing is left", () => {
		expect(downloadName("Écrasement du Dragon ÉPIQUE!")).toBe("ecrasement-du-dragon-epique");
		expect(downloadName("円堂")).toBe("fichier");
		expect(downloadName("円堂", "joueur")).toBe("joueur");
	});
});

describe("gaiji glyphs", () => {
	test("the 21 glyphs are unique sub-textures inside the 416×436 atlas", () => {
		const glyphs = Object.values(GAIJI);
		expect(glyphs).toHaveLength(21);
		expect(new Set(glyphs.map((glyph) => glyph.name)).size).toBe(21);
		for (const glyph of glyphs) {
			expect(glyph.x + glyph.w).toBeLessThanOrEqual(GAIJI_ATLAS.width);
			expect(glyph.y + glyph.h).toBeLessThanOrEqual(GAIJI_ATLAS.height);
		}
		expect(GAIJI_ATLAS.url.endsWith(GAIJI_ATLAS_VFS)).toBe(true);
	});

	test("no two glyph rects overlap", () => {
		const glyphs = Object.values(GAIJI);
		for (const [i, a] of glyphs.entries()) {
			for (const b of glyphs.slice(i + 1)) {
				const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
				expect(overlap ? `${a.name} overlaps ${b.name}` : "").toBe("");
			}
		}
	});

	test("growth types point at real glyphs and every type 0..7 has a label", () => {
		for (const keys of Object.values(GROWTH_TYPE_GLYPHS)) {
			for (const key of keys) expect(GAIJI[key]).toBeDefined();
		}
		expect(Object.keys(GROWTH_TYPE_LABEL).map(Number)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		// Types without a confirmed glyph must stay text-only rather than borrow one.
		for (const type of [0, 4, 5, 6]) expect(GROWTH_TYPE_GLYPHS[type]).toBeUndefined();
	});
});
