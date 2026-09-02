/**
 * Couverture de l'écoute en vocal — la file, l'enchaînement, le refus d'une
 * source injouable, et l'écran qui les affiche.
 *
 * Aucun salon vocal, aucun ffmpeg, aucun réseau : {@link PasserelleVocale} est
 * une interface, et la doublure ci-dessous journalise ce qu'on lui demande.
 */

import { describe, expect, it } from "bun:test";

import { ecranEcoute } from "./ecrans.ts";
import { MARQUE_PAR_DEFAUT } from "./ui/theme.ts";
import type { ComposantV2 } from "./ui/v2.ts";
import {
	SessionVocale,
	SessionsVocales,
	estMediaDirect,
	resolveurDepuisTable,
	type PasserelleVocale,
	type PisteVocale,
	type ResolveurAudio,
} from "./vocal.ts";
import { argumentsFfmpeg } from "./passerelle-vocale.ts";

/** Passerelle factice : elle note les gestes au lieu de les faire. */
class PasserelleFactice implements PasserelleVocale {
	journal: string[] = [];
	sources: string[] = [];
	private fin: (() => void) | null = null;

	async rejoindre(guildeId: string, salonId: string): Promise<void> {
		this.journal.push(`rejoindre:${guildeId}/${salonId}`);
	}
	async jouer(source: string): Promise<void> {
		this.journal.push(`jouer:${source}`);
		this.sources.push(source);
	}
	pause(): void {
		this.journal.push("pause");
	}
	reprendre(): void {
		this.journal.push("reprendre");
	}
	couper(): void {
		this.journal.push("couper");
	}
	quitter(): void {
		this.journal.push("quitter");
	}
	surFin(rappel: () => void): void {
		this.fin = rappel;
	}
	/** Simule la fin naturelle d'une piste. */
	terminerPiste(): void {
		this.fin?.();
	}
}

function piste(saison: number, episode: number): PisteVocale {
	return { saison, episode, titre: `Titre ${episode}`, nomArc: `Arc ${saison}`, demandeur: "m1" };
}

function sessionAvec(resoudre: ResolveurAudio): {
	session: SessionVocale;
	passerelle: PasserelleFactice;
} {
	const passerelle = new PasserelleFactice();
	return { session: new SessionVocale({ passerelle, resoudre }), passerelle };
}

/** Une source directe par épisode, dérivée de la clé. */
const SOURCE_PAR_CLE: ResolveurAudio = async (p) => `https://media.test/${p.saison}-${p.episode}.mp4`;

describe("session vocale", () => {
	it("rejoint le salon puis joue la première piste", async () => {
		const { session, passerelle } = sessionAvec(SOURCE_PAR_CLE);
		const resultat = await session.ajouter("g1", "v1", piste(1, 1));

		expect(resultat.demarre).toBe(true);
		expect(passerelle.journal).toEqual(["rejoindre:g1/v1", "jouer:https://media.test/1-1.mp4"]);
		expect(session.vue().etat).toBe("lecture");
		expect(session.vue().courante?.episode).toBe(1);
	});

	it("met en file sans couper ce qui joue", async () => {
		const { session, passerelle } = sessionAvec(SOURCE_PAR_CLE);
		await session.ajouter("g1", "v1", piste(1, 1));
		const second = await session.ajouter("g1", "v1", piste(1, 2));

		expect(second.demarre).toBe(false);
		expect(second.rang).toBe(1);
		expect(session.vue().courante?.episode).toBe(1);
		expect(session.vue().file).toHaveLength(1);
		// Une seule lecture lancée : la seconde attend son tour.
		expect(passerelle.sources).toHaveLength(1);
	});

	it("enchaîne tout seul quand une piste se termine", async () => {
		const { session, passerelle } = sessionAvec(SOURCE_PAR_CLE);
		await session.ajouter("g1", "v1", piste(1, 1));
		await session.ajouter("g1", "v1", piste(1, 2));

		passerelle.terminerPiste();
		await Promise.resolve();
		await Promise.resolve();

		expect(session.vue().courante?.episode).toBe(2);
		expect(session.vue().file).toHaveLength(0);
	});

	it("coupe et s'arrête, sans quitter, quand la file se vide", async () => {
		const { session, passerelle } = sessionAvec(SOURCE_PAR_CLE);
		await session.ajouter("g1", "v1", piste(1, 1));

		passerelle.terminerPiste();
		await Promise.resolve();
		await Promise.resolve();

		expect(session.vue().etat).toBe("arrete");
		expect(session.vue().courante).toBeNull();
		// On reste dans le salon : entrer et sortir à chaque fin de piste serait
		// insupportable pour les membres.
		expect(passerelle.journal).not.toContain("quitter");
	});

	it("écarte une piste sans source et continue la file", async () => {
		// Une source absente ne doit pas vider le salon pour un seul épisode.
		const resoudre: ResolveurAudio = async (p) =>
			p.episode === 1 ? null : `https://media.test/${p.episode}.mp4`;
		const { session } = sessionAvec(resoudre);

		await session.ajouter("g1", "v1", piste(1, 1));
		const resultat = await session.ajouter("g1", "v1", piste(1, 2));

		expect(session.vue().courante?.episode).toBe(2);
		expect(resultat.demarre).toBe(true);
	});

	it("dit ce qui coince quand AUCUNE source ne se résout", async () => {
		const { session } = sessionAvec(async () => null);
		const resultat = await session.ajouter("g1", "v1", piste(3, 7));

		expect(resultat.demarre).toBe(false);
		expect(resultat.erreur).toContain("Arc 3");
		expect(session.vue().etat).toBe("arrete");
	});

	it("survit à un résolveur qui lève", async () => {
		const { session } = sessionAvec(async () => {
			throw new Error("réseau coupé");
		});
		const resultat = await session.ajouter("g1", "v1", piste(1, 1));
		expect(resultat.erreur).toBeDefined();
		expect(session.vue().etat).toBe("arrete");
	});

	it("bascule pause et reprise", async () => {
		const { session, passerelle } = sessionAvec(SOURCE_PAR_CLE);
		await session.ajouter("g1", "v1", piste(1, 1));

		expect(session.basculerPause()).toBe("pause");
		expect(session.basculerPause()).toBe("lecture");
		expect(passerelle.journal).toContain("pause");
		expect(passerelle.journal).toContain("reprendre");
	});

	it("ne bascule rien quand rien ne joue", () => {
		const { session } = sessionAvec(SOURCE_PAR_CLE);
		expect(session.basculerPause()).toBe("arrete");
	});

	it("passe à la suivante sur demande", async () => {
		const { session } = sessionAvec(SOURCE_PAR_CLE);
		await session.ajouter("g1", "v1", piste(1, 1));
		await session.ajouter("g1", "v1", piste(1, 2));

		await session.passer();
		expect(session.vue().courante?.episode).toBe(2);
	});

	it("arrête tout et quitte le salon", async () => {
		const { session, passerelle } = sessionAvec(SOURCE_PAR_CLE);
		await session.ajouter("g1", "v1", piste(1, 1));
		await session.ajouter("g1", "v1", piste(1, 2));

		session.arreter();
		expect(session.vue()).toEqual({ etat: "arrete", courante: null, file: [], salonId: null });
		expect(passerelle.journal).toContain("quitter");
	});
});

describe("sessions par serveur", () => {
	it("garde une session distincte par serveur", () => {
		// Discord n'autorise qu'une connexion vocale par serveur : mélanger deux
		// serveurs ferait couper l'un en agissant sur l'autre.
		let creees = 0;
		const sessions = new SessionsVocales(() => {
			creees++;
			return new SessionVocale({ passerelle: new PasserelleFactice(), resoudre: SOURCE_PAR_CLE });
		});

		const a = sessions.de("g1");
		const b = sessions.de("g2");
		expect(a).not.toBe(b);
		expect(sessions.de("g1")).toBe(a);
		expect(creees).toBe(2);
	});

	it("ne crée rien pour une session seulement consultée", () => {
		const sessions = new SessionsVocales(() => {
			throw new Error("ne devrait pas être appelé");
		});
		expect(sessions.existante("g1")).toBeNull();
	});
});

describe("sources audio", () => {
	it("accepte un média que ffmpeg lit tel quel", () => {
		for (const url of [
			"https://media.test/ep.mp4",
			"https://media.test/ep.mp3",
			"https://media.test/flux.m3u8",
			"https://media.test/a/b.opus?token=x",
		]) {
			expect(estMediaDirect(url)).toBe(true);
		}
	});

	it("refuse une page web et un protocole étranger", () => {
		// ffmpeg lit un média, pas une page : en extraire un flux demande un
		// outil spécialisé, et le droit de le faire.
		for (const url of [
			"https://exemple.test/watch?v=abc",
			"https://exemple.test/tv/saison1/ep-1",
			"file:///etc/passwd",
			"pas une url",
		]) {
			expect(estMediaDirect(url)).toBe(false);
		}
	});

	it("résout depuis la table, et refuse ce qui n'est pas direct", async () => {
		const resoudre = resolveurDepuisTable({
			"1:1": "https://media.test/s1e1.mp4",
			"1:2": "https://exemple.test/watch?v=abc",
		});
		expect(await resoudre(piste(1, 1))).toBe("https://media.test/s1e1.mp4");
		expect(await resoudre(piste(1, 2))).toBeNull();
		expect(await resoudre(piste(9, 9))).toBeNull();
	});

	it("jette la vidéo et encode en Opus", () => {
		const arguments_ = argumentsFfmpeg("https://media.test/ep.mp4");
		// `-vn` : décoder une image qui finirait à la poubelle coûterait le CPU
		// du VPS pour rien.
		expect(arguments_).toContain("-vn");
		expect(arguments_).toContain("libopus");
		expect(arguments_).toContain("pipe:1");
		expect(arguments_[arguments_.indexOf("-i") + 1]).toBe("https://media.test/ep.mp4");
		// Reconnexion : une coupure d'une seconde ne doit pas terminer la piste.
		expect(arguments_).toContain("-reconnect");
	});
});

describe("écran d'écoute", () => {
	const texteDe = (composants: readonly ComposantV2[]): string => {
		const morceaux: string[] = [];
		const parcourir = (liste: readonly ComposantV2[]) => {
			for (const composant of liste) {
				if (composant.type === 10) morceaux.push(composant.content);
				else if (composant.type === 9 || composant.type === 17) parcourir(composant.components);
			}
		};
		parcourir(composants);
		return morceaux.join("\n");
	};

	it("dit franchement que la vidéo n'est pas possible", () => {
		// Un membre s'attend souvent à voir l'épisode dans le salon. Discord ne
		// le permet pas : le taire ferait passer une limite d'API pour une panne.
		const rendu = texteDe(
			ecranEcoute({
				etat: "arrete",
				courante: null,
				file: [],
				salonId: null,
				marque: MARQUE_PAR_DEFAUT,
			}).components
		);
		expect(rendu).toContain("aucune API");
		expect(rendu).toContain("vidéo");
	});

	it("affiche ce qui joue et ce qui suit", () => {
		const rendu = texteDe(
			ecranEcoute({
				etat: "lecture",
				courante: { saison: 1, episode: 3, titre: "La Tornade", nomArc: "Saison 1" },
				file: [{ saison: 1, episode: 4, titre: "Le Cahier", nomArc: "Saison 1" }],
				salonId: "42",
				marque: MARQUE_PAR_DEFAUT,
			}).components
		);
		expect(rendu).toContain("en lecture");
		expect(rendu).toContain("La Tornade");
		expect(rendu).toContain("À suivre · 1");
		expect(rendu).toContain("<#42>");
	});

	it("remonte l'avertissement de source manquante", () => {
		const rendu = texteDe(
			ecranEcoute({
				etat: "arrete",
				courante: null,
				file: [],
				salonId: null,
				avertissement: "Aucune source audio n'est déclarée",
				marque: MARQUE_PAR_DEFAUT,
			}).components
		);
		expect(rendu).toContain("Aucune source audio");
	});
});
