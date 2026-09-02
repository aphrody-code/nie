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

const DATA_ROOT = "/home/ubuntu/niers/data/level5.co.jp/blog";

async function safeGoto(page: Page, url: string, timeout = 30000): Promise<unknown> {
	return Promise.race([
		page.goto(url),
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`Navigation timeout (${timeout}ms) pour ${url}`)), timeout)
		),
	]);
}

interface BlogArticle {
	id: string;
	url: string;
	title: string;
	date: string;
	locale: "ja" | "en" | "zh-tw" | "zh-cn";
}

export async function crawlLevel5Blog(): Promise<{
	success: boolean;
	error?: string;
	count?: number;
}> {
	console.log(
		"[Crawl Level5 Blog] Démarrage du crawl du blog LEVEL-5 (5つ星工房日記 / Five-Star Workshop)..."
	);

	try {
		const page = (await Browser.newPage({
			profile:
				(process.env.BXC_PROFILE as "stealth" | "max" | "static" | "fast" | "http") || "stealth",
		})) as Page;
		const articles: BlogArticle[] = [];

		// 1. Scraping du Blog Japonais, Anglais et Chinois (Traditionnel & Simplifié)
		const targets = [
			{ locale: "ja" as const, url: "https://www.level5.co.jp/blog/" },
			{ locale: "en" as const, url: "https://www.level5.co.jp/blog/en/" },
			{ locale: "zh-tw" as const, url: "https://www.level5.co.jp/blog/zh-tw/" },
			{ locale: "zh-cn" as const, url: "https://www.level5.co.jp/blog/zh-cn/" },
		];

		for (const target of targets) {
			console.log(`[Crawl Level5 Blog] Index scraping (${target.locale}) : ${target.url}`);
			try {
				await safeGoto(page, target.url);
				await page.waitForSelector("body", 15000).catch(() => {});
				const indexHtml = await page.content();
				const $ = cheerio.load(indexHtml);

				// Extraire les articles listés dans la section "recent" de l'aside
				$("aside #recent ul li.item").each((_, el) => {
					const link = $(el).find("a");
					const href = link.attr("href") || "";
					const date = $(el).find("dt").text().trim();
					const title = $(el).find("dd").text().trim();

					if (!href) return;

					// Exemples d'href : "/blog/250303/", "/blog/en/250303/", etc.
					// Résoudre l'URL absolute
					const absoluteUrl = href.startsWith("http") ? href : `https://www.level5.co.jp${href}`;

					// Extraire l'ID (e.g. "250303")
					const urlParts = href.split("/").filter(Boolean);
					const id = urlParts[urlParts.length - 1] || "index";

					if (id && !articles.find((a) => a.id === id && a.locale === target.locale)) {
						articles.push({
							id,
							url: absoluteUrl,
							title: title || "LEVEL-5 Blog Post",
							date: date || "Unknown",
							locale: target.locale,
						});
					}
				});

				// Récupérer également l'article à la une actuellement affiché en entier sur la page d'accueil
				const latestTitleEl = $("article h2 dd");
				const latestDateEl = $("article h2 dt");
				const latestTitle = latestTitleEl.text().trim();
				const latestDate = latestDateEl.text().trim();

				if (latestTitle && latestDate) {
					const id = "latest";
					if (!articles.find((a) => a.id === id && a.locale === target.locale)) {
						articles.push({
							id,
							url: target.url,
							title: latestTitle,
							date: latestDate,
							locale: target.locale,
						});
					}
				}
			} catch (err) {
				console.error(
					`[Crawl Level5 Blog] Erreur lors du scraping de l'index ${target.locale} :`,
					err
				);
			}
		}

		console.log(
			`[Crawl Level5 Blog] ${articles.length} articles trouvés. Téléchargement des détails...`
		);
		let count = 0;

		for (const art of articles) {
			const outputDir = join(DATA_ROOT, art.locale, art.id);
			const indexPath = join(outputDir, "index.html");

			if (existsSync(indexPath)) {
				continue;
			}

			console.log(
				`[Crawl Level5 Blog] Scraping article [${art.locale}] : ${art.title} (${art.url})`
			);
			await mkdir(outputDir, { recursive: true });

			try {
				await safeGoto(page, art.url);
				await page.waitForSelector("body", 15000).catch(() => {});
				const detailHtml = await page.content();
				await writeFile(indexPath, detailHtml);

				const $detail = cheerio.load(detailHtml);
				const contentText = $detail("article section.all").text().trim() || "";

				const meta = {
					id: art.id,
					title: art.title,
					date: art.date,
					url: art.url,
					locale: art.locale,
					category: "LEVEL-5 Developer Blog",
					content_text_snippet: contentText.substring(0, 500),
				};

				await writeFile(join(outputDir, "meta.json"), JSON.stringify(meta, null, 2));
				count++;
			} catch (err) {
				console.error(
					`[Crawl Level5 Blog] Erreur lors du scraping du détail pour ${art.id} :`,
					err
				);
			}
		}

		await page.close();
		console.log(
			`[Crawl Level5 Blog] Crawl terminé avec succès. ${count} nouveaux articles stockés.`
		);
		return { success: true, count };
	} catch (err: any) {
		console.error("[Crawl Level5 Blog] Erreur critique lors du crawl du blog Level5 :", err);
		return { success: false, error: err.message || String(err) };
	}
}
