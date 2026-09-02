/**
 * Garde-fous du navigateur CPK — zéro accès réseau.
 *
 * Les valeurs attendues ne sont pas inventées : elles proviennent de relevés
 * réels du 13/8/2026 sur l'API Azalée (`http://127.0.0.1:8807`) et sur le CDN
 * (`https://cdn.rosegriffon.fr`), rappelés au-dessus de chaque bloc.
 */
import { describe, expect, test } from "bun:test";

import {
	apercuCpk,
	blocCode,
	bornerOffset,
	cheminParent,
	cheminWiki,
	correspondPrefixe,
	decoderParcours,
	decoderRecherche,
	decouperSaisieDossier,
	encoderParcours,
	encoderRecherche,
	entierLisible,
	estRacine,
	extraitConfig,
	filAriane,
	ligneAriane,
	ligneDossier,
	ligneFichier,
	ligneResultat,
	liensContenu,
	MAX_CUSTOM_ID,
	methodeRefusee,
	nombreDePages,
	nomPieceJointe,
	normaliserChemin,
	numeroPage,
	octetsLisibles,
	resumerConfig,
	SEUIL_PIECE_JOINTE_OCTETS,
	tientEnPieceJointe,
	tranchePage,
} from "./cpk-format";

describe("normaliserChemin", () => {
	test("préfixe `data/` quand il manque — sans quoi l'API répond vide", () => {
		// Mesuré : `/api/cpk?path=dx11/menu` → `{"dirs":[],"files":[]}` alors que
		// `data/dx11/menu` a 40 000 fichiers et 60 sous-dossiers.
		expect(normaliserChemin("dx11/menu")).toBe("data/dx11/menu");
		expect(normaliserChemin("common/chr/_waza")).toBe("data/common/chr/_waza");
	});

	test("laisse un chemin déjà préfixé intact", () => {
		expect(normaliserChemin("data/dx11/menu/220_img")).toBe("data/dx11/menu/220_img");
	});

	test("absorbe slashs de bord, doublons et antislashs", () => {
		expect(normaliserChemin("/data/dx11//menu/")).toBe("data/dx11/menu");
		expect(normaliserChemin("data\\dx11\\menu")).toBe("data/dx11/menu");
		expect(normaliserChemin("  data / dx11 ")).toBe("data/dx11");
	});

	test("écarte les segments de traversée", () => {
		expect(normaliserChemin("data/dx11/../../etc/passwd")).toBe("data/dx11/etc/passwd");
		expect(normaliserChemin("../../..")).toBe("");
		expect(normaliserChemin("./data/./dx11")).toBe("data/dx11");
	});

	test("une saisie vide reste vide (racine)", () => {
		expect(normaliserChemin("")).toBe("");
		expect(normaliserChemin("   ")).toBe("");
		expect(estRacine(normaliserChemin(""))).toBe(true);
		expect(estRacine("data")).toBe(true);
		expect(estRacine("data/dx11")).toBe(false);
	});

	test("borne la longueur", () => {
		expect(normaliserChemin("a/".repeat(400)).length).toBeLessThanOrEqual(240);
	});
});

describe("cheminParent", () => {
	test("remonte d'un cran et s'arrête à la racine", () => {
		expect(cheminParent("data/dx11/menu/220_img")).toBe("data/dx11/menu");
		expect(cheminParent("data/dx11")).toBe("data");
		expect(cheminParent("data")).toBe("");
		expect(cheminParent("")).toBe("");
	});
});

describe("filAriane", () => {
	test("traduit le premier segment par `topLabel`, les suivants par `segLabel`", () => {
		expect(ligneAriane("data/dx11/menu/220_img")).toBe("data › DX11 (PC) › Menus › 220_img");
		expect(ligneAriane("data/common/chr/_waza")).toBe(
			"data › Commun › Modèles 3D › Techniques (waza)"
		);
	});

	test("chaque étape porte un chemin réutilisable tel quel", () => {
		expect(filAriane("data/common/chr")).toEqual([
			{ libelle: "data", chemin: "data" },
			{ libelle: "Commun", chemin: "data/common" },
			{ libelle: "Modèles 3D", chemin: "data/common/chr" },
		]);
	});

	test("la racine rend une seule étape", () => {
		expect(filAriane("")).toEqual([{ libelle: "data", chemin: "data" }]);
	});
});

describe("cheminWiki", () => {
	test("retire le préfixe `data/` que la route catch-all remet elle-même", () => {
		// Vérifié : `http://127.0.0.1:3003/cpk/dx11/menu/220_img/telop_waza/a000010.g4tx` → 200.
		expect(cheminWiki("data/dx11/menu/220_img/telop_waza/a000010.g4tx")).toBe(
			"/cpk/dx11/menu/220_img/telop_waza/a000010.g4tx"
		);
		expect(cheminWiki("dx11/menu")).toBe("/cpk/dx11/menu");
	});

	test("la racine renvoie `/cpk`", () => {
		expect(cheminWiki("")).toBe("/cpk");
		expect(cheminWiki("data")).toBe("/cpk");
	});

	test("les segments sont encodés", () => {
		expect(cheminWiki("data/common/a b/c#d")).toBe("/cpk/common/a%20b/c%23d");
	});
});

describe("pagination", () => {
	test("nombreDePages ne descend jamais sous 1", () => {
		expect(nombreDePages(0, 12)).toBe(1);
		expect(nombreDePages(363, 12)).toBe(31);
		expect(nombreDePages(12, 12)).toBe(1);
		expect(nombreDePages(13, 12)).toBe(2);
	});

	test("bornerOffset aligne sur une page et plafonne à la dernière", () => {
		expect(bornerOffset(0, 363, 12)).toBe(0);
		expect(bornerOffset(7, 363, 12)).toBe(0);
		expect(bornerOffset(25, 363, 12)).toBe(24);
		// 363 entrées, 31 pages → dernier décalage = 360.
		expect(bornerOffset(999_999, 363, 12)).toBe(360);
		expect(bornerOffset(-40, 363, 12)).toBe(0);
		expect(bornerOffset(Number.NaN, 363, 12)).toBe(0);
	});

	test("numeroPage est 1-indexé", () => {
		expect(numeroPage(0, 12)).toBe(1);
		expect(numeroPage(24, 12)).toBe(3);
	});
});

describe("tranchePage", () => {
	// Relevé réel : `data/common/event/ev60` → 363 sous-dossiers, 0 fichier ;
	// `data/dx11/menu/220_img/gallery_img2` → 0 sous-dossier, 363 fichiers.
	test("une page entièrement dans les dossiers ne demande aucun fichier", () => {
		expect(tranchePage(363, 0, 0, 12)).toEqual({
			debutDossiers: 0,
			finDossiers: 12,
			offsetFichiers: 0,
			limiteFichiers: 0,
		});
	});

	test("une page à cheval prend la fin des dossiers puis le début des fichiers", () => {
		// 5 dossiers + 100 fichiers, page 1 (offset 0) : 5 dossiers puis 7 fichiers.
		expect(tranchePage(5, 100, 0, 12)).toEqual({
			debutDossiers: 0,
			finDossiers: 5,
			offsetFichiers: 0,
			limiteFichiers: 7,
		});
	});

	test("une page au-delà des dossiers ne lit que des fichiers", () => {
		expect(tranchePage(0, 363, 24, 12)).toEqual({
			debutDossiers: 0,
			finDossiers: 0,
			offsetFichiers: 24,
			limiteFichiers: 12,
		});
	});

	test("un décalage hors bornes est ramené sur la dernière page", () => {
		// 363 fichiers, 12 par page → dernière page à 360, il en reste 3.
		expect(tranchePage(0, 363, 10_000, 12)).toEqual({
			debutDossiers: 0,
			finDossiers: 0,
			offsetFichiers: 360,
			limiteFichiers: 12,
		});
	});

	test("un dossier vide ne demande rien", () => {
		expect(tranchePage(0, 0, 0, 12)).toEqual({
			debutDossiers: 0,
			finDossiers: 0,
			offsetFichiers: 0,
			limiteFichiers: 0,
		});
	});
});

describe("état des boutons", () => {
	test("aller-retour d'un parcours", () => {
		const id = encoderParcours({ chemin: "data/dx11/menu/220_img", offset: 24 });
		expect(id).toBe("cpkd|24|data/dx11/menu/220_img");
		expect(decoderParcours(id ?? "")).toEqual({
			chemin: "data/dx11/menu/220_img",
			offset: 24,
		});
	});

	test("le dossier le plus long de l'index tient sous la limite Discord", () => {
		// Chemin de dossier le plus long mesuré sur les 250 800 entrées : 66 caractères.
		const long = "data/common/event/ev60/ev60_10080/ev60_10080_c000101_s03_p00_c0300";
		expect(long.length).toBe(66);
		const id = encoderParcours({ chemin: long, offset: 999_999 });
		expect(id).not.toBeNull();
		expect((id ?? "").length).toBeLessThanOrEqual(MAX_CUSTOM_ID);
	});

	test("un chemin trop long refuse le bouton au lieu de produire un identifiant invalide", () => {
		expect(encoderParcours({ chemin: "data/".concat("x".repeat(120)), offset: 0 })).toBeNull();
	});

	test("aller-retour d'une recherche", () => {
		const id = encoderRecherche({ motif: "telop_waza", offset: 10 });
		expect(id).toBe("cpkq|10|telop_waza");
		expect(decoderRecherche(id ?? "")).toEqual({ motif: "telop_waza", offset: 10 });
	});

	test("un identifiant étranger ou malformé est rejeté", () => {
		expect(decoderParcours("tw|1||||")).toBeNull();
		expect(decoderParcours("cpkq|0|telop")).toBeNull();
		expect(decoderRecherche("cpkd|0|data/dx11")).toBeNull();
		expect(decoderParcours("cpkd|-3|data")).toBeNull();
		expect(decoderRecherche("cpkq|0|a")).toBeNull();
	});

	test("le séparateur est retiré des valeurs", () => {
		expect(encoderRecherche({ motif: "a|b", offset: 0 })).toBe("cpkq|0|a b");
	});
});

describe("decouperSaisieDossier", () => {
	test("le slash final veut dire « liste le contenu »", () => {
		expect(decouperSaisieDossier("data/dx11/")).toEqual({ parent: "data/dx11", filtre: "" });
	});

	test("sans slash final, le dernier segment est un filtre de frère", () => {
		expect(decouperSaisieDossier("data/dx11/me")).toEqual({ parent: "data/dx11", filtre: "me" });
		expect(decouperSaisieDossier("dx11/me")).toEqual({ parent: "data/dx11", filtre: "me" });
	});

	test("saisie vide ou racine seule propose les racines", () => {
		expect(decouperSaisieDossier("")).toEqual({ parent: "", filtre: "" });
		expect(decouperSaisieDossier("data")).toEqual({ parent: "", filtre: "" });
	});

	test("correspondPrefixe ignore la casse et accepte un filtre vide", () => {
		expect(correspondPrefixe("dx11", "DX")).toBe(true);
		expect(correspondPrefixe("common", "")).toBe(true);
		expect(correspondPrefixe("common", "dx")).toBe(false);
	});
});

describe("formats lisibles", () => {
	test("entierLisible groupe avec une espace ordinaire", () => {
		// 250 800 = total de l'index (`/health` → `cpkFiles`).
		expect(entierLisible(250_800)).toBe("250 800");
		expect(entierLisible(193_540)).toBe("193 540");
		expect(entierLisible(0)).toBe("0");
		expect(entierLisible(999)).toBe("999");
		expect(entierLisible(-1_234)).toBe("-1 234");
		expect(entierLisible(Number.NaN)).toBe("—");
	});

	test("octetsLisibles rend les tailles réellement mesurées sur le CDN", () => {
		// PNG brut d'une illustration de galerie : 12 176 145 octets.
		expect(octetsLisibles(12_176_145)).toBe("12 Mo");
		// La même en `?w=800&format=webp` : 80 672 octets.
		expect(octetsLisibles(80_672)).toBe("79 Ko");
		// `/model-full/c05021090.glb` : 175 072 octets.
		expect(octetsLisibles(175_072)).toBe("171 Ko");
		expect(octetsLisibles(7_468)).toBe("7,3 Ko");
		expect(octetsLisibles(512)).toBe("512 o");
		expect(octetsLisibles(null)).toBe("taille inconnue");
		expect(octetsLisibles(-1)).toBe("taille inconnue");
	});

	test("tientEnPieceJointe garde une marge sous la limite Discord", () => {
		expect(tientEnPieceJointe(175_072)).toBe(true);
		expect(tientEnPieceJointe(SEUIL_PIECE_JOINTE_OCTETS)).toBe(true);
		expect(tientEnPieceJointe(SEUIL_PIECE_JOINTE_OCTETS + 1)).toBe(false);
		expect(tientEnPieceJointe(0)).toBe(false);
		expect(tientEnPieceJointe(null)).toBe(false);
	});

	test("nomPieceJointe retire la chaîne de requête", () => {
		expect(nomPieceJointe("https://cdn.rosegriffon.fr/model-full/c05021090.glb", "x.glb")).toBe(
			"c05021090.glb"
		);
		expect(nomPieceJointe("https://cdn.rosegriffon.fr/dx11/a.png?w=800&format=webp", "x")).toBe(
			"a.png"
		);
		expect(nomPieceJointe("https://cdn.rosegriffon.fr/", "repli.bin")).toBe("repli.bin");
	});
});

describe("rendu des lignes", () => {
	test("un sous-dossier connu porte sa traduction et son compte", () => {
		// Relevé : `/api/cpk?path=data/common/chr` → `{"name":"_waza","count":833}`.
		expect(ligneDossier({ name: "_waza", count: 833 })).toBe(
			"📁 `_waza/` *(Techniques (waza))* — 833 fichiers"
		);
	});

	test("un sous-dossier sans traduction reste brut", () => {
		expect(ligneDossier({ name: "220_img", count: 1 })).toBe("📁 `220_img/` — 1 fichier");
	});

	test("un fichier porte sa famille de preview", () => {
		expect(
			ligneFichier({
				name: "a000010.g4tx",
				ext: "g4tx",
				cpk: "43076a327c5184776b0502cab5f36229.cpk",
				path: "data/dx11/menu/220_img/telop_waza/a000010.g4tx",
			})
		).toBe("📄 `a000010.g4tx` — Texture");
	});

	test("un résultat de recherche montre le chemin complet", () => {
		expect(
			ligneResultat({
				name: "c05021090.g4md",
				ext: "g4md",
				cpk: "8dcfc5f5cd0e051d45c8dedb65d3be35.cpk",
				path: "data/common/chr/_face/05_go2/c05021090/c05021090.g4md",
			})
		).toBe("`data/common/chr/_face/05_go2/c05021090/c05021090.g4md`\n↳ Modèle 3D");
	});
});

describe("apercuCpk", () => {
	test("une texture pointe la variante bornée, jamais le PNG brut", () => {
		// URL vérifiées : la brute rend 200 image/png 12 176 145 o, la variante
		// 200 image/webp 80 672 o.
		const apercu = apercuCpk({
			path: "data/dx11/menu/220_img/gallery_img2/img_chronicle_artwork_0010.g4tx",
			ext: "g4tx",
		});
		expect(apercu.famille).toBe("image");
		expect(apercu.libelle).toBe("Texture");
		expect(apercu.image).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/220_img/gallery_img2/img_chronicle_artwork_0010.png?w=800&format=webp"
		);
		expect(apercu.contenu).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/220_img/gallery_img2/img_chronicle_artwork_0010.png"
		);
		expect(apercu.image).toContain("w=800");
		expect(apercu.modele3d).toBe(false);
	});

	test("un modèle pointe le GLB assemblé en direct", () => {
		// `/model-full/c05021090.glb` → 200 model/gltf-binary, 175 072 o.
		const apercu = apercuCpk({
			path: "data/common/chr/_face/05_go2/c05021090/c05021090.g4md",
			ext: "g4md",
		});
		expect(apercu.famille).toBe("model");
		expect(apercu.contenu).toBe("https://cdn.rosegriffon.fr/model-full/c05021090.glb");
		expect(apercu.modele3d).toBe(true);
		expect(apercu.image).toBeNull();
	});

	test("un `cfg.bin` pointe le décodage JSON", () => {
		// `/cfg/…/chara_param_table_config_0.00.00.00.cfg.bin.json` → 200 JSON.
		const apercu = apercuCpk({
			path: "data/common/gamedata/character/chara_param_table_config_0.00.00.00.cfg.bin",
			ext: "bin",
		});
		expect(apercu.famille).toBe("config");
		expect(apercu.configJson).toBe(true);
		expect(apercu.contenu).toBe(
			"https://cdn.rosegriffon.fr/cfg/data/common/gamedata/character/chara_param_table_config_0.00.00.00.cfg.bin.json"
		);
	});

	test("un son et une vidéo passent par leurs décodeurs dédiés", () => {
		expect(
			apercuCpk({ path: "data/common/sound_asset/ja/c05021090.acb", ext: "acb" })
		).toMatchObject({
			famille: "sound",
			contenu: "https://cdn.rosegriffon.fr/audio/data/common/sound_asset/ja/c05021090.acb",
		});
		expect(apercuCpk({ path: "data/movie/op.usm", ext: "usm" })).toMatchObject({
			famille: "movie",
			contenu: "https://cdn.rosegriffon.fr/video/data/movie/op.usm",
		});
	});

	test("tout le reste retombe sur les octets bruts", () => {
		const apercu = apercuCpk({
			path: "data/common/event/ev60/ev60_10080/ev60_10080.g4pk",
			ext: "g4pk",
		});
		expect(apercu.famille).toBe("package");
		expect(apercu.contenu).toBe(apercu.brut);
		expect(apercu.brut).toBe(
			"https://cdn.rosegriffon.fr/raw/data/common/event/ev60/ev60_10080/ev60_10080.g4pk"
		);
	});
});

describe("methodeRefusee", () => {
	test("un 405 dit « méthode refusée », jamais « contenu absent »", () => {
		// Relevé décisif du 13/8/2026 :
		//   HEAD https://cdn.rosegriffon.fr/model-full/c11010034.glb → 405
		//   GET  https://cdn.rosegriffon.fr/model-full/c11010034.glb → 200,
		//        model/gltf-binary, 70 936 octets.
		// Conclure sur le HEAD annoncerait « pas de modèle » pour un modèle qui
		// existe — et ce cas couvre 9 878 des 15 533 codes de modèle de l'index,
		// ceux dont le GLB n'est pas déjà posé dans le cache disque de nginx.
		expect(methodeRefusee(405)).toBe(true);
		expect(methodeRefusee(501)).toBe(true);
	});

	test("un 404 et un 200 restent des réponses sur le contenu", () => {
		// `/model-full/ear001.glb` → 404 : celui-là n'est réellement pas assemblable.
		expect(methodeRefusee(404)).toBe(false);
		expect(methodeRefusee(200)).toBe(false);
		expect(methodeRefusee(500)).toBe(false);
	});
});

describe("liensContenu", () => {
	test("un format sans décodeur n'annonce qu'un seul lien", () => {
		// `.g4pk` : `contenu` vaut `brut` (mesuré : /raw/data/common/map/w/w90i001/
		// cam/cam.g4pk → 200, 1 664 octets). Deux libellés pour la même URL
		// laisseraient croire à un décodage qui n'existe pas.
		const apercu = apercuCpk({ path: "data/common/map/w/w90i001/cam/cam.g4pk", ext: "g4pk" });
		const lignes = liensContenu(apercu);
		expect(lignes).toContain(
			"https://cdn.rosegriffon.fr/raw/data/common/map/w/w90i001/cam/cam.g4pk"
		);
		expect(lignes.split("https://").length - 1).toBe(1);
		expect(lignes).toContain("Aucun décodeur");
	});

	test("un format décodé montre le décodage ET les octets bruts", () => {
		// Vidéo : /video/data/common/movie/ev01_00050.usm → 200 video/mp4.
		const apercu = apercuCpk({ path: "data/common/movie/ev01_00050.usm", ext: "usm" });
		const lignes = liensContenu(apercu);
		expect(lignes).toContain("https://cdn.rosegriffon.fr/video/data/common/movie/ev01_00050.usm");
		expect(lignes).toContain("https://cdn.rosegriffon.fr/raw/data/common/movie/ev01_00050.usm");
		expect(lignes).toContain("Vidéo");
	});

	test("le bloc tient dans un champ d'embed", () => {
		const apercu = apercuCpk({
			path: `data/common/event/${"x".repeat(180)}.g4pk`,
			ext: "g4pk",
		});
		expect(liensContenu(apercu).length).toBeLessThanOrEqual(1_024);
	});
});

describe("resumerConfig", () => {
	test("forme RDBN — relevé réel de `chara_param_table_config_0.00.00.00.cfg.bin`", () => {
		const resume = resumerConfig({
			format: "rdbn",
			lists: [
				{ name: "m_charaParamPresetTableParamList", count: 8, rows: [] },
				{ name: "m_charaParamPresetTableGrowTypeList", count: 2, rows: [] },
				{ name: "m_charaParamPresetTablePlayStyleList", count: 1, rows: [] },
			],
		});
		expect(resume).toBe(
			[
				"Format **rdbn** · 3 listes",
				"• `m_charaParamPresetTableParamList` — 8 lignes",
				"• `m_charaParamPresetTableGrowTypeList` — 2 lignes",
				"• `m_charaParamPresetTablePlayStyleList` — 1 ligne",
			].join("\n")
		);
	});

	test("forme T2b — relevé réel de `data/common/text/pt/event/ev08_02050.cfg.bin`", () => {
		const resume = resumerConfig({
			format: "T2b",
			entries: [
				{
					name: "TEXT_INFO_BEGIN",
					variables: [{ Int: 2 }],
					children: [
						{ name: "TEXT_INFO", children: [], variables: [] },
						{ name: "TEXT_INFO", children: [], variables: [] },
					],
				},
			],
		});
		expect(resume).toBe(
			["Format **T2b** · 1 bloc racine", "• `TEXT_INFO_BEGIN` — 2 enfants"].join("\n")
		);
	});

	test("au-delà de huit listes, le reste est annoncé", () => {
		const resume = resumerConfig({
			format: "rdbn",
			lists: Array.from({ length: 10 }, (_, i) => ({ name: `l${i}`, count: 1 })),
		});
		expect(resume).toContain("Format **rdbn** · 10 listes");
		expect(resume).toContain("… et 2 autres listes");
	});

	test("une forme inconnue ne fabrique pas de résumé", () => {
		expect(resumerConfig(null)).toBeNull();
		expect(resumerConfig("texte")).toBeNull();
		expect(resumerConfig({})).toBeNull();
		expect(resumerConfig({ format: "inattendu" })).toBe("Format **inattendu**");
	});
});

describe("blocCode et extraitConfig", () => {
	test("le bloc est toujours refermé, même tronqué", () => {
		const rendu = blocCode("x".repeat(5_000), "json", 100);
		expect(rendu.startsWith("```json\n")).toBe(true);
		expect(rendu.endsWith("\n```")).toBe(true);
		expect(rendu).toContain("…");
		expect(rendu.length).toBeLessThanOrEqual(100 + 12);
	});

	test("un ``` du contenu ne casse pas le bloc", () => {
		expect(blocCode("avant ``` après")).not.toContain("``` a");
		expect(blocCode("avant ``` après")).toContain("'''");
	});

	test("un corps complet est ré-indenté", () => {
		const extrait = extraitConfig('{"format":"T2b","entries":[]}', true);
		expect(extrait).toContain('"format": "T2b"');
	});

	test("un corps tronqué est montré tel quel, sans prétendre le parser", () => {
		const tronque = '{"format":"rdbn","lists":[{"count":8,"name":"m_chara';
		const extrait = extraitConfig(tronque, false);
		expect(extrait).toContain(tronque);
	});

	test("un corps complet mais illisible retombe sur le brut", () => {
		expect(extraitConfig("{pas du json", true)).toContain("{pas du json");
	});
});
