/**
 * @license
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

// Harvest X/Twitter par REQUÊTES DE RECHERCHE (complémentaire de twitter.ts, qui
// crawle des timelines de comptes). Le crawl par timeline rate les tweets news /
// communauté qui ne viennent pas des comptes officiels suivis ; la recherche
// "Latest" remonte tout le contenu Inazuma Eleven (Victory Road surtout), multi-
// langue (JA/EN/FR/ES). On filtre le bruit (RT purs, trop court), on dédoublonne
// par id, on upsert dans la table `tweets` (réutilisée par le RAG sync) ET on
// ingère directement dans `inagle_rag_chunks` (kind=tweet, idempotent par id).
//
// Requêtes validées via bxc x search (2026-06, compte yoyo) — voir x-accounts.ts.
// Lecture/recherche seule : on ne publie RIEN.

import { XClient, XSession, type Tweet } from "@aphrody-code/x";
import { createSupabaseServiceClient } from "@rosegriffon/db/service";
import { ingestSources, type RagSource } from "./rag-store-local";
// Conversion tweet → ligne de `public.tweets` : mutualisée dans `tweet-row.ts`
// (le code y est repris à l'identique) pour que la récolte de campagnes à hashtag
// produise exactement le même jsonb `media` que cette veille-ci.
import { tweetToRow, type DBTweetRow } from "./tweet-row";
import { loadBxcXCookieHeader } from "./x-accounts";

// Requêtes "Latest" couvrant officiel + news + communauté, multi-langue.
// Centrées Inazuma Eleven: Victory Road (英雄たちのヴィクトリーロード) + série.
export const IE_SEARCH_QUERIES: readonly string[] = [
	// EN — jeu + news (engagement minimal pour filtrer le bruit pur)
	'"Inazuma Eleven" Victory Road -filter:replies min_faves:3',
	"Inazuma Eleven Victory Road (update OR DLC OR trailer OR roster OR datamine OR leak) -filter:replies min_faves:5",
	// JA — titre complet + abréviations communautaires
	"イナズマイレブン 英雄たちのヴィクトリーロード -filter:replies",
	"#イナズマイレブン (アップデート OR 公式 OR 新情報 OR 必殺技 OR DLC) -filter:replies",
	"#イナイレV OR #イナヴィク -filter:replies",
	// FR — communauté francophone
	"Inazuma Eleven Victory Road lang:fr -filter:replies",
	// ES — grosse communauté hispanophone (news/leaks)
	"Inazuma Eleven Victory Road lang:es -filter:replies min_faves:5",

	// ── Round 2 — requêtes Grok (OIDC) VALIDÉES, multi-langue ────────────────
	// JA — compétitif / techniques /育成 (progression), événements (大会/イナダイ)
	'"ヴィクトリーロード" (大会 OR 対戦 OR 必殺技 OR 育成) -filter:replies',
	"#イナイレ (リーク OR 解析 OR データマイニング) -filter:replies",
	"イナイレ (イナダイ OR 大会システム) ヴィクトリーロード -filter:replies",
	"イナイレ (配信 OR ライブ OR 動画) ヴィクトリーロード -filter:replies",
	// JA — Inazuma Eleven Cross (jeu mobile lié à l'univers VR) + 日本代表2026
	'"イナイレクロス" OR "イナズマイレブン クロス" (新情報 OR コラボ OR 設定資料 OR 日本代表) -filter:replies',
	// JA — hissatsu récents (overrides EV) + persos VR
	'("ゴッドハンドEV" OR "インフェルノペンギン" OR 必殺技 EV) #イナイレ -filter:replies',
	// EN — lore / story / Cross + mods/datamine
	'"Inazuma Eleven" ("Victory Road" OR Cross) (lore OR story OR datamine OR mod) lang:en -filter:replies min_faves:3',
	// FR — actualité Victory Road francophone (élargie au-delà du titre exact)
	"(Inazuma OR ievr OR \"Victory Road\") lang:fr (sortie OR màj OR DLC OR perso OR technique) -filter:replies",
	// ES — communauté/news Espagne (élargie)
	'Inazuma (España OR español) ("Victory Road" OR Cross) -filter:replies',
	// IT — communauté italienne (petite mais centrée)
	'"Inazuma Eleven" lang:it (Victory Road OR Cross OR novità) -filter:replies',
	// PT/BR — communauté lusophone
	'"Inazuma Eleven" "Victory Road" lang:pt -filter:replies',
	// Multi — hashtags globaux art/gameplay
	"(#InazumaEleven OR #VictoryRoad) (gameplay OR update OR DLC OR reveal) -filter:replies min_faves:3",
] as const;

// Garde-fou anti-bruit : on ne garde que le contenu informatif Inazuma Eleven.
const IE_KEYWORDS = [
	"inazuma",
	"victory road",
	"イナズマイレブン",
	"イナイレ", // couvre イナイレV / イナイレクロス
	"ヴィクトリーロード",
	"英雄たち",
	"level-5",
	"level5",
	"レベルファイブ",
	// Round 2 — abréviations + termes Victory Road / Cross récents
	"ievr",
	"イナヴィク",
	"イナダイ", // émission/événement (Ina-Dai)
	"クロス 公式", // Inazuma Eleven Cross officiel
	"イナイレクロス",
	"日本代表2026", // projet Cross
	"ゴッドハンドev", // override hissatsu récent
	"インフェルノペンギン",
	"#inazumaeleven",
	"#victoryroad",
];

function isInformativeIeTweet(t: Tweet): boolean {
	const text = (t.text || "").trim();
	if (text.length < 20) return false;
	if (text.startsWith("RT @")) return false; // RT purs
	const lower = text.toLowerCase();
	// Doit mentionner Inazuma Eleven d'une manière ou d'une autre.
	if (!IE_KEYWORDS.some((k) => lower.includes(k))) return false;
	return true;
}

function rowToRagSource(row: DBTweetRow): RagSource {
	const username = row.author_username || "unknown";
	const displayName = row.author_name || username;
	const url = `https://x.com/${username}/status/${row.id}`;
	const rawForChunk = JSON.stringify({
		id: row.id,
		text: row.text,
		author_username: username,
		author_name: displayName,
		created_at: row.created_at,
		metrics: row.metrics,
		media: row.media,
		url,
	});
	return {
		sourceId: `tweet-${row.id}`,
		kind: "tweet",
		raw: rawForChunk,
		title: `Tweet de ${displayName} (@${username})`,
		url,
		meta: {
			author_username: username,
			author_name: displayName,
			date: row.created_at,
			source: "x-search",
		},
	};
}

export interface HarvestStats {
	success: boolean;
	queries: number;
	fetched: number;
	kept: number;
	upserted: number;
	ragChunks: number;
	ragBackend: string;
	error?: string;
}

/**
 * Harvest par requêtes de recherche, puis upsert `tweets` + ingestion pgvector.
 * @param queries  liste de requêtes (défaut: IE_SEARCH_QUERIES)
 * @param perQuery nb de tweets par requête (max 100)
 */
export async function crawlTwitterSearch(
	queries: readonly string[] = IE_SEARCH_QUERIES,
	perQuery = 40
): Promise<HarvestStats> {
	console.log(`[X Search] Harvest sur ${queries.length} requêtes (${perQuery}/req)...`);

	let session: XSession;
	const bxcCookie = loadBxcXCookieHeader();
	if (bxcCookie) {
		session = XSession.fromCookieString(bxcCookie);
	} else {
		session = XSession.loadOrEnv();
	}
	const client = new XClient(session);
	const supabase = createSupabaseServiceClient();

	const collected = new Map<string, Tweet>();
	let fetched = 0;

	for (const q of queries) {
		try {
			const page = await Promise.race([
				client.search(q, Math.min(perQuery, 100), undefined, "Latest"),
				new Promise<never>((_, rej) =>
					setTimeout(() => rej(new Error("search() timeout")), 25000)
				),
			]);
			const tweets = page.tweets || [];
			fetched += tweets.length;
			let kept = 0;
			for (const t of tweets) {
				if (!isInformativeIeTweet(t)) continue;
				if (!collected.has(t.id)) {
					collected.set(t.id, t);
					kept++;
				}
				// Capte aussi le tweet cité s'il est informatif (souvent l'annonce source).
				const qt = (t as any).quoted_tweet as Tweet | null | undefined;
				if (qt && qt.id && isInformativeIeTweet(qt) && !collected.has(qt.id)) {
					collected.set(qt.id, qt);
					kept++;
				}
			}
			console.log(`[X Search] "${q.slice(0, 48)}…" → ${tweets.length} reçus, ${kept} retenus.`);
		} catch (err) {
			console.warn(
				`[X Search] Requête "${q.slice(0, 48)}…" échouée :`,
				err instanceof Error ? err.message : err
			);
		}
		await new Promise((r) => setTimeout(r, 800)); // throttle anti rate-limit
	}

	const rows = Array.from(collected.values()).map(tweetToRow).filter((r) => r.author_username);
	console.log(`[X Search] ${rows.length} tweets uniques informatifs collectés.`);

	if (rows.length === 0) {
		return {
			success: true,
			queries: queries.length,
			fetched,
			kept: 0,
			upserted: 0,
			ragChunks: 0,
			ragBackend: "hash",
		};
	}

	// 1) Upsert dans `tweets` (réutilisé par le RAG sync timeline). Idempotent par id.
	let upserted = 0;
	const { error: upErr } = await supabase.from("tweets").upsert(rows, { onConflict: "id" });
	if (upErr) {
		console.warn("[X Search] Upsert table `tweets` échoué :", upErr.message);
	} else {
		upserted = rows.length;
	}

	// 2) Ingestion directe pgvector (kind=tweet, idempotent par tweet id).
	const sources = rows.map(rowToRagSource);
	const stats = await ingestSources(sources);
	console.log(
		`[X Search] RAG pgvector : ${stats.chunks} chunks (${stats.sources} sources, backend=${stats.backend}, skipped=${stats.skipped}).`
	);

	return {
		success: true,
		queries: queries.length,
		fetched,
		kept: rows.length,
		upserted,
		ragChunks: stats.chunks,
		ragBackend: stats.backend,
	};
}

if (import.meta.main) {
	const res = await crawlTwitterSearch();
	console.log("[X Search] Résultat :", JSON.stringify(res, null, 2));
	process.exit(res.success ? 0 : 1);
}
