import { describe, expect, test } from "bun:test";

import {
	extractKeshinModelCode,
	GALLERY_VARIANT_WIDTHS,
	galleryVariantUrl,
	getArmureModelGlbUrl,
	getAuraImageUrl,
	getCharacterFaceUrl,
	getCharacterImageUrl,
	getCharacterModelFullGlbUrl,
	getCharacterModelGlbUrl,
	getEmblemImageUrl,
	getGalleryImageUrl,
	getGenderIconUrl,
	getItemImageUrl,
	getKeshinModelGlbUrl,
	getMiximaxIconUrl,
	getOptimizedImageUrl,
	getRarityIconUrl,
	getSkillCategoryIconUrl,
	getSkillElementIconUrl,
	hasCharacterModelGlb,
	getSkillImageUrl,
	getCharacterUniformUrl,
	resolveAuraTelopUrl,
	resolveItemIcon,
	listServedArmureCodes,
	listServedKeshinCodes,
	PLACEHOLDERS,
	resolveAssetUrl,
} from "../src/images/utils";

/**
 * Toutes les attentes ci-dessous verrouillent le **contrat d'URL CPK** :
 *   1:1            `<MENU>/<chemin>.png`             (conteneur à texture unique)
 *   texture nommée `<MENU>/<chemin>.g4tx/<nom>.png`  (conteneur multi-textures / atlas)
 * Le nommage du dump archivé (`<basename>_<texture>.png`) est un 404 garanti : aucun
 * motif de cette forme ne doit réapparaître.
 */
const MENU = "https://cdn.rosegriffon.fr/dx11/menu";
const CHR = `${MENU}/200_icon/10_icon_chr`;
const ITEM_CDN = `${MENU}/200_icon/02_icon_item`;
const EMBLEM_CDN = `${MENU}/200_icon/01_icon_emblem`;
const TELOP_FR = `${MENU}/220_img/telop_waza/fr`;

describe("getAuraImageUrl — routage dossier + base famille", () => {
	test("keshins wk* → aura_fs/k{N} en texture nommée", () => {
		expect(getAuraImageUrl("wks00020")).toBe(`${CHR}/aura_fs/k000020_l.g4tx/k000020_l00.png`);
		expect(getAuraImageUrl("wkk00110")).toBe(`${CHR}/aura_fs/k000110_l.g4tx/k000110_l00.png`);
		expect(getAuraImageUrl("wkt00010")).toBe(`${CHR}/aura_fs/k000010_l.g4tx/k000010_l00.png`);
	});

	test("keshin-armé wak/wao/wad → aura_fs/k{N} (PAS aura_soul)", () => {
		expect(getAuraImageUrl("wak00110")).toBe(`${CHR}/aura_fs/k000110_l.g4tx/k000110_l00.png`);
		expect(getAuraImageUrl("wao00010")).toBe(`${CHR}/aura_fs/k000010_l.g4tx/k000010_l00.png`);
		expect(getAuraImageUrl("wad00060")).toBe(`${CHR}/aura_fs/k000060_l.g4tx/k000060_l00.png`);
	});

	test("souls ws* → aura_soul/a{N}", () => {
		expect(getAuraImageUrl("wss00010")).toBe(`${CHR}/aura_soul/a000010_l.g4tx/a000010_l00.png`);
		expect(getAuraImageUrl("wsk00010")).toBe(`${CHR}/aura_soul/a000010_l.g4tx/a000010_l00.png`);
	});

	test("formes évoluées (…721/…651/…2025) → arrondi à la famille ×10 existante", () => {
		// Le dump dx11 ne contient que les icônes ×10 ; les formes éveillées
		// retombent sur l'icône de famille au lieu d'un 404.
		expect(getAuraImageUrl("wak00721")).toBe(`${CHR}/aura_fs/k000720_l.g4tx/k000720_l00.png`);
		expect(getAuraImageUrl("wad00651")).toBe(`${CHR}/aura_fs/k000650_l.g4tx/k000650_l00.png`);
		expect(getAuraImageUrl("wad00672")).toBe(`${CHR}/aura_fs/k000670_l.g4tx/k000670_l00.png`);
		expect(getAuraImageUrl("wko02025")).toBe(`${CHR}/aura_fs/k002020_l.g4tx/k002020_l00.png`);
	});

	test("suffixe de variante (_st0701, _1, _b1) ignoré, base conservée", () => {
		expect(getAuraImageUrl("wks02060_st0901")).toBe(`${CHR}/aura_fs/k002060_l.g4tx/k002060_l00.png`);
		expect(getAuraImageUrl("wad00720_1")).toBe(`${CHR}/aura_fs/k000720_l.g4tx/k000720_l00.png`);
	});

	test("was* non dérivable côté code → \"\" (déféré à image_url DB)", () => {
		expect(getAuraImageUrl("was00020")).toBe("");
		expect(getAuraImageUrl("was00610")).toBe("");
	});

	test("entrée vide → \"\"", () => {
		expect(getAuraImageUrl(null)).toBe("");
		expect(getAuraImageUrl(undefined)).toBe("");
		expect(getAuraImageUrl("")).toBe("");
	});
});

describe("resolveAssetUrl — mapping image_url legacy webp → chemin CPK réel", () => {
	test("aura webp → texture nommée CPK (base conservée)", () => {
		expect(resolveAssetUrl("200_icon/10_icon_chr/aura_fs/k000020_l_00020_l00.webp")).toBe(
			`${CHR}/aura_fs/k000020_l.g4tx/k000020_l00.png`
		);
		expect(resolveAssetUrl("200_icon/10_icon_chr/aura_soul/a000240_l_00240_l00.webp")).toBe(
			`${CHR}/aura_soul/a000240_l.g4tx/a000240_l00.png`
		);
	});

	test("aura webp d'une forme évoluée → arrondi famille ×10", () => {
		expect(resolveAssetUrl("200_icon/10_icon_chr/aura_fs/k000721_l_00721_l00.webp")).toBe(
			`${CHR}/aura_fs/k000720_l.g4tx/k000720_l00.png`
		);
		expect(resolveAssetUrl("200_icon/10_icon_chr/aura_fs/k002025_l_02025_l00.webp")).toBe(
			`${CHR}/aura_fs/k002020_l.g4tx/k002020_l00.png`
		);
	});

	test("forme legacy /menu/…webp (emblèmes em*) → fichier 1:1 CPK", () => {
		expect(resolveAssetUrl("/menu/200_icon/01_icon_emblem/em0001.webp")).toBe(
			`${EMBLEM_CDN}/em0001.png`
		);
	});

	test("telop legacy `<code>_0.webp` → fichier 1:1 CPK sans suffixe", () => {
		expect(
			resolveAssetUrl("/storage/v1/object/public/menu/220_img/telop_waza/fr/whd00030_0.webp")
		).toBe(`${TELOP_FR}/whd00030.png`);
	});

	test("item legacy : le dossier écrit en base est ignoré au profit du manifeste", () => {
		// `em040022` est déclaré dans `02_icon_item` mais vit dans `01_icon_emblem`.
		expect(resolveAssetUrl("200_icon/02_icon_item/em040022.webp")).toBe(
			`${EMBLEM_CDN}/em040022.g4tx/em040022.png`
		);
		// `coa_animal_an000100` vit dans `22_icon_town/icon_animal.g4tx`.
		expect(resolveAssetUrl("200_icon/02_icon_item/coa_animal_an000100.webp")).toBe(
			`${MENU}/200_icon/22_icon_town/icon_animal.g4tx/coa_animal_an000100.png`
		);
	});

	test("plaque de nom sans extension → texture nommée `_01` (2 textures de même taille)", () => {
		expect(resolveAssetUrl("200_icon/25_icon_nameplate/nm00001")).toBe(
			`${MENU}/200_icon/25_icon_nameplate/nm00001.g4tx/nm00001_01.png`
		);
	});

	test("chemin non résolu → placeholder (jamais un `.webp` re-forgé)", () => {
		expect(resolveAssetUrl("220_img/activity_photo/fr/")).toBe(PLACEHOLDERS.item);
		expect(resolveAssetUrl("200_icon/02_icon_item/ti11010010.webp")).toBe(PLACEHOLDERS.item);
	});

	test("emblem_url d'équipe en `0x<CRC>.webp` → placeholder (trou de données, 0/208)", () => {
		expect(
			resolveAssetUrl("/storage/v1/object/public/menu/200_icon/01_icon_emblem/0x4DC11E01.webp")
		).toBe(PLACEHOLDERS.item);
	});

	test("URL absolue ou racine inchangée", () => {
		expect(resolveAssetUrl("https://example.com/x.png")).toBe("https://example.com/x.png");
		expect(resolveAssetUrl("/local.png")).toBe("/local.png");
		expect(resolveAssetUrl(null)).toBeNull();
	});
});

describe("getMiximaxIconUrl — icon_code/asset_code → code icône réel (ca/cn/cp/iau)", () => {
	const MIXI = `${CHR}/aura_mixi`;

	test("icon_code c05028XXX → vrai code via manifeste (pas c05028XXX_l_…)", () => {
		expect(getMiximaxIconUrl("c05028010")).toBe(`${MIXI}/ca0201_l.g4tx/ca0201_l00.png`);
		expect(getMiximaxIconUrl("c05028110")).toBe(`${MIXI}/cn0231_l.g4tx/cn0231_l00.png`);
		expect(getMiximaxIconUrl("c05028130")).toBe(`${MIXI}/cp1811_l.g4tx/cp1811_l00.png`);
		expect(getMiximaxIconUrl("c05028120")).toBe(`${MIXI}/iau0010a_l.g4tx/iau0010a_l00.png`);
	});

	test("asset_code wmm00XXX (et variante _h1/_b1) → même vrai code", () => {
		expect(getMiximaxIconUrl("wmm00010")).toBe(`${MIXI}/ca0201_l.g4tx/ca0201_l00.png`);
		expect(getMiximaxIconUrl("wmm00010_h1")).toBe(`${MIXI}/ca0201_l.g4tx/ca0201_l00.png`);
		expect(getMiximaxIconUrl("wmm00130")).toBe(`${MIXI}/cp1811_l.g4tx/cp1811_l00.png`);
	});

	test("Miximax sans icône réelle dans le dump → \"\" (pas de 404 forgé)", () => {
		// wmm00220 pointe vers un hash de ressource absent du dump → data-gap.
		expect(getMiximaxIconUrl("wmm00220")).toBe("");
		expect(getMiximaxIconUrl("c05028220")).toBe("");
		expect(getMiximaxIconUrl("wmm99999")).toBe("");
	});

	test("entrée vide → \"\"", () => {
		expect(getMiximaxIconUrl(null)).toBe("");
		expect(getMiximaxIconUrl(undefined)).toBe("");
		expect(getMiximaxIconUrl("")).toBe("");
	});
});

describe("items — résolution par manifeste (conteneur + texture réels)", () => {
	test("gd120001 garde son icône réelle, les autres gd120* sont un trou de données", () => {
		expect(getItemImageUrl("gd120001")).toBe(`${ITEM_CDN}/icon_item01.g4tx/gd120001.png`);
		expect(resolveAssetUrl("200_icon/02_icon_item/gd120001.webp")).toBe(
			`${ITEM_CDN}/icon_item01.g4tx/gd120001.png`
		);
		for (const code of ["gd120002", "gd120030", "gd120059", "gd120066", "gd120091"]) {
			expect(resolveItemIcon(code)).toBeNull();
			expect(getItemImageUrl(code)).toBe(PLACEHOLDERS.item);
			expect(resolveAssetUrl(`200_icon/02_icon_item/${code}.webp`)).toBe(PLACEHOLDERS.item);
		}
	});

	test("familles courantes → texture nommée dans leur conteneur", () => {
		expect(getItemImageUrl("eq_ac0105001")).toBe(`${ITEM_CDN}/icon_item05.g4tx/eq_ac0105001.png`);
		expect(getItemImageUrl("ke000033")).toBe(`${ITEM_CDN}/icon_item02.g4tx/ke000033.png`);
	});

	test("le dossier écrit en base est FAUX pour 522 objets : le manifeste tranche", () => {
		expect(resolveItemIcon("em040022")?.g4txPath).toBe("200_icon/01_icon_emblem/em040022.g4tx");
		expect(resolveItemIcon("coa_animal_an000100")?.g4txPath).toBe(
			"200_icon/22_icon_town/icon_animal.g4tx"
		);
		expect(resolveItemIcon("ds01014")?.g4txPath).toBe("200_icon/20_icon_deco/icon_deco.g4tx");
		// Plaque de nom : la texture ne porte PAS le nom de l'objet (`_01` suffixé).
		expect(resolveItemIcon("nm00001")).toEqual({
			g4txPath: "200_icon/25_icon_nameplate/nm00001.g4tx",
			textureName: "nm00001_01",
		});
	});

	test("un id hex n'est pas un internal_code → placeholder", () => {
		expect(getItemImageUrl("0x002B6B38")).toBe(PLACEHOLDERS.item);
		expect(getItemImageUrl("")).toBe("");
	});
});

describe("techniques — telop 1:1 (fr puis en), gate sur les fichiers réels", () => {
	test("code avec telop → fichier 1:1, sans doublage", () => {
		expect(getSkillImageUrl("who00090")).toBe(`${TELOP_FR}/who00090.png`);
		// 858 techniques ont un telop `fr` : l'ancienne allowlist n'en listait que 16.
		expect(getSkillImageUrl("whd00030")).toBe(`${TELOP_FR}/whd00030.png`);
		expect(getSkillImageUrl("whs00520")).toBe(`${TELOP_FR}/whs00520.png`);
	});

	test("code sans aucun telop → placeholder (pas de 404 forgé)", () => {
		expect(getSkillImageUrl("rhd00010")).toBe(PLACEHOLDERS.skill);
		expect(getSkillImageUrl("swap_skill_waza_01")).toBe(PLACEHOLDERS.skill);
		expect(getSkillImageUrl(null)).toBe("");
	});

	test("resolveAuraTelopUrl mappe wk*/ws*/wap* sur le telop réel", () => {
		expect(resolveAuraTelopUrl("wks00020")).toBe(`${TELOP_FR}/k000020.png`);
		expect(resolveAuraTelopUrl("wss00010")).toBe(`${TELOP_FR}/a000010.png`);
		expect(resolveAuraTelopUrl("wap01004")).toBe(`${TELOP_FR}/aura_power_wap01004.png`);
		// Miximax : aucun telop valide (bandeau d'un autre perso sinon).
		expect(resolveAuraTelopUrl("wmm00100")).toBeNull();
		// Code sans fichier → null, jamais une URL forgée.
		expect(resolveAuraTelopUrl("wks99999")).toBeNull();
	});
});

describe("uniformes — texture `_1` nommée (le `_2` est un masque d'emblème, pas un dos)", () => {
	test("perso doté d'un uniforme personnel → `<code>_l.g4tx/<code>_1.png`", () => {
		expect(getCharacterUniformUrl("c11010010")).toBe(
			`${CHR}/uniform/u11010010_l.g4tx/u11010010_1.png`
		);
		// Le suffixe de variante est retiré avant la dérivation `c` → `u`.
		expect(getCharacterUniformUrl("c11010010_5000")).toBe(getCharacterUniformUrl("c11010010"));
	});

	test("perso sans uniforme personnel → \"\" (gate 303 codes)", () => {
		expect(getCharacterUniformUrl("c99999999")).toBe("");
		expect(getCharacterUniformUrl(null)).toBe("");
	});
});

// ---------------------------------------------------------------------------
// Résolution d'URLs CDN — les gates de manifeste évitent les 404 forgés.
// ---------------------------------------------------------------------------

describe("URLs CDN — visages, emblèmes, illustrations", () => {
	test("getCharacterFaceUrl : texture nommée `_1_l00` (le 1:1 servirait `_2_l00`)", () => {
		expect(getCharacterFaceUrl("c01000010")).toBe(
			`${CHR}/face/c01000010_l.g4tx/c01000010_1_l00.png`
		);
		// Le suffixe de variante (_5000/_5100…) est retiré : le dump n'a que la base.
		expect(getCharacterFaceUrl("c01000010_5000")).toBe(getCharacterFaceUrl("c01000010"));
		// Code absent du manifeste des faces servies → placeholder, pas un 404 forgé.
		expect(getCharacterFaceUrl("c99999999")).toBe(PLACEHOLDERS.character);
		expect(getCharacterFaceUrl(null)).toBe(PLACEHOLDERS.character);
		expect(getCharacterFaceUrl("")).toBe(PLACEHOLDERS.character);
		expect(getCharacterImageUrl).toBe(getCharacterFaceUrl);
	});

	test("getEmblemImageUrl : fichier 1:1, entier zéro-paddé, gate sur les 542 réels", () => {
		expect(getEmblemImageUrl("em110002")).toBe(`${EMBLEM_CDN}/em110002.png`);
		expect(getEmblemImageUrl(1)).toBe(`${EMBLEM_CDN}/em0001.png`);
		expect(getEmblemImageUrl(null)).toBe("");
		expect(getEmblemImageUrl(undefined)).toBe("");
		expect(getEmblemImageUrl("pas-un-emblème")).toBe("");
		// Emblème inexistant dans les CPK → "" plutôt qu'une URL 404.
		expect(getEmblemImageUrl("em999999")).toBe("");
	});

	test("getGalleryImageUrl : fichier 1:1 (le doublage était le nommage du dump)", () => {
		expect(getGalleryImageUrl("img_story_ev01_main_0010")).toBe(
			`${MENU}/220_img/gallery_img2/img_story_ev01_main_0010.png`
		);
		expect(getGalleryImageUrl(null)).toBeNull();
		expect(getGalleryImageUrl("")).toBeNull();
	});

	test("galleryVariantUrl : idempotent hors sources CDN raster", () => {
		expect(galleryVariantUrl("https://cdn.rosegriffon.fr/dx11/menu/x.png", 400)).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/x.png?w=400&format=webp"
		);
		expect(galleryVariantUrl("https://cdn.rosegriffon.fr/g4tx/y.jpg", 1600)).toBe(
			"https://cdn.rosegriffon.fr/g4tx/y.jpg?w=1600&format=webp"
		);
		// Un webp est déjà léger, un chemin local n'a pas de décodeur derrière nginx.
		expect(galleryVariantUrl("https://cdn.rosegriffon.fr/dx11/menu/x.webp", 400)).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/x.webp"
		);
		expect(galleryVariantUrl("/local.png", 400)).toBe("/local.png");
		expect(galleryVariantUrl(null, 400)).toBeNull();
		// Toutes les largeurs whitelistées produisent une variante distincte.
		const urls = GALLERY_VARIANT_WIDTHS.map((w) =>
			galleryVariantUrl("https://cdn.rosegriffon.fr/dx11/a.png", w)
		);
		expect(new Set(urls).size).toBe(GALLERY_VARIANT_WIDTHS.length);
	});
});

describe("URLs CDN — modèles 3D (gate manifeste + cache-buster)", () => {
	test("getCharacterModelFullGlbUrl gate les persos c* sur le manifeste", () => {
		const url = getCharacterModelFullGlbUrl("c01000010");
		expect(url).toStartWith("https://cdn.rosegriffon.fr/model-full/c01000010.glb?v=");
		// Cache-buster obligatoire : les GLB sont servis `immutable`.
		expect(url).toMatch(/\?v=\d+$/);
		expect(getCharacterModelFullGlbUrl("c99999999")).toBeNull();
		expect(getCharacterModelFullGlbUrl(null)).toBeNull();
		// Keshins/armures ne sont pas gatés sur le manifeste des faces.
		expect(getCharacterModelFullGlbUrl("k000010")).toStartWith(
			"https://cdn.rosegriffon.fr/model-full/k000010.glb?v="
		);
	});

	test("getCharacterModelGlbUrl / hasCharacterModelGlb sont cohérents", () => {
		expect(getCharacterModelGlbUrl("c01000010")).toBe("https://cdn.rosegriffon.fr/model/c01000010.glb");
		expect(hasCharacterModelGlb("c01000010")).toBe(true);
		expect(getCharacterModelGlbUrl("c99999999")).toBeNull();
		expect(hasCharacterModelGlb("c99999999")).toBe(false);
	});

	test("les codes keshin/armure servis résolvent tous vers une URL", () => {
		const keshins = listServedKeshinCodes();
		const armures = listServedArmureCodes();
		expect(keshins.length).toBeGreaterThan(0);
		expect(armures.length).toBeGreaterThan(0);
		// Listes triées et sans doublon.
		expect([...keshins].sort()).toEqual(keshins);
		expect(new Set(armures).size).toBe(armures.length);
		for (const code of keshins) {
			expect(getKeshinModelGlbUrl(code)).toStartWith(`https://cdn.rosegriffon.fr/model-full/${code}.glb?v=`);
		}
		for (const code of armures) {
			expect(getArmureModelGlbUrl(code)).toStartWith(`https://cdn.rosegriffon.fr/model-full/${code}.glb?v=`);
		}
		expect(getKeshinModelGlbUrl("k999999")).toBeNull();
		expect(getArmureModelGlbUrl("ka999999")).toBeNull();
	});

	test("extractKeshinModelCode retrouve `kNNNNNN` dans un chemin d'icône", () => {
		expect(extractKeshinModelCode("200_icon/10_icon_chr/aura_fs/k000010_l.g4tx/k000010_l00.png")).toBe("k000010");
		expect(extractKeshinModelCode(null, undefined, "aura_fs/k002020_l")).toBe("k002020");
		expect(extractKeshinModelCode("aucun-code-ici")).toBeNull();
		expect(extractKeshinModelCode()).toBeNull();
	});
});

describe("Icônes UI locales (élément / catégorie / rareté / genre)", () => {
	test("getSkillElementIconUrl accepte FR, EN et code numérique", () => {
		expect(getSkillElementIconUrl("Feu")).toBe("/spirit_type/fire.webp");
		expect(getSkillElementIconUrl("Fire")).toBe("/spirit_type/fire.webp");
		expect(getSkillElementIconUrl(1)).toBe("/spirit_type/fire.webp");
		expect(getSkillElementIconUrl("Forêt")).toBe("/spirit_type/forest.webp");
		expect(getSkillElementIconUrl("Montagne")).toBe("/spirit_type/mountain.webp");
		expect(getSkillElementIconUrl("Vent")).toBe("/spirit_type/wind.webp");
		// Élément inconnu → chaîne vide (l'UI n'affiche pas d'icône cassée).
		expect(getSkillElementIconUrl("inconnu")).toBe("");
		expect(getSkillElementIconUrl("")).toBe("");
	});

	test("getSkillCategoryIconUrl mappe les catégories de technique", () => {
		expect(getSkillCategoryIconUrl("Shoot")).toBe("/move/tir.webp");
		expect(getSkillCategoryIconUrl("Tir")).toBe("/move/tir.webp");
		expect(getSkillCategoryIconUrl("gk")).toBe("/move/gardien.webp");
		expect(getSkillCategoryIconUrl("inconnue")).toBe("");
	});

	test("getRarityIconUrl mappe les raretés du jeu", () => {
		expect(getRarityIconUrl("Normal")).toBe("/rarity/normal.webp");
		expect(getRarityIconUrl(4)).toBe("/rarity/heros.webp");
		expect(getRarityIconUrl("BASARA")).toBe("/rarity/basara.webp");
		expect(getRarityIconUrl(null)).toBe("");
		expect(getRarityIconUrl("inconnue")).toBe("");
	});

	test("getGenderIconUrl retombe sur le masculin par défaut", () => {
		expect(getGenderIconUrl(1)).toBe("/move/girl.webp");
		expect(getGenderIconUrl("F")).toBe("/move/girl.webp");
		expect(getGenderIconUrl(0)).toBe("/move/boy.webp");
		expect(getGenderIconUrl("M")).toBe("/move/boy.webp");
		expect(getGenderIconUrl(null)).toBe("");
	});

	test("getOptimizedImageUrl encode l'URL source et passe les data: telles quelles", () => {
		expect(getOptimizedImageUrl("https://x/y.png", 400, 70)).toBe(
			"/_next/image?url=https%3A%2F%2Fx%2Fy.png&w=400&q=70"
		);
		expect(getOptimizedImageUrl("data:image/png;base64,AA")).toBe("data:image/png;base64,AA");
		expect(getOptimizedImageUrl(null)).toBe("");
	});
});
