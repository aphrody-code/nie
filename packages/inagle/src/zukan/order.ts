/**
 * Zukan order crawler — canonical, shared module.
 *
 * Extrait la logique de crawl de l'ordre officiel des personnages depuis
 * `zukan.inazuma.jp/en/chara_param` (pages paginées). C'est le scraper PROUVÉ en
 * production (cron `ie-crawl/zukan.ts`) : navigation via le navigateur headless
 * `Browser/Page` de `@aphrody-code/bxc` (le contenu est rendu côté client, un
 * simple `fetch()` ne suffit pas pour la liste hydratée), puis parsing cheerio
 * avec les sélecteurs éprouvés (`ul.charaListBox`) et la regex CloudFront
 * `cloudfront\.net/1/([^."\s]+)`.
 *
 * ⚠️ CONTRAINTE BARREL : ce module tire `@aphrody-code/bxc`. Il NE DOIT JAMAIS
 * être ré-exporté par `zukan/index.ts` ni `src/index.ts` (le barrel est
 * value-importé en runtime par Azalée → bundle Next cassé). Importer en leaf :
 *   import { crawlZukanOrderPages } from "@rosegriffon/inagle/zukan/order";
 *
 * Le helper pur `buildOrderMap` (sans bxc) est aussi exporté ici pour les
 * scripts qui crawlent en `fetch()` statique (cf. crawl-zukan-order.ts).
 */

import { Browser, Page } from "@aphrody-code/bxc";
import * as cheerio from "cheerio";

/** Regex d'extraction du hash zukan depuis une URL CloudFront (variante prod, avec `\s`). */
export const ZUKAN_HASH_RE = /cloudfront\.net\/1\/([^."\s]+)/;

export const ZUKAN_ORDER_PER_PAGE = 200;
export const ZUKAN_ORDER_MAX_PAGES = 30;

/** Personnage tel qu'extrait du crawl d'ordre (proven prod shape). */
export interface ZukanOrderCharacter {
	id: string;
	name: string;
	zukanHash: string | null;
	position: string;
	element: string;
	game: string;
	order: number;
	/** Surnom affiché sous le nom complet (`.lBox .name .nickname`), ex. "Evans". */
	nickname: string | null;
	/** `ul.basic` : "Elementary School" / "Middle School" / "High School" / "Adult"… (brut, EN). */
	ageGroup: string | null;
	/** `ul.basic` : "Grade 7" / "Grade 8" / "Grade 9" (brut, EN). */
	schoolYear: string | null;
}

export interface CrawlZukanOrderOptions {
	/** Profil bxc (par défaut $BXC_PROFILE ou "stealth"). */
	profile?: "stealth" | "max" | "static" | "fast" | "http";
	perPage?: number;
	maxPages?: number;
	/** Hook de log (par défaut console.log). */
	log?: (msg: string) => void;
}

async function safeGoto(page: Page, url: string, timeout = 30000): Promise<unknown> {
	return Promise.race([
		page.goto(url),
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`Navigation timeout (${timeout}ms) pour ${url}`)), timeout)
		),
	]);
}

/**
 * Crawl paginé des pages chara_param (EN) via navigateur headless bxc.
 * Retourne la liste ordonnée des personnages (ordre officiel = ordre d'apparition).
 *
 * Port VERBATIM de la boucle de crawl du cron `crawlZukanOrder` (mêmes sélecteurs,
 * mêmes attentes de rendu, même regex). Les effets DB/Redis restent côté appelant.
 */
export async function crawlZukanOrderPages(
	opts: CrawlZukanOrderOptions = {}
): Promise<ZukanOrderCharacter[]> {
	const perPage = opts.perPage ?? ZUKAN_ORDER_PER_PAGE;
	const maxPages = opts.maxPages ?? ZUKAN_ORDER_MAX_PAGES;
	const log = opts.log ?? ((m: string) => console.log(m));
	const profile =
		opts.profile ||
		(process.env.BXC_PROFILE as "stealth" | "max" | "static" | "fast" | "http") ||
		"stealth";

	const allCharacters: ZukanOrderCharacter[] = [];
	let globalIndex = 0;

	const page = (await Browser.newPage({ profile })) as Page;

	try {
		for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
			const url = `https://zukan.inazuma.jp/en/chara_param/?page=${pageNum}&per_page=${perPage}`;
			log(`[Crawl Zukan] Navigation vers page ${pageNum} : ${url}`);

			try {
				await safeGoto(page, url);
				await page.waitForSelector("ul.charaListBox", 15000).catch(() => {});
				// Attendre le rendu complet côté client des personnages (plus de 2 li)
				try {
					let retries = 24; // 24 * 250ms = 6s max
					while (retries > 0) {
						const count = await page.evaluate(
							() =>
								(
									globalThis as unknown as {
										document: { querySelectorAll(sel: string): { length: number } };
									}
								).document.querySelectorAll("ul.charaListBox > li").length
						);
						if (count > 2) break;
						await new Promise((r) => setTimeout(r, 250));
						retries--;
					}
				} catch (e) {
					log(`[Crawl Zukan] page.evaluate failed, falling back to static sleep: ${e}`);
					await new Promise((r) => setTimeout(r, 4000));
				}

				const html = await page.content();
				const $ = cheerio.load(html);

				const listItems = $("ul.charaListBox > li");
				if (listItems.length === 0) {
					log(`[Crawl Zukan] Page ${pageNum} vide. Fin du crawl.`);
					break;
				}

				listItems.each((_i, el) => {
					const img = $(el).find("img[src*='cloudfront']").first();
					const source = $(el).find("source[srcset*='cloudfront.net/1/']").first();
					const src = img.attr("src") || source.attr("srcset") || "";
					const hashMatch = src.match(ZUKAN_HASH_RE);
					const zukanHash = (hashMatch && hashMatch[1]) || null;

					const name = img.attr("alt")?.trim() || "?";
					const position = $(el).find("dl:has(dt:contains('Position')) dd p").text().trim() || "?";
					const element = $(el).find("dl:has(dt:contains('Element')) dd p").text().trim() || "?";
					const game = $(el).find("dl.appearedWorks dd").text().trim() || "?";
					// `.basic` porte Age Group / School Year / Gender / Character Role — déjà présents
					// dans la même page (SSR, pas besoin d'un crawl séparé de chara_list/chara_param
					// en détail). Seuls Age Group/School Year/le surnom manquaient à l'appel.
					const nickname = $(el).find(".lBox .name .nickname").text().trim() || null;
					const ageGroup =
						$(el).find(".basic dl:has(dt:contains('Age Group')) dd").text().trim() || null;
					const schoolYear =
						$(el).find(".basic dl:has(dt:contains('School Year')) dd").text().trim() || null;

					allCharacters.push({
						id: zukanHash || `chara-${globalIndex}`,
						name,
						zukanHash,
						position,
						element,
						game,
						order: globalIndex,
						nickname,
						ageGroup,
						schoolYear,
					});
					globalIndex++;
				});

				log(`[Crawl Zukan] Page ${pageNum} : ${listItems.length} personnages trouvés.`);
			} catch (err) {
				log(`[Crawl Zukan] Erreur sur la page ${pageNum} : ${err}`);
				break;
			}
		}
	} finally {
		await page.close();
	}

	return allCharacters;
}

/**
 * Construit la map `zukanHash → order` à partir d'une liste de personnages
 * ordonnés. Pur (aucune dépendance) — réutilisable par les crawlers statiques.
 */
export function buildOrderMap(
	characters: { zukanHash: string | null; order: number }[]
): Record<string, number> {
	const orderMap: Record<string, number> = {};
	for (const char of characters) {
		if (char.zukanHash) orderMap[char.zukanHash] = char.order;
	}
	return orderMap;
}
