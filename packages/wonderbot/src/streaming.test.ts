/**
 * Couverture du service de lecture : routes, progression, composants V2,
 * écrans, et le service qui les relie.
 *
 * Aucun jeton, aucune base, aucun réseau — les seules dépendances lourdes
 * (catalogue, progression) sont injectées sous forme de doublures. Les budgets
 * de Discord sont vérifiés sur des volumes RÉELS (une saison de soixante
 * épisodes en deux langues), parce que c'est là que les limites mordent.
 */

import { describe, expect, it } from "bun:test";

import type { ChannelInfo, VideoRef } from "@aphrody/ietv";
import type { CacheStats } from "@aphrody/ietv/cache";

import { Catalogue, type CacheLike } from "./catalogue.ts";
import {
	PAR_PAGE,
	ecranAccueil,
	ecranArc,
	ecranAide,
	ecranFilArc,
	ecranLecture,
	ecranMaListe,
	ecranProgression,
	ecranRouteInconnue,
} from "./ecrans.ts";
import { cleAutocompletion } from "./commands/ietv.ts";
import {
	Progression,
	ProgressionMemoire,
	avancement,
	barre,
	cheminEtatDepuisCatalogue,
	cleTexte,
	prochainNonVu,
	voisins,
} from "./progression.ts";
import { argumentEntier, argumentLangue, lireRoute, route } from "./routes.ts";
import { Service } from "./service.ts";
import { MARQUE_PAR_DEFAUT } from "./ui/theme.ts";
import type { EpisodeCatalogue } from "./ui/format.ts";
import {
	DRAPEAU_V2,
	LIMITES_V2,
	compterComposants,
	ecran,
	galerie,
	rangeeSelect,
	tailleTexte,
	texte,
	type ComposantV2,
} from "./ui/v2.ts";

// ---------------------------------------------------------------------------
// Doublures
// ---------------------------------------------------------------------------

function episode(partiel: Partial<EpisodeCatalogue> & { videoId: string }): EpisodeCatalogue {
	return {
		title: `Épisode ${partiel.videoId}`,
		url: `https://www.youtube.com/watch?v=${partiel.videoId}`,
		description: null,
		thumbnail: null,
		publishDate: null,
		titleJp: null,
		romaji: null,
		season: 1,
		episode: 1,
		language: "vf",
		duration: null,
		viewCount: null,
		...partiel,
	};
}

/** Cache en mémoire — même surface que `IETVCache`, sans SQLite. */
class CacheMemoire implements CacheLike {
	episodes: EpisodeCatalogue[] = [];
	chaines: ChannelInfo[] = [];
	meta = new Map<string, string>();

	search(query: {
		q?: string;
		season?: number;
		episode?: number;
		language?: "vf" | "vostfr";
		limit?: number;
	}) {
		let resultat = this.episodes;
		if (query.q) {
			const q = query.q.toLowerCase();
			resultat = resultat.filter((ep) => ep.title.toLowerCase().includes(q));
		}
		if (query.season !== undefined) resultat = resultat.filter((ep) => ep.season === query.season);
		if (query.episode !== undefined) resultat = resultat.filter((ep) => ep.episode === query.episode);
		if (query.language) resultat = resultat.filter((ep) => ep.language === query.language);
		return resultat.slice(0, query.limit ?? resultat.length) as never;
	}

	getAllChannels() {
		return this.chaines;
	}

	getStats(): CacheStats {
		const byLanguage: Record<string, number> = {};
		for (const ep of this.episodes) byLanguage[ep.language] = (byLanguage[ep.language] ?? 0) + 1;
		return {
			channels: this.chaines.length,
			seasons: new Set(this.episodes.map((ep) => ep.season)).size,
			episodes: this.episodes.length,
			byLanguage,
			lastUpdate: 0,
		};
	}

	getMetadata(cle: string) {
		return this.meta.get(cle) ?? null;
	}
	setMetadata(cle: string, valeur: string) {
		this.meta.set(cle, valeur);
	}
	saveChannel(info: ChannelInfo) {
		this.chaines.push(info);
		for (const saison of info.seasons) this.episodes.push(...(saison.episodes as EpisodeCatalogue[]));
	}
	clearChannel() {}
	clear() {
		this.episodes = [];
		this.chaines = [];
	}
	clearExpired() {}
	close() {}
}

/** Catalogue peuplé, avec des NOMS d'arcs — le cas réel du site officiel. */
function catalogueAvec(
	episodes: EpisodeCatalogue[],
	nomsArcs: Readonly<Record<number, string>> = {}
): Catalogue {
	const parSaison = new Map<number, EpisodeCatalogue[]>();
	for (const ep of episodes) {
		const cle = ep.season ?? 0;
		parSaison.set(cle, [...(parSaison.get(cle) ?? []), ep]);
	}

	const cache = new CacheMemoire();
	cache.saveChannel({
		channel: "source-test",
		title: "Source de test",
		description: null,
		avatar: null,
		totalEpisodes: episodes.length,
		seasons: [...parSaison.entries()].map(([season, eps]) => ({
			season,
			name: nomsArcs[season] ?? null,
			episodes: eps as VideoRef[],
			totalEpisodes: eps.length,
		})),
	});

	return new Catalogue({
		ouvrirCache: () => cache,
		creerScraper: () => ({ getAllChannelEpisodes: async () => [], close: async () => {} }),
	});
}

function serviceAvec(
	episodes: EpisodeCatalogue[],
	nomsArcs: Readonly<Record<number, string>> = {},
	options: { tirage?: () => number; lacunes?: ReadonlySet<string> } = {}
): { service: Service; progression: Progression } {
	// Horloge qui AVANCE : deux marquages successifs doivent se distinguer,
	// comme en production. Une horloge figée masquerait tout défaut d'ordre.
	let instant = 1_000;
	const progression = new Progression(new ProgressionMemoire(), () => (instant += 1_000));
	const service = new Service({
		catalogue: catalogueAvec(episodes, nomsArcs),
		progression,
		marque: MARQUE_PAR_DEFAUT,
		...(options.tirage ? { tirage: options.tirage } : {}),
		...(options.lacunes ? { lacunesConfirmees: () => options.lacunes! } : {}),
	});
	return { service, progression };
}

/** Une saison complète en deux langues — le volume qui fait mordre les budgets. */
function saisonComplete(saison: number, taille: number): EpisodeCatalogue[] {
	return Array.from({ length: taille }, (_, index) => [
		episode({
			videoId: `vf${saison}-${index}`,
			season: saison,
			episode: index + 1,
			title: `Arc ${saison} — Épisode ${index + 1} - Un titre d'épisode plutôt long pour tester`,
			thumbnail: `https://img.youtube.com/vi/vf${saison}-${index}/hqdefault.jpg`,
		}),
		episode({
			videoId: `vo${saison}-${index}`,
			season: saison,
			episode: index + 1,
			language: "vostfr",
			title: `[VOSTFR] Série ${saison} ${index + 1} - "Le même épisode, en version bruitée" {V2}`,
		}),
	]).flat();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

describe("routes", () => {
	it("fait l'aller-retour", () => {
		const identifiant = route("arc", 4, 2);
		expect(identifiant).toBe("wb/arc/4/2");
		const lue = lireRoute(identifiant)!;
		expect(lue.action).toBe("arc");
		expect(argumentEntier(lue, 0)).toBe(4);
		expect(argumentEntier(lue, 1)).toBe(2);
	});

	it("lit une langue et refuse une valeur inconnue", () => {
		expect(argumentLangue(lireRoute(route("lire", 1, 2, "vostfr"))!, 2)).toBe("vostfr");
		expect(argumentLangue(lireRoute(route("lire", 1, 2, "klingon"))!, 2)).toBeUndefined();
	});

	it("rend null sur une route étrangère ou disparue", () => {
		// Le menu du forum garde son préfixe historique `wb:ep:` : les deux
		// séparateurs diffèrent exprès, aucun ne doit lire l'autre.
		expect(lireRoute("wb:ep:3:0")).toBeNull();
		expect(lireRoute("autre/chose")).toBeNull();
		expect(lireRoute("wb/action-retiree/1")).toBeNull();
		expect(lireRoute("wb")).toBeNull();
	});

	it("refuse un segment qui contient le séparateur", () => {
		expect(() => route("arc", "4/2")).toThrow(/séparateur|invalide/i);
	});

	it("refuse un identifiant plus long que ce que Discord accepte", () => {
		expect(() => route("arc", "x".repeat(120))).toThrow(/100/);
	});

	it("tient sous les 100 caractères sur les routes réelles", () => {
		for (const identifiant of [
			route("accueil"),
			route("arc", 10, 3),
			route("lire", 10, 127),
			route("vu", 10, 127),
			route("liste", 10, 127),
			route("choix", 10),
		]) {
			expect(identifiant.length).toBeLessThanOrEqual(100);
		}
	});
});

// ---------------------------------------------------------------------------
// Progression
// ---------------------------------------------------------------------------

describe("progression", () => {
	it("bascule le visionnage dans les deux sens", () => {
		const progression = new Progression(new ProgressionMemoire(), () => 42);
		const cle = { saison: 3, episode: 7 };

		expect(progression.basculerVu("membre", cle, new Set())).toBe(true);
		expect(progression.vusDeSaison("membre", 3).has(7)).toBe(true);
		expect(progression.basculerVu("membre", cle, new Set([7]))).toBe(false);
		expect(progression.vusDeSaison("membre", 3).has(7)).toBe(false);
	});

	it("garde les membres séparés", () => {
		const progression = new Progression(new ProgressionMemoire(), () => 1);
		progression.marquerVu("a", { saison: 1, episode: 1 });
		expect(progression.vusDeSaison("a", 1).size).toBe(1);
		expect(progression.vusDeSaison("b", 1).size).toBe(0);
	});

	it("bascule « Ma liste » dans les deux sens", () => {
		const progression = new Progression(new ProgressionMemoire(), () => 1);
		const cle = { saison: 2, episode: 5 };
		expect(progression.basculerListe("membre", cle)).toBe(true);
		expect(progression.estDansListe("membre", cle)).toBe(true);
		expect(progression.basculerListe("membre", cle)).toBe(false);
		expect(progression.liste("membre")).toHaveLength(0);
	});

	it("propose le plus petit NON VU, pas « le dernier + 1 »", () => {
		// Quelqu'un qui a sauté E03..E06 doit se voir proposer E03, l'épisode qui
		// lui manque — et non E08, qui laisserait le trou derrière lui.
		expect(prochainNonVu([1, 2, 3, 4, 5, 6, 7, 8], new Set([1, 2, 7]))).toBe(3);
		expect(prochainNonVu([1, 2, 3], new Set([1, 2, 3]))).toBeNull();
		expect(prochainNonVu([], new Set())).toBeNull();
	});

	it("ne propose que des numéros qui existent au catalogue", () => {
		// La saison a un trou en 4 : le suivant après 3 est 5, pas 4.
		expect(voisins([1, 2, 3, 5, 6], 3)).toEqual({ precedent: 2, suivant: 5 });
		expect(voisins([1, 2, 3], 1).precedent).toBeNull();
		expect(voisins([1, 2, 3], 3).suivant).toBeNull();
	});

	it("encadre quand même un épisode absent du catalogue", () => {
		// Un message ancien peut pointer un épisode qu'une source a dépublié :
		// la navigation doit rester possible dans les deux sens.
		expect(voisins([1, 2, 6, 7], 4)).toEqual({ precedent: 2, suivant: 6 });
	});

	it("borne l'avancement et dessine sa barre", () => {
		expect(avancement(0, 0)).toBe(0);
		expect(avancement(30, 47)).toBe(64);
		expect(avancement(50, 47)).toBe(100);
		expect(barre(0)).toBe("░".repeat(12));
		expect(barre(100)).toBe("█".repeat(12));
		expect(barre(50)).toHaveLength(12);
	});

	it("classe les visionnages du plus récent au plus ancien", () => {
		const memoire = new ProgressionMemoire();
		memoire.marquerVu("m", { saison: 1, episode: 1 }, 100);
		memoire.marquerVu("m", { saison: 4, episode: 9 }, 300);
		memoire.marquerVu("m", { saison: 2, episode: 2 }, 200);
		expect(memoire.dernierVu("m")).toEqual({ saison: 4, episode: 9, quand: 300 });
		expect(memoire.derniersVus("m", 2).map((v) => v.saison)).toEqual([4, 2]);
		expect([...memoire.comptesParSaison("m").entries()].sort()).toEqual([
			[1, 1],
			[2, 1],
			[4, 1],
		]);
	});

	it("départage deux visionnages de la même milliseconde", () => {
		// Deux clics dans la même milliseconde : sans départage, « le dernier
		// vu » dépendrait de l'ordre d'insertion et `suivant` enchaînerait au
		// mauvais endroit. Le plus avancé fait foi.
		const memoire = new ProgressionMemoire();
		memoire.marquerVu("m", { saison: 1, episode: 1 }, 500);
		memoire.marquerVu("m", { saison: 1, episode: 5 }, 500);
		expect(memoire.dernierVu("m")).toEqual({ saison: 1, episode: 5, quand: 500 });

		const inverse = new ProgressionMemoire();
		inverse.marquerVu("m", { saison: 1, episode: 5 }, 500);
		inverse.marquerVu("m", { saison: 1, episode: 1 }, 500);
		expect(inverse.dernierVu("m")).toEqual({ saison: 1, episode: 5, quand: 500 });
	});

	it("écrit son état à côté du catalogue, jamais dedans", () => {
		// Le répertoire est le SEUL que l'unité systemd ouvre en écriture ; le
		// fichier, lui, doit être distinct — le catalogue est un cache réécrit.
		expect(cheminEtatDepuisCatalogue("/home/x/.cache/ietv/episodes.db")).toBe(
			"/home/x/.cache/ietv/wonderbot.db"
		);
	});

	it("écrit une clé lisible", () => {
		expect(cleTexte({ saison: 3, episode: 7 })).toBe("3:7");
	});
});

// ---------------------------------------------------------------------------
// Composants V2
// ---------------------------------------------------------------------------

describe("composants V2", () => {
	it("pose le drapeau et rien d'autre", () => {
		const message = ecran([texte("bonjour")]);
		expect(message.flags).toBe(DRAPEAU_V2);
		expect(message).not.toHaveProperty("content");
		expect(message).not.toHaveProperty("embeds");
	});

	it("écarte par la fin plutôt que de laisser Discord refuser le message", () => {
		// 4 000 caractères de texte : le message entier serait REFUSÉ, pas
		// tronqué. On préfère un écran incomplet et affiché.
		const trop = Array.from({ length: 6 }, () => texte("T".repeat(900)));
		const message = ecran(trop);
		expect(tailleTexte(message.components)).toBeLessThanOrEqual(LIMITES_V2.texteTotal);
		expect(message.components.length).toBeLessThan(trop.length);
	});

	it("respecte le plafond de composants", () => {
		const message = ecran(Array.from({ length: 30 }, (_, i) => texte(`bloc ${i}`)));
		expect(message.components.length).toBeLessThanOrEqual(LIMITES_V2.racines);
		expect(compterComposants(message.components)).toBeLessThanOrEqual(LIMITES_V2.total);
	});

	it("écarte les images sans URL au lieu de faire refuser la galerie", () => {
		const gal = galerie([{ url: null }, { url: "" }, { url: "https://i/1.jpg" }])!;
		expect(gal.items).toHaveLength(1);
		expect(galerie([{ url: null }])).toBeNull();
	});

	it("borne une galerie à dix images", () => {
		const gal = galerie(Array.from({ length: 20 }, (_, i) => ({ url: `https://i/${i}.jpg` })))!;
		expect(gal.items).toHaveLength(LIMITES_V2.imagesGalerie);
	});

	it("borne un menu à vingt-cinq choix et rend null s'il est vide", () => {
		const rangee = rangeeSelect({
			id: "wb/choix/1",
			choix: Array.from({ length: 40 }, (_, i) => ({ label: `E${i}`, value: String(i) })),
		})!;
		expect(rangee.components[0].options).toHaveLength(25);
		expect(rangeeSelect({ id: "wb/choix/1", choix: [] })).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Écrans
// ---------------------------------------------------------------------------

/** Tout le texte d'un arbre de composants, à plat. */
function texteDe(composants: readonly ComposantV2[]): string {
	const morceaux: string[] = [];
	const parcourir = (liste: readonly ComposantV2[]) => {
		for (const composant of liste) {
			if (composant.type === 10) morceaux.push(composant.content);
			else if (composant.type === 9 || composant.type === 17) parcourir(composant.components);
		}
	};
	parcourir(composants);
	return morceaux.join("\n");
}

describe("écrans", () => {
	it("dit « Commencer », pas « Reprendre », à qui n'a rien vu", () => {
		// L'épisode proposé est le même — le premier non vu — mais le mot change :
		// on ne reprend pas ce qu'on n'a jamais commencé.
		const { service } = serviceAvec(saisonComplete(1, 5), { 1: "Saison 1" });
		const vue = service.accueil("membre");
		expect(vue.reprise?.commence).toBe(false);
		expect(vue.reprise?.episode).toBe(1);

		const rendu = texteDe(ecranAccueil(vue).components);
		expect(rendu).toContain("Commencer");
		expect(rendu).not.toContain("Reprendre");
	});

	it("invite à parcourir quand le catalogue est vide", () => {
		const { service } = serviceAvec([]);
		const vue = service.accueil("membre");
		expect(vue.reprise).toBeNull();
		expect(texteDe(ecranAccueil(vue).components)).toContain("Commencer");
	});

	it("propose de reprendre avec sa barre d'avancement", () => {
		const { service, progression } = serviceAvec(saisonComplete(1, 10), { 1: "Saison 1" });
		progression.marquerVu("membre", { saison: 1, episode: 1 });
		progression.marquerVu("membre", { saison: 1, episode: 2 });

		const vue = service.accueil("membre");
		expect(vue.reprise?.episode).toBe(3);
		const rendu = texteDe(ecranAccueil(vue).components);
		expect(rendu).toContain("Reprendre");
		expect(rendu).toContain("E03");
		expect(rendu).toContain("2/10");
	});

	it("tient les budgets sur une saison de soixante épisodes en deux langues", () => {
		const { service } = serviceAvec(saisonComplete(3, 60), { 3: "Saison 3" });
		const message = ecranArc(service.arc("membre", 3, 0));
		expect(tailleTexte(message.components)).toBeLessThanOrEqual(LIMITES_V2.texteTotal);
		expect(compterComposants(message.components)).toBeLessThanOrEqual(LIMITES_V2.total);
		expect(message.components).toHaveLength(1);
	});

	it("pagine un arc plus grand qu'une page et désactive les bouts", () => {
		const { service } = serviceAvec(saisonComplete(3, 60), { 3: "Saison 3" });
		const premiere = service.arc("membre", 3, 0);
		expect(premiere.episodes).toHaveLength(PAR_PAGE);
		expect(premiere.total).toBe(60);

		const derniere = service.arc("membre", 3, 99);
		// La page est bornée : trois pages pour soixante épisodes.
		expect(derniere.page).toBe(2);
		expect(derniere.episodes).toHaveLength(10);
	});

	it("marque le déjà-vu dans la grille", () => {
		const { service, progression } = serviceAvec(saisonComplete(2, 5), { 2: "GO" });
		progression.marquerVu("membre", { saison: 2, episode: 2 });
		const rendu = texteDe(ecranArc(service.arc("membre", 2, 0)).components);
		expect(rendu).toContain("✓ **E02**");
		expect(rendu).toContain("◦ **E01**");
		// Le nom de l'arc prime sur « Saison 2 » — c'est celui que la source donne.
		expect(rendu).toContain("GO");
	});

	it("affiche les épisodes confirmés introuvables", () => {
		const { service } = serviceAvec(saisonComplete(1, 5), {}, { lacunes: new Set(["1:3"]) });
		expect(texteDe(ecranArc(service.arc("membre", 1, 0)).components)).toContain("E03");
	});

	it("dit quoi faire quand la liste est vide", () => {
		const { service } = serviceAvec(saisonComplete(1, 3));
		expect(texteDe(ecranMaListe(service.maListe("membre")).components)).toContain("vide");
	});

	it("garde une entrée dont l'épisode a quitté le catalogue", () => {
		// Un scraping raté d'en face ne doit pas effacer un choix du membre.
		const { service, progression } = serviceAvec(saisonComplete(1, 3));
		progression.basculerListe("membre", { saison: 9, episode: 99 });
		const vue = service.maListe("membre");
		expect(vue.entrees[0]?.absent).toBe(true);
		expect(texteDe(ecranMaListe(vue).components)).toContain("absent du catalogue");
	});

	it("le lecteur pose l'URL nue — c'est elle qui fait le lecteur Discord", () => {
		const { service } = serviceAvec(saisonComplete(1, 3), { 1: "Saison 1" });
		const reponse = ecranLecture(service.lecture("membre", { saison: 1, episode: 2 })!);
		expect(reponse.contenu).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=/);
		// V1 obligatoire : un message V2 n'a pas le droit d'avoir de contenu.
		expect(reponse.v2).toBeUndefined();
		expect(reponse.embeds).toHaveLength(1);
		expect(reponse.composants).toHaveLength(2);
	});

	it("le lecteur désactive « précédent » sur le premier épisode", () => {
		const { service } = serviceAvec(saisonComplete(1, 3));
		const premier = ecranLecture(service.lecture("membre", { saison: 1, episode: 1 })!);
		const rangee = premier.composants![0] as { components: { disabled?: boolean }[] };
		expect(rangee.components[0]!.disabled).toBe(true);

		const dernier = ecranLecture(service.lecture("membre", { saison: 1, episode: 3 })!);
		const rangeeFin = dernier.composants![0] as { components: { disabled?: boolean }[] };
		expect(rangeeFin.components[2]!.disabled).toBe(true);
	});

	it("le fil de forum n'affiche AUCUN état personnel", () => {
		// Un fil est lu par tout le serveur : y peindre les pastilles de celui
		// qui l'a généré serait faux pour tous les autres.
		const { service, progression } = serviceAvec(saisonComplete(2, 6), { 2: "GO" });
		progression.marquerVu("membre", { saison: 2, episode: 1 });
		const arc = service.arc("membre", 2, 0);

		const rendu = texteDe(
			ecranFilArc({
				saison: 2,
				nom: "GO",
				episodes: arc.episodes.map((episode) => ({ ...episode, vu: false, dansListe: false })),
				langues: { vf: 6, vostfr: 6 },
				introuvables: [],
				rafraichiLe: 0,
				marque: MARQUE_PAR_DEFAUT,
			}).components
		);
		expect(rendu).not.toContain("✓");
		expect(rendu).toContain("GO");
		expect(rendu).toContain("VOSTFR");
	});

	it("le fil tient le budget V2, plus étroit que celui des embeds", () => {
		// 4 000 caractères, pas 6 000 : une saison de soixante épisodes doit
		// tenir en resserrant les titres, sans perdre d'épisode.
		const { service } = serviceAvec(saisonComplete(3, 60), { 3: "Saison 3" });
		const arc = service.arc("membre", 3, 0);
		const tous = [];
		for (let page = 0; page < 3; page++) tous.push(...service.arc("membre", 3, page).episodes);

		const message = ecranFilArc({
			saison: 3,
			nom: "Saison 3",
			episodes: tous,
			langues: { vf: 60, vostfr: 60 },
			introuvables: [],
			rafraichiLe: 1_700_000_000_000,
			marque: MARQUE_PAR_DEFAUT,
		});
		expect(tailleTexte(message.components)).toBeLessThanOrEqual(LIMITES_V2.texteTotal);
		expect(compterComposants(message.components)).toBeLessThanOrEqual(LIMITES_V2.total);
		expect(arc.total).toBe(60);
	});

	it("le fil dit ce qu'il n'a pas trouvé", () => {
		const rendu = texteDe(
			ecranFilArc({
				saison: 1,
				nom: "Saison 1",
				episodes: [],
				langues: {},
				introuvables: [3, 7],
				rafraichiLe: 0,
				marque: MARQUE_PAR_DEFAUT,
			}).components
		);
		expect(rendu).toContain("E03");
		expect(rendu).toContain("E07");
		expect(rendu).toContain("Aucun épisode référencé");
	});

	it("l'aide range par intention, pas par liste de commandes", () => {
		const rendu = texteDe(ecranAide(MARQUE_PAR_DEFAUT).components);
		for (const intention of ["Regarder", "Retrouver", "Suivre"]) {
			expect(rendu).toContain(intention);
		}
		expect(rendu).toContain("/episodes accueil");
	});

	it("reconnaît une proposition d'autocomplétion choisie", () => {
		// Discord envoie la VALEUR (`4:12`), pas le libellé : traitée comme du
		// texte libre, elle ne trouverait rien.
		expect(cleAutocompletion("4:12")).toEqual({ saison: 4, episode: 12 });
		expect(cleAutocompletion(" 10:127 ")).toEqual({ saison: 10, episode: 127 });
		expect(cleAutocompletion("la tornade")).toBeNull();
		expect(cleAutocompletion("4:")).toBeNull();
		expect(cleAutocompletion("12:34:56")).toBeNull();
	});

	it("l'écran de route périmée explique et renvoie à l'accueil", () => {
		const rendu = texteDe(ecranRouteInconnue(MARQUE_PAR_DEFAUT).components);
		expect(rendu).toContain("n'est plus valide");
	});
});

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

describe("service", () => {
	it("enchaîne sur l'arc suivant quand l'arc courant est fini", () => {
		const { service, progression } = serviceAvec(
			[...saisonComplete(1, 2), ...saisonComplete(2, 3)],
			{ 1: "Saison 1", 2: "GO" }
		);
		progression.marquerVu("membre", { saison: 1, episode: 1 });
		progression.marquerVu("membre", { saison: 1, episode: 2 });

		const reprise = service.reprise("membre")!;
		expect(reprise.saison).toBe(2);
		expect(reprise.nomArc).toBe("GO");
		expect(reprise.episode).toBe(1);
	});

	it("ne rend rien à reprendre quand tout est vu", () => {
		const { service, progression } = serviceAvec(saisonComplete(1, 2));
		progression.marquerVu("membre", { saison: 1, episode: 1 });
		progression.marquerVu("membre", { saison: 1, episode: 2 });
		expect(service.reprise("membre")).toBeNull();
	});

	it("borne l'avancement d'un arc dont une source a retiré un épisode", () => {
		// Le membre a vu un épisode qui n'est plus au catalogue : « 3/2 » serait
		// absurde, et la barre passerait au-dessus de 100 %.
		const { service, progression } = serviceAvec(saisonComplete(1, 2));
		for (const numero of [1, 2, 3]) progression.marquerVu("membre", { saison: 1, episode: numero });
		expect(service.arcs("membre")[0]).toEqual({ saison: 1, nom: "Saison 1", total: 2, vus: 2 });
	});

	it("tire au hasard parmi les NON VUS d'abord", () => {
		const { service, progression } = serviceAvec(saisonComplete(1, 3), {}, { tirage: () => 0 });
		progression.marquerVu("membre", { saison: 1, episode: 1 });
		// Le tirage à 0 prend le premier du bassin ; le bassin exclut E01.
		expect(service.hasard("membre")).toEqual({ saison: 1, episode: 2 });
	});

	it("retombe sur le catalogue entier quand tout est vu", () => {
		const { service, progression } = serviceAvec(saisonComplete(1, 2), {}, { tirage: () => 0 });
		progression.marquerVu("membre", { saison: 1, episode: 1 });
		progression.marquerVu("membre", { saison: 1, episode: 2 });
		expect(service.hasard("membre")).toEqual({ saison: 1, episode: 1 });
	});

	it("rend null sur un catalogue vide", () => {
		const { service } = serviceAvec([]);
		expect(service.hasard("membre")).toBeNull();
		expect(service.reprise("membre")).toBeNull();
		expect(service.lecture("membre", { saison: 1, episode: 1 })).toBeNull();
	});

	it("choisit le titre le moins bruité entre les versions", () => {
		// La VOSTFR de la doublure porte crochets, guillemets et « {V2} » ; la VF
		// est propre. C'est la VF qui doit s'afficher.
		const { service } = serviceAvec(saisonComplete(1, 1));
		const vue = service.lecture("membre", { saison: 1, episode: 1 })!;
		expect(vue.titre).toBe("Un titre d'épisode plutôt long pour tester");
	});

	it("dédoublonne l'autocomplétion par épisode, pas par version", () => {
		// Chaque épisode existe en VF et en VOSTFR : sans dédoublonnage, la
		// liste afficherait chaque épisode deux fois.
		const { service } = serviceAvec(saisonComplete(1, 4), { 1: "Saison 1" });
		const choix = service.autocompleter("");
		expect(choix).toHaveLength(4);
		expect(new Set(choix.map((c) => c.valeur)).size).toBe(4);
		expect(choix[0]!.valeur).toMatch(/^\d+:\d+$/);
	});

	it("borne chaque proposition à ce que Discord accepte", () => {
		const { service } = serviceAvec(
			[episode({ videoId: "long", season: 1, episode: 1, title: `Arc 1 — Épisode 1 - ${"T".repeat(300)}` })],
			{ 1: "Un nom d'arc" }
		);
		for (const choix of service.autocompleter("")) {
			expect(choix.nom.length).toBeLessThanOrEqual(100);
		}
	});

	it("enchaîne strictement après le dernier vu, trous compris", () => {
		// « Suivant » n'est pas « reprendre » : le membre a vu E05 après avoir
		// sauté E02..E04. Suivant donne E06 ; reprendre donnerait E02.
		const { service, progression } = serviceAvec(saisonComplete(1, 8));
		progression.marquerVu("membre", { saison: 1, episode: 1 });
		progression.marquerVu("membre", { saison: 1, episode: 5 });

		expect(service.apresDernierVu("membre")).toEqual({ saison: 1, episode: 6 });
		expect(service.reprise("membre")?.episode).toBe(2);
	});

	it("passe à l'arc suivant quand le dernier vu finissait l'arc", () => {
		const { service, progression } = serviceAvec(
			[...saisonComplete(1, 2), ...saisonComplete(2, 2)],
			{ 1: "Saison 1", 2: "GO" }
		);
		progression.marquerVu("membre", { saison: 1, episode: 2 });
		expect(service.apresDernierVu("membre")).toEqual({ saison: 2, episode: 1 });
	});

	it("n'enchaîne rien sans historique ni au bout du catalogue", () => {
		const { service, progression } = serviceAvec(saisonComplete(1, 2));
		expect(service.apresDernierVu("membre")).toBeNull();
		progression.marquerVu("membre", { saison: 1, episode: 2 });
		expect(service.apresDernierVu("membre")).toBeNull();
	});

	it("totalise la progression sur tous les arcs", () => {
		const { service, progression } = serviceAvec(
			[...saisonComplete(1, 4), ...saisonComplete(2, 6)],
			{ 1: "Saison 1", 2: "GO" }
		);
		progression.marquerVu("membre", { saison: 1, episode: 1 });
		progression.marquerVu("membre", { saison: 2, episode: 1 });
		progression.marquerVu("membre", { saison: 2, episode: 2 });

		const vue = service.progressionGlobale("membre");
		expect(vue.total).toBe(10);
		expect(vue.vus).toBe(3);
		expect(vue.recents).toHaveLength(3);

		const rendu = texteDe(ecranProgression(vue).components);
		expect(rendu).toContain("30 %");
		expect(rendu).toContain("3 épisodes vus sur 10");
		expect(rendu).toContain("GO");
	});

	it("propose les arcs par leur NOM, mais renvoie leur numéro", () => {
		// Le membre tape « chrono » ; il n'a jamais à savoir que c'est l'arc 3.
		const { service } = serviceAvec(
			[...saisonComplete(1, 1), ...saisonComplete(3, 1)],
			{ 1: "Saison 1", 3: "Chrono Stones" }
		);
		const trouves = service.autocompleterArcs("chrono");
		expect(trouves).toHaveLength(1);
		expect(trouves[0]!.valeur).toBe(3);
		expect(trouves[0]!.nom).toContain("Chrono Stones");
		// Le numéro tapé directement marche aussi.
		expect(service.autocompleterArcs("1")[0]?.valeur).toBe(1);
		expect(service.autocompleterArcs("")).toHaveLength(2);
	});

	it("montre l'avancement dans les propositions d'arc", () => {
		const { service, progression } = serviceAvec(saisonComplete(1, 4), { 1: "Saison 1" });
		progression.marquerVu("membre", { saison: 1, episode: 1 });
		expect(service.autocompleterArcs("", "membre")[0]!.nom).toContain("1/4");
	});

	it("filtre l'autocomplétion sur le texte saisi", () => {
		const { service } = serviceAvec([
			episode({ videoId: "a", season: 1, episode: 1, title: "Arc 1 — Épisode 1 - La Tornade" }),
			episode({ videoId: "b", season: 1, episode: 2, title: "Arc 1 — Épisode 2 - Le Cahier" }),
		]);
		expect(service.autocompleter("tornade")).toHaveLength(1);
		expect(service.autocompleter("zzz")).toHaveLength(0);
	});
});
