/**
 * Tests de `azalee-format.ts` — module PUR, zéro réseau.
 *
 * Les URL et les textes utilisés ici sont des valeurs RÉELLES relevées le
 * 13/8/2026 sur l'API Azalée (`http://127.0.0.1:8807`) et vérifiées par `curl`
 * sur `cdn.rosegriffon.fr` : chaque cas d'image dit ce que renvoie la forme
 * d'origine (404/502) et ce que renvoie la forme corrigée (200).
 */
import { describe, expect, test } from "bun:test";

import {
	bornerPage,
	CATEGORIES_GALERIE,
	cheminCpkDepuisUrl,
	classerPropositions,
	corrigerCheminIconeChr,
	decouperEnChamps,
	decoderEtatListe,
	encoderEtatListe,
	formaterNombre,
	formaterPourcentage,
	imageJeu,
	joindre,
	libelleCategorieGalerie,
	libelleCategorieSucces,
	libelleGenreQuete,
	libelleRoleCoordinateur,
	libelleTypeAura,
	ligneStats,
	nettoyerRubis,
	nettoyerTexteJeu,
	nombreDePages,
	resoudreCategorieGalerie,
	resoudreTypeAura,
	texteFr,
	TYPES_AURA,
	urlIllustrationQuete,
	urlModele3d,
	urlVisage,
	COULEURS_ELEMENT,
	couleurElement,
	emojiCategorie,
	emojiElement,
	emojiPosition,
	titreFiche,
} from "./azalee-format";

describe("texteFr", () => {
	test("préfère le français", () => {
		expect(texteFr({ fr: "Tornade", en: "Swoop", ja: "翼" })).toBe("Tornade");
	});

	test("replie sur l'anglais puis le japonais", () => {
		expect(texteFr({ fr: null, en: "Swoop", ja: "翼" })).toBe("Swoop");
		expect(texteFr({ fr: "", en: "   ", ja: "翼" })).toBe("翼");
	});

	test("renvoie le repli quand tout est vide", () => {
		expect(texteFr({}, "Inconnu")).toBe("Inconnu");
		expect(texteFr(null, "—")).toBe("—");
	});
});

describe("nettoyerTexteJeu", () => {
	// Valeur réelle de `inagle_passives.text_raw` (`/api/passives?q=tir`).
	const brut =
		"Après récupération du ballon (sauf arrêt), \\nATT des tirs de l'équipe [CPASSIVE01]+<VALUE> %[C] pendant 30 sec";

	test("retire les balises de couleur du moteur", () => {
		expect(nettoyerTexteJeu(brut)).not.toContain("[CPASSIVE01]");
		expect(nettoyerTexteJeu(brut)).not.toContain("[C]");
	});

	test("substitue <VALUE> quand la valeur est connue", () => {
		expect(nettoyerTexteJeu(brut, 10)).toContain("+10 %");
	});

	test("convertit les retours-ligne échappés", () => {
		expect(nettoyerTexteJeu(brut, 10).split("\n")).toHaveLength(2);
	});

	test("tolère l'absence de texte", () => {
		expect(nettoyerTexteJeu(null)).toBe("");
		expect(nettoyerTexteJeu(undefined)).toBe("");
	});
});

describe("nettoyerRubis", () => {
	test("garde le kanji et retire la lecture", () => {
		// Valeur réelle du japonais de `cps20008_03`.
		expect(nettoyerRubis("キャッチ[以外/いがい]でボール[奪還後/だっかんご]")).toBe(
			"キャッチ以外でボール奪還後"
		);
	});

	test("laisse un texte sans annotation intact", () => {
		expect(nettoyerRubis("シュートＡＴ＋10％")).toBe("シュートＡＴ＋10％");
	});
});

describe("joindre", () => {
	test("ignore les morceaux absents", () => {
		expect(joindre(["a", null, "", undefined, "b"])).toBe("a · b");
	});

	test("renvoie une chaîne vide si tout manque", () => {
		expect(joindre([null, undefined, "  "])).toBe("");
	});
});

describe("ligneStats", () => {
	test("rend les sept statistiques dans l'ordre du wiki", () => {
		// Statistiques niveau 99 réelles de Mark Evans (variante Normal).
		const ligne = ligneStats({
			kick: 133,
			control: 146,
			technique: 137,
			pressure: 164,
			physical: 157,
			agility: 166,
			intelligence: 150,
		});
		expect(ligne).toBe(
			"Frappe **133** · Contrôle **146** · Technique **137** · Pression **164** · Physique **157** · Agilité **166** · Intelligence **150**"
		);
	});

	test("renvoie null quand aucune statistique n'est chiffrée", () => {
		expect(ligneStats({})).toBeNull();
		expect(ligneStats(null)).toBeNull();
	});
});

describe("formaterNombre / formaterPourcentage", () => {
	test("formate en français", () => {
		// Intl place une espace fine insécable : on compare sans les espaces.
		expect(formaterNombre(1716).replaceAll(/\s+/g, " ")).toBe("1 716");
		expect(formaterPourcentage(0.4972375690607735, 1).replaceAll(/\s+/g, " ")).toBe("0,5 %");
	});

	test("renvoie un tiret pour une valeur absente", () => {
		expect(formaterNombre(null)).toBe("—");
		expect(formaterPourcentage(Number.NaN)).toBe("—");
	});
});

describe("decouperEnChamps", () => {
	test("regroupe les lignes sans dépasser la limite d'un champ", () => {
		const lignes = Array.from({ length: 40 }, (_v, i) => `ligne ${i}`.padEnd(100, "."));
		const blocs = decouperEnChamps(lignes);
		expect(blocs.length).toBeGreaterThan(1);
		for (const bloc of blocs) {
			expect(bloc.length).toBeLessThanOrEqual(1024);
		}
	});

	test("tronque une ligne seule plus longue que la limite", () => {
		const [bloc] = decouperEnChamps(["x".repeat(3000)]);
		expect(bloc).toHaveLength(1024);
		expect(bloc?.endsWith("…")).toBe(true);
	});

	test("respecte le plafond de champs", () => {
		const lignes = Array.from({ length: 200 }, () => "y".repeat(1000));
		expect(decouperEnChamps(lignes, { maxChamps: 3 })).toHaveLength(3);
	});

	test("ne produit rien pour une liste vide", () => {
		expect(decouperEnChamps([])).toEqual([]);
	});
});

describe("corrigerCheminIconeChr", () => {
	test("répare le dossier ET le nom d'une icône d'esprit guerrier", () => {
		// Origine `/api/auras/esprits-guerriers` → 404 ; forme corrigée → 200.
		expect(corrigerCheminIconeChr("/dx11/menu/icon_chr/aura_fs/k000520_l_k000520_l00.png")).toBe(
			"/dx11/menu/200_icon/10_icon_chr/aura_fs/k000520_l.g4tx/k000520_l00.png"
		);
	});

	test("répare une icône de totem", () => {
		// Mesuré 200, 71 973 octets, image/png.
		expect(corrigerCheminIconeChr("/dx11/menu/icon_chr/aura_soul/a000250_l_a000250_l00.png")).toBe(
			"/dx11/menu/200_icon/10_icon_chr/aura_soul/a000250_l.g4tx/a000250_l00.png"
		);
	});

	test("garde la texture du visage plutôt que le conteneur entier", () => {
		// Un visage a DEUX textures : `_1_l00` (portrait) et `_2_l00` (seconde pose).
		// Demander le conteneur entier laisse le CDN choisir, et il rend `_2_l00`.
		// Forme nommée mesurée 200, 23 802 octets, image/png.
		expect(corrigerCheminIconeChr("/dx11/menu/icon_chr/face/c05026530_l_c05026530_1_l00.png")).toBe(
			"/dx11/menu/200_icon/10_icon_chr/face/c05026530_l.g4tx/c05026530_1_l00.png"
		);
	});

	test("laisse intact un chemin qui n'est pas une icône de personnage", () => {
		const telop = "/dx11/menu/220_img/telop_waza/fr/k000520_k000520.png";
		expect(corrigerCheminIconeChr(telop)).toBe(telop);
	});
});

describe("imageJeu", () => {
	test("corrige le nom doublé d'un télop de technique", () => {
		// `whd00990_whd00990.png` → 404 ; `whd00990.png` → 200 (327 716 octets).
		expect(
			imageJeu("https://cdn.rosegriffon.fr/dx11/menu/220_img/telop_waza/fr/whd00990_whd00990.png")
		).toBe("https://cdn.rosegriffon.fr/dx11/menu/220_img/telop_waza/fr/whd00990.png");
	});

	test("corrige le nom doublé d'un stade DÉJÀ porteur d'une variante", () => {
		// L'API sert la forme doublée AVEC `?w=400` : mesuré 502. Forme simple : 200.
		expect(
			imageJeu(
				"https://cdn.rosegriffon.fr/dx11/menu/220_img/stadium/img_room_s90g001_img_room_s90g001.png?w=400&format=webp",
				400
			)
		).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/220_img/stadium/img_room_s90g001.png?w=400&format=webp"
		);
	});

	test("demande une variante WebP sur les grandes illustrations", () => {
		// Une planche `gallery_img2` brute pèse jusqu'à 12 Mo, la variante w=400 ~13 Ko.
		expect(
			imageJeu(
				"https://cdn.rosegriffon.fr/dx11/menu/220_img/gallery_img2/img_story_ev01_main_0010_img_story_ev01_main_0010.png",
				400
			)
		).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/220_img/gallery_img2/img_story_ev01_main_0010.png?w=400&format=webp"
		);
	});

	test("répare l'icône d'aura et lui demande sa variante", () => {
		// Mesuré 200, 11 088 octets, image/webp.
		expect(
			imageJeu(
				"https://cdn.rosegriffon.fr/dx11/menu/icon_chr/aura_fs/k000520_l_k000520_l00.png",
				200
			)
		).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/200_icon/10_icon_chr/aura_fs/k000520_l.g4tx/k000520_l00.png?w=200&format=webp"
		);
	});

	test("laisse passer une icône d'objet en texture nommée", () => {
		// C'est la forme que sert l'API depuis que le CDN sait extraire une texture
		// d'un conteneur. Mesuré 200, 9 006 octets, image/webp.
		expect(
			imageJeu(
				"https://cdn.rosegriffon.fr/dx11/menu/200_icon/02_icon_item/icon_item05.g4tx/eq_ac0100101.png",
				200
			)
		).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/200_icon/02_icon_item/icon_item05.g4tx/eq_ac0100101.png?w=200&format=webp"
		);
	});

	test("refuse le nommage du dump archivé", () => {
		// Le dump collait le nom du conteneur à celui de la texture. Ce nommage
		// n'existe dans aucun des 250 800 chemins du CPK : 404 par construction.
		expect(
			imageJeu(
				"https://cdn.rosegriffon.fr/dx11/menu/200_icon/02_icon_item/icon_item05_eq_ac0105301.png"
			)
		).toBeNull();
		expect(imageJeu("https://cdn.rosegriffon.fr/dx11/menu/200_icon/02_icon_item/.webp")).toBeNull();
	});

	test("refuse le repli local de l'API", () => {
		expect(imageJeu("/ievr.webp")).toBeNull();
		expect(imageJeu(null)).toBeNull();
		expect(imageJeu("pas une url")).toBeNull();
	});

	test("ne pose pas de variante hors du CDN qui sait les servir", () => {
		// Les portraits `zukan` sont sur CloudFront : `?w=` n'y redimensionne rien.
		const portrait = "https://dxi4wb638ujep.cloudfront.net/1/k/v/w/vwj02v5fvcs.png";
		expect(imageJeu(portrait, 400)).toBe(portrait);
	});
});

describe("cheminCpkDepuisUrl", () => {
	test("retrouve le fichier source d'une illustration de quête", () => {
		expect(
			cheminCpkDepuisUrl(
				"https://cdn.rosegriffon.fr/dx11/menu/220_img/quest_img/story_img001_l01.png"
			)
		).toBe("data/dx11/menu/220_img/quest_img/story_img001_l01.g4tx");
	});

	test("ignore la chaîne de requête de variante", () => {
		expect(
			cheminCpkDepuisUrl(
				"https://cdn.rosegriffon.fr/dx11/menu/200_icon/10_icon_chr/face/c05026530_l.png?w=200&format=webp"
			)
		).toBe("data/dx11/menu/200_icon/10_icon_chr/face/c05026530_l.g4tx");
	});

	test("renvoie null hors du décodage CPK", () => {
		expect(cheminCpkDepuisUrl("https://cdn.rosegriffon.fr/model-full/k000520.glb")).toBeNull();
		expect(
			cheminCpkDepuisUrl("https://dxi4wb638ujep.cloudfront.net/1/k/v/w/vwj02v5fvcs.png")
		).toBeNull();
		expect(cheminCpkDepuisUrl(null)).toBeNull();
	});
});

describe("urlVisage / urlModele3d", () => {
	test("forge le chemin réellement servi", () => {
		expect(urlVisage("c05026530")).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/200_icon/10_icon_chr/face/c05026530_l.png"
		);
	});

	test("retire le suffixe de variante de statistiques", () => {
		// `c01000010_5000` est une variante de PARAMÈTRES ; l'asset n'existe qu'au code de base.
		expect(urlVisage("c01000010_5000")).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/200_icon/10_icon_chr/face/c01000010_l.png"
		);
	});

	test("refuse un code impossible", () => {
		expect(urlVisage("")).toBeNull();
		expect(urlVisage("../../etc")).toBeNull();
		expect(urlVisage(null)).toBeNull();
	});

	test("forge l'URL du modèle 3D complet d'un personnage", () => {
		// 11/11 codes `c########` mesurés à 200 sur `nie-model-serve` (345–480 Ko).
		expect(urlModele3d("c01000010")).toBe("https://cdn.rosegriffon.fr/model-full/c01000010.glb");
		expect(urlModele3d("c05026530")).toBe("https://cdn.rosegriffon.fr/model-full/c05026530.glb");
	});

	test("retire le suffixe de variante de paramètres", () => {
		// `c01000010_5000` est la variante retenue par `/azalee perso` pour Mark
		// Evans : `/model-full/c01000010_5000.glb` répond 404, la base répond 200.
		expect(urlModele3d("c01000010_5000")).toBe(
			"https://cdn.rosegriffon.fr/model-full/c01000010.glb"
		);
	});

	test("refuse tout code dont le modèle n'est PAS servi", () => {
		// Mesuré 404 : entraîneur, esprit guerrier sous ses trois écritures.
		expect(urlModele3d("COORD_55")).toBeNull();
		expect(urlModele3d("k000520")).toBeNull();
		expect(urlModele3d("ka000520")).toBeNull();
		expect(urlModele3d("wkk00520")).toBeNull();
		expect(urlModele3d("a b")).toBeNull();
		expect(urlModele3d(null)).toBeNull();
	});
});

describe("urlIllustrationQuete", () => {
	test("forge le chemin réellement servi", () => {
		// Mesuré : la variante w=800 répond 200 (27 338 octets).
		expect(urlIllustrationQuete("story_img001_l01")).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/220_img/quest_img/story_img001_l01.png"
		);
		expect(urlIllustrationQuete("game_img01")).toBe(
			"https://cdn.rosegriffon.fr/dx11/menu/220_img/quest_img/game_img01.png"
		);
	});

	test("refuse une quête sans code d'image (45 des 182)", () => {
		expect(urlIllustrationQuete(null)).toBeNull();
		expect(urlIllustrationQuete("")).toBeNull();
		expect(urlIllustrationQuete("../../etc/passwd")).toBeNull();
	});
});

describe("catégories de galerie", () => {
	test("les onze valeurs sont celles acceptées par l'API", () => {
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
		]);
	});

	test("aucune catégorie annoncée n'est vide", () => {
		for (const categorie of CATEGORIES_GALERIE) {
			expect(categorie.total).toBeGreaterThan(0);
		}
	});

	test("résout par valeur et par libellé, sans accent ni casse", () => {
		expect(resoudreCategorieGalerie("story")).toBe("story");
		expect(resoudreCategorieGalerie("Chroniques")).toBe("chronicle");
		expect(resoudreCategorieGalerie("EVENEMENTS")).toBe("ev_pic");
	});

	test("refuse une catégorie inconnue plutôt que de renvoyer du vide", () => {
		expect(resoudreCategorieGalerie("illustrations")).toBeNull();
		expect(resoudreCategorieGalerie(null)).toBeNull();
	});

	test("libelle une catégorie connue", () => {
		expect(libelleCategorieGalerie("telop_waza")).toBe("Techniques");
		expect(libelleCategorieGalerie("inconnue")).toBe("inconnue");
	});
});

describe("libelleRoleCoordinateur", () => {
	test("traduit les trois rôles réellement servis par /api/coordinators", () => {
		// Mesuré sur les 102 lignes : Manager 68, Coordinator 31, Coach 3.
		expect(libelleRoleCoordinateur("Coordinator")).toBe("Coordinateur");
		expect(libelleRoleCoordinateur("Manager")).toBe("Manager");
		expect(libelleRoleCoordinateur("Coach")).toBe("Coach");
	});

	test("laisse passer un rôle inconnu et ignore l'absence", () => {
		expect(libelleRoleCoordinateur("Sponsor")).toBe("Sponsor");
		expect(libelleRoleCoordinateur("")).toBeNull();
		expect(libelleRoleCoordinateur(null)).toBeNull();
	});
});

describe("libellés de quête et de succès", () => {
	test("traduit les deux genres réels de quête", () => {
		expect(libelleGenreQuete("main")).toBe("Quête principale");
		expect(libelleGenreQuete("side")).toBe("Quête annexe");
		expect(libelleGenreQuete(null)).toBe("Quête");
	});

	test("traduit les deux catégories réelles de succès", () => {
		expect(libelleCategorieSucces("trophy")).toBe("Trophée");
		expect(libelleCategorieSucces("activity")).toBe("Activité");
		expect(libelleCategorieSucces("autre")).toBe("autre");
	});
});

describe("familles d'aura", () => {
	test("les six slugs sont ceux acceptés par l'API", () => {
		expect(TYPES_AURA.map((t) => t.slug)).toEqual([
			"esprits-guerriers",
			"totems",
			"miximax",
			"eveil",
			"changement-mode",
			"autres",
		]);
	});

	test("résout par slug et par libellé, sans accent ni casse", () => {
		expect(resoudreTypeAura("esprits-guerriers")).toBe("esprits-guerriers");
		expect(resoudreTypeAura("Éveils")).toBe("eveil");
		expect(resoudreTypeAura("CHANGEMENTS DE MODE")).toBe("changement-mode");
	});

	test("refuse un slug inconnu plutôt que de renvoyer du vide", () => {
		// `/api/auras/aura` répond `{"data":[],"total":0}` : mesuré.
		expect(resoudreTypeAura("aura")).toBeNull();
		expect(resoudreTypeAura(null)).toBeNull();
	});

	test("libelle une famille connue", () => {
		expect(libelleTypeAura("totems")).toBe("Totems");
		expect(libelleTypeAura("inconnue")).toBe("inconnue");
	});
});

describe("pagination", () => {
	test("compte les pages", () => {
		expect(nombreDePages(360, 10)).toBe(36);
		expect(nombreDePages(361, 10)).toBe(37);
		expect(nombreDePages(0, 10)).toBe(1);
	});

	test("ramène une page hors bornes dans les limites", () => {
		expect(bornerPage(99, 360, 10)).toBe(36);
		expect(bornerPage(-4, 360, 10)).toBe(1);
		expect(bornerPage(Number.NaN, 360, 10)).toBe(1);
	});

	test("l'état d'une liste fait l'aller-retour", () => {
		const etat = { vue: "galerie", page: 3, filtre: "story", recherche: "ev01" };
		const identifiant = encoderEtatListe(etat);
		expect(identifiant).toBe("az|galerie|3|story|ev01");
		expect(decoderEtatListe(identifiant as string)).toEqual(etat);
	});

	test("le séparateur saisi par un membre ne casse pas le décodage", () => {
		const identifiant = encoderEtatListe({
			vue: "galerie",
			page: 1,
			filtre: null,
			recherche: "a|b",
		});
		expect(decoderEtatListe(identifiant as string)?.recherche).toBe("a b");
	});

	test("renvoie null au-delà de la limite Discord de 100 caractères", () => {
		expect(
			encoderEtatListe({ vue: "galerie", page: 1, filtre: null, recherche: "z".repeat(120) })
		).toBeNull();
	});

	test("rejette un customId étranger", () => {
		expect(decoderEtatListe("tw|1|inazuma||")).toBeNull();
		expect(decoderEtatListe("az|galerie|0||")).toBeNull();
		expect(decoderEtatListe("az||1||")).toBeNull();
	});
});

describe("classerPropositions", () => {
	const equipes = [
		{ nom: "Raimon" },
		{ nom: "Royal Academy" },
		{ nom: "Inazuma Japan" },
		{ nom: "Zeus" },
		{ nom: "Ultra Raimon" },
	];

	test("place les préfixes avant les inclusions", () => {
		expect(classerPropositions(equipes, "ra", (e) => e.nom).map((e) => e.nom)).toEqual([
			"Raimon",
			"Ultra Raimon",
		]);
	});

	test("ignore accents et casse", () => {
		expect(classerPropositions([{ nom: "Forêt" }], "FORET", (e) => e.nom)).toHaveLength(1);
	});

	test("plafonne à 25 propositions", () => {
		const beaucoup = Array.from({ length: 100 }, (_v, i) => ({ nom: `equipe ${i}` }));
		expect(classerPropositions(beaucoup, "", (e) => e.nom)).toHaveLength(25);
		expect(classerPropositions(beaucoup, "equipe", (e) => e.nom)).toHaveLength(25);
	});
});

describe("identité visuelle des fiches", () => {
	test("la couleur suit l'élément, quelle que soit la langue rendue par l'API", () => {
		// L'API rend l'élément en fr, en ou ja selon la route : la couleur ne doit
		// pas dépendre de laquelle on regarde.
		expect(couleurElement("Feu")).toBe(0xa1_4b_3f);
		expect(couleurElement("Fire")).toBe(0xa1_4b_3f);
		expect(couleurElement("火")).toBe(0xa1_4b_3f);
		expect(couleurElement("Montagne")).toBe(0xd4_af_37);
		// `Aucun` est la seconde écriture du néant en base (9 lignes).
		expect(couleurElement("Aucun")).toBe(COULEURS_ELEMENT.Néant);
	});

	test("un élément inconnu ne force aucune couleur", () => {
		// `null` laisse l'embed garder la couleur du profil plutôt que d'inventer.
		expect(couleurElement("Ténèbres")).toBeNull();
		expect(couleurElement(null)).toBeNull();
		expect(couleurElement("")).toBeNull();
	});

	test("chaque élément, catégorie et position a son émoji", () => {
		expect(emojiElement("Vent")).toBe("🌪️");
		expect(emojiElement("Wind")).toBe("🌪️");
		expect(emojiCategorie("Tir")).toBe("⚽");
		expect(emojiCategorie("Shoot")).toBe("⚽");
		expect(emojiPosition("Gardien")).toBe("🧤");
		// Inconnu : chaîne vide, jamais un émoji par défaut trompeur.
		expect(emojiElement("Ténèbres")).toBe("");
		expect(emojiCategorie(null)).toBe("");
	});

	test("le titre reste sous la limite de Discord et n'ouvre pas sur une espace", () => {
		expect(titreFiche("Mark Evans", "🔥", "Attaquant")).toBe("🔥 Mark Evans — Attaquant");
		expect(titreFiche("Mark Evans", "", null)).toBe("Mark Evans");
		expect(titreFiche("Mark Evans", null, "")).toBe("Mark Evans");
		const long = titreFiche("x".repeat(400), "🔥", "Attaquant");
		expect(long.length).toBe(250);
		expect(long.endsWith("…")).toBe(true);
	});
});
