/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { crawlZukanOrder } from "./zukan";
import { crawlNews } from "./news";
import { crawlRe } from "./re";
import { crawlCross } from "./cross";
import { crawlLevel5 } from "./level5";
import { crawlLevel5Blog } from "./level5-blog";
import { crawlTwitter } from "./twitter";
import { crawlTwitterSearch } from "./harvest-search";
import { crawlExternalDocs } from "./external-docs";
import { runRagSync } from "./rag-index";
import { withProxyRotation } from "../../lib/proxy";
import { processTweets } from "./process-tweets";
import { crawlXRadar } from "./x-radar";
import { crawlReddit } from "./reddit";
import { crawlDiscord } from "./discord";
import { XClient, XSession } from "@aphrody-code/x";
import { loadBxcXCookieHeader } from "./x-accounts";

export async function runIeCrawl(): Promise<{ success: boolean; error?: string }> {
	console.log("==================================================================");
	console.log("🏃 Démarrage du pipeline de Crawl Inazuma Eleven (ie-crawl)");
	console.log("==================================================================");

	try {
		// 1. Crawl de l'ordre officiel des personnages Zukan
		const zukanRes = await withProxyRotation(() => crawlZukanOrder());
		if (!zukanRes.success) {
			console.error("[ie-crawl] Échec du crawl Zukan :", zukanRes.error);
		} else {
			console.log(`[ie-crawl] Crawl Zukan complété : ${zukanRes.count} personnages analysés.`);
		}

		// 2. Crawl des actualités (Topics FR & Patch Notes EN)
		const newsRes = await withProxyRotation(() => crawlNews());
		if (!newsRes.success) {
			console.error("[ie-crawl] Échec du crawl des actualités :", newsRes.error);
		} else {
			console.log("[ie-crawl] Crawl des actualités complété.");
		}

		// 3. Crawl Inazuma Eleven RE (Remake)
		const reRes = await withProxyRotation(() => crawlRe());
		if (!reRes.success) {
			console.error("[ie-crawl] Échec du crawl Inazuma Eleven RE :", reRes.error);
		} else {
			console.log("[ie-crawl] Crawl Inazuma Eleven RE complété.");
		}

		// 4. Crawl Inazuma Eleven: Cross (Mobile)
		const crossRes = await withProxyRotation(() => crawlCross());
		if (!crossRes.success) {
			console.error("[ie-crawl] Échec du crawl Inazuma Eleven: Cross :", crossRes.error);
		} else {
			console.log("[ie-crawl] Crawl Inazuma Eleven: Cross complété.");
		}

		// 5. Crawl LEVEL-5 Corporate News (filtered for Inazuma)
		const level5Res = await withProxyRotation(() => crawlLevel5());
		if (!level5Res.success) {
			console.error("[ie-crawl] Échec du crawl LEVEL-5 :", level5Res.error);
		} else {
			console.log("[ie-crawl] Crawl LEVEL-5 complété.");
		}

		// 5c. Crawl LEVEL-5 Blog (Akihiro Hino / Five-Star Workshop)
		const level5BlogRes = await withProxyRotation(() => crawlLevel5Blog());
		if (!level5BlogRes.success) {
			console.error("[ie-crawl] Échec du crawl LEVEL-5 Blog :", level5BlogRes.error);
		} else {
			console.log("[ie-crawl] Crawl LEVEL-5 Blog complété.");
		}

		// 5b. Crawl Twitter @Azalee_IE
		const twitterRes = await withProxyRotation(() => crawlTwitter());
		if (!twitterRes.success) {
			console.error("[ie-crawl] Échec du crawl Twitter :", twitterRes.error);
		} else {
			console.log(`[ie-crawl] Crawl Twitter complété : ${twitterRes.count} tweets synchronisés.`);
			// Traiter, traduire et classifier les tweets
			try {
				await processTweets();
			} catch (tweetProcessErr) {
				console.error("[ie-crawl] Échec du traitement/traduction des tweets :", tweetProcessErr);
			}
		}

		// 5d. X Radar (bxc x radar) — ex: radar spécifique IE / Hino / Level-5 (curated feed)
		// Utilise @aphrody-code/bxc Browser + cookies bxc xcom (auth) + extraction structurée.
		// Les tweets sont upsertés dans la même table + passent par processTweets (Azalee + Grok trans + RAG).
		try {
			const radarRes = await crawlXRadar("2062085553466552555");
			if (radarRes.success) {
				console.log(`[ie-crawl] X Radar complété : ${radarRes.count ?? 0} tweets (bxc x radar).`);
			} else {
				console.error("[ie-crawl] Échec X Radar :", radarRes.error);
			}
		} catch (radarErr) {
			console.error("[ie-crawl] Exception X Radar :", radarErr);
		}

		// 5b-bis. Harvest X par requêtes de recherche (news/communauté multi-langue,
		// IEVR/Victory Road) — complémentaire des timelines, ingère aussi dans le RAG.
		let searchSuccess = true;
		try {
			const searchRes = await withProxyRotation(() => crawlTwitterSearch());
			searchSuccess = searchRes.success;
			console.log(
				`[ie-crawl] Harvest X search complété : ${searchRes.kept} tweets retenus, ${searchRes.ragChunks} chunks RAG (backend=${searchRes.ragBackend}).`
			);
		} catch (searchErr) {
			searchSuccess = false;
			console.error("[ie-crawl] Échec du harvest X search :", searchErr);
		}

		// 5c. Crawl documentations externes (Markdown & Bun.markdown)
		const externalRes = await crawlExternalDocs();
		if (!externalRes.success) {
			console.error("[ie-crawl] Échec du crawl des documentations externes :", externalRes.error);
		} else {
			console.log("[ie-crawl] Crawl des documentations externes complété.");
		}

		// 5e. Crawl Reddit (r/inazumaeleven)
		const redditRes = await crawlReddit();
		if (!redditRes.success) {
			console.error("[ie-crawl] Échec du crawl Reddit :", redditRes.error);
		} else {
			console.log(`[ie-crawl] Crawl Reddit complété : ${redditRes.count} posts sauvegardés.`);
		}

		// 5f. Crawl Discord (salons publics)
		const discordCrawlRes = await crawlDiscord();
		if (!discordCrawlRes.success) {
			console.error("[ie-crawl] Échec du crawl Discord :", discordCrawlRes.error);
		} else {
			console.log(`[ie-crawl] Crawl Discord complété : ${discordCrawlRes.count} blocs sauvegardés.`);
		}

		// 6. Synchronisation sémantique / vectorisation pour le RAG
		let ragSuccess = true;
		const anyNewsCrawlSuccess =
			newsRes.success ||
			reRes.success ||
			crossRes.success ||
			level5Res.success ||
			level5BlogRes.success ||
			twitterRes.success ||
			searchSuccess ||
			externalRes.success ||
			redditRes.success ||
			discordCrawlRes.success;
		if (anyNewsCrawlSuccess) {
			const ragRes = await runRagSync();
			ragSuccess = ragRes.success;
			if (!ragRes.success) {
				console.error("[ie-crawl] Échec de la synchronisation vectorielle RAG.");
			} else {
				console.log(
					`[ie-crawl] RAG Sync complété : ${ragRes.processed} nouveaux documents indexés.`
				);
			}
		}

		const success =
			zukanRes.success &&
			newsRes.success &&
			ragSuccess;

		if (success) {
			try {
				console.log("[ie-crawl] Publication du tweet d'annonce...");
				const bxcCookies = loadBxcXCookieHeader();
				const session = bxcCookies ? XSession.fromCookieString(bxcCookies) : XSession.loadOrEnv();
				const client = new XClient(session);
				// S'assurer que les query IDs sont frais
				await client.queryIds.refresh(["CreateTweet"], false);
				const tweetText = "Crawl et indexation sémantique terminés ! Toutes les sources Inazuma Eleven (Victory Road & Cross) ont été synchronisées via ie-crawler. #InazumaEleven #VictoryRoad";
				const tweetRes = await client.createTweet(tweetText);
				console.log(`[ie-crawl] Tweet publié avec succès : ID ${tweetRes.id}`);
			} catch (tweetErr) {
				console.error("[ie-crawl] Échec de la publication du tweet d'annonce :", tweetErr);
			}
		}

		return {
			success,
			error: success ? undefined : "Les tâches de crawl critiques (Zukan, News) ou le RAG ont échoué.",
		};
	} catch (err: any) {
		console.error("[ie-crawl] Erreur critique lors de l'exécution du crawl :", err);
		return { success: false, error: err.message || String(err) };
	}
}
