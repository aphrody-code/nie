/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { Browser, Page, type NavigationResponse } from "@aphrody-code/bxc";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DATA_ROOT = "/home/ubuntu/niers/data/inazuma-cross.jp";

interface CrossPageTarget {
	lang: string;
	url: string;
}

async function safeGoto(page: Page, url: string, timeout = 30000): Promise<NavigationResponse> {
	return Promise.race([
		page.goto(url),
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Navigation timeout (${timeout}ms) pour ${url}`)), timeout)
		),
	]);
}

export async function crawlCross(): Promise<{ success: boolean; error?: string }> {
	console.log("[Crawl Cross] Démarrage du crawl de Inazuma Eleven: Cross...");

	const targets: CrossPageTarget[] = [
		{ lang: "ja", url: "https://inazuma-cross.jp/" },
		{ lang: "en", url: "https://inazuma-cross.jp/en/" },
		{ lang: "fr", url: "https://inazuma-cross.jp/fr/" },
	];

	try {
		const page = (await Browser.newPage({
			profile:
				(process.env.BXC_PROFILE as "stealth" | "max" | "static" | "fast" | "http") || "stealth",
		})) as Page;
		let crawlCount = 0;

		for (const target of targets) {
			const outputDir = join(DATA_ROOT, target.lang);
			await mkdir(outputDir, { recursive: true });

			console.log(`[Crawl Cross] Scraping page ${target.lang} : ${target.url}`);
			try {
				const response = await safeGoto(page, target.url);
				const status = response ? response.status : 200;
				if (status >= 400) {
					console.warn(`[Crawl Cross] URL non disponible (HTTP ${status}) : ${target.url}`);
					continue;
				}

				await page.waitForSelector("body", 15000).catch(() => {});
				const html = await page.content();
				if (html.length < 500) {
					console.warn(`[Crawl Cross] Page trop courte ou vide pour ${target.lang}, abandon.`);
					continue;
				}

				await writeFile(join(outputDir, "index.html"), html);

				const meta = {
					id: `cross-${target.lang}`,
					title: `Inazuma Eleven: Cross - Portal (${target.lang.toUpperCase()})`,
					date: new Date().toISOString().split("T")[0] || "",
					url: target.url,
					category: "Cross Mobile",
					language: target.lang,
				};

				await writeFile(join(outputDir, "meta.json"), JSON.stringify(meta, null, 2));
				crawlCount++;
			} catch (err) {
				console.warn(`[Crawl Cross] Impossible de scraper ${target.url} :`, err);
			}
		}

		await page.close();
		console.log(`[Crawl Cross] Crawl terminé. ${crawlCount} langues sauvegardées.`);
		return { success: true };
	} catch (err: unknown) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error("[Crawl Cross] Erreur critique lors du crawl Cross :", err);
		return { success: false, error: msg };
	}
}
