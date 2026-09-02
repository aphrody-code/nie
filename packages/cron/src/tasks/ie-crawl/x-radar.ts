/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { Browser, Page } from "@aphrody-code/bxc";
import { createSupabaseServiceClient } from "@rosegriffon/db/service";
import type { Json } from "@rosegriffon/db";
import { loadBxcXCookies, loadBxcXCookieHeader } from "./x-accounts";
import { processTweets } from "./process-tweets";
import * as cheerio from "cheerio";
import { XClient, XSession, radarSearch } from "@aphrody-code/x";

const RADAR_BASE = "https://x.com/i/radar";

type SimpleTweet = {
	id: string;
	text: string;
	author_username: string;
	created_at?: string;
};

function snowflakeToIso(id: string): string {
	try {
		const ms = (BigInt(id) >> 22n) + 1288834974657n;
		return new Date(Number(ms)).toISOString();
	} catch {
		return new Date().toISOString();
	}
}

/** Deep research extraction from X __INITIAL_STATE__ (the real hydrated data from SearchTimeline with querySource "radar").
 * Recursively searches for tweet-shaped objects (full_text/text + id/rest_id + user info).
 * This bypasses DOM/virtual list issues and gets the raw feed data for the radar.
 */
function extractTweetsFromState(obj: any, depth = 0, maxDepth = 8): SimpleTweet[] {
	if (!obj || typeof obj !== "object" || depth > maxDepth) return [];
	const results: SimpleTweet[] = [];
	if (Array.isArray(obj)) {
		for (const item of obj) results.push(...extractTweetsFromState(item, depth + 1, maxDepth));
	} else {
		// Common X tweet shapes in state (legacy or modern result)
		const text = obj.full_text || obj.text || obj.legacy?.full_text || obj.legacy?.text;
		const id = obj.id_str || obj.rest_id || obj.id || obj.legacy?.id_str;
		const user = obj.user?.screen_name || obj.core?.user_results?.result?.legacy?.screen_name || obj.legacy?.user?.screen_name || obj.user_results?.result?.legacy?.screen_name;
		const created = obj.created_at || obj.legacy?.created_at;
		if (text && id && typeof text === "string" && text.length > 5) {
			results.push({
				id: String(id),
				text: text.slice(0, 500),
				author_username: (user || "unknown").replace(/[^a-zA-Z0-9_]/g, ""),
				created_at: created,
			});
		}
		// Prioritize traversing entries, items, tweets, results (the feed containers)
		const keys = Object.keys(obj);
		for (const key of keys) {
			if (["entries", "items", "tweets", "results", "content", "itemContent", "tweet_results"].includes(key) || key.includes("entry") || key.includes("tweet")) {
				results.push(...extractTweetsFromState(obj[key], depth + 1, maxDepth));
			} else if (typeof obj[key] === "object") {
				results.push(...extractTweetsFromState(obj[key], depth + 1, maxDepth));
			}
		}
	}
	// dedup
	const seen = new Set<string>();
	return results.filter((t) => !seen.has(t.id) && seen.add(t.id));
}

export async function crawlXRadar(
	radarIdOrUrl: string = "2062085553466552555",
): Promise<{ success: boolean; count?: number; error?: string }> {
	const radarId = (radarIdOrUrl.includes("/radar/")
		? (radarIdOrUrl.split("/radar/")[1] || radarIdOrUrl).split(/[?#]/)[0]
		: radarIdOrUrl) || radarIdOrUrl;
	const url = `${RADAR_BASE}/${radarId}`;

	console.log(`[Crawl X Radar] bxc x radar scrape: ${url} (ID=${radarId})`);

	let page: Page | null = null;
	try {
		const profile =
			(process.env.BXC_PROFILE as "stealth" | "max" | "static" | "fast" | "http") || "max";
		page = (await Browser.newPage({ profile })) as Page;

		// Inject bxc X cookies for full authenticated radar view (same as twitter.ts / XClient)
		const xCookies = loadBxcXCookies();
		if (xCookies.length > 0) {
			try {
				await (page as any).addCookies(xCookies);
				console.log(`[Crawl X Radar] Injected ${xCookies.length} X cookies (bxc)`);
			} catch (ckErr) {
				console.warn("[Crawl X Radar] addCookies warning (continuing):", ckErr);
			}
		}

		await page.goto(url);
		await page.waitForSelector("body", 20000).catch(() => {});
		// Radar is JS-heavy: give hydration time + possible lazy load
		await new Promise((r) => setTimeout(r, 4500));

		// Snapshot HTML (like other web crawls in ie-crawl)
		const html = await page.content();
		const { mkdir, writeFile } = await import("node:fs/promises");
		const { join } = await import("node:path");
		const snapDir = join("/home/ubuntu/niers/data/radar", radarId);
		await mkdir(snapDir, { recursive: true });
		await writeFile(join(snapDir, "page.html"), html);
		console.log(`[Crawl X Radar] Snapshot saved: ${snapDir}/page.html`);

		// === DEEP RESEARCH using bxc: extract from __INITIAL_STATE__ (the real hydrated SearchTimeline data with querySource:"radar")
		// This is the authoritative feed data (bypasses virtualized DOM / lazy render issues). We also research the rawQuery for this radar ID.
		let extracted: SimpleTweet[] = [];
		let discoveredQuery: string | null = null;
		try {
			const state = await page.evaluate(() => (globalThis as any).__INITIAL_STATE__);
			if (state) {
				console.log("[Crawl X Radar] Deep research: got __INITIAL_STATE__ from bxc render, searching for radar entries...");
				extracted = extractTweetsFromState(state);
				console.log(`[Crawl X Radar] State deep extract found ${extracted.length} tweets`);
				// Research the query associated with this specific radar ID (for future pure XClient radarSearch calls)
				function findRadarQuery(o: any, d = 0): string | null {
					if (!o || d > 6 || typeof o !== "object") return null;
					if (o.rawQuery && (o.querySource === "radar" || String(o.querySource || "").toLowerCase().includes("radar"))) return o.rawQuery;
					if (Array.isArray(o)) {
						for (const i of o) { const r = findRadarQuery(i, d + 1); if (r) return r; }
					} else {
						for (const k of Object.keys(o)) {
							const r = findRadarQuery(o[k], d + 1); if (r) return r;
						}
					}
					return null;
				}
				discoveredQuery = findRadarQuery(state);
				if (discoveredQuery) console.log(`[Crawl X Radar] Discovered rawQuery for radar ${radarId}: ${discoveredQuery}`);
			}
		} catch (stateErr) {
			console.warn("[Crawl X Radar] __INITIAL_STATE__ deep research error (will fallback):", stateErr);
		}

		if (extracted.length === 0) {
			// Fallback cheerio on saved html (resilience, broad search)
			console.log("[Crawl X Radar] No tweets from deep state, falling back to cheerio on snapshot...");
			const { readFile } = await import("node:fs/promises");
			const { join: pathJoin } = await import("node:path");
			const savedHtml = await readFile(pathJoin(snapDir, "page.html"), "utf8").catch(() => html);
			const $ = cheerio.load(savedHtml);
			const seen = new Set<string>();
			$('a[href*="/status/"]').each((_, a) => {
				const href = $(a).attr("href") || "";
				const m = href.match(/\/status\/(\d+)/);
				if (!m) return;
				const id = m[1];
				if (!id) return;
				if (seen.has(id)) return;
				seen.add(id);
				const container = $(a).closest("article, section, div[role], div[data-testid], body > div");
				let text = container.find('[lang], [data-testid="tweetText"], div[dir="auto"]').first().text().trim();
				if (!text) text = container.text().replace(/\s+/g, " ").trim().slice(0, 500);
				const u = container.find('a[href^="/"]').first().attr("href") || "";
				const user = u.split("/")[1] || "unknown";
				if (text.length > 6) {
					extracted.push({ id, text, author_username: user.replace(/[^a-z0-9_]/gi, ""), created_at: undefined });
				}
			});
		}

		// === Additional deep radar content via native @aphrody-code/x (bxc x) with querySource "radar" ===
		// This supplements the specific /i/radar/ID page snapshot (which may be UI/config) with actual IE-relevant radar search results.
		try {
			const bxcCookie = loadBxcXCookieHeader();
			const session = bxcCookie ? XSession.fromCookieString(bxcCookie) : XSession.loadOrEnv();
			const xclient = new XClient(session);
			const radarQs = [
				'"Inazuma Eleven" OR "ヴィクトリーロード" OR "イナイレ" lang:ja min_faves:2',
				'from:AkihiroHino (Inazuma OR イナイレ OR Victory OR ヴィクトリーロード)',
				'"Inazuma Eleven Victory Road" (DLC OR roster OR update OR リーク) min_faves:3',
			];
			for (const q of radarQs) {
				console.log(`[Crawl X Radar] Native bxc x radarSearch: ${q}`);
				const res = await radarSearch(xclient, q, { count: 15, querySource: "radar", product: "Latest" });
				console.log(`[Crawl X Radar] +${res.tweets.length} from native radar`);
				for (const t of res.tweets) {
					if (!extracted.find((e) => e.id === t.id)) {
						extracted.push({
							id: t.id,
							text: t.text,
							author_username: t.author?.username || "unknown",
							created_at: t.created_at,
						});
					}
				}
			}
		} catch (xerr) {
			console.warn("[Crawl X Radar] native radarSearch supplement error:", xerr);
		}

		console.log(`[Crawl X Radar] Extracted ${extracted.length} tweets from radar ${radarId}`);

		if (extracted.length === 0) {
			return { success: true, count: 0 };
		}

		// Normalize + upsert into same "tweets" table (so processTweets / RAG / Azalee wiki consume them)
		// Same shape as twitter.ts DBTweetRow
		const supabase = createSupabaseServiceClient();
		const now = new Date().toISOString();
		const rows: any[] = extracted.map((t) => ({
			id: t.id,
			author_id: t.author_username,
			author_name: t.author_username,
			author_username: t.author_username,
			created_at: t.created_at || snowflakeToIso(t.id),
			text: t.text,
			is_thread: false,
			tweet_count: 1,
			metrics: null as Json,
			media: null as Json,
			quoted_tweets: null as Json,
			raw_tweets: [{ id: t.id, text: t.text, author: t.author_username }] as Json,
			updated_at: now,
		}));

		const { error: upErr } = await supabase.from("tweets").upsert(rows, { onConflict: "id" });
		if (upErr) {
			console.error("[Crawl X Radar] Upsert error:", upErr);
		} else {
			console.log(`[Crawl X Radar] Upserted ${rows.length} radar tweets.`);
		}

		// Reuse the full pipeline: media, Azalee+Grok translation (our enhancement), classification, RAG
		try {
			await processTweets();
			console.log("[Crawl X Radar] processTweets (trans + RAG) completed for radar content.");
		} catch (procErr) {
			console.error("[Crawl X Radar] processTweets error:", procErr);
		}

		return { success: true, count: extracted.length };
	} catch (e: any) {
		console.error("[Crawl X Radar] Error:", e?.message || e);
		return { success: false, error: String(e?.message || e) };
	} finally {
		if (page) {
			await page.close().catch(() => {});
		}
	}
}

if (import.meta.main) {
	crawlXRadar("2062085553466552555")
		.then((res) => {
			console.log("[x-radar main] result:", res);
			process.exit(res.success ? 0 : 1);
		})
		.catch((e) => {
			console.error("[x-radar main] fatal:", e);
			process.exit(1);
		});
}
