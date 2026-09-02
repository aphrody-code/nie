/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDiscordClient, GUILD_ID } from "../../lib/discord.js";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";

const DATA_ROOT = "/home/ubuntu/niers/data/discord";

interface DiscordMessage {
	id: string;
	authorTag: string;
	content: string;
	timestamp: string;
}

/**
 * Crawle les salons Discord publics pour extraire des blocs de discussion
 * et les indexer dans le RAG.
 */
export async function crawlDiscord(): Promise<{ success: boolean; count: number; error?: string }> {
	console.log("[Crawl Discord] Démarrage du crawl des salons Discord publics...");

	const client = getDiscordClient();
	if (!client) {
		console.warn("[Crawl Discord] Client Discord non disponible.");
		return { success: true, count: 0 };
	}

	if (!GUILD_ID) {
		console.warn("[Crawl Discord] GUILD_ID non configuré.");
		return { success: true, count: 0 };
	}

	try {
		await mkdir(DATA_ROOT, { recursive: true });

		const guild = await client.guilds.fetch(GUILD_ID);
		if (!guild) {
			throw new Error(`Serveur non trouvé : ${GUILD_ID}`);
		}

		const channels = await guild.channels.fetch();
		// Ne garder que les salons textuels
		const textChannels = [...channels.values()].filter(
			(c) => c && c.isTextBased() && !c.isThread()
		);

		console.log(`[Crawl Discord] ${textChannels.length} salons textuels trouvés.`);
		let totalBlocksSaved = 0;

		for (const channel of textChannels) {
			if (!channel) continue;
			// Vérifier si le salon est public (accessible au rôle @everyone)
			const everyoneRole = guild.roles.everyone;
			const permissions = channel.permissionsFor(everyoneRole);
			if (!permissions || !permissions.has("ViewChannel")) {
				// Salon privé, on ignore pour des raisons de confidentialité
				continue;
			}

			console.log(`[Crawl Discord] Lecture du salon : #${channel.name}`);

			try {
				// Récupérer les 100 derniers messages
				const messagesObj = await (channel as any).messages.fetch({ limit: 100 });
				const messagesList: DiscordMessage[] = [...messagesObj.values()]
					.filter((m) => !m.author.bot && m.content && m.content.length > 5)
					.map((m) => ({
						id: m.id,
						authorTag: m.author.tag,
						content: m.content,
						timestamp: m.createdAt.toISOString(),
					}))
					.reverse(); // Ordre chronologique

				if (messagesList.length === 0) continue;

				// Découpage en blocs de 15 messages pour préserver le contexte de conversation
				const blockSize = 15;
				for (let i = 0; i < messagesList.length; i += blockSize) {
					const blockIndex = Math.floor(i / blockSize);
					const blockMessages = messagesList.slice(i, i + blockSize);
					const latestMsg = blockMessages[blockMessages.length - 1]!;
					
					const blockId = `discord-${channel.id}-${blockIndex}`;
					const blockDir = join(DATA_ROOT, blockId);
					const metaPath = join(blockDir, "meta.json");
					const htmlPath = join(blockDir, "index.html");

					// Si déjà indexé, on saute
					if (existsSync(metaPath) && existsSync(htmlPath)) {
						continue;
					}

					await mkdir(blockDir, { recursive: true });

					const meta = {
						id: blockId,
						title: `Discussion Discord - #${channel.name} [Partie ${blockIndex + 1}]`,
						url: `https://discord.com/channels/${guild.id}/${channel.id}/${latestMsg.id}`,
						date: latestMsg.timestamp.split("T")[0] || "",
						channelName: channel.name,
						category: "Discord",
						language: "fr",
					};

					// Génération du contenu HTML de la discussion
					let dialogueHtml = `<h1>Discussion dans #${channel.name}</h1>\n<ul>\n`;
					for (const msg of blockMessages) {
						dialogueHtml += `  <li><strong>@${msg.authorTag}</strong> [${msg.timestamp}]: ${msg.content}</li>\n`;
					}
					dialogueHtml += `</ul>`;

					await writeFile(metaPath, JSON.stringify(meta, null, 2));
					await writeFile(htmlPath, dialogueHtml);
					totalBlocksSaved++;
				}
			} catch (chanErr) {
				console.warn(`[Crawl Discord] Impossible de lire #${channel.name} :`, chanErr);
			}
		}

		console.log(`[Crawl Discord] Terminé. ${totalBlocksSaved} nouveaux blocs de discussion enregistrés.`);
		return { success: true, count: totalBlocksSaved };
	} catch (err: any) {
		const msg = err.message || String(err);
		console.error("[Crawl Discord] Erreur lors du scan Discord :", err);
		return { success: false, count: 0, error: msg };
	}
}
