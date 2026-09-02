/**
 * Constantes du processus — résolues À L'IMPORT, en échec immédiat.
 *
 * Un jeton absent ne doit jamais ressortir en `undefined` propagé jusqu'à
 * `client.login()`, qui répond « An invalid token was provided » sans dire ni
 * quelle variable poser, ni où, ni pour quelle application Discord.
 *
 * ── OÙ VIVENT LES SECRETS ──────────────────────────────────────────────────
 * Dans `~/.config/niers/bot.env`, en 0600, hors du dépôt, chargé par
 * `EnvironmentFile=` de l'unité systemd — jamais dans un `.env` versionné.
 * `~/.config/niers/wonderbot.env` suit déjà cette forme sur cette machine.
 */
import { COULEUR_HEX, couleurDeMarque, PIED_DE_PAGE, TITRE, urlBase } from "./marque";

const ENV = Bun.env;

/** Variable portant le jeton du bot. Une seule, sans variable de secours. */
export const VARIABLE_JETON = "NIE_DISCORD_BOT_TOKEN";

/**
 * Jeton du bot.
 *
 * Deux valeurs présentes mais inutilisables sont refusées explicitement parce
 * qu'elles ont déjà été observées : un secret SCELLÉ écrit à la place du texte
 * clair par un ancien outil de chiffrement, et une référence shell non
 * substituée — Bun ne fait pas l'expansion des `$VAR` dans un fichier
 * d'environnement, et la chaîne littérale arriverait telle quelle à Discord.
 */
export function resoudreJeton(env: Record<string, string | undefined> = ENV): string {
	const valeur = (env[VARIABLE_JETON] ?? "").trim();
	if (valeur === "") {
		throw new Error(
			`[config] Jeton Discord absent. Pose ${VARIABLE_JETON} dans ~/.config/niers/bot.env ` +
				"(Developer Portal → l'application du bot → Bot → Reset Token), en chmod 600. " +
				"⚠ N'y mets PAS le jeton du bot azalee-bot du dépôt rg : deux processus sous la même " +
				"identité Discord traiteraient chaque interaction deux fois."
		);
	}
	if (valeur.startsWith("eyJ2Ijo")) {
		throw new Error(
			`[config] ${VARIABLE_JETON} contient un secret SCELLÉ (« eyJ2Ijo… ») au lieu du jeton en ` +
				"clair. Rétablis la vraie valeur — le bot ne sait pas déchiffrer ce blob."
		);
	}
	if (valeur.startsWith("$")) {
		throw new Error(
			`[config] ${VARIABLE_JETON}="${valeur}" est une référence shell non substituée : Bun ne fait ` +
				"pas l'expansion des $VAR dans un fichier d'environnement. Écris la valeur littérale."
		);
	}
	return valeur;
}

export const DISCORD_TOKEN = resoudreJeton();

/** Marque appliquée aux embeds. */
export const BOT_BRAND_HEX: `#${string}` = COULEUR_HEX;
export const BOT_COLOR = couleurDeMarque(COULEUR_HEX);
export const BOT_FOOTER = PIED_DE_PAGE;
export const BOT_TITRE = TITRE;
export const BOT_BASE_URL = urlBase(ENV);

/**
 * Cache partagé.
 *
 * Base 2, et non la base 1 du bot Rose Griffon : les deux tourneraient sur le
 * même Redis, avec des clés de même préfixe pour des données de forme
 * différente. Une base par bot coûte zéro et supprime la question.
 */
export const REDIS_URL = ENV.NIE_BOT_REDIS_URL ?? "redis://127.0.0.1:6379/2";
