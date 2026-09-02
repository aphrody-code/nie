/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Alerte Discord sur échec répété d'une tâche planifiée.
 *
 * CE QUE ÇA CORRIGE
 * Le démon planifie dix-huit tâches et n'avertissait personne quand l'une
 * d'elles échouait en boucle : l'échec ne vivait que dans le journal systemd et
 * dans un compteur en mémoire remis à zéro au redémarrage. Six semaines de
 * sauvegardes nocturnes muettes en sont la preuve historique (cf. `tasks/db.ts`).
 *
 * DEUX MESSAGES PAR SÉRIE, PAS UN DE PLUS
 * La décision (« alerter » / « annoncer le rétablissement » / « ne rien faire »)
 * est prise par `RegistreExecutions` dans `executions.ts`, qui garantit l'unicité
 * par série. Ce module ne fait que la MISE EN FORME et l'ENVOI ; il ne réévalue
 * aucune condition, sans quoi la règle anti-spam vivrait à deux endroits.
 *
 * SALON : `DISCORD_CRON_ALERTS_CHANNEL_ID`, à défaut `DISCORD_LOGS_CHANNEL_ID`,
 * à défaut `DISCORD_BOTS_CHANNEL_ID`. Aucun repli sur le salon d'annonces
 * publiques : une pile d'erreurs d'exploitation n'a rien à faire sous les yeux
 * des membres. Sans salon configuré, l'alerte se réduit à une ligne de journal.
 */

import { publierMessageDiscord, type EncartDiscord } from "./discord-rest.js";
import { formaterDuree, type DecisionAlerte } from "./executions.js";

/** Brique de la palette Rose Griffon : la couleur des alertes. */
const COULEUR_ECHEC = 0xa14b3f;
/** Or de la palette : le retour à la normale. */
const COULEUR_RETABLISSEMENT = 0xd4af37;

let salonManquantSignale = false;

/** Identifiant du salon d'exploitation, ou `null` s'il n'est pas configuré. */
export function salonAlertes(env: Record<string, string | undefined> = Bun.env): string | null {
	const id =
		env.DISCORD_CRON_ALERTS_CHANNEL_ID ||
		env.DISCORD_LOGS_CHANNEL_ID ||
		env.DISCORD_BOTS_CHANNEL_ID;
	return id && id.trim().length > 0 ? id.trim() : null;
}

/**
 * Construit l'encart d'une décision. Pur, donc testable sans jeton Discord.
 * Rend `null` pour une décision qui ne s'annonce pas.
 */
export function encartDecision(decision: DecisionAlerte): EncartDiscord | null {
	if (decision.type === "alerte") {
		return {
			title: `Tâche cron en échec : ${decision.nom}`,
			description:
				`\`${decision.nom}\` a échoué **${decision.echecsConsecutifs} fois de suite**.\n` +
				(decision.erreur ? `Dernière erreur :\n\`\`\`\n${decision.erreur}\n\`\`\`` : "Aucun message d'erreur remonté."),
			color: COULEUR_ECHEC,
			footer: { text: "rg-cron — une seule alerte par série d'échecs" },
			timestamp: new Date().toISOString(),
		};
	}
	if (decision.type === "retablissement") {
		return {
			title: `Tâche cron rétablie : ${decision.nom}`,
			description:
				`\`${decision.nom}\` a de nouveau réussi en ${formaterDuree(decision.dureeMs)}, ` +
				`après ${decision.echecsPrecedents} échec(s) consécutif(s).`,
			color: COULEUR_RETABLISSEMENT,
			footer: { text: "rg-cron" },
			timestamp: new Date().toISOString(),
		};
	}
	return null;
}

/**
 * Poste l'alerte correspondant à une décision.
 *
 * Ne lève jamais et n'est jamais attendue par le chemin critique d'une tâche.
 * Rend `true` si un message est effectivement parti.
 */
export async function signalerDecisionAlerte(decision: DecisionAlerte): Promise<boolean> {
	const encart = encartDecision(decision);
	if (!encart) return false;

	// Le journal d'abord : il est la trace qui survit même sans Discord.
	if (decision.type === "alerte") {
		console.error(
			`[cron-alerte] ${decision.nom} : ${decision.echecsConsecutifs} échecs consécutifs — ${
				decision.erreur ?? "sans message"
			}`
		);
	} else if (decision.type === "retablissement") {
		// Test explicite et non `else` : `encartDecision` a déjà écarté le cas
		// `aucune` juste au-dessus, mais TypeScript ne le déduit pas d'un `null` —
		// un `else` nu lisait donc `.nom` sur une variante qui n'en a pas.
		console.log(
			`[cron-alerte] ${decision.nom} : rétablie après ${decision.echecsPrecedents} échec(s).`
		);
	}

	const salon = salonAlertes();
	if (!salon) {
		if (!salonManquantSignale) {
			salonManquantSignale = true;
			console.warn(
				"[cron-alerte] aucun salon configuré (DISCORD_CRON_ALERTS_CHANNEL_ID / DISCORD_LOGS_CHANNEL_ID / DISCORD_BOTS_CHANNEL_ID) : les alertes restent dans le journal."
			);
		}
		return false;
	}

	const message = await publierMessageDiscord(salon, { embeds: [encart] });
	return message !== null;
}
