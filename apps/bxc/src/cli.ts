#!/usr/bin/env bun
/**
 * `niers-bxc` — point d'entrée unique du scrapping Inazuma dans niers.
 *
 * Deux sous-commandes, et rien d'autre :
 *
 *   • `workflow`  — la passe unifiée : épisodes → catalogue → iecrawl → annonces
 *   • `wonderbot` — le bot Discord, repris tel quel de `bxc wonderbot`
 *
 * ── POURQUOI CETTE APP EXISTE ──────────────────────────────────────────────
 * Le moteur de navigation `@aphrody/bxc` reste une DÉPENDANCE (registre npm,
 * version 0.8.0, celle-là même que `@aphrody/ietv` et `@aphrody/zukan`
 * réclament) : il n'a pas été recopié dans niers. Ce qui est entré dans le
 * dépôt, ce sont les paquets métier — `@aphrody/ietv`, `@aphrody/ietv-client`,
 * `@aphrody/wonderbot`, `@aphrody/zukan` — et cette app, qui les enchaîne.
 */

import { executerWorkflow, type ResultatWorkflow } from "./workflow.ts";
import { journal, lireOptionsCommunes, messageErreur, SORTIE, type OptionsCommunes } from "./journal.ts";
import type { ProfilBxc } from "./iecrawl.ts";

function aide(): void {
	Bun.stdout.write(
		`niers-bxc — scrapping Inazuma : épisodes, sites officiels, catalogue, annonces

Usage :
  niers-bxc workflow [options]         Une passe complète des quatre étapes
  niers-bxc wonderbot <action>         Bot Discord (start | doctor | refresh | register)
  niers-bxc bxc <args...>              Passe-plat vers le CLI amont @aphrody/bxc
                                       (ietv, zukan, crawl-worker, recon, scrape,
                                        search, mirror, x, xcom, fut, challonge…)

Options de « workflow » :
  --dry-run              Scrape et compare, mais n'écrit NULLE PART
                         (ni base, ni fichier d'état, ni message Discord)
  --sans-iecrawl         Saute le balayage des sites officiels
  --sans-annonces        Saute l'étape d'annonce
  --sans-codex           Ne balaye pas zukan.inazuma.jp (évite le moteur de rendu)
  --profil <p>           Profil bxc du balayage : static | http | fast | stealth | max
                         (défaut : static — aucun navigateur lancé)

Options communes :
  --json                 Sortie machine
  --quiet, -q            Silencieux
  --help, -h             Cette aide

Environnement (le premier nom trouvé gagne) :
  WONDERBOT_DISCORD_TOKEN | DISCORD_BOT_TOKEN | DISCORD_TOKEN   jeton du bot
  WONDERBOT_APPLICATION_ID | DISCORD_APPLICATION_ID | DISCORD_CLIENT_ID
  WONDERBOT_GUILD_ID | DISCORD_GUILD_ID          guilde(s), vide = commandes globales
  WONDERBOT_ANNOUNCE_CHANNEL_ID                  salon des nouveautés
  IETV_CACHE_PATH                                base SQLite du catalogue
  IE_CRAWL_DIR                                   état d'iecrawl (défaut : data/ie-crawl)

Les secrets vivent HORS du dépôt : ~/.config/niers/wonderbot.env (chmod 600),
chargé par l'unité systemd « niers-wonderbot ».
`
	);
}

const PROFILS: readonly ProfilBxc[] = ["static", "http", "fast", "stealth", "max"];

function estProfil(valeur: string): valeur is ProfilBxc {
	return (PROFILS as readonly string[]).includes(valeur);
}

/** Résumé humain d'une passe — ce qu'on veut lire dans `journalctl`. */
function resumer(resultat: ResultatWorkflow): string {
	const lignes: string[] = [];
	const c = resultat.catalogue;
	lignes.push(
		c.erreur === null
			? `catalogue : ${c.episodes} épisode(s) sur ${c.sources} source(s), ${c.nouveaux.length} nouveauté(s)`
			: `catalogue : ÉCHEC — ${c.erreur}`
	);

	if (!("portail" in resultat.iecrawl)) {
		lignes.push(`iecrawl : ${resultat.iecrawl.erreur}`);
	} else {
		const balayage = resultat.iecrawl;
		const ok = balayage.portail.filter((page) => page.erreur === null).length;
		lignes.push(
			`iecrawl : ${ok}/${balayage.portail.length} page(s) du portail, ` +
				(balayage.codex.erreur === null
					? `${balayage.codex.personnages} fiche(s) au codex`
					: `codex indisponible (${balayage.codex.erreur})`)
		);
	}

	const a = resultat.annonces;
	lignes.push(
		!a.active
			? "annonces : désactivées"
			: a.erreur !== null
				? `annonces : ÉCHEC — ${a.erreur}`
				: a.amorcage
					? "annonces : journal amorcé, rien publié"
					: `annonces : ${a.annonces.length} publiée(s)${a.omis > 0 ? `, ${a.omis} omise(s)` : ""}` +
						(a.envoye ? "" : " (non envoyées)")
	);

	lignes.push(`durée : ${(resultat.dureeMs / 1000).toFixed(1)} s`);
	return lignes.join("\n");
}

async function commandeWorkflow(argv: readonly string[], options: OptionsCommunes): Promise<number> {
	let dryRun = false;
	let sansIecrawl = false;
	let sansAnnonces = false;
	let codex = true;
	let profil: ProfilBxc | undefined;

	for (let i = 0; i < argv.length; i++) {
		const argument = argv[i];
		if (argument === "--dry-run") dryRun = true;
		else if (argument === "--sans-iecrawl") sansIecrawl = true;
		else if (argument === "--sans-annonces") sansAnnonces = true;
		else if (argument === "--sans-codex") codex = false;
		else if (argument === "--profil") {
			const valeur = argv[++i] ?? "";
			if (!estProfil(valeur)) {
				journal.error(`--profil "${valeur}" inconnu. Valeurs : ${PROFILS.join(", ")}.`);
				return SORTIE.USAGE;
			}
			profil = valeur;
		} else if (argument.startsWith("-")) {
			journal.error(`option inconnue : ${argument}`);
			return SORTIE.USAGE;
		}
	}

	const { lireConfig, resumerConfig } = await import("@aphrody/wonderbot/config");
	let config;
	try {
		config = lireConfig(Bun.env as Record<string, string | undefined>);
	} catch (erreur) {
		// Configuration incomplète : erreur d'installation, pas un bug. `CONFIG`
		// dit à systemd que réessayer ne servira à rien.
		journal.error(messageErreur(erreur));
		return SORTIE.CONFIG;
	}

	journal.log(resumerConfig(config), options);
	const resultat = await executerWorkflow({
		config,
		dryRun,
		sansIecrawl,
		sansAnnonces,
		codex,
		...(profil ? { profilIecrawl: profil } : {}),
		journaliser: (message) => journal.log(message, options),
	});

	if (options.json) Bun.stdout.write(`${JSON.stringify(resultat, null, 2)}\n`);
	else journal.log(`\n${resumer(resultat)}`, options);

	// Le scrapping est la raison d'être de la passe : s'il échoue, la passe a
	// échoué, même si `iecrawl` et les annonces se sont bien passés.
	return resultat.catalogue.erreur === null ? SORTIE.OK : SORTIE.LOGICIEL;
}

async function principal(): Promise<number> {
	const brut = Bun.argv.slice(2);

	// `lireOptionsCommunes` a déjà retiré `--json` et `--quiet` : ce qui reste
	// appartient à la sous-commande. Les lui repasser la ferait échouer sur
	// « option inconnue ».
	const { options, reste } = lireOptionsCommunes(brut);
	const commande = reste[0] ?? "";

	// `--help` n'est intercepté qu'au niveau global : `niers-bxc bxc --help`
	// doit afficher l'aide du CLI AMONT, pas la nôtre.
	if (
		commande !== "bxc" &&
		(brut.length === 0 || brut.includes("--help") || brut.includes("-h"))
	) {
		aide();
		return brut.length === 0 ? SORTIE.USAGE : SORTIE.OK;
	}

	switch (commande) {
		case "workflow":
			return commandeWorkflow(reste.slice(1), options);
		case "wonderbot": {
			const { commandeWonderbot } = await import("./wonderbot.ts");
			return commandeWonderbot(reste.slice(1), options);
		}
		case "bxc": {
			// Passe-plat : tout ce que le CLI amont sait faire reste joignable
			// depuis niers, sans qu'une seule commande soit recopiée. On repasse
			// `brut` et non `reste` — les drapeaux communs de niers-bxc (`--json`,
			// `--quiet`) existent aussi en amont et lui appartiennent ici.
			const { executerBxc } = await import("./passerelle.ts");
			return executerBxc(brut.slice(brut.indexOf("bxc") + 1));
		}
		default:
			journal.error(`commande inconnue : ${commande}`);
			aide();
			return SORTIE.USAGE;
	}
}

process.exitCode = await principal();
