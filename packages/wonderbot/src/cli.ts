#!/usr/bin/env bun
/**
 * Point d'entrée en ligne de commande de Wonderbot.
 *
 * ── POURQUOI CE FICHIER EXISTE ─────────────────────────────────────────────
 * Les quatre commandes que le README documente (`doctor`, `refresh`,
 * `register`, `start`) étaient servies par `apps/bxc/src/cli.ts`. Ce fichier a
 * disparu avec l'absorption de BXC — le moteur navigateur est désormais
 * consommé depuis npm (`docs/BXC-NATIVE.md`) — et le binaire publié n'a PAS de
 * sous-commande `wonderbot` : `bxc --help` de la v0.9.15 ne la liste pas.
 * `niers-wonderbot.service` pointait donc, dans le dépôt COMME dans
 * `/etc/systemd/system`, sur un chemin supprimé : l'unité ne pouvait plus
 * démarrer du tout. La bibliothèque, elle, est intacte et testée — il ne lui
 * manquait que sa façade.
 *
 * Aucune logique ne vit ici. Le fichier traduit un argument en appel de
 * bibliothèque et rend un code de sortie ; tout ce qui se teste vit dans les
 * modules voisins, qui n'ont besoin ni de jeton, ni de réseau, ni de base.
 */

import { Wonderbot } from "./bot.ts";
import { catalogueReel } from "./catalogue.ts";
import { lireConfig, resumerConfig } from "./config.ts";

const COMMANDES = ["doctor", "refresh", "register", "start"] as const;
type Commande = (typeof COMMANDES)[number];

/**
 * Code de sortie « configuration refusée », attendu par
 * `deploy/systemd/niers-wonderbot.service` : il y est posé en
 * `RestartPreventExitStatus`, parce que relancer ne répare pas un jeton absent
 * et que marteler la passerelle avec un mauvais jeton fait limiter
 * l'application par Discord. Sortir en 1 ferait relancer toutes les 15 s.
 */
const CODE_CONFIG_REFUSEE = 77;

/** Marque une erreur venue de `lireConfig`, pour la traduire en code 77. */
class ConfigRefusee extends Error {}

function config() {
	try {
		return lireConfig(process.env);
	} catch (err) {
		throw new ConfigRefusee(err instanceof Error ? err.message : String(err));
	}
}

function usage(): string {
	return [
		"wonderbot — bot Discord du catalogue d'épisodes",
		"",
		"Usage : bun --bun packages/wonderbot/src/cli.ts <commande>",
		"",
		"  doctor     vérifie la configuration et le catalogue, sans Discord",
		"  refresh    amorce/rafraîchit le catalogue, sans Discord",
		"  register   publie les slash commands puis sort",
		"  start      passerelle + rafraîchissement périodique + annonces",
		"",
		"Configuration : voir packages/wonderbot/README.md § Configuration.",
	].join("\n");
}

/** Horodatage lisible, ou « jamais » — 0 signifie qu'aucun passage n'a réussi. */
function fraicheur(marque: number): string {
	if (marque <= 0) return "jamais";
	const ageMin = Math.round((Date.now() - marque) / 60_000);
	return `${new Date(marque).toISOString()} (il y a ${ageMin} min)`;
}

/**
 * `doctor` ne touche NI Discord NI le réseau : il lit la configuration et la
 * base. C'est ce qui permet de distinguer « la configuration est fausse » de
 * « Discord refuse le jeton » sans ouvrir de passerelle — la confusion que le
 * refus explicite de `lireConfig` existe déjà pour éviter.
 */
function doctor(): number {
	const configuration = config();
	console.log(resumerConfig(configuration));

	const catalogue = catalogueReel(configuration.cheminCache);
	try {
		const resume = catalogue.resume();
		const langues = Object.entries(resume.stats.byLanguage)
			.map(([langue, n]) => `${langue} ${n}`)
			.join(", ");
		console.log(
			`catalogue : ${resume.stats.episodes} épisode(s), ${resume.stats.seasons} saison(s), ` +
				`${resume.sources.length} source(s)${langues ? ` — ${langues}` : ""}`
		);
		console.log(`dernier rafraîchissement : ${fraicheur(resume.dernierRafraichissement)}`);
		// Un catalogue vide n'est pas une erreur de configuration : `refresh` le
		// remplit. Le dire plutôt que sortir non nul, sinon `doctor` refuse une
		// installation neuve pourtant correcte.
		if (resume.stats.episodes === 0) {
			console.log("catalogue vide — lancer `refresh` pour l'amorcer");
		}
	} finally {
		catalogue.fermer();
	}
	return 0;
}

/** `refresh` rescrape les sources. Plusieurs minutes, sans Discord. */
async function refresh(): Promise<number> {
	const configuration = config();
	const catalogue = catalogueReel(configuration.cheminCache);
	try {
		const resultat = await catalogue.rafraichir();
		console.log(
			`rafraîchissement : ${resultat.stats.episodes} épisode(s) au total, ` +
				`${resultat.nouveaux.length} nouveau(x), ${resultat.sources} source(s), ` +
				`${(resultat.dureeMs / 1000).toFixed(1)} s`
		);
	} finally {
		catalogue.fermer();
	}
	return 0;
}

/**
 * `register` ouvre la passerelle, publie, et REFERME.
 *
 * `demarrer({ planifier: false })` est exactement ce cas : `publierCommandes`
 * a besoin de `client.application`, qui n'existe qu'après `clientReady`, mais
 * ni du planificateur ni de la synchronisation du forum.
 */
async function register(): Promise<number> {
	const configuration = config();
	const bot = new Wonderbot({ config: configuration });
	try {
		await bot.demarrer({ planifier: false });
	} finally {
		await bot.arreter();
	}
	return 0;
}

/**
 * `start` est le mode service. Il ne rend la main que sur un signal : systemd
 * envoie `SIGTERM`, et `arreter()` doit fermer la passerelle et la base —
 * sinon le `-wal` du catalogue survit au processus et le passage suivant
 * rouvre une base encore en écriture.
 */
async function start(): Promise<number> {
	const configuration = config();
	const bot = new Wonderbot({ config: configuration });
	await bot.demarrer();

	await new Promise<void>((resoudre) => {
		let arretDemande = false;
		const arreter = (signal: NodeJS.Signals) => {
			// Un second signal ne relance pas l'arrêt : systemd envoie `SIGTERM`
			// puis `SIGKILL`, et deux `arreter()` concurrents ferment deux fois la
			// même base.
			if (arretDemande) return;
			arretDemande = true;
			console.log(`signal ${signal} — arrêt`);
			void bot.arreter().then(resoudre, resoudre);
		};
		process.on("SIGTERM", arreter);
		process.on("SIGINT", arreter);
	});
	return 0;
}

function estCommande(valeur: string | undefined): valeur is Commande {
	return COMMANDES.includes(valeur as Commande);
}

async function principal(argv: readonly string[]): Promise<number> {
	const commande = argv[0];
	if (commande === undefined || commande === "--help" || commande === "-h") {
		console.log(usage());
		return commande === undefined ? 2 : 0;
	}
	if (!estCommande(commande)) {
		console.error(`[wonderbot] commande inconnue : ${commande}`);
		console.error(usage());
		return 2;
	}

	switch (commande) {
		case "doctor":
			return doctor();
		case "refresh":
			return await refresh();
		case "register":
			return await register();
		case "start":
			return await start();
	}
}

// `import.meta.main` : le module reste importable par un test sans lancer le bot.
if (import.meta.main) {
	try {
		process.exitCode = await principal(process.argv.slice(2));
	} catch (err) {
		// Le message de `lireConfig` NOMME la variable manquante : le relayer tel
		// quel vaut mieux qu'une trace de pile qui l'enterre.
		console.error(err instanceof Error ? err.message : String(err));
		process.exitCode = err instanceof ConfigRefusee ? CODE_CONFIG_REFUSEE : 1;
	}
}

export { principal };
