/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { getDiscordClient, GUILD_ID, syncAllMembers, syncAllRoles, syncStaffPhotos } from "../lib/discord.js";
import { sql } from "../lib/db.js";

/**
 * Exécute la synchronisation globale de Discord (membres, rôles et photos d'équipe).
 * Enregistre un rapport détaillé dans `discord_sync_logs`.
 */
export async function runDiscordSync(): Promise<{ success: boolean; error?: string }> {
	console.log("[Cron Discord] Démarrage de la synchronisation Discord...");
	
	const client = getDiscordClient();
	if (!client) {
		const msg = "Client Discord non initialisé (vérifiez DISCORD_BOT_TOKEN).";
		console.warn(`[Cron Discord] ${msg}`);
		return { success: false, error: msg };
	}

	if (!GUILD_ID) {
		const msg = "DISCORD_GUILD_ID n'est pas configuré.";
		console.warn(`[Cron Discord] ${msg}`);
		return { success: false, error: msg };
	}

	const startTime = new Date();
	let totalMembers = 0;
	let updatedCount = 0;
	let errorCount = 0;
	let logMessage = "";

	try {
		const guild = await client.guilds.fetch(GUILD_ID);
		if (!guild) {
			throw new Error(`Serveur Discord non trouvé pour l'ID : ${GUILD_ID}`);
		}

		console.log(`[Cron Discord] Synchro du serveur : ${guild.name} (${guild.id})`);

		// 1. Synchronisation des rôles du serveur
		console.log("[Cron Discord] Étape 1/3 : Synchronisation des rôles...");
		const roleReport = await syncAllRoles(guild);
		console.log(`[Cron Discord] Rôles : ${roleReport.upserted}/${roleReport.fetched} synchronisés en ${roleReport.durationMs}ms`);
		if (roleReport.errors.length > 0) {
			console.warn(`[Cron Discord] ${roleReport.errors.length} erreurs lors de la synchro des rôles.`);
		}

		// 2. Synchronisation de tous les membres du serveur
		console.log("[Cron Discord] Étape 2/3 : Synchronisation des membres...");
		const memberReport = await syncAllMembers(guild);
		totalMembers = memberReport.fetched;
		updatedCount = memberReport.upserted;
		errorCount = memberReport.errors.length;
		console.log(`[Cron Discord] Membres : ${memberReport.upserted}/${memberReport.fetched} synchronisés en ${memberReport.durationMs}ms`);
		if (memberReport.errors.length > 0) {
			console.error(`[Cron Discord] ${memberReport.errors.length} erreurs lors de la synchro des membres.`);
			for (const e of memberReport.errors.slice(0, 5)) {
				console.error(`  - Membre ID ${e.discordId} : ${e.reason}`);
			}
		}

		// 3. Synchronisation des photos d'équipe
		console.log("[Cron Discord] Étape 3/3 : Synchronisation des avatars du staff...");
		const staffReport = await syncStaffPhotos(client);
		console.log(`[Cron Discord] Staff : ${staffReport.updated}/${staffReport.total} mis à jour, ${staffReport.unchanged} inchangés en ${staffReport.durationMs}ms`);
		if (staffReport.errors.length > 0) {
			console.error(`[Cron Discord] ${staffReport.errors.length} erreurs lors de la synchro du staff.`);
			for (const e of staffReport.errors.slice(0, 3)) {
				console.error(`  - Staff ${e.name} : ${e.reason}`);
			}
		}

		logMessage = `Synchronisation complète réussie. Rôles: ${roleReport.upserted}/${roleReport.fetched}. Membres: ${memberReport.upserted}/${memberReport.fetched}. Staff: ${staffReport.updated}/${staffReport.total} mis à jour.`;

		// Enregistrement du log de synchro dans la base de données
		await sql`
			INSERT INTO discord_sync_logs (status, total_members, updated_count, error_count, message, created_at)
			VALUES ('success', ${totalMembers}, ${updatedCount}, ${errorCount}, ${logMessage}, NOW())
		`.catch(err => console.error("[Cron Discord] Impossible de sauvegarder le log de synchro:", err));

		return { success: true };
	} catch (err: any) {
		const errMsg = err.message || String(err);
		console.error("[Cron Discord] Erreur critique lors de la synchronisation :", err);

		await sql`
			INSERT INTO discord_sync_logs (status, total_members, updated_count, error_count, message, created_at)
			VALUES ('error', ${totalMembers}, ${updatedCount}, ${errorCount + 1}, ${errMsg}, NOW())
		`.catch(dbErr => console.error("[Cron Discord] Impossible de sauvegarder le log d'erreur:", dbErr));

		return { success: false, error: errMsg };
	}
}

/**
 * Exécute une fonction asynchrone sur un tableau d'éléments en parallèle avec une limite de concurrence.
 */
async function runParallelWithLimit<T, R>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<R>
): Promise<R[]> {
	const results: R[] = [];
	for (let i = 0; i < items.length; i += limit) {
		const chunk = items.slice(i, i + limit);
		const chunkResults = await Promise.all(chunk.map(fn));
		results.push(...chunkResults);
	}
	return results;
}

interface MessageScanData {
	id: string;
	authorId: string;
	authorTag: string;
	contentLength: number;
	timestamp: string;
}

interface ChannelScanResult {
	channelId: string;
	name: string;
	type: string;
	messageCount: number;
	error?: string;
	messages?: MessageScanData[];
}

/**
 * Scanne en parallèle tous les salons textuels et fils actifs du serveur.
 * Analyse les derniers messages et écrit un rapport JSON sur disque via les APIs natives de Bun.
 */
export async function runDiscordChannelScan(): Promise<{ success: boolean; error?: string; stats?: any }> {
	console.log("[Cron Discord] Démarrage du scan parallèle des salons...");
	
	const client = getDiscordClient();
	if (!client) {
		const msg = "Client Discord non initialisé.";
		console.warn(`[Cron Discord] ${msg}`);
		return { success: false, error: msg };
	}

	if (!GUILD_ID) {
		const msg = "DISCORD_GUILD_ID non configuré.";
		console.warn(`[Cron Discord] ${msg}`);
		return { success: false, error: msg };
	}

	const start = Date.now();

	try {
		const guild = await client.guilds.fetch(GUILD_ID);
		if (!guild) {
			throw new Error(`Serveur non trouvé : ${GUILD_ID}`);
		}

		// Récupère tous les salons et les fils actifs du serveur
		const channels = await guild.channels.fetch();
		const activeThreads = await guild.channels.fetchActiveThreads();

		const allChannels = [
			...channels.values(),
			...activeThreads.threads.values()
		];

		// Filtre uniquement les salons textuels
		const textChannels = allChannels.filter(c => c && c.isTextBased());
		console.log(`[Cron Discord] ${textChannels.length} salons textuels à scanner.`);

		// Limite de concurrence à 5 pour éviter d'être banni par le rate limit Discord
		const results = await runParallelWithLimit(textChannels, 5, async (chan): Promise<ChannelScanResult> => {
			const channel = chan as any;
			try {
				// Récupère les 50 derniers messages du salon
				const messages = await channel.messages.fetch({ limit: 50 });
				
				const scanData: MessageScanData[] = [...messages.values()].map(m => ({
					id: m.id,
					authorId: m.author.id,
					authorTag: m.author.tag,
					contentLength: m.content.length,
					timestamp: m.createdAt.toISOString()
				}));

				return {
					channelId: channel.id,
					name: channel.name,
					type: channel.type.toString(),
					messageCount: messages.size,
					messages: scanData
				};
			} catch (err: any) {
				return {
					channelId: channel.id,
					name: channel.name,
					type: channel.type.toString(),
					messageCount: 0,
					error: err.message || String(err)
				};
			}
		});

		// Calcul des statistiques globales
		let totalMessages = 0;
		let totalCharacters = 0;
		const authorMessageCount: Record<string, number> = {};
		const channelMessageCount: Record<string, number> = {};

		for (const r of results) {
			totalMessages += r.messageCount;
			if (r.messages) {
				channelMessageCount[r.name] = r.messageCount;
				for (const m of r.messages) {
					totalCharacters += m.contentLength;
					authorMessageCount[m.authorTag] = (authorMessageCount[m.authorTag] || 0) + 1;
				}
			}
		}

		const mostActiveAuthors = Object.entries(authorMessageCount)
			.map(([author, count]) => ({ author, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		const mostActiveChannels = Object.entries(channelMessageCount)
			.map(([channel, count]) => ({ channel, count }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5);

		const stats = {
			scanDate: new Date().toISOString(),
			durationMs: Date.now() - start,
			totalChannelsScanned: textChannels.length,
			totalMessages,
			totalCharacters,
			averageMessageLength: totalMessages > 0 ? Math.round(totalCharacters / totalMessages) : 0,
			mostActiveAuthors,
			mostActiveChannels
		};

		// Écriture du rapport sur le disque en utilisant Bun.write (API native rapide)
		const reportPath = "/home/ubuntu/niers/data/discord-channels-scan.json";
		const reportContent = JSON.stringify({ stats, channels: results }, null, 2);
		
		await Bun.write(reportPath, reportContent);
		console.log(`✓ Scan terminé en ${stats.durationMs}ms. Rapport écrit sur : ${reportPath}`);

		// Insertion du log du scan
		await sql`
			INSERT INTO discord_sync_logs (status, total_members, updated_count, error_count, message, created_at)
			VALUES ('scan_success', ${guild.memberCount}, ${totalMessages}, 0, ${`Scan de ${textChannels.length} salons terminé. Total messages : ${totalMessages}`}, NOW())
		`.catch(err => console.error("[Cron Discord] Échec log scan:", err));

		return { success: true, stats };
	} catch (err: any) {
		const errMsg = err.message || String(err);
		console.error("[Cron Discord] Échec lors du scan parallèle :", err);

		await sql`
			INSERT INTO discord_sync_logs (status, total_members, updated_count, error_count, message, created_at)
			VALUES ('scan_error', 0, 0, 1, ${errMsg}, NOW())
		`.catch(dbErr => console.error("[Cron Discord] Échec log d'erreur scan:", dbErr));

		return { success: false, error: errMsg };
	}
}

