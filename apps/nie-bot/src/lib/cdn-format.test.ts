/**
 * Noyau pur du CDN : chemins d'asset, variantes, modèles 3D, galerie.
 *
 * Toutes les valeurs de ce fichier viennent d'un relevé RÉEL du 13/8/2026 sur
 * `cdn.rosegriffon.fr`, `127.0.0.1:8804`, `127.0.0.1:8805` et
 * `127.0.0.1:8807/api/…` — aucune n'est inventée pour faire passer un test.
 * Aucun accès réseau n'est fait ici : les charges sont figées.
 */
import { describe, expect, test } from "bun:test";

import {
	ASSET_SONDE,
	CATEGORIES_GALERIE,
	GALERIE_PAR_PAGE,
	LARGEURS_VARIANTE,
	LARGEUR_PLEINE,
	LARGEUR_VIGNETTE,
	LIMITE_PIECE_JOINTE_OCTETS,
	MAX_CUSTOM_ID,
	PREFIXE_BOUTON_GALERIE,
	SURFACES_VARIANTE,
	bornerPage,
	cheminCdnDepuisCpk,
	choisirTextureModele,
	decoderEtatGalerie,
	decrireSanteCdn,
	decrireSanteVariantes,
	encoderEtatGalerie,
	estTypeImage,
	estTypeModele,
	formaterOctets,
	largeurAutorisee,
	libelleCache,
	libelleCategorieGalerie,
	libelleFamille,
	nombreDePages,
	normaliserCheminAsset,
	normaliserCodeModele,
	urlAsset,
	urlModele,
	urlVariante,
} from "./cdn-format";

const CDN = "https://cdn.rosegriffon.fr";

/** Raccourci : n'accepte que les résolutions réussies. */
function reussi(saisie: string, base = CDN) {
	const resultat = normaliserCheminAsset(saisie, base);
	if (!resultat.ok) {
		throw new Error(`attendu réussi, obtenu : ${resultat.raison}`);
	}
	return resultat;
}

/** Raccourci : n'accepte que les refus. */
function refuse(saisie: string, base = CDN): string {
	const resultat = normaliserCheminAsset(saisie, base);
	if (resultat.ok) {
		throw new Error(`attendu refusé, obtenu : ${resultat.chemin}`);
	}
	return resultat.raison;
}

describe("largeurs de variante", () => {
	// `GET http://127.0.0.1:8805/health` → {"widths":[200,400,800,1600],"quality":78}
	test("reproduit exactement les largeurs annoncées par le service", () => {
		expect([...LARGEURS_VARIANTE]).toEqual([200, 400, 800, 1600]);
	});

	test("la vignette et le plein cadre sont des largeurs servies", () => {
		expect(LARGEURS_VARIANTE).toContain(LARGEUR_VIGNETTE);
		expect(LARGEURS_VARIANTE).toContain(LARGEUR_PLEINE);
	});

	test("une largeur arbitraire est ramenée à la plus proche servie", () => {
		expect(largeurAutorisee(1)).toBe(200);
		expect(largeurAutorisee(250)).toBe(200);
		expect(largeurAutorisee(320)).toBe(400);
		expect(largeurAutorisee(700)).toBe(800);
		expect(largeurAutorisee(4000)).toBe(1600);
	});

	test("une largeur absente ou absurde retombe sur la vignette", () => {
		expect(largeurAutorisee(null)).toBe(LARGEUR_VIGNETTE);
		expect(largeurAutorisee(undefined)).toBe(LARGEUR_VIGNETTE);
		expect(largeurAutorisee(Number.NaN)).toBe(LARGEUR_VIGNETTE);
		expect(largeurAutorisee(Number.POSITIVE_INFINITY)).toBe(LARGEUR_VIGNETTE);
	});

	test("seules dx11 et g4tx sont des surfaces de variante", () => {
		// `apps/cdn-variants/server.ts` répond 404 sur toute autre surface.
		expect([...SURFACES_VARIANTE]).toEqual(["dx11", "g4tx"]);
	});
});

describe("normalisation d'un chemin d'asset", () => {
	test("chemin CDN nu", () => {
		const r = reussi("/dx11/menu/220_img/stadium/img_room_b10g001.png");
		expect(r.chemin).toBe("/dx11/menu/220_img/stadium/img_room_b10g001.png");
		expect(r.surface).toBe("dx11");
		expect(r.extension).toBe("png");
		expect(r.variante).toBe(true);
		expect(r.depuisCpk).toBe(false);
	});

	test("chemin sans barre oblique initiale", () => {
		expect(reussi("dx11/menu/220_img/vsroute_map/grid_map00.png").chemin).toBe(
			"/dx11/menu/220_img/vsroute_map/grid_map00.png"
		);
	});

	test("URL publique complète, query comprise", () => {
		const r = reussi(
			"https://cdn.rosegriffon.fr/dx11/menu/220_img/vsroute_map/grid_map00.png?w=1600&format=webp"
		);
		expect(r.chemin).toBe("/dx11/menu/220_img/vsroute_map/grid_map00.png");
		expect(r.variante).toBe(true);
	});

	test("chemin de l'index CPK : le préfixe data/ tombe et .g4tx devient .png", () => {
		// `GET /api/cpk/search?q=220_img/stadium/img_room_b10g001` →
		//   data/dx11/menu/220_img/stadium/img_room_b10g001.g4tx
		// et l'URL décodée correspondante répond 200 (image/webp, 112 042 octets).
		const r = reussi("data/dx11/menu/220_img/stadium/img_room_b10g001.g4tx");
		expect(r.chemin).toBe("/dx11/menu/220_img/stadium/img_room_b10g001.png");
		expect(r.extension).toBe("png");
		expect(r.depuisCpk).toBe(true);
		expect(r.variante).toBe(true);
	});

	test("surface g4tx acceptée telle quelle", () => {
		// Mesuré : /g4tx/dx11/chr/_keshin/k000010/k000010.png?w=400 → 200, 9 398 octets.
		const r = reussi("/g4tx/dx11/chr/_keshin/k000010/k000010.png");
		expect(r.surface).toBe("g4tx");
		expect(r.variante).toBe(true);
	});

	test("miroir static : servi mais sans variante", () => {
		// Mesuré : /static/azalee/public/ChronoStones_EN.webp → 200, image/webp, 14 774 octets.
		const r = reussi("/static/azalee/public/ChronoStones_EN.webp");
		expect(r.surface).toBe("static");
		expect(r.variante).toBe(false);
	});

	test("identifiant de téléversement à la racine : servi mais sans variante", () => {
		// Mesuré : /04b34672d112790b.png → 200, image/png, 192 octets.
		const r = reussi("04b34672d112790b.png");
		expect(r.chemin).toBe("/04b34672d112790b.png");
		expect(r.surface).toBe("");
		expect(r.variante).toBe(false);
	});

	test("un hôte étranger est refusé", () => {
		expect(refuse("https://exemple.test/dx11/a.png")).toContain("exemple.test");
	});

	test("la traversée de chemin est refusée", () => {
		expect(refuse("/dx11/../../etc/passwd.png")).toContain("`..`");
		expect(refuse("/dx11/%2e%2e/secret.png")).toContain("`..`");
	});

	test("un chemin sans extension est refusé", () => {
		expect(refuse("/dx11/menu/220_img/stadium")).toContain("extension");
		expect(refuse("/dx11/menu/fichier.")).toContain("extension");
	});

	test("une extension non-image est refusée", () => {
		// data/common/sound_asset/ja/c01000010.acb existe bel et bien dans l'index CPK,
		// mais ce n'est pas une image : le CDN ne la décline pas.
		expect(refuse("/dx11/sound/c01000010.acb")).toContain(".acb");
	});

	test("une surface inconnue du CDN est refusée avec les formes acceptées", () => {
		// `data/common/**` n'a AUCUNE location nginx : mesuré 404 sur /common/chr/test.png.
		const raison = refuse("data/common/chr/_face/01_ie1/c01000010/c01000010.g4tx");
		expect(raison).toContain("dx11/");
		expect(raison).toContain("static/");
	});

	test("une saisie vide, trop longue ou avec un espace est refusée", () => {
		expect(refuse("")).toContain("vide");
		expect(refuse("   ")).toContain("vide");
		expect(refuse(`/dx11/${"a".repeat(320)}.png`)).toContain("trop long");
		expect(refuse("/dx11/mon fichier.png")).toContain("espace");
	});

	test("le .g4tx n'est PAS réécrit hors des surfaces de décodage", () => {
		// Sur `static/`, nginx sert le fichier tel quel : le renommer produirait un 404.
		expect(refuse("/static/azalee/public/texture.g4tx")).toContain(".g4tx");
	});
});

describe("forge des URLs d'image", () => {
	test("URL directe", () => {
		expect(urlAsset(CDN, "/dx11/a.png")).toBe("https://cdn.rosegriffon.fr/dx11/a.png");
		expect(urlAsset("https://cdn.rosegriffon.fr/", "dx11/a.png")).toBe(
			"https://cdn.rosegriffon.fr/dx11/a.png"
		);
	});

	test("URL de variante — forme exacte vérifiée en 200", () => {
		expect(urlVariante(CDN, "/dx11/menu/220_img/vsroute_map/grid_map00.png", 200)).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/220_img/vsroute_map/grid_map00.png?w=200&format=webp"
		);
	});

	test("l'asset de sonde est bien sur une surface de variante", () => {
		const r = reussi(ASSET_SONDE);
		expect(r.variante).toBe(true);
		expect(r.surface).toBe("dx11");
	});
});

describe("codes de modèle 3D", () => {
	test("personnage, keshin et armure sont reconnus", () => {
		// Codes réels : c01000010 (Mark Evans, 459 968 o), k000010 (692 132 o),
		// ka000101 (1 955 520 o) — les trois répondent 200 en model/gltf-binary.
		expect(normaliserCodeModele("c01000010")).toEqual({
			code: "c01000010",
			famille: "personnage",
		});
		expect(normaliserCodeModele("k000010")).toEqual({ code: "k000010", famille: "keshin" });
		expect(normaliserCodeModele("ka000101")).toEqual({ code: "ka000101", famille: "armure" });
	});

	test("une armure n'est jamais classée keshin", () => {
		const r = normaliserCodeModele("ka000201");
		expect("famille" in r && r.famille).toBe("armure");
	});

	test("la casse, l'extension et le préfixe d'URL sont absorbés", () => {
		expect(normaliserCodeModele("  C01000010.GLB ")).toEqual({
			code: "c01000010",
			famille: "personnage",
		});
		expect(normaliserCodeModele("https://cdn.rosegriffon.fr/model-full/ka000101.glb")).toEqual({
			code: "ka000101",
			famille: "armure",
		});
	});

	test("toute forme permettant une traversée de chemin est refusée", () => {
		for (const mauvais of ["../../etc/passwd", "c01000010/../x", "c0100 0010", "c01000010?x=1"]) {
			const r = normaliserCodeModele(mauvais);
			expect("raison" in r).toBe(true);
		}
	});

	test("un code vide ou d'une famille non assemblée est refusé", () => {
		expect("raison" in normaliserCodeModele("")).toBe(true);
		// b000001 et i000003 existent dans data/common/chr mais ne sont pas assemblés.
		const r = normaliserCodeModele("b000001");
		expect("raison" in r && r.raison).toContain("keshins");
	});

	test("URL du modèle", () => {
		expect(urlModele(CDN, "c01000010")).toBe("https://cdn.rosegriffon.fr/model-full/c01000010.glb");
	});

	test("libellés français des familles", () => {
		expect(libelleFamille("personnage")).toBe("Personnage");
		expect(libelleFamille("keshin")).toBe("Keshin");
		expect(libelleFamille("armure")).toBe("Armure");
	});

	test("le plafond de pièce jointe laisse la marge du multipart", () => {
		expect(LIMITE_PIECE_JOINTE_OCTETS).toBe(8 * 1024 * 1024);
		// Les trois modèles mesurés passent en pièce jointe.
		for (const taille of [459_968, 692_132, 1_955_520]) {
			expect(taille).toBeLessThan(LIMITE_PIECE_JOINTE_OCTETS);
		}
	});
});

describe("choix de la texture d'aperçu d'un modèle", () => {
	// Extrait RÉEL de `GET /api/cpk/search?q=c01000010&limit=10`.
	const fichiersPersonnage = [
		{ path: "data/common/sound_asset/ja/c01000010.acb", ext: "acb", name: "c01000010.acb" },
		{
			path: "data/common/chr/_face/01_ie1/c01000010/c01000010.g4md",
			ext: "g4md",
			name: "c01000010.g4md",
		},
		{
			path: "data/dx11/chr/_face/01_ie1/c01000010/c01000010.g4tx",
			ext: "g4tx",
			name: "c01000010.g4tx",
		},
		{
			path: "data/dx11/menu/200_icon/10_icon_chr/face/c01000010_l.g4tx",
			ext: "g4tx",
			name: "c01000010_l.g4tx",
		},
		{
			path: "data/dx11/chr/_face/01_ie1/c01000010/c01000010_06.g4tx",
			ext: "g4tx",
			name: "c01000010_06.g4tx",
		},
	];

	test("la texture au nom exact gagne, quel que soit l'ordre de l'index", () => {
		// Vérifié : /dx11/chr/_face/01_ie1/c01000010/c01000010.png?w=200 → 200, 3 338 octets.
		expect(choisirTextureModele("c01000010", fichiersPersonnage)).toBe(
			"/dx11/chr/_face/01_ie1/c01000010/c01000010.png"
		);
	});

	test("sans nom exact, le chemin le plus court gagne", () => {
		// `GET /api/cpk/search?q=ka000101` → une seule texture, suffixée `_10`.
		// Vérifié : /dx11/chr/_armd/ka000101/ka000101_10.png?w=200 → 200, 10 136 octets.
		expect(
			choisirTextureModele("ka000101", [
				{ path: "data/common/chr/_armd/ka000101/ka000101.g4md", ext: "g4md" },
				{ path: "data/dx11/chr/_armd/ka000101/ka000101_10.g4tx", ext: "g4tx" },
			])
		).toBe("/dx11/chr/_armd/ka000101/ka000101_10.png");
	});

	test("aucune texture dx11 exploitable → null", () => {
		expect(
			choisirTextureModele("k000020", [
				{ path: "data/common/chr/_keshin/k000020/k000020.g4mg", ext: "g4mg" },
			])
		).toBeNull();
		expect(choisirTextureModele("c01000010", [])).toBeNull();
	});
});

describe("conversion d'un chemin CPK en chemin CDN", () => {
	test("une texture dx11 est convertie", () => {
		expect(cheminCdnDepuisCpk("data/dx11/chr/_keshin/k000010/k000010.g4tx")).toBe(
			"/dx11/chr/_keshin/k000010/k000010.png"
		);
	});

	test("hors dx11 ou hors g4tx : rien à proposer", () => {
		expect(cheminCdnDepuisCpk("data/common/chr/_armd/ka000101/ka000101.g4md")).toBeNull();
		expect(cheminCdnDepuisCpk("data/dx11/chr/x/y.bin")).toBeNull();
		expect(cheminCdnDepuisCpk(null)).toBeNull();
		expect(cheminCdnDepuisCpk(undefined)).toBeNull();
	});
});

describe("catégories de galerie", () => {
	test("les douze catégories réellement peuplées sont proposées", () => {
		// Totaux relevés sur /api/gallery : aucune de ces catégories n'est vide.
		expect(CATEGORIES_GALERIE).toHaveLength(12);
		expect(CATEGORIES_GALERIE.map((c) => c.valeur)).toEqual([
			"story",
			"chronicle",
			"special",
			"kizuna",
			"other",
			"gallery_img2",
			"ev_pic",
			"stadium",
			"vsroute_map",
			"hlp",
			"telop_waza",
			"menu",
		]);
	});

	test("Discord accepte la liste : au plus 25 choix", () => {
		expect(CATEGORIES_GALERIE.length).toBeLessThanOrEqual(25);
	});

	test("libellé français, repli sur la valeur brute", () => {
		expect(libelleCategorieGalerie("telop_waza")).toBe("Télops de techniques");
		expect(libelleCategorieGalerie(null)).toBe("Toutes");
		expect(libelleCategorieGalerie("inconnue")).toBe("inconnue");
	});

	test("une page tient sous la limite de dix embeds par message", () => {
		expect(GALERIE_PAR_PAGE + 1).toBeLessThanOrEqual(10);
	});
});

describe("pagination de la galerie", () => {
	test("nombre de pages", () => {
		// Totaux réels : 1341 télops, 2370 illustrations de menu, 2 « liens ».
		expect(nombreDePages(1341, GALERIE_PAR_PAGE)).toBe(336);
		expect(nombreDePages(2370, GALERIE_PAR_PAGE)).toBe(593);
		expect(nombreDePages(2, GALERIE_PAR_PAGE)).toBe(1);
		expect(nombreDePages(0, GALERIE_PAR_PAGE)).toBe(1);
		expect(nombreDePages(10, 0)).toBe(1);
	});

	test("une page hors bornes est ramenée dans les bornes", () => {
		expect(bornerPage(0, 1341, GALERIE_PAR_PAGE)).toBe(1);
		expect(bornerPage(-5, 1341, GALERIE_PAR_PAGE)).toBe(1);
		expect(bornerPage(999_999, 1341, GALERIE_PAR_PAGE)).toBe(336);
		expect(bornerPage(Number.NaN, 1341, GALERIE_PAR_PAGE)).toBe(1);
		expect(bornerPage(3.7, 1341, GALERIE_PAR_PAGE)).toBe(3);
	});

	test("l'état fait l'aller-retour dans le customId", () => {
		const etat = { page: 42, categorie: "telop_waza", recherche: "aura" };
		const id = encoderEtatGalerie(etat);
		expect(id).toBe("cdng|42|telop_waza|aura");
		expect(decoderEtatGalerie(id as string)).toEqual(etat);
	});

	test("un état sans filtre fait aussi l'aller-retour", () => {
		const id = encoderEtatGalerie({ page: 1, categorie: null, recherche: null });
		expect(decoderEtatGalerie(id as string)).toEqual({
			page: 1,
			categorie: null,
			recherche: null,
		});
	});

	test("les séparateurs de la recherche ne cassent pas le décodage", () => {
		const id = encoderEtatGalerie({ page: 2, categorie: null, recherche: "a|b|c" });
		expect(id).not.toBeNull();
		expect(decoderEtatGalerie(id as string)?.recherche).toBe("a b c");
	});

	test("au-delà de 100 caractères, aucun bouton n'est proposé", () => {
		expect(encoderEtatGalerie({ page: 1, categorie: null, recherche: "x".repeat(120) })).toBeNull();
	});

	test("un customId étranger n'est jamais décodé", () => {
		expect(decoderEtatGalerie("tw|1|azalee|actu|x")).toBeNull();
		expect(decoderEtatGalerie("cdng|zero||")).toBeNull();
		expect(decoderEtatGalerie("cdng|0||")).toBeNull();
		expect(decoderEtatGalerie("cdng|1|")).toBeNull();
		expect(decoderEtatGalerie("")).toBeNull();
	});

	test("le préfixe et la limite Discord sont ceux annoncés", () => {
		expect(PREFIXE_BOUTON_GALERIE).toBe("cdng");
		expect(MAX_CUSTOM_ID).toBe(100);
		expect(
			(encoderEtatGalerie({ page: 1, categorie: "menu", recherche: null }) ?? "").length
		).toBeLessThanOrEqual(MAX_CUSTOM_ID);
	});
});

describe("mise en forme", () => {
	// Une décimale seulement sous 10, comme partout ailleurs dans le bot depuis
	// l'unification (`lib/ui/nombres.ts`) : au-delà, le dixième de mégaoctet
	// n'apprend rien, et deux commandes ne doivent pas peser le même fichier
	// différemment (« 11,0 Mo » ici contre « 11 Mo » sur `/cpk`).
	test("tailles réelles rendues en français", () => {
		expect(formaterOctets(192)).toBe("192 o");
		expect(formaterOctets(6_650)).toBe("6,5 Ko");
		expect(formaterOctets(97_882)).toBe("96 Ko");
		expect(formaterOctets(459_968)).toBe("449 Ko");
		expect(formaterOctets(1_955_520)).toBe("1,9 Mo");
		expect(formaterOctets(11_494_007)).toBe("11 Mo");
		expect(formaterOctets(0)).toBe("0 o");
	});

	test("une taille inconnue le dit", () => {
		expect(formaterOctets(null)).toBe("taille inconnue");
		expect(formaterOctets(undefined)).toBe("taille inconnue");
		expect(formaterOctets(-1)).toBe("taille inconnue");
		expect(formaterOctets(Number.NaN)).toBe("taille inconnue");
	});

	test("types MIME réellement renvoyés par le CDN", () => {
		expect(estTypeImage("image/webp")).toBe(true);
		expect(estTypeImage("image/png")).toBe(true);
		expect(estTypeImage("text/plain; charset=utf-8")).toBe(false);
		expect(estTypeImage(null)).toBe(false);
		expect(estTypeModele("model/gltf-binary")).toBe(true);
		expect(estTypeModele("image/webp")).toBe(false);
		expect(estTypeModele(undefined)).toBe(false);
	});

	test("l'en-tête x-cache est traduit", () => {
		expect(libelleCache("HIT")).toBe("déjà en cache");
		expect(libelleCache("MISS")).toBe("décodée à la demande");
		expect(libelleCache(null)).toBe("cache non renseigné");
	});
});

describe("description des sondes de santé", () => {
	test("charge réelle de rg-cdn.service", () => {
		// {"ok":true,"storage":"/var/www/cdn/images","assetsManifest":null}
		const lignes = decrireSanteCdn({
			ok: true,
			storage: "/var/www/cdn/images",
			assetsManifest: null,
		});
		expect(lignes[0]).toContain("/var/www/cdn/images");
		expect(lignes[1]).toContain("aucun");
	});

	test("un manifeste présent est pesé", () => {
		const lignes = decrireSanteCdn({ ok: true, storage: "/x", assetsManifest: { bytes: 2048 } });
		expect(lignes[1]).toContain("2,0 Ko");
	});

	test("charge réelle de cdn-variants.service", () => {
		// {"ok":true,"cacheRoot":"/var/cache/cdn-variants","widths":[200,400,800,1600],"quality":78}
		const lignes = decrireSanteVariantes({
			ok: true,
			cacheRoot: "/var/cache/cdn-variants",
			widths: [200, 400, 800, 1600],
			quality: 78,
		});
		expect(lignes[0]).toContain("`1600`");
		expect(lignes[1]).toContain("78");
		expect(lignes[2]).toContain("/var/cache/cdn-variants");
	});

	test("une sonde muette ne fabrique aucune valeur", () => {
		expect(decrireSanteCdn(null)).toEqual(["Sonde muette."]);
		expect(decrireSanteVariantes(null)).toEqual(["Sonde muette."]);
		expect(decrireSanteVariantes({ ok: true })[0]).toContain("non annoncées");
	});
});
