/**
 * L'écoute en vocal — une file d'attente partagée par salon.
 *
 * ── CE QUE DISCORD PERMET, ET CE QU'IL NE PERMET PAS ───────────────────────
 * Un bot peut transmettre de l'AUDIO dans un salon vocal : c'est une API
 * officielle, documentée, celle des bots de musique. Il ne peut PAS diffuser
 * de vidéo — le « Go Live » et le partage d'écran n'ont aucune API bot, et
 * toute bibliothèque qui prétend le contraire passe par des internes non
 * documentés qui cassent à la première mise à jour du client.
 *
 * Ce module fait donc ce qui est réellement faisable et solide : la bande son
 * dans le salon vocal, pendant que l'image reste dans le lecteur du message.
 * C'est aussi ce qui a du sens à plusieurs — l'audio est le seul canal qu'un
 * salon vocal partage vraiment.
 *
 * ── LA SOURCE AUDIO EST ENFICHABLE, ET C'EST DÉLIBÉRÉ ──────────────────────
 * {@link ResolveurAudio} traduit un épisode en URL de média DIRECTE. Le module
 * n'en impose aucune : ffmpeg lit aussi bien un MP4, un MP3 qu'un flux HLS, et
 * c'est à l'exploitant de désigner les sources qu'il a le droit de servir —
 * un miroir qu'il héberge, un flux dont il dispose. Coder une plateforme en
 * dur ici rendrait le module à la fois fragile et présomptueux.
 *
 * ── MODULE PUR, SAUF LA PASSERELLE ─────────────────────────────────────────
 * La file, la reprise et l'enchaînement se testent sans réseau ni salon vocal :
 * {@link PasserelleVocale} est une interface, et `bot.ts` en fournit
 * l'implémentation `@discordjs/voice`.
 */

import type { CleEpisode } from "./progression.ts";

/** Un épisode en attente d'écoute, avec de quoi l'annoncer. */
export interface PisteVocale extends CleEpisode {
	titre: string;
	nomArc: string;
	/** Qui l'a mise en file — affiché, et utilisé pour les droits de contrôle. */
	demandeur: string;
}

/** Ce qu'une piste devient une fois sa source résolue. */
export interface PisteResolue extends PisteVocale {
	/** URL directe, lisible par ffmpeg. */
	source: string;
}

/**
 * Traduit un épisode en URL de média directe.
 *
 * Rend `null` quand aucune source jouable n'existe — l'appelant le DIT au
 * membre plutôt que de laisser la file avancer dans le vide.
 */
export type ResolveurAudio = (piste: PisteVocale) => Promise<string | null>;

/** Ce que la session attend de Discord — remplacé par une doublure en test. */
export interface PasserelleVocale {
	/** Rejoint un salon vocal. Idempotent si on y est déjà. */
	rejoindre(guildeId: string, salonId: string): Promise<void>;
	/** Joue une source. La promesse se résout quand la lecture COMMENCE. */
	jouer(source: string): Promise<void>;
	pause(): void;
	reprendre(): void;
	/** Coupe la lecture en cours sans quitter le salon. */
	couper(): void;
	/** Quitte le salon et libère la connexion. */
	quitter(): void;
	/** Appelé quand une piste se termine d'elle-même. */
	surFin(rappel: () => void): void;
}

export type EtatVocal = "arrete" | "lecture" | "pause";

/** Ce qu'un écran a besoin de savoir de la session. */
export interface VueVocale {
	etat: EtatVocal;
	courante: PisteVocale | null;
	file: readonly PisteVocale[];
	salonId: string | null;
}

/**
 * Une session d'écoute par serveur.
 *
 * ── UNE SEULE SESSION PAR SERVEUR ──────────────────────────────────────────
 * Discord n'autorise qu'une connexion vocale par bot et par serveur : deux
 * sessions concurrentes se voleraient la connexion, et la seconde couperait la
 * première sans prévenir. La contrainte est donc portée ici, explicitement,
 * plutôt que subie plus bas.
 */
export class SessionVocale {
	private readonly passerelle: PasserelleVocale;
	private readonly resoudre: ResolveurAudio;
	private readonly journaliser: (message: string) => void;

	private attente: PisteVocale[] = [];
	private courante: PisteVocale | null = null;
	private etat: EtatVocal = "arrete";
	private salonId: string | null = null;
	/** Une seule avancée de file à la fois : `surFin` peut arriver pendant. */
	private avancee: Promise<void> | null = null;

	constructor(options: {
		passerelle: PasserelleVocale;
		resoudre: ResolveurAudio;
		journaliser?: (message: string) => void;
	}) {
		this.passerelle = options.passerelle;
		this.resoudre = options.resoudre;
		this.journaliser = options.journaliser ?? (() => undefined);
		this.passerelle.surFin(() => {
			void this.avancer();
		});
	}

	vue(): VueVocale {
		return {
			etat: this.etat,
			courante: this.courante,
			file: [...this.attente],
			salonId: this.salonId,
		};
	}

	/**
	 * Met une piste en file, et démarre si rien ne joue.
	 *
	 * Rend ce qui s'est passé, pour que l'appelant le dise : « ça joue » et
	 * « c'est en file derrière trois autres » ne méritent pas le même message.
	 */
	async ajouter(
		guildeId: string,
		salonId: string,
		piste: PisteVocale
	): Promise<{ demarre: boolean; rang: number; erreur?: string }> {
		// Rejoindre AVANT de résoudre : si le membre n'est dans aucun salon,
		// autant le dire tout de suite plutôt qu'après une résolution inutile.
		await this.passerelle.rejoindre(guildeId, salonId);
		this.salonId = salonId;

		this.attente.push(piste);
		if (this.etat !== "arrete") {
			return { demarre: false, rang: this.attente.length };
		}

		const resultat = await this.avancer();
		return resultat.erreur
			? { demarre: false, rang: this.attente.length, erreur: resultat.erreur }
			: { demarre: true, rang: 0 };
	}

	/**
	 * Passe à la piste suivante.
	 *
	 * ── ON N'ABANDONNE PAS SUR UNE SOURCE MANQUANTE ────────────────────────
	 * Une piste dont la source ne se résout pas est ÉCARTÉE et la file
	 * continue. S'arrêter à la première source absente viderait le salon pour
	 * un seul épisode indisponible ; on le signale, et on enchaîne.
	 */
	private async avancer(): Promise<{ erreur?: string }> {
		// `surFin` peut se déclencher pendant qu'on avance déjà : sans cette
		// garde, deux pistes démarreraient et la seconde couperait la première.
		if (this.avancee) {
			await this.avancee;
			return {};
		}

		let echec: string | undefined;
		const travail = (async () => {
			while (this.attente.length > 0) {
				const piste = this.attente.shift()!;
				let source: string | null = null;
				try {
					source = await this.resoudre(piste);
				} catch (err) {
					this.journaliser(
						`source illisible pour ${piste.nomArc} E${piste.episode} : ${err instanceof Error ? err.message : String(err)}`
					);
				}

				if (!source) {
					echec = `Aucune source jouable pour ${piste.nomArc} E${piste.episode}.`;
					this.journaliser(echec);
					continue;
				}

				await this.passerelle.jouer(source);
				this.courante = piste;
				this.etat = "lecture";
				return;
			}

			// File vide : on coupe, mais on RESTE dans le salon. Quitter à chaque
			// fin de piste ferait entrer et sortir le bot sans arrêt.
			this.courante = null;
			this.etat = "arrete";
			this.passerelle.couper();
		})();

		this.avancee = travail.finally(() => {
			this.avancee = null;
		});
		await this.avancee;
		return echec ? { erreur: echec } : {};
	}

	/** Bascule pause/lecture, et dit dans quel état on est. */
	basculerPause(): EtatVocal {
		if (this.etat === "lecture") {
			this.passerelle.pause();
			this.etat = "pause";
		} else if (this.etat === "pause") {
			this.passerelle.reprendre();
			this.etat = "lecture";
		}
		return this.etat;
	}

	/** Passe à la piste suivante immédiatement. */
	async passer(): Promise<{ erreur?: string }> {
		if (this.etat === "arrete") return {};
		this.passerelle.couper();
		return this.avancer();
	}

	/** Coupe tout, vide la file et quitte le salon. */
	arreter(): void {
		this.attente = [];
		this.courante = null;
		this.etat = "arrete";
		this.passerelle.couper();
		this.passerelle.quitter();
		this.salonId = null;
	}
}

/**
 * Les sessions, une par serveur.
 *
 * Une table plutôt qu'une variable : le bot sert plusieurs serveurs, et la
 * session de l'un ne doit jamais répondre aux commandes de l'autre.
 */
export class SessionsVocales {
	private readonly sessions = new Map<string, SessionVocale>();
	private readonly creer: (guildeId: string) => SessionVocale;

	constructor(creer: (guildeId: string) => SessionVocale) {
		this.creer = creer;
	}

	de(guildeId: string): SessionVocale {
		let session = this.sessions.get(guildeId);
		if (!session) {
			session = this.creer(guildeId);
			this.sessions.set(guildeId, session);
		}
		return session;
	}

	/** Session existante seulement — sans en créer une pour rien. */
	existante(guildeId: string): SessionVocale | null {
		return this.sessions.get(guildeId) ?? null;
	}

	arreterTout(): void {
		for (const session of this.sessions.values()) session.arreter();
		this.sessions.clear();
	}
}

/**
 * Résolveur par défaut : il n'accepte qu'une URL de média DIRECTE.
 *
 * ── POURQUOI IL REFUSE LES PAGES DE PLATEFORME ─────────────────────────────
 * ffmpeg lit un MP4, un MP3, un flux HLS — pas une page web. Une URL de
 * plateforme vidéo est une PAGE : en extraire un flux demande un outil
 * spécialisé, et surtout le droit de le faire. Le module ne tranche pas cette
 * question à la place de l'exploitant : il rend `null`, le bot le dit
 * clairement, et {@link resolveurDepuisTable} permet de brancher les sources
 * dont on dispose.
 */
export const RESOLVEUR_DIRECT: ResolveurAudio = async () => null;

/** Extensions et formats que ffmpeg lit sans intermédiaire. */
const EXTENSIONS_DIRECTES = /\.(mp3|m4a|aac|ogg|opus|flac|wav|mp4|m4v|mkv|webm|m3u8|mpd)(\?|$)/i;

/** L'URL désigne-t-elle un média que ffmpeg peut lire tel quel ? */
export function estMediaDirect(url: string): boolean {
	try {
		const analysee = new URL(url);
		if (analysee.protocol !== "http:" && analysee.protocol !== "https:") return false;
		return EXTENSIONS_DIRECTES.test(analysee.pathname) || EXTENSIONS_DIRECTES.test(analysee.search);
	} catch {
		return false;
	}
}

/**
 * Résolveur bâti sur une table `saison:episode` → URL directe.
 *
 * C'est la forme qu'un exploitant remplit avec ses propres sources. Une URL
 * qui n'est pas un média direct est REFUSÉE ici plutôt qu'au fond de ffmpeg,
 * où l'erreur serait illisible.
 */
export function resolveurDepuisTable(table: Readonly<Record<string, string>>): ResolveurAudio {
	return async (piste) => {
		const url = table[`${piste.saison}:${piste.episode}`];
		return url && estMediaDirect(url) ? url : null;
	};
}
