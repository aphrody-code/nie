/**
 * L'implémentation `@discordjs/voice` de {@link PasserelleVocale}.
 *
 * ── ISOLÉE DANS SON PROPRE MODULE, ET CHARGÉE PARESSEUSEMENT ───────────────
 * `@discordjs/voice` est une dépendance FACULTATIVE : un bot qui ne sert que
 * le catalogue n'a aucune raison de tirer une pile audio, un chiffrement et un
 * démultiplexeur Ogg. Le module n'est donc importé qu'au premier usage du
 * vocal, et son absence se traduit par un message clair plutôt que par un
 * plantage au démarrage.
 *
 * ── FFMPEG ENCODE, PAS NOUS ────────────────────────────────────────────────
 * ffmpeg est bâti ici avec libopus : il produit directement un flux Ogg/Opus,
 * exactement ce que Discord attend. Cela évite `@discordjs/opus` (module natif
 * à compiler) comme `opusscript` (encodage en JavaScript, coûteux). Le CPU du
 * VPS ne fait que recopier des paquets déjà encodés.
 */

import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";

import type { PasserelleVocale } from "./vocal.ts";

/**
 * ffmpeg tel qu'on le lance : entrée fermée, sortie et erreurs en tuyaux.
 *
 * Le type dit `null` pour l'entrée parce que `stdio[0]` vaut `"ignore"` — on
 * ne lui écrit jamais rien, la source est une URL qu'il ouvre lui-même.
 */
type ProcessusFfmpeg = ChildProcessByStdio<null, Readable, Readable>;

/** Ce qu'on utilise de `@discordjs/voice`, sans en dépendre à l'import. */
interface ModuleVoix {
	joinVoiceChannel(options: {
		channelId: string;
		guildId: string;
		adapterCreator: unknown;
		selfDeaf: boolean;
	}): ConnexionVoix;
	createAudioPlayer(options?: unknown): LecteurVoix;
	createAudioResource(entree: unknown, options: { inputType: unknown }): unknown;
	getVoiceConnection(guildId: string): ConnexionVoix | undefined;
	entersState(cible: unknown, etat: unknown, delaiMs: number): Promise<unknown>;
	StreamType: Record<string, unknown>;
	VoiceConnectionStatus: Record<string, unknown>;
	AudioPlayerStatus: Record<string, unknown>;
	NoSubscriberBehavior: Record<string, unknown>;
}

interface ConnexionVoix {
	subscribe(lecteur: LecteurVoix): unknown;
	destroy(): void;
}

interface LecteurVoix {
	play(ressource: unknown): void;
	pause(): boolean;
	unpause(): boolean;
	stop(force?: boolean): boolean;
	on(evenement: string, rappel: (...args: unknown[]) => void): unknown;
}

/** Le module voix, chargé une seule fois. */
let moduleVoix: Promise<ModuleVoix> | null = null;

/**
 * Charge `@discordjs/voice`, ou explique ce qu'il manque.
 *
 * L'erreur nomme la dépendance ET la commande qui l'installe : « Cannot find
 * module » seul enverrait l'exploitant lire une trace d'appels pour découvrir
 * qu'il lui manque un paquet facultatif.
 */
export async function chargerVoix(): Promise<ModuleVoix> {
	moduleVoix ??= import("@discordjs/voice").catch((err) => {
		throw new Error(
			"[wonderbot] l'écoute en vocal demande `@discordjs/voice`, qui n'est pas installé. " +
				"Depuis la racine du dépôt : `bun install`. " +
				`(cause : ${err instanceof Error ? err.message : String(err)})`
		);
	}) as Promise<ModuleVoix>;
	return moduleVoix;
}

/** ffmpeg est-il utilisable ? Vérifié une fois, au premier besoin. */
let ffmpegDisponible: Promise<boolean> | null = null;

export async function verifierFfmpeg(): Promise<boolean> {
	ffmpegDisponible ??= new Promise<boolean>((resoudre) => {
		const essai = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
		essai.on("error", () => resoudre(false));
		essai.on("close", (code) => resoudre(code === 0));
	});
	return ffmpegDisponible;
}

/**
 * Arguments ffmpeg : n'importe quelle source lisible → Ogg/Opus 48 kHz stéréo.
 *
 * `-vn` jette la vidéo : elle ne sert à rien dans un salon vocal et la
 * décoder coûterait le CPU du VPS pour un flux qui finirait à la poubelle.
 * Les options de reconnexion évitent qu'une coupure réseau d'une seconde
 * termine la lecture au milieu d'un épisode.
 */
export function argumentsFfmpeg(source: string): string[] {
	return [
		"-reconnect", "1",
		"-reconnect_streamed", "1",
		"-reconnect_delay_max", "5",
		"-i", source,
		"-vn",
		"-analyzeduration", "0",
		"-loglevel", "error",
		"-acodec", "libopus",
		"-f", "ogg",
		"-ar", "48000",
		"-ac", "2",
		"-b:a", "96k",
		"pipe:1",
	];
}

export interface OptionsPasserelleDiscord {
	/** Rend l'adaptateur de voix d'un serveur — `guild.voiceAdapterCreator`. */
	adaptateur(guildeId: string): Promise<unknown>;
	journaliser?(message: string): void;
}

/**
 * Passerelle vocale réelle.
 *
 * Une instance par serveur : la connexion vocale de Discord l'est aussi, et
 * partager l'objet entre serveurs ferait couper l'un en agissant sur l'autre.
 */
export class PasserelleVocaleDiscord implements PasserelleVocale {
	private readonly guildeId: string;
	private readonly options: OptionsPasserelleDiscord;
	private readonly journaliser: (message: string) => void;

	private connexion: ConnexionVoix | null = null;
	private lecteur: LecteurVoix | null = null;
	private ffmpeg: ProcessusFfmpeg | null = null;
	private rappelFin: (() => void) | null = null;
	/** Vrai pendant un `couper()` volontaire : la fin qui suit n'est pas naturelle. */
	private coupureVolontaire = false;

	constructor(guildeId: string, options: OptionsPasserelleDiscord) {
		this.guildeId = guildeId;
		this.options = options;
		this.journaliser = options.journaliser ?? (() => undefined);
	}

	surFin(rappel: () => void): void {
		this.rappelFin = rappel;
	}

	async rejoindre(guildeId: string, salonId: string): Promise<void> {
		const voix = await chargerVoix();
		if (!(await verifierFfmpeg())) {
			throw new Error(
				"[wonderbot] ffmpeg est introuvable : c'est lui qui transcode la source en Opus. " +
					"Installe-le (`apt install ffmpeg`) puis relance."
			);
		}

		const existante = voix.getVoiceConnection(guildeId);
		if (existante && this.connexion === existante) return;

		this.connexion = voix.joinVoiceChannel({
			channelId: salonId,
			guildId: guildeId,
			adapterCreator: await this.options.adaptateur(guildeId),
			// `selfDeaf` : le bot n'écoute PAS le salon. Il n'a aucun usage du
			// flux entrant, et le recevoir consommerait de la bande passante
			// pour rien — en plus de ressembler à une écoute.
			selfDeaf: true,
		});

		this.lecteur ??= this.creerLecteur(voix);
		this.connexion.subscribe(this.lecteur);

		await voix.entersState(this.connexion, voix.VoiceConnectionStatus.Ready, 20_000);
	}

	private creerLecteur(voix: ModuleVoix): LecteurVoix {
		const lecteur = voix.createAudioPlayer({
			behaviors: {
				// La lecture continue même si le salon se vide : sinon elle
				// s'arrêterait à chaque fois que le dernier membre se déconnecte
				// une seconde, et reprendrait au début.
				noSubscriber: voix.NoSubscriberBehavior.Play,
			},
		});

		lecteur.on("idle", () => {
			if (this.coupureVolontaire) {
				this.coupureVolontaire = false;
				return;
			}
			this.arreterFfmpeg();
			this.rappelFin?.();
		});
		lecteur.on("error", (err: unknown) => {
			this.journaliser(
				`lecture vocale en échec : ${err instanceof Error ? err.message : String(err)}`
			);
			this.arreterFfmpeg();
			this.rappelFin?.();
		});

		return lecteur;
	}

	async jouer(source: string): Promise<void> {
		const voix = await chargerVoix();
		if (!this.lecteur) throw new Error("[wonderbot] `jouer` avant `rejoindre`");

		this.arreterFfmpeg();
		const processus = spawn("ffmpeg", argumentsFfmpeg(source), {
			stdio: ["ignore", "pipe", "pipe"],
		});
		this.ffmpeg = processus;

		// stderr est LU, pas ignoré : un tuyau plein bloquerait ffmpeg au
		// premier message d'erreur, et la lecture s'arrêterait sans explication.
		processus.stderr.on("data", (morceau: Buffer) => {
			const texte = morceau.toString().trim();
			if (texte !== "") this.journaliser(`ffmpeg : ${texte}`);
		});
		processus.on("error", (err) => this.journaliser(`ffmpeg introuvable : ${err.message}`));

		this.lecteur.play(
			voix.createAudioResource(processus.stdout, { inputType: voix.StreamType.OggOpus })
		);
	}

	pause(): void {
		this.lecteur?.pause();
	}

	reprendre(): void {
		this.lecteur?.unpause();
	}

	couper(): void {
		this.coupureVolontaire = true;
		this.lecteur?.stop(true);
		this.arreterFfmpeg();
	}

	quitter(): void {
		this.arreterFfmpeg();
		this.connexion?.destroy();
		this.connexion = null;
		this.lecteur = null;
	}

	/** Tue le transcodeur — sinon un ffmpeg orphelin survit à chaque piste. */
	private arreterFfmpeg(): void {
		if (!this.ffmpeg) return;
		this.ffmpeg.kill("SIGKILL");
		this.ffmpeg = null;
	}
}
