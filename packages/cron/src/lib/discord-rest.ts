/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Appels REST Discord partagés entre tâches.
 *
 * POURQUOI CE FICHIER EXISTE : la même logique (jeton de bot, respect du
 * `retry_after` sur 429, retry linéaire sur 5xx) vivait déjà en privé dans
 * `tasks/discord-messages.ts`. La dupliquer dans l'import des sondages
 * garantirait qu'un jour l'une des deux copies traite mal une limite de débit.
 * Elle est donc posée ici, dans `lib/`, où n'importe quelle tâche peut la
 * prendre. DETTE ASSUMÉE : `discord-messages.ts` garde pour l'instant sa copie
 * privée (fichier d'un autre chantier en cours) ; sa migration se fera en une
 * seule ligne, `const appelDiscord = ...` remplacé par un `import`.
 *
 * On passe par `fetch` natif plutôt que par le client discord.js pour la même
 * raison qu'ailleurs : ces tâches doivent tourner en ligne de commande, sans
 * passerelle connectée et sans le boot des ~2000 membres.
 */

import { DISCORD_TOKEN } from "./discord.js";

export const API_DISCORD = "https://discord.com/api/v10";

/** Identité déclarée à Discord, comme l'exige sa politique d'API. */
const AGENT = "RoseGriffonCron (https://rosegriffon.fr, 1.0)";

/** Nombre maximal de réémissions après une limite de débit. */
const TENTATIVES_429 = 5;
/** Nombre maximal de réémissions après une erreur serveur. */
const TENTATIVES_5XX = 3;

/** En-têtes d'un appel authentifié en tant que bot. */
function entetes(supplementaires?: Record<string, string>): Record<string, string> {
	if (!DISCORD_TOKEN) {
		throw new Error(
			"DISCORD_BOT_TOKEN absent : aucun appel REST Discord n'est possible. " +
				"(Attention : `DISCORD_TOKEN` seul n'est pas défini dans l'environnement du dépôt.)"
		);
	}
	return {
		Authorization: `Bot ${DISCORD_TOKEN}`,
		"User-Agent": AGENT,
		...supplementaires,
	};
}

/**
 * Appel REST Discord avec jeton de bot.
 *
 * Lève sur 4xx : c'est le comportement voulu quand l'appelant considère la
 * ressource comme obligatoire. Pour un accès « au mieux », voir
 * {@link appelDiscordOuNull}.
 */
export async function appelDiscord<T>(chemin: string, tentative = 0): Promise<T> {
	const reponse = await fetch(`${API_DISCORD}${chemin}`, { headers: entetes() });

	if (reponse.status === 429) {
		if (tentative >= TENTATIVES_429) {
			throw new Error(`Limite de débit Discord persistante sur ${chemin}.`);
		}
		const corps = (await reponse.json().catch(() => ({}))) as { retry_after?: number };
		// `retry_after` est en secondes (décimales) ; la marge de 250 ms évite de
		// se faire refuser une seconde fois pour quelques millisecondes.
		const attente = Math.ceil((corps.retry_after ?? 1) * 1000) + 250;
		console.warn(`[Discord REST] Limite de débit sur ${chemin} : attente de ${attente} ms.`);
		await Bun.sleep(attente);
		return appelDiscord<T>(chemin, tentative + 1);
	}

	if (reponse.status >= 500 && tentative < TENTATIVES_5XX) {
		await Bun.sleep(1000 * (tentative + 1));
		return appelDiscord<T>(chemin, tentative + 1);
	}

	if (!reponse.ok) {
		const texte = await reponse.text().catch(() => "");
		throw new Error(`Discord a répondu ${reponse.status} sur ${chemin} : ${texte.slice(0, 200)}`);
	}

	return (await reponse.json()) as T;
}

/**
 * Variante tolérante : rend `null` sur 4xx au lieu de lever.
 *
 * Un message supprimé, un salon devenu invisible ou un jeton sans permission ne
 * doivent pas interrompre un enrichissement facultatif — la donnée reste
 * simplement absente, ce que le reste du code sait déjà représenter par `null`.
 */
export async function appelDiscordOuNull<T>(chemin: string): Promise<T | null> {
	try {
		return await appelDiscord<T>(chemin);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (/a répondu 4\d\d /.test(message)) return null;
		throw err;
	}
}

/** Encart Discord, réduit aux champs que ce dépôt utilise réellement. */
export interface EncartDiscord {
	title?: string;
	description?: string;
	url?: string;
	color?: number;
	timestamp?: string;
	footer?: { text: string };
	fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

/**
 * Publie un message dans un salon.
 *
 * C'est le PENDANT EN ÉCRITURE de {@link appelDiscord} : même jeton, mêmes
 * en-têtes, même respect du `retry_after`. Elle existe pour que les alertes
 * d'exploitation n'aient pas à monter un client discord.js — le démon en a
 * déjà un, mais il n'est pas connecté en ligne de commande et la passerelle
 * peut être tombée précisément quand l'alerte doit partir.
 *
 * Ne lève JAMAIS : une alerte qui plante le rapporteur d'alertes serait pire
 * que pas d'alerte du tout. Rend `null` en cas d'échec, après l'avoir journalisé.
 *
 * `allowed_mentions` est forcé à « aucune mention » : un message d'alerte
 * reprend un texte d'erreur arbitraire, qui pourrait contenir `@everyone`.
 */
export async function publierMessageDiscord(
	salonId: string,
	charge: { content?: string; embeds?: EncartDiscord[] },
	tentative = 0
): Promise<{ id: string } | null> {
	try {
		const reponse = await fetch(`${API_DISCORD}/channels/${salonId}/messages`, {
			method: "POST",
			headers: entetes({ "Content-Type": "application/json" }),
			body: JSON.stringify({ ...charge, allowed_mentions: { parse: [] } }),
			signal: AbortSignal.timeout(15_000),
		});

		if (reponse.status === 429 && tentative < TENTATIVES_429) {
			const corps = (await reponse.json().catch(() => ({}))) as { retry_after?: number };
			const attente = Math.ceil((corps.retry_after ?? 1) * 1000) + 250;
			await Bun.sleep(attente);
			return publierMessageDiscord(salonId, charge, tentative + 1);
		}

		if (reponse.status >= 500 && tentative < TENTATIVES_5XX) {
			await Bun.sleep(1000 * (tentative + 1));
			return publierMessageDiscord(salonId, charge, tentative + 1);
		}

		if (!reponse.ok) {
			const texte = await reponse.text().catch(() => "");
			console.warn(
				`[Discord REST] publication refusée dans ${salonId} : ${reponse.status} ${texte.slice(0, 200)}`
			);
			return null;
		}

		return (await reponse.json()) as { id: string };
	} catch (err) {
		console.warn(
			`[Discord REST] publication impossible dans ${salonId} :`,
			err instanceof Error ? err.message : err
		);
		return null;
	}
}

/**
 * Re-signe des URL de pièces jointes périmées.
 *
 * Les URL `cdn.discordapp.com` portent une signature (`?ex=…&is=…&hm=…`) valable
 * moins de 24 h : une pièce jointe archivée hier n'est plus téléchargeable
 * aujourd'hui. Cette route rend des URL fraîches sans re-lire le message.
 * Rend `null` si la route échoue : l'appelant retentera à la passe suivante.
 */
export async function resignerPiecesJointes(
	salonId: string,
	urls: string[]
): Promise<string[] | null> {
	if (urls.length === 0) return [];
	try {
		const reponse = await fetch(`${API_DISCORD}/channels/${salonId}/attachments/refresh-urls`, {
			method: "POST",
			headers: entetes({ "Content-Type": "application/json" }),
			body: JSON.stringify({ attachment_urls: urls }),
		});
		if (!reponse.ok) return null;
		const corps = (await reponse.json()) as { refreshed_urls?: Array<{ refreshed: string }> };
		return (corps.refreshed_urls ?? []).map((entree) => entree.refreshed);
	} catch {
		return null;
	}
}
