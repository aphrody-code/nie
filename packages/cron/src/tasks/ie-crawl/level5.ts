/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { Browser, Page } from "@aphrody-code/bxc";
import * as cheerio from "cheerio";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_ROOT = "/home/ubuntu/niers/data/level5.co.jp/inazuma";

interface NewsItem {
	id: string;
	url: string;
	title: string;
	date: string;
}

async function safeGoto(page: Page, url: string, timeout = 30000): Promise<unknown> {
	return Promise.race([
		page.goto(url),
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`Navigation timeout (${timeout}ms) pour ${url}`)), timeout)
		),
	]);
}

export async function crawlLevel5(): Promise<{ success: boolean; error?: string }> {
	console.log("[Crawl Level5] Démarrage du crawl des actualités LEVEL-5...");

	try {
		const page = (await Browser.newPage({
			profile:
				(process.env.BXC_PROFILE as "stealth" | "max" | "static" | "fast" | "http") || "stealth",
		})) as Page;

		console.log("[Crawl Level5] Navigation vers https://www.level5.co.jp/news/");
		await safeGoto(page, "https://www.level5.co.jp/news/");
		await page.waitForSelector("body", 15000).catch(() => {});
		const indexHtml = await page.content();

		const $ = cheerio.load(indexHtml);
		const articles: NewsItem[] = [];

		// Recherche des liens vers les articles d'actualités (format news/YYYYMMDD/)
		$("a").each((_, el) => {
			const href = $(el).attr("href") || "";
			const text = $(el).text().trim();

			const match = href.match(/\/news\/(\d{8})\//);
			if (match) {
				const id = match[1] || "";
				const absoluteUrl = href.startsWith("http") ? href : `https://www.level5.co.jp${href}`;

				if (id && !articles.find((a) => a.id === id)) {
					articles.push({
						id,
						url: absoluteUrl,
						title: text || "LEVEL-5 Announcement",
						// Formater la date YYYYMMDD en YYYY.MM.DD ou YYYY-MM-DD
						date: `${id.substring(0, 4)}.${id.substring(4, 6)}.${id.substring(6, 8)}`,
					});
				}
			}
		});

		console.log(
			`[Crawl Level5] ${articles.length} communiqués trouvés au total. Filtrage pour Inazuma Eleven...`
		);
		let crawlCount = 0;

		for (const art of articles) {
			const outputDir = join(DATA_ROOT, art.id);
			const indexPath = join(outputDir, "index.html");

			if (existsSync(indexPath)) {
				// Déjà traité
				continue;
			}

			console.log(`[Crawl Level5] Inspection de l'article : ${art.title} (${art.url})`);
			try {
				await safeGoto(page, art.url);
				await page.waitForSelector("body", 15000).catch(() => {});
				const detailHtml = await page.content();

				// On vérifie si l'article parle de Inazuma Eleven (イナズマ or Inazuma)
				const lowerHtml = detailHtml.toLowerCase();
				const isInazumaRelated = lowerHtml.includes("イナズマ") || lowerHtml.includes("inazuma");

				if (!isInazumaRelated) {
					console.log(`[Crawl Level5] Article ${art.id} non lié à Inazuma Eleven, ignoré.`);
					continue;
				}

				console.log(`[Crawl Level5] -> Sauvegarde de l'article lié à Inazuma: ${art.title}`);
				await mkdir(outputDir, { recursive: true });
				await writeFile(indexPath, detailHtml);

				const meta = {
					id: art.id,
					title: art.title,
					date: art.date,
					url: art.url,
					category: "LEVEL-5 Press Release",
					language: "ja",
				};
				await writeFile(join(outputDir, "meta.json"), JSON.stringify(meta, null, 2));
				crawlCount++;
			} catch (err) {
				console.error(`[Crawl Level5] Erreur lors du scraping de l'article ${art.id} :`, err);
			}
		}

		await page.close();
		console.log(
			`[Crawl Level5] Crawl terminé. ${crawlCount} nouveaux articles Inazuma Eleven enregistrés.`
		);
		return { success: true };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[Crawl Level5] Erreur critique lors du crawl Level5 :", err);
		return { success: false, error: msg };
	}
}
