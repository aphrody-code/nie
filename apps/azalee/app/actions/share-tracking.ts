"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export type SharePlatform =
	| "twitter"
	| "facebook"
	| "whatsapp"
	| "linkedin"
	| "telegram"
	| "copy"
	| "native";

export interface ShareCounts {
	total: number;
	byPlatform: Record<string, number>;
}

export interface ShareTimelineEntry {
	date: string;
	count: number;
}

export interface ArticleShareStats {
	total: number;
	byPlatform: Record<string, number>;
	timeline: ShareTimelineEntry[];
}

const VALID_PLATFORMS: ReadonlySet<SharePlatform> = new Set([
	"twitter",
	"facebook",
	"whatsapp",
	"linkedin",
	"telegram",
	"copy",
	"native",
]);

/**
 * Enregistre un partage pour un article. L'authentification est optionnelle :
 * les partages anonymes sont tracés avec user_id null.
 */
export async function trackShare(
	articleId: string,
	platform: SharePlatform
): Promise<{ success: boolean }> {
	if (!articleId || !VALID_PLATFORMS.has(platform)) {
		return { success: false };
	}

	const session = await getServerSession();
	const userId = session?.user?.id ?? null;

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { error: insertError } = await client.from("article_shares").insert({
		article_id: articleId,
		created_at: new Date().toISOString(),
		platform,
		user_id: userId,
	});

	if (insertError) {
		console.error("trackShare insert error:", insertError);
	}

	const { error: rpcError } = await client.rpc("increment_share_count", {
		p_article_id: articleId,
		p_platform: platform,
	});

	if (rpcError) {
		console.error("trackShare rpc error:", rpcError);
	}

	return { success: true };
}

/**
 * Retourne les compteurs de partage pour une liste d'articles.
 *
 * Le RPC `get_share_counts` est défini en DB comme retournant
 * `{ article_id: uuid, by_platform: jsonb, total: int8 }[]` — on adapte le
 * mapping en conséquence (le code historique lisait `platform`/`count`, qui
 * n'existent pas, et produisait des `NaN`).
 */
export async function getShareCounts(articleIds: string[]): Promise<Record<string, ShareCounts>> {
	if (articleIds.length === 0) {
		return {};
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const result: Record<string, ShareCounts> = {};
	for (const id of articleIds) {
		result[id] = { byPlatform: {}, total: 0 };
	}

	// Tentative via RPC
	const { data: rpcData, error: rpcError } = await client.rpc("get_share_counts", {
		p_article_ids: articleIds,
	});

	if (!rpcError && rpcData) {
		for (const row of rpcData as Array<{
			article_id: string;
			by_platform: Record<string, number> | null;
			total: number | string | null;
		}>) {
			const bucket = result[row.article_id] ?? {
				byPlatform: {},
				total: 0,
			};
			bucket.total =
				typeof row.total === "number"
					? row.total
					: Number.parseInt(String(row.total ?? "0"), 10) || 0;
			if (row.by_platform && typeof row.by_platform === "object") {
				for (const [platform, count] of Object.entries(row.by_platform)) {
					bucket.byPlatform[platform] = Number(count) || 0;
				}
			}
			result[row.article_id] = bucket;
		}
		return result;
	}

	// Fallback : agrégation directe sur la table article_shares
	const { data, error } = await client
		.from("article_shares")
		.select("article_id, platform")
		.in("article_id", articleIds);

	if (error) {
		console.error("getShareCounts fallback error:", error);
		return result;
	}

	if (data) {
		for (const row of data as Array<{ article_id: string; platform: string }>) {
			const bucket = result[row.article_id] ?? {
				byPlatform: {},
				total: 0,
			};
			bucket.byPlatform[row.platform] = (bucket.byPlatform[row.platform] || 0) + 1;
			bucket.total += 1;
			result[row.article_id] = bucket;
		}
	}

	return result;
}

/**
 * Retourne les statistiques détaillées de partage pour un article :
 * total, répartition par plateforme, et timeline des 30 derniers jours.
 */
export async function getArticleShareStats(articleId: string): Promise<ArticleShareStats> {
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const thirtyDaysAgo = new Date();
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

	const { data, error } = await client
		.from("article_shares")
		.select("platform, created_at")
		.eq("article_id", articleId)
		.gte("created_at", thirtyDaysAgo.toISOString());

	if (error) {
		console.error("getArticleShareStats error:", error);
		return { byPlatform: {}, timeline: [], total: 0 };
	}

	const rows = (data || []) as Array<{ platform: string; created_at: string }>;

	const byPlatform: Record<string, number> = {};
	const timelineMap = new Map<string, number>();

	for (const row of rows) {
		byPlatform[row.platform] = (byPlatform[row.platform] || 0) + 1;
		const date = row.created_at.slice(0, 10);
		timelineMap.set(date, (timelineMap.get(date) || 0) + 1);
	}

	const timeline: ShareTimelineEntry[] = [...timelineMap.entries()]
		.toSorted(([a], [b]) => a.localeCompare(b))
		.map(([date, count]) => ({ count, date }));

	return {
		byPlatform,
		timeline,
		total: rows.length,
	};
}
