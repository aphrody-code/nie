/**
 * Tâche Cron IETV — Rafraîchir le cache SQLite nightly
 *
 * Exécution: Chaque jour à 00:00 UTC (minuit)
 * Timeout: 5 minutes
 * Logs: systemd `rg-cron.service`
 *
 * Intégration: packages/cron/src/index.ts
 * Catalogue: packages/types/src/cron.ts
 */

import IETVScraper from "@aphrody/ietv";
import { IETVCache } from "@aphrody/ietv/cache";

export async function rafraichirCacheIetv(): Promise<{
	success: boolean;
	error?: string;
}> {
	const startTime = Date.now();
	let cache: IETVCache | null = null;
	let scraper: IETVScraper | null = null;

	try {
		console.log("[Cron IETV] Démarrage du refresh du cache...");

		// Initialiser clients
		cache = new IETVCache("~/.cache/ietv/episodes.db");
		scraper = new IETVScraper();

		// Clear old data
		console.log("[Cron IETV] Nettoyage du cache existant...");
		cache.clear();

		// Scraper toutes les sources en parallèle
		console.log("[Cron IETV] Scraping 7 sources (YouTube×4 + official + Pluto×2)...");
		const channels = await scraper.getAllChannelEpisodes();
		console.log(
			`[Cron IETV] ✅ Scraped ${channels.length} sources (${channels.reduce((sum, ch) => sum + ch.totalEpisodes, 0)} episodes)`,
		);

		// Persister dans SQLite
		console.log("[Cron IETV] Persisting to SQLite...");
		for (const channel of channels) {
			cache.saveChannel(channel);
		}

		// Stats finales
		const stats = cache.getStats();
		console.log(
			`[Cron IETV] Cache stats: ${stats.episodes} episodes, ${stats.channels} sources, ${stats.seasons} seasons`,
		);
		console.log(
			`[Cron IETV] Language breakdown: VF=${stats.byLanguage.vf || 0}, VOSTFR=${stats.byLanguage.vostfr || 0}`,
		);

		// Cleanup metadata
		console.log("[Cron IETV] Cleaning expired metadata...");
		cache.clearExpired();

		// Durée totale
		const duration = Date.now() - startTime;
		console.log(
			`[Cron IETV] ✅ Refresh completed in ${(duration / 1000).toFixed(1)}s`,
		);

		// Retourner succès
		return {
			success: true,
		};
	} catch (err: any) {
		const duration = Date.now() - startTime;
		console.error("[Cron IETV] ❌ Error:", err);
		console.error("[Cron IETV] Stack:", err.stack);

		return {
			success: false,
			error: err.message || String(err),
		};
	} finally {
		// Cleanup resources
		if (cache) {
			try {
				cache.close();
			} catch (e) {
				console.error("[Cron IETV] Error closing cache:", e);
			}
		}
		if (scraper) {
			try {
				await scraper.close();
			} catch (e) {
				console.error("[Cron IETV] Error closing scraper:", e);
			}
		}
	}
}

// Export pour éventuelles statistiques détaillées
export interface IETVCacheStats {
	channels: number;
	episodes: number;
	seasons: number;
	lastUpdate: number;
	byLanguage: Record<string, number>;
	durationMs: number;
}
