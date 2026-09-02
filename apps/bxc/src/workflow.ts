/**
 * Le workflow unifié — une passe, quatre étapes, un seul point d'entrée.
 *
 *   1. scrapping des épisodes  (sept sources : quatre chaînes YouTube, le site
 *      officiel `inazuma-eleven.fr/tv`, Pluto TV `no` et `fr`)
 *   2. mise à jour du catalogue (la base SQLite que le bot lit)
 *   3. `iecrawl` — balayage des sites officiels LEVEL-5 (`inazuma.jp`, `zukan`)
 *   4. annonces — les nouveautés publiées dans le salon Discord
 *
 * ── POURQUOI 1 ET 2 NE SE SÉPARENT PAS ─────────────────────────────────────
 * `Catalogue.rafraichir()` scrape PUIS remplace la base, dans cet ordre et
 * dans le même appel — c'est délibéré côté `@aphrody/wonderbot` : vider avant
 * de scraper laisserait un catalogue vide si le réseau tombe. Les découper ici
 * voudrait dire réécrire cette garantie, donc ne plus copier le fonctionnement
 * existant. Le workflow les compte comme deux étapes et n'en fait qu'un appel.
 *
 * ── CE QUE `--dry-run` FAIT VRAIMENT ───────────────────────────────────────
 * Il ne simule rien : il scrape pour de bon (c'est la seule façon de savoir ce
 * qui est neuf), mais n'ÉCRIT nulle part — ni la base, ni le fichier d'état
 * `iecrawl`, ni Discord. Il ouvre donc le catalogue en lecture pour comparer,
 * et rend exactement ce que la passe réelle aurait produit.
 *
 * ── LES ÉTAPES NE SE BLOQUENT PAS L'UNE L'AUTRE ────────────────────────────
 * `iecrawl` tape deux sites hors de notre contrôle, et le codex demande un
 * moteur de rendu qui peut manquer. Son échec est rapporté, jamais propagé :
 * une panne de `zukan.inazuma.jp` ne doit pas priver un serveur Discord de son
 * annonce d'épisode.
 */

import type { ConfigWonderbot } from "@aphrody/wonderbot/config";

import { iecrawl, type ProfilBxc, type ResultatIeCrawl } from "./iecrawl.ts";

/** Un épisode tel que le rapport le montre — sans dépendre du type amont. */
export interface EpisodeAnnonce {
	videoId: string;
	title: string;
	season: number | null;
	episode: number | null;
	url: string;
}

export interface EtapeCatalogue {
	/** Épisodes présents dans le catalogue à la fin de l'étape. */
	episodes: number;
	saisons: number;
	/** Sources rendues par le scraping (0 = le scraping a échoué). */
	sources: number;
	/** Épisodes absents du catalogue avant cette passe. */
	nouveaux: EpisodeAnnonce[];
	dureeMs: number;
	erreur: string | null;
}

export interface EtapeAnnonces {
	/** Le salon d'annonces est-il configuré ? */
	active: boolean;
	/** Vrai quand cette passe n'a fait qu'amorcer le journal (rien publié). */
	amorcage: boolean;
	/** Épisodes retenus pour l'annonce, plafond appliqué. */
	annonces: EpisodeAnnonce[];
	/** Nouveautés écartées par le plafond anti-inondation. */
	omis: number;
	/** Vrai quand le message a réellement été envoyé à Discord. */
	envoye: boolean;
	erreur: string | null;
}

export interface ResultatWorkflow {
	dryRun: boolean;
	catalogue: EtapeCatalogue;
	iecrawl: ResultatIeCrawl | { erreur: string };
	annonces: EtapeAnnonces;
	dureeMs: number;
}

export interface OptionsWorkflow {
	config: ConfigWonderbot;
	/** N'écrire nulle part : ni base, ni fichier d'état, ni Discord. */
	dryRun?: boolean;
	/** Sauter le balayage `iecrawl`. */
	sansIecrawl?: boolean;
	/** Sauter l'étape d'annonce, même si le salon est configuré. */
	sansAnnonces?: boolean;
	/** Profil de transport du balayage `iecrawl`. Défaut : `static`. */
	profilIecrawl?: ProfilBxc;
	/** Balayer aussi `zukan.inazuma.jp`. Défaut : vrai. */
	codex?: boolean;
	journaliser?: (message: string) => void;
}

/** Plafond de lecture du catalogue, aligné sur celui de `@aphrody/wonderbot`. */
const PLAFOND_BALAYAGE = 20_000;

function resumerEpisode(episode: {
	videoId: string;
	title: string;
	season: number | null;
	episode: number | null;
	url: string;
}): EpisodeAnnonce {
	return {
		videoId: episode.videoId,
		title: episode.title,
		season: episode.season,
		episode: episode.episode,
		url: episode.url,
	};
}

function messageErreur(erreur: unknown): string {
	return erreur instanceof Error ? erreur.message : String(erreur);
}

/**
 * Étapes 1 et 2 — scrapping des épisodes puis mise à jour du catalogue.
 *
 * En mode réel c'est `Catalogue.rafraichir()`, tel quel. En `--dry-run` on
 * refait le même enchaînement à la main SANS l'écriture : on relève les
 * identifiants connus, on scrape, on compare. Le scraper est chargé à la
 * demande — il tire tout le moteur `@aphrody/bxc`, dont une passe qui échoue
 * plus tôt n'a que faire.
 */
async function etapeCatalogue(
	options: OptionsWorkflow,
	journaliser: (message: string) => void
): Promise<EtapeCatalogue> {
	const { catalogueReel } = await import("@aphrody/wonderbot/catalogue");
	const catalogue = catalogueReel(options.config.cheminCache);
	const debut = Date.now();

	try {
		if (options.dryRun !== true) {
			const resultat = await catalogue.rafraichir();
			return {
				episodes: resultat.stats.episodes,
				saisons: resultat.stats.seasons,
				sources: resultat.sources,
				nouveaux: resultat.nouveaux.map(resumerEpisode),
				dureeMs: resultat.dureeMs,
				erreur: null,
			};
		}

		const connus = catalogue.identifiants();
		const { default: IETVScraper } = await import("@aphrody/ietv");
		const scraper = new IETVScraper();
		let chaines;
		try {
			chaines = await scraper.getAllChannelEpisodes();
		} finally {
			await scraper.close();
		}

		// Le même épisode existe sur plusieurs sources : on dédoublonne par
		// identifiant de vidéo, exactement comme le fait le cache à l'écriture.
		const vus = new Set<string>();
		const nouveaux: EpisodeAnnonce[] = [];
		let total = 0;
		const saisons = new Set<number>();
		for (const chaine of chaines) {
			for (const saison of chaine.seasons) {
				saisons.add(saison.season);
				for (const video of saison.episodes) {
					if (vus.has(video.videoId)) continue;
					vus.add(video.videoId);
					total++;
					if (!connus.has(video.videoId)) nouveaux.push(resumerEpisode(video));
				}
			}
		}

		journaliser("  (dry-run) catalogue NON réécrit — la base reste en l'état");
		return {
			episodes: total,
			saisons: saisons.size,
			sources: chaines.length,
			nouveaux,
			dureeMs: Date.now() - debut,
			erreur: null,
		};
	} catch (erreur) {
		return {
			episodes: 0,
			saisons: 0,
			sources: 0,
			nouveaux: [],
			dureeMs: Date.now() - debut,
			erreur: messageErreur(erreur),
		};
	} finally {
		catalogue.fermer();
	}
}

/**
 * Étape 4 — annonce des nouveautés dans le salon Discord.
 *
 * Copie fidèle du chemin `Wonderbot.apresRafraichissement` → `annoncer` : même
 * journal, même plafond, même fiche, même politique de mention. La différence
 * tient au cycle de vie — une passerelle ouverte le temps d'un message, puis
 * détruite, là où le bot la garde ouverte.
 *
 * En `--dry-run` le journal n'est ni lu à travers `traiter` (qui écrit) ni mis
 * à jour : on calcule le diff avec `diffNouveaux`, la fonction pure, et rien
 * ne part.
 */
async function etapeAnnonces(
	options: OptionsWorkflow,
	journaliser: (message: string) => void
): Promise<EtapeAnnonces> {
	const inactive: EtapeAnnonces = {
		active: false,
		amorcage: false,
		annonces: [],
		omis: 0,
		envoye: false,
		erreur: null,
	};

	if (options.sansAnnonces === true) return inactive;
	if (options.config.salonAnnonces === null) {
		journaliser("  aucun salon d'annonces configuré (WONDERBOT_ANNOUNCE_CHANNEL_ID) — étape sautée");
		return inactive;
	}

	const { catalogueReel } = await import("@aphrody/wonderbot/catalogue");
	const { JournalAnnonces, diffNouveaux } = await import("@aphrody/wonderbot/annonces");
	const catalogue = catalogueReel(options.config.cheminCache);

	try {
		const complet = catalogue.rechercher({ limite: PLAFOND_BALAYAGE });
		const journal = new JournalAnnonces(catalogue);

		if (options.dryRun === true) {
			const vus = journal.vus();
			if (vus === null) {
				journaliser(
					`  (dry-run) journal d'annonces ABSENT — une passe réelle l'amorcerait sur ` +
						`${complet.length} épisode(s) sans rien publier`
				);
				return { ...inactive, active: true, amorcage: true };
			}
			// Les plus récents d'abord — même règle que `JournalAnnonces.traiter` :
			// si le plafond coupe, mieux vaut le dernier épisode paru que le
			// premier d'un rattrapage de saison.
			const nouveaux = diffNouveaux(vus, complet).toReversed();
			const retenus = nouveaux.slice(0, options.config.plafondAnnonces);
			journaliser(
				`  (dry-run) ${retenus.length} annonce(s) seraient publiées dans le salon ` +
					`${options.config.salonAnnonces}, rien n'est envoyé`
			);
			return {
				active: true,
				amorcage: false,
				annonces: retenus.map(resumerEpisode),
				omis: Math.max(0, nouveaux.length - retenus.length),
				envoye: false,
				erreur: null,
			};
		}

		const decision = journal.traiter(complet, options.config.plafondAnnonces);
		if (decision.amorcage) {
			journaliser(
				`  journal d'annonces amorcé sur ${complet.length} épisode(s) — aucun rattrapage, ` +
					"la première annonce portera sur une nouveauté à venir"
			);
			return { ...inactive, active: true, amorcage: true };
		}
		if (decision.aAnnoncer.length === 0) {
			journaliser("  aucune nouveauté à annoncer");
			return { ...inactive, active: true };
		}

		const envoye = await publierAnnonce(
			options.config,
			decision.aAnnoncer,
			decision.omis,
			journaliser
		);
		return {
			active: true,
			amorcage: false,
			annonces: decision.aAnnoncer.map(resumerEpisode),
			omis: decision.omis,
			envoye,
			erreur: null,
		};
	} catch (erreur) {
		return { ...inactive, active: true, erreur: messageErreur(erreur) };
	} finally {
		catalogue.fermer();
	}
}

/**
 * Ouvre une passerelle Discord le temps d'un message, puis la referme.
 *
 * Les intents restent ceux du bot : `Guilds` et rien d'autre. Demander un
 * intent privilégié non accordé ferme la passerelle (code 4014) — ici comme
 * dans le service.
 */
async function publierAnnonce(
	config: ConfigWonderbot,
	episodes: readonly {
		videoId: string;
		title: string;
		season: number | null;
		episode: number | null;
		url: string;
	}[],
	omis: number,
	journaliser: (message: string) => void
): Promise<boolean> {
	const { Client, GatewayIntentBits } = await import("discord.js");
	const { ICONES, fiche, listerEpisodes } = await import("@aphrody/wonderbot/ui");

	const client = new Client({ intents: [GatewayIntentBits.Guilds] });
	try {
		await client.login(config.jeton);
		// `login` rend la main avant que le cache des salons soit utilisable :
		// `channels.fetch` sur un client non prêt échoue silencieusement.
		await new Promise<void>((resolve) => {
			if (client.isReady()) resolve();
			else client.once("clientReady", () => resolve());
		});

		const salon = await client.channels.fetch(config.salonAnnonces as string).catch(() => null);
		if (!salon || !salon.isSendable()) {
			journaliser(
				`  ${ICONES.echec} salon d'annonces ${config.salonAnnonces} injoignable ou interdit à ` +
					"l'écriture — vérifier « Voir le salon », « Envoyer des messages » et « Intégrer des liens »"
			);
			return false;
		}

		const liste = listerEpisodes(episodes as never, { limite: episodes.length });
		const embed = fiche({
			titre: `${ICONES.nouveau} ${episodes.length} nouvel(s) épisode(s) au catalogue`,
			marque: config.marque,
		})
			.description(liste.texte)
			.finir(omis > 0 ? `${omis} autre(s) non listé(s)` : undefined);

		await salon.send({
			...(config.roleAnnonces ? { content: `<@&${config.roleAnnonces}>` } : {}),
			embeds: [embed as never],
			allowedMentions: config.roleAnnonces ? { roles: [config.roleAnnonces] } : { parse: [] },
		});
		journaliser(`  ${ICONES.nouveau} ${episodes.length} nouveauté(s) annoncée(s)`);
		return true;
	} finally {
		await client.destroy();
	}
}

/** Enchaîne les quatre étapes, dans l'ordre, en une passe. */
export async function executerWorkflow(options: OptionsWorkflow): Promise<ResultatWorkflow> {
	const journaliser = options.journaliser ?? (() => {});
	const debut = Date.now();

	journaliser(
		options.dryRun === true
			? "[1-2/4] scrapping des épisodes (dry-run : le catalogue ne sera pas réécrit)"
			: "[1-2/4] scrapping des épisodes et mise à jour du catalogue"
	);
	const catalogue = await etapeCatalogue(options, journaliser);
	journaliser(
		catalogue.erreur === null
			? `  ${catalogue.episodes} épisode(s), ${catalogue.saisons} saison(s), ` +
					`${catalogue.sources} source(s), ${catalogue.nouveaux.length} nouveauté(s) ` +
					`en ${(catalogue.dureeMs / 1000).toFixed(1)} s`
			: `  échec : ${catalogue.erreur}`
	);

	journaliser("[3/4] iecrawl — balayage des sites officiels LEVEL-5");
	let balayage: ResultatWorkflow["iecrawl"];
	if (options.sansIecrawl === true) {
		balayage = { erreur: "balayage désactivé (--sans-iecrawl)" };
		journaliser("  désactivé");
	} else {
		try {
			balayage = await iecrawl({
				...(options.profilIecrawl ? { profil: options.profilIecrawl } : {}),
				...(options.codex !== undefined ? { codex: options.codex } : {}),
				dryRun: options.dryRun === true,
				journaliser,
			});
			if (balayage.fichier !== null) journaliser(`  état écrit : ${balayage.fichier}`);
		} catch (erreur) {
			// Ne devrait pas arriver — `iecrawl` rapporte ses échecs. Filet de
			// sécurité pour que l'étape 4 s'exécute quand même.
			balayage = { erreur: messageErreur(erreur) };
			journaliser(`  échec : ${balayage.erreur}`);
		}
	}

	journaliser("[4/4] annonces");
	const annonces = await etapeAnnonces(options, journaliser);
	if (annonces.erreur !== null) journaliser(`  échec : ${annonces.erreur}`);

	return {
		dryRun: options.dryRun === true,
		catalogue,
		iecrawl: balayage,
		annonces,
		dureeMs: Date.now() - debut,
	};
}
