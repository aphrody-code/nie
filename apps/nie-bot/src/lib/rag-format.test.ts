/**
 * Mise en forme du corpus RAG — garde-fous.
 *
 * Les fixtures ne sont PAS inventées : ce sont des réponses réelles de
 * `rag-api` (`http://127.0.0.1:8806/search`) et de l'API Azalée
 * (`http://127.0.0.1:8807/api/text*`), relevées le 13/8/2026, réduites au
 * strict nécessaire. Chaque cas limite testé ici correspond à une forme
 * réellement observée dans le corpus.
 */
import { describe, expect, test } from "bun:test";

import {
	blocCode,
	blocSondes,
	bornerEntier,
	champsRechercheTexte,
	champsTexteMultilingue,
	compacterLignes,
	construireChampsResultats,
	dateFr,
	descriptionRecherche,
	estIdentifiantTexte,
	estTypeRag,
	formaterScore,
	K_MAX_RAG,
	LANGAGE_BLOC,
	libelleType,
	lienResultat,
	ligneSonde,
	LIMITES_EMBED,
	longueurExtrait,
	nomChampResultat,
	nombreFr,
	normaliserIdentifiantTexte,
	normaliserRequete,
	requeteValide,
	resumerCategoriesTexte,
	sourceLisible,
	surUneLigne,
	titreResultat,
	tronquer,
	TYPES_RAG,
	valeurChampResultat,
	type ResultatRag,
	type StatCategorieTexte,
} from "./rag-format";

/** Les espaces fines insécables de `fr-FR` cassent toute comparaison littérale. */
function espacesNormalisees(texte: string): string {
	return texte.replaceAll(/\s+/g, " ");
}

function resultat(partiel: Partial<ResultatRag>): ResultatRag {
	return {
		id: "x#0",
		source_id: "x",
		source_kind: "doc",
		title: "titre",
		url: null,
		lang: null,
		content: "contenu",
		meta: {},
		score: 0.0164,
		...partiel,
	};
}

// Fixture réelle — GET /search?q=technique%20de%20tir&k=1&kinds=lua
const FRAGMENT_LUA: ResultatRag = {
	id: "lua-/home/ubuntu/data/lua_scripts/boost_stats.lua#0",
	source_id: "lua-/home/ubuntu/data/lua_scripts/boost_stats.lua",
	source_kind: "lua",
	title: "boost_stats.lua",
	url: null,
	lang: "code",
	content:
		'[lua] boost_stats.lua :: main\nlocal function main()\n    print("=== Boost Stats v1.0 ===")\n    print(string.format("Multiplicateur: x%.1f", MULTIPLIER))',
	meta: { file: "/home/ubuntu/data/lua_scripts/boost_stats.lua", symbol: "main" },
	score: 0.01639344262295082,
};

// Fixture réelle — GET /search?q=technique%20de%20tir&k=1&kinds=text
// Le titre est MULTILIGNE : c'est le cas qui interdit de « retirer la première ligne ».
const FRAGMENT_TEXTE: ResultatRag = {
	id: "gametext-help-0x71E004B8#0",
	source_id: "gametext-help-0x71E004B8",
	source_kind: "text",
	title:
		"Une technique de tir qui s'active en réaction au tir d'un adversaire.\nSi votre ATT est supérieure, le ballon se renforce et rebondit directement\nvers le but adverse.",
	url: null,
	lang: "mul",
	content:
		"[text] Une technique de tir qui s'active en réaction au tir d'un adversaire.\nSi votre ATT est supérieure, le ballon se renforce et rebondit directement\nvers le but adverse.\nfr: Une technique de tir qui s'active en réaction au tir d'un adversaire.\nen: A Shot Move that activates in response to an opponent",
	meta: { hashId: "0x71E004B8", symbol: null, locales: ["fr", "en", "ja"], category: "help" },
	score: 0.031754032258064516,
};

// Fixture réelle — GET /search?q=Qui%20est%20Mark%20Evans...&k=3&kinds=sqlite
const FRAGMENT_WIKI: ResultatRag = {
	id: "chara-0x353553B4#0",
	source_id: "chara-0x353553B4",
	source_kind: "sqlite",
	title: "Mark Evans",
	url: "https://azalee.rosegriffon.fr/chara/0x353553B4",
	lang: "fr",
	content:
		"[sqlite] Mark Evans\nPersonnage: Mark Evans / Mark Evans / 円堂 守\nPoste: Gardien\nÉlément: Montagne",
	meta: { table: "inagle_characters", symbol: null, element: "Montagne", position: "Gardien" },
	score: 0.01639344262295082,
};

describe("tronquer", () => {
	test("respecte la limite EXACTE, ellipse comprise", () => {
		expect(tronquer("abcdefghij", 5)).toHaveLength(5);
		expect(tronquer("abcdefghij", 5).endsWith("…")).toBe(true);
	});

	test("laisse intact ce qui tient", () => {
		expect(tronquer("court", 20)).toBe("court");
	});

	test("une limite nulle ou négative rend une chaîne vide plutôt que de lever", () => {
		expect(tronquer("abc", 0)).toBe("");
		expect(tronquer("abc", -4)).toBe("");
	});
});

describe("surUneLigne", () => {
	test("écrase les retours à la ligne d'un titre multiligne", () => {
		expect(surUneLigne(FRAGMENT_TEXTE.title ?? "")).not.toContain("\n");
	});
});

describe("normaliserRequete / requeteValide", () => {
	test("le contrat de rag-api est de 2 caractères minimum", () => {
		expect(requeteValide(normaliserRequete("  a  "))).toBe(false);
		expect(requeteValide(normaliserRequete("ab"))).toBe(true);
	});

	test("les espaces multiples d'un collage Discord sont réduits", () => {
		expect(normaliserRequete("Mark   Evans\n\ngardien")).toBe("Mark Evans gardien");
	});
});

describe("bornerEntier", () => {
	test("borne dans l'intervalle", () => {
		expect(bornerEntier(99, 1, 25, 5)).toBe(25);
		expect(bornerEntier(0, 1, 25, 5)).toBe(1);
		expect(bornerEntier(7, 1, 25, 5)).toBe(7);
	});

	test("replie sur le défaut quand la valeur est absente ou non finie", () => {
		expect(bornerEntier(undefined, 1, 25, 5)).toBe(5);
		expect(bornerEntier(null, 1, 25, 5)).toBe(5);
		expect(bornerEntier(Number.NaN, 1, 25, 5)).toBe(5);
	});

	test("tronque un décimal au lieu de le laisser passer à Discord", () => {
		expect(bornerEntier(4.9, 1, 25, 5)).toBe(4);
	});
});

describe("types du corpus", () => {
	test("les onze types de rag-api sont couverts, et tous étiquetés", () => {
		expect(TYPES_RAG).toHaveLength(11);
		for (const type of TYPES_RAG) {
			expect(estTypeRag(type)).toBe(true);
			expect(libelleType(type).length).toBeGreaterThan(0);
			expect(LANGAGE_BLOC).toHaveProperty(type);
		}
	});

	test("un type inconnu est refusé mais reste affichable tel quel", () => {
		expect(estTypeRag("pdf")).toBe(false);
		expect(estTypeRag(null)).toBe(false);
		expect(libelleType("pdf")).toBe("pdf");
	});

	test("cfg est rendu en json — les cfg.bin sont indexés convertis", () => {
		expect(LANGAGE_BLOC.cfg).toBe("json");
	});

	test("les types de prose n'ont pas de bloc de code", () => {
		expect(LANGAGE_BLOC.sqlite).toBeNull();
		expect(LANGAGE_BLOC.tweet).toBeNull();
		expect(LANGAGE_BLOC.text).toBeNull();
	});
});

describe("retirerEntete", () => {
	test("retire l'en-tête avec symbole", () => {
		const extrait = valeurChampResultat(FRAGMENT_LUA, 400);
		expect(extrait).not.toContain("[lua] boost_stats.lua :: main");
		expect(extrait).toContain("local function main()");
	});

	test("retire un en-tête MULTILIGNE (titre du type text)", () => {
		const extrait = valeurChampResultat(FRAGMENT_TEXTE, 400);
		expect(extrait.startsWith("fr: Une technique de tir")).toBe(true);
	});

	test("retire l'en-tête sans symbole", () => {
		const extrait = valeurChampResultat(FRAGMENT_WIKI, 400);
		expect(extrait.startsWith("Personnage: Mark Evans")).toBe(true);
	});

	test("laisse le contenu intact quand il ne porte pas l'en-tête attendu", () => {
		const brut = resultat({ source_kind: "doc", title: "Autre", content: "Sans en-tête du tout." });
		expect(valeurChampResultat(brut, 400)).toContain("Sans en-tête du tout.");
	});
});

describe("compacterLignes", () => {
	test("réduit les lignes vides en série et les espaces de fin", () => {
		expect(compacterLignes("a   \n\n\n\nb\n")).toBe("a\n\nb");
	});
});

describe("blocCode", () => {
	test("ouvre une clôture plus longue que la plus longue série d'accents du texte", () => {
		const bloc = blocCode("avant ``` après", "lua");
		expect(bloc.startsWith("````lua\n")).toBe(true);
		expect(bloc.endsWith("\n````")).toBe(true);
		// Le contenu n'est jamais altéré : on l'entoure, on ne le réécrit pas.
		expect(bloc).toContain("avant ``` après");
	});

	test("clôture standard à trois accents quand le texte n'en contient pas", () => {
		expect(blocCode("local x = 1", "lua")).toBe("```lua\nlocal x = 1\n```");
	});

	test("sans langage, la clôture reste valide", () => {
		expect(blocCode("brut", null)).toBe("```\nbrut\n```");
	});
});

describe("longueurExtrait", () => {
	test("plus il y a de résultats, plus la part de chacun se réduit", () => {
		expect(longueurExtrait(1)).toBeGreaterThan(longueurExtrait(25));
	});

	test("reste entre le seuil de lisibilité et le plafond", () => {
		for (let n = 1; n <= 25; n++) {
			expect(longueurExtrait(n)).toBeGreaterThanOrEqual(140);
			expect(longueurExtrait(n)).toBeLessThanOrEqual(700);
		}
	});
});

describe("lienResultat / sourceLisible", () => {
	test("une fiche du wiki porte son lien", () => {
		expect(lienResultat(FRAGMENT_WIKI)).toBe("https://azalee.rosegriffon.fr/chara/0x353553B4");
	});

	test("un fragment de disque n'a pas de lien mais un chemin", () => {
		expect(lienResultat(FRAGMENT_LUA)).toBeNull();
		expect(sourceLisible(FRAGMENT_LUA)).toBe("/home/ubuntu/data/lua_scripts/boost_stats.lua");
	});

	test("sans fichier ni lien, on retombe sur l'identifiant de source", () => {
		expect(sourceLisible(FRAGMENT_TEXTE)).toBe("gametext-help-0x71E004B8");
	});

	test("une url relative n'est pas un lien cliquable", () => {
		expect(lienResultat(resultat({ url: "/chara/0x1" }))).toBeNull();
	});
});

describe("formaterScore", () => {
	test("rend le score RRF brut, sans le maquiller en pourcentage", () => {
		expect(formaterScore(0.01639344262295082)).toBe("0.0164");
		expect(formaterScore(Number.NaN)).toBe("—");
	});
});

describe("titreResultat / nomChampResultat", () => {
	test("le nom du champ porte le rang et le type en français", () => {
		expect(nomChampResultat(FRAGMENT_WIKI, 1)).toBe("1. [fiche du wiki] Mark Evans");
	});

	test("un titre absent retombe sur l'identifiant de source", () => {
		expect(titreResultat(resultat({ title: null, source_id: "poc-doc-inagle.md" }))).toBe(
			"poc-doc-inagle.md"
		);
	});

	test("un titre démesuré reste sous la limite de nom de champ", () => {
		const long = resultat({ title: "z".repeat(900) });
		expect(nomChampResultat(long, 12).length).toBeLessThanOrEqual(LIMITES_EMBED.nomChamp);
	});
});

describe("valeurChampResultat", () => {
	test("ne dépasse jamais la limite de valeur de champ", () => {
		const enorme = resultat({ source_kind: "lua", title: "gros.lua", content: "x".repeat(50_000) });
		expect(valeurChampResultat(enorme, 5_000).length).toBeLessThanOrEqual(
			LIMITES_EMBED.valeurChamp
		);
	});

	test("le code part en bloc de code, la prose non", () => {
		expect(valeurChampResultat(FRAGMENT_LUA, 300)).toContain("```lua");
		expect(valeurChampResultat(FRAGMENT_WIKI, 300)).not.toContain("```");
	});

	test("porte toujours une provenance et un score", () => {
		const valeur = valeurChampResultat(FRAGMENT_LUA, 300);
		expect(valeur).toContain("/home/ubuntu/data/lua_scripts/boost_stats.lua");
		expect(valeur).toContain("score 0.0164");
		expect(valeur).toContain("langue code");
	});
});

describe("construireChampsResultats", () => {
	const beaucoup = Array.from({ length: 40 }, (_, i) =>
		resultat({
			id: `r${i}`,
			source_id: `r${i}`,
			title: `Résultat ${i}`,
			content: `[doc] Résultat\n${"y".repeat(2_000)}`,
		})
	);

	test("ne dépasse jamais 25 champs, quelle que soit la demande", () => {
		const { champs, ignores } = construireChampsResultats(beaucoup, LIMITES_EMBED.total);
		expect(champs.length).toBeLessThanOrEqual(LIMITES_EMBED.champs);
		expect(ignores).toBe(beaucoup.length - champs.length);
	});

	test("respecte le budget total de l'embed", () => {
		const { champs } = construireChampsResultats(beaucoup, 1_200);
		const cout = champs.reduce((somme, c) => somme + c.name.length + c.value.length, 0);
		expect(cout).toBeLessThanOrEqual(1_200);
	});

	test("un budget nul ne rend aucun champ et compte tout comme ignoré", () => {
		const { champs, affiches, ignores } = construireChampsResultats(beaucoup.slice(0, 3), 0);
		expect(champs).toHaveLength(0);
		expect(affiches).toBe(0);
		expect(ignores).toBe(3);
	});

	test("numérote à partir de 1 dans l'ordre du moteur", () => {
		const { champs } = construireChampsResultats(
			[FRAGMENT_WIKI, FRAGMENT_LUA],
			LIMITES_EMBED.total
		);
		expect(champs[0]?.name.startsWith("1. ")).toBe(true);
		expect(champs[1]?.name.startsWith("2. ")).toBe(true);
	});
});

describe("descriptionRecherche", () => {
	test("annonce la portée et le nombre", () => {
		const texte = descriptionRecherche({ query: "q", count: 3, results: [] }, null);
		// « extraits rapportés », pas « fragments du corpus » : `count` est plafonné par `k`.
		expect(espacesNormalisees(texte)).toContain("**3** extraits rapportés");
		expect(texte).toContain("tous types confondus");
	});

	test("nomme le type quand il est filtré", () => {
		expect(descriptionRecherche({ query: "q", count: 1, results: [] }, "lua")).toContain(
			"script Lua"
		);
	});

	test("dit clairement qu'il n'y a rien plutôt que d'afficher zéro résultat muet", () => {
		expect(descriptionRecherche({ query: "q", count: 0, results: [] }, "asset")).toContain(
			"Aucun fragment"
		);
		expect(descriptionRecherche({ query: "q", count: 0, results: [] }, "asset")).toContain(
			"ressource"
		);
	});
});

describe("identifiants de texte du jeu", () => {
	test("reconnaît les formes réellement acceptées par /api/text/:hash", () => {
		expect(estIdentifiantTexte("0x11E1AD03")).toBe(true);
		expect(estIdentifiantTexte("11E1AD03")).toBe(true);
		expect(estIdentifiantTexte(" 0x71e004b8 ")).toBe(true);
	});

	test("ne capture pas un mot recherché qui ressemble à de l'hexadécimal", () => {
		expect(estIdentifiantTexte("face")).toBe(false);
		expect(estIdentifiantTexte("Mark Evans")).toBe(false);
		expect(estIdentifiantTexte("bed")).toBe(false);
	});

	test("normalise vers la forme canonique de l'index", () => {
		expect(normaliserIdentifiantTexte("11e1ad03")).toBe("0x11E1AD03");
		expect(normaliserIdentifiantTexte("0x1584")).toBe("0x00001584");
	});
});

describe("champsTexteMultilingue", () => {
	// Fixture réelle — GET /api/text/0x11E1AD03
	const entree = {
		hashId: "0x11E1AD03",
		category: "chara",
		en: "Mark Evans",
		fr: "Mark Evans",
		ja: "円堂 守",
	};

	test("rend une ligne par langue, dans l'ordre fr → en → ja", () => {
		const champs = champsTexteMultilingue(entree);
		expect(champs.map((c) => c.name)).toEqual(["français", "anglais", "japonais"]);
		expect(champs[2]?.value).toBe("円堂 守");
	});

	test("omet une langue absente ou vide au lieu d'afficher un champ creux", () => {
		expect(champsTexteMultilingue({ hashId: "0x1", fr: "seul", en: "  " })).toHaveLength(1);
	});
});

describe("champsRechercheTexte", () => {
	// Fixture réelle — GET /api/text?q=Mark%20Evans&limit=3
	const entrees = [
		{ hashId: "0x069E1584", locale: "fr", category: "staffroll", value: "Mark Evans" },
		{ hashId: "0x11E1AD03", locale: "fr", category: "chara", value: "Mark Evans" },
		{ hashId: "0x12070DB5", locale: "fr", category: "chara", value: "Mark Evans" },
	];

	test("porte l'identifiant et la catégorie, les deux clés pour aller plus loin", () => {
		const { champs, affiches } = champsRechercheTexte(entrees, LIMITES_EMBED.total);
		expect(affiches).toBe(3);
		expect(champs[0]?.name).toBe("0x069E1584 · staffroll");
		expect(champs[0]?.value).toBe("Mark Evans");
	});

	test("une valeur vide devient un tiret plutôt qu'un champ refusé par Discord", () => {
		const { champs } = champsRechercheTexte(
			[{ hashId: "0x1", locale: "fr", category: "menu", value: "" }],
			LIMITES_EMBED.total
		);
		expect(champs[0]?.value).toBe("—");
	});

	test("s'arrête au budget", () => {
		const { affiches, ignores } = champsRechercheTexte(entrees, 40);
		expect(affiches).toBeLessThan(3);
		expect(affiches + ignores).toBe(3);
	});
});

describe("sondes de type", () => {
	test("zéro résultat prouve un type vide", () => {
		expect(ligneSonde({ type: "asset", renvoyes: 0, plafond: K_MAX_RAG })).toContain(
			"aucun fragment"
		);
	});

	test("sous le plafond, le décompte est EXACT", () => {
		// Mesuré le 13/8/2026 : kinds=lua, k=50 → count = 18.
		expect(
			espacesNormalisees(ligneSonde({ type: "lua", renvoyes: 18, plafond: K_MAX_RAG }))
		).toContain("18 fragments");
	});

	test("au plafond, on ne prétend pas connaître le total", () => {
		const ligne = ligneSonde({ type: "sqlite", renvoyes: 50, plafond: K_MAX_RAG });
		expect(ligne).toContain("≥");
		expect(ligne).not.toContain("exact");
	});

	test("un sondage en échec le dit au lieu d'être compté comme vide", () => {
		expect(ligneSonde({ type: "doc", renvoyes: null, plafond: K_MAX_RAG })).toContain("échec");
	});

	test("le bloc reste sous la limite d'un champ, même avec les onze types", () => {
		const sondes = TYPES_RAG.map((type) => ({ type, renvoyes: 50, plafond: K_MAX_RAG }));
		expect(blocSondes(sondes).length).toBeLessThanOrEqual(LIMITES_EMBED.valeurChamp);
	});
});

describe("resumerCategoriesTexte", () => {
	// Fixture réelle réduite — GET /api/text/stats (42 catégories, 64 146 entrées fr).
	const stats: StatCategorieTexte[] = [
		{ category: "chara", count: 19_725 },
		{ category: "event-dialogue", count: 16_764 },
		{ category: "chara_description", count: 5_546 },
		{ category: "map-npc", count: 3_690 },
		{ category: "skill", count: 2_705 },
	];

	test("somme les catégories réellement renvoyées", () => {
		expect(resumerCategoriesTexte(stats).total).toBe(48_430);
		expect(resumerCategoriesTexte(stats).categories).toBe(5);
	});

	test("classe par volume décroissant et borne la tête de liste", () => {
		const { tete } = resumerCategoriesTexte(stats, 2);
		expect(tete.startsWith("`chara`")).toBe(true);
		expect(tete).not.toContain("skill");
	});

	test("un index vide ne casse pas le résumé", () => {
		expect(resumerCategoriesTexte([]).total).toBe(0);
	});
});

describe("nombreFr / dateFr", () => {
	test("les grands nombres sont lisibles en français", () => {
		expect(espacesNormalisees(nombreFr(64_983))).toBe("64 983");
	});

	test("une date absente ou invalide rend un tiret, jamais « Invalid Date »", () => {
		expect(dateFr(null)).toBe("—");
		expect(dateFr(new Date("pas une date"))).toBe("—");
	});

	test("une date réelle est rendue en heure de Paris", () => {
		// 2026-08-13T05:23:57Z = 07:23 à Paris (UTC+2 en été).
		expect(espacesNormalisees(dateFr(new Date("2026-08-13T05:23:57.174Z")))).toContain(
			"13 août 2026"
		);
		expect(espacesNormalisees(dateFr(new Date("2026-08-13T05:23:57.174Z")))).toContain("07:23");
	});
});
