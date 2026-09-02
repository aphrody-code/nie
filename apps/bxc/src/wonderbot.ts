/**
 * `niers-bxc wonderbot <action>` — le bot Discord du catalogue d'épisodes.
 *
 * Copie fidèle de `src/cli/wonderbot.ts` du dépôt `@aphrody/bxc`, à trois
 * différences près, toutes de forme :
 *
 *   • le module rend un code de sortie au lieu d'appeler `process.exit`, pour
 *     que le dispatcheur `cli.ts` reste le seul à décider de la sortie ;
 *   • les messages passent par le journal local (`journal.ts`) ;
 *   • `register` et `start` partagent le même montage de bot.
 *
 * `doctor` et `refresh` NE se connectent PAS à Discord : ils servent à vérifier
 * une installation et à amorcer le catalogue avant même que le bot ne démarre.
 */

import { journal, messageErreur, SORTIE, type OptionsCommunes } from "./journal.ts";

/** Actions reconnues, dans l'ordre où l'aide les présente. */
const ACTIONS = ["start", "doctor", "refresh", "register", "forum"] as const;
type Action = (typeof ACTIONS)[number];

function estAction(valeur: string): valeur is Action {
	return (ACTIONS as readonly string[]).includes(valeur);
}

export async function commandeWonderbot(
	argv: readonly string[],
	options: OptionsCommunes
): Promise<number> {
	const demandee = argv.find((argument) => !argument.startsWith("-")) ?? "start";
	if (!estAction(demandee)) {
		journal.error(`action inconnue : ${demandee}. Actions : ${ACTIONS.join(", ")}.`);
		return SORTIE.USAGE;
	}

	const { lireConfig, resumerConfig } = await import("@aphrody/wonderbot/config");
	const { catalogueReel } = await import("@aphrody/wonderbot/catalogue");

	let config;
	try {
		config = lireConfig(Bun.env as Record<string, string | undefined>);
	} catch (erreur) {
		// Configuration incomplète : c'est une erreur d'installation, pas un bug.
		// `CONFIG` (77) dit à systemd que réessayer ne servira à rien.
		journal.error(messageErreur(erreur));
		return SORTIE.CONFIG;
	}

	switch (demandee) {
		case "doctor": {
			const catalogue = catalogueReel(config.cheminCache);
			try {
				const resume = catalogue.resume();
				if (options.json) {
					Bun.stdout.write(
						`${JSON.stringify(
							{
								applicationId: config.applicationId,
								portee: config.portee,
								guildes: config.guildes,
								cheminCache: config.cheminCache,
								salonAnnonces: config.salonAnnonces,
								intervalleRafraichissementMs: config.intervalleRafraichissementMs,
								catalogue: {
									episodes: resume.stats.episodes,
									saisons: resume.stats.seasons,
									sources: resume.stats.channels,
									parLangue: resume.stats.byLanguage,
									dernierRafraichissement: resume.dernierRafraichissement,
								},
							},
							null,
							2
						)}\n`
					);
				} else {
					journal.log(resumerConfig(config), options);
					journal.log(
						`catalogue : ${resume.stats.episodes} épisode(s), ${resume.stats.seasons} saison(s), ` +
							`${resume.stats.channels} source(s)`,
						options
					);
					if (resume.stats.episodes === 0) {
						journal.warn("catalogue vide — lancer `niers-bxc workflow`", options);
					}
				}
			} finally {
				catalogue.fermer();
			}
			return SORTIE.OK;
		}

		case "refresh": {
			const catalogue = catalogueReel(config.cheminCache);
			try {
				const resultat = await catalogue.rafraichir();
				if (options.json) {
					Bun.stdout.write(
						`${JSON.stringify(
							{
								episodes: resultat.stats.episodes,
								sources: resultat.sources,
								nouveaux: resultat.nouveaux.length,
								dureeMs: resultat.dureeMs,
							},
							null,
							2
						)}\n`
					);
				} else {
					journal.log(
						`catalogue rafraîchi : ${resultat.stats.episodes} épisode(s) sur ${resultat.sources} source(s) ` +
							`en ${(resultat.dureeMs / 1000).toFixed(1)} s — ${resultat.nouveaux.length} nouveauté(s)`,
						options
					);
				}
			} catch (erreur) {
				journal.error(messageErreur(erreur));
				return SORTIE.LOGICIEL;
			} finally {
				catalogue.fermer();
			}
			return SORTIE.OK;
		}

		case "forum": {
			// Destructeur, donc jamais automatique : la boucle du service ne
			// l'appelle nulle part. `--tout` renonce à la garde qui épargne les
			// fils où des membres ont écrit.
			const { Wonderbot } = await import("@aphrody/wonderbot");
			const bot = new Wonderbot({ config, journaliser: (m) => journal.log(m, options) });
			try {
				await bot.demarrer({ planifier: false });
				await bot.reconstruireForum({ garderNonVides: !argv.includes("--tout") });
			} catch (erreur) {
				journal.error(messageErreur(erreur));
				await bot.arreter();
				return SORTIE.LOGICIEL;
			}
			await bot.arreter();
			return SORTIE.OK;
		}

		case "register": {
			const { Wonderbot } = await import("@aphrody/wonderbot");
			const bot = new Wonderbot({ config, journaliser: (m) => journal.log(m, options) });
			// `publierCommandes` a besoin d'une application résolue : on se connecte,
			// on attend la publication, on repart. Aucune boucle de rafraîchissement.
			try {
				await bot.demarrer({ planifier: false });
			} catch (erreur) {
				journal.error(messageErreur(erreur));
				await bot.arreter();
				return SORTIE.LOGICIEL;
			}
			await bot.arreter();
			return SORTIE.OK;
		}

		default: {
			const { Wonderbot } = await import("@aphrody/wonderbot");
			const bot = new Wonderbot({ config, journaliser: (m) => journal.log(m, options) });

			const arret = async (signal: string) => {
				journal.log(`\n${signal} reçu — arrêt propre`, options);
				await bot.arreter();
				// Sortie immédiate assumée : la passerelle est fermée, attendre la
				// remontée de pile ne ferait que retarder l'arrêt du service.
				process.exit(SORTIE.SIGINT);
			};
			process.on("SIGINT", () => void arret("SIGINT"));
			process.on("SIGTERM", () => void arret("SIGTERM"));

			await bot.demarrer();
			// `demarrer` rend la main une fois la passerelle ouverte ; le processus
			// reste vivant tant que discord.js tient sa socket.
			return SORTIE.OK;
		}
	}
}
