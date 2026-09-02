"use server";

import { getServerSession, requireAdmin } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

// ─── Helpers CSV ──────────────────────────────────────────────────────────────

function escapeCsvField(value: unknown): string {
	if (value === null || value === undefined) {
		return "";
	}
	const str = String(value);
	if (str.includes(",") || str.includes('"') || str.includes("\n")) {
		return `"${str.replaceAll('"', '""')}"`;
	}
	return str;
}

function buildCsvRow(fields: unknown[]): string {
	return fields.map(escapeCsvField).join(",");
}

// ─── Actions admin ────────────────────────────────────────────────────────────

export async function exportArticleStatsCSV(): Promise<string> {
	await requireAdmin();

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { data: articles, error } = await client
		.from("articles")
		.select("title, slug, status, category, view_count, share_count, published_at, created_at, id")
		.eq("status", "published")
		.eq("app", "azalee")
		.order("view_count", { ascending: false });

	if (error) {
		console.error("exportArticleStatsCSV error:", error);
		return "";
	}

	if (!articles || articles.length === 0) {
		return "title,slug,status,category,view_count,share_count,reaction_count,comment_count,published_at,created_at\n";
	}

	const articleIds: string[] = articles.map((a: { id: string }) => a.id);

	// Récupérer les compteurs de réactions et commentaires en parallèle
	const [{ data: reactions }, { data: comments }] = await Promise.all([
		client.from("article_reactions").select("article_id").in("article_id", articleIds),
		client.from("article_comments").select("article_id").in("article_id", articleIds),
	]);

	const reactionCounts = new Map<string, number>();
	const commentCounts = new Map<string, number>();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const r of (reactions ?? []) as any[]) {
		reactionCounts.set(r.article_id, (reactionCounts.get(r.article_id) ?? 0) + 1);
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const c of (comments ?? []) as any[]) {
		commentCounts.set(c.article_id, (commentCounts.get(c.article_id) ?? 0) + 1);
	}

	const header =
		"title,slug,status,category,view_count,share_count,reaction_count,comment_count,published_at,created_at";

	const rows = [header];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const a of articles as any[]) {
		rows.push(
			buildCsvRow([
				a.title,
				a.slug,
				a.status,
				a.category,
				a.view_count ?? 0,
				a.share_count ?? 0,
				reactionCounts.get(a.id) ?? 0,
				commentCounts.get(a.id) ?? 0,
				a.published_at,
				a.created_at,
			])
		);
	}

	return `${rows.join("\n")}\n`;
}

export async function exportAuthorStatsCSV(): Promise<string> {
	await requireAdmin();

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { data: articles, error } = await client
		.from("articles")
		.select("id, author_id, view_count")
		.eq("status", "published")
		.eq("app", "azalee");

	if (error) {
		console.error("exportAuthorStatsCSV articles error:", error);
		return "";
	}

	if (!articles || articles.length === 0) {
		return "author_name,article_count,total_views,total_reactions,total_comments\n";
	}

	const articleIds: string[] = articles.map((a: { id: string }) => a.id);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const authorIds: string[] = [
		...new Set<string>(
			articles.map((a: any) => a.author_id).filter((id: unknown): id is string => Boolean(id))
		),
	];

	const [{ data: reactions }, { data: comments }, { data: profiles }] = await Promise.all([
		client.from("article_reactions").select("article_id").in("article_id", articleIds),
		client.from("article_comments").select("article_id").in("article_id", articleIds),
		client.from("profiles").select("id, username, display_name").in("id", authorIds),
	]);

	// Index article_id → author_id
	const articleAuthor = new Map<string, string>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const a of articles as any[]) {
		if (a.author_id) {
			articleAuthor.set(a.id, a.author_id);
		}
	}

	// Index profileId → nom affiché
	const profileName = new Map<string, string>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const p of (profiles ?? []) as any[]) {
		profileName.set(p.id, p.display_name || p.username || p.id);
	}

	// Agréger par auteur
	const stats = new Map<
		string,
		{ article_count: number; total_views: number; total_reactions: number; total_comments: number }
	>();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const a of articles as any[]) {
		if (!a.author_id) {
			continue;
		}
		const current = stats.get(a.author_id) ?? {
			article_count: 0,
			total_comments: 0,
			total_reactions: 0,
			total_views: 0,
		};
		current.article_count++;
		current.total_views += a.view_count ?? 0;
		stats.set(a.author_id, current);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const r of (reactions ?? []) as any[]) {
		const authorId = articleAuthor.get(r.article_id);
		if (!authorId) {
			continue;
		}
		const current = stats.get(authorId);
		if (current) {
			current.total_reactions++;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const c of (comments ?? []) as any[]) {
		const authorId = articleAuthor.get(c.article_id);
		if (!authorId) {
			continue;
		}
		const current = stats.get(authorId);
		if (current) {
			current.total_comments++;
		}
	}

	const header = "author_name,article_count,total_views,total_reactions,total_comments";
	const rows = [header];

	for (const [authorId, s] of stats.entries()) {
		rows.push(
			buildCsvRow([
				profileName.get(authorId) ?? authorId,
				s.article_count,
				s.total_views,
				s.total_reactions,
				s.total_comments,
			])
		);
	}

	return `${rows.join("\n")}\n`;
}

// ─── Dashboard auteur ─────────────────────────────────────────────────────────

export async function getAuthorDashboard(): Promise<{
	articles: Array<{
		id: string;
		title: string;
		slug: string;
		status: string;
		published_at: string | null;
		view_count: number;
		reaction_count: number;
		comment_count: number;
		bookmark_count: number;
	}>;
	total_views: number;
	most_popular: {
		id: string;
		title: string;
		slug: string;
		view_count: number;
	} | null;
	latest_comments: Array<{
		id: string;
		article_id: string;
		article_title: string;
		content: string;
		created_at: string;
	}>;
} | null> {
	const session = await getServerSession();
	if (!session?.user) {
		return null;
	}

	const userId = session.user.id;
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Récupérer les articles de l'auteur
	const { data: articles, error: articlesError } = await client
		.from("articles")
		.select("id, title, slug, status, view_count, published_at")
		.eq("author_id", userId)
		.eq("app", "azalee")
		.order("created_at", { ascending: false });

	if (articlesError) {
		console.error("getAuthorDashboard articles error:", articlesError);
		return null;
	}

	if (!articles || articles.length === 0) {
		return {
			articles: [],
			latest_comments: [],
			most_popular: null,
			total_views: 0,
		};
	}

	const articleIds: string[] = articles.map((a: { id: string }) => a.id);

	const [{ data: reactions }, { data: comments }, { data: bookmarks }] = await Promise.all([
		client.from("article_reactions").select("article_id").in("article_id", articleIds),
		client
			.from("article_comments")
			.select("id, article_id, content, created_at")
			.in("article_id", articleIds)
			.order("created_at", { ascending: false })
			.limit(10),
		client.from("article_bookmarks").select("article_id").in("article_id", articleIds),
	]);

	const reactionCounts = new Map<string, number>();
	const commentCounts = new Map<string, number>();
	const bookmarkCounts = new Map<string, number>();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const r of (reactions ?? []) as any[]) {
		reactionCounts.set(r.article_id, (reactionCounts.get(r.article_id) ?? 0) + 1);
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const c of (comments ?? []) as any[]) {
		commentCounts.set(c.article_id, (commentCounts.get(c.article_id) ?? 0) + 1);
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const b of (bookmarks ?? []) as any[]) {
		bookmarkCounts.set(b.article_id, (bookmarkCounts.get(b.article_id) ?? 0) + 1);
	}

	// Index des titres pour les commentaires récents
	const articleTitles = new Map<string, string>();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	for (const a of articles as any[]) {
		articleTitles.set(a.id, a.title);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const enrichedArticles = (articles as any[]).map((a) => ({
		bookmark_count: bookmarkCounts.get(a.id) ?? 0,
		comment_count: commentCounts.get(a.id) ?? 0,
		id: a.id,
		published_at: a.published_at ?? null,
		reaction_count: reactionCounts.get(a.id) ?? 0,
		slug: a.slug,
		status: a.status,
		title: a.title,
		view_count: a.view_count ?? 0,
	}));

	const totalViews = enrichedArticles.reduce((sum, a) => sum + a.view_count, 0);

	const mostPopular =
		enrichedArticles.length > 0
			? enrichedArticles.reduce((best, a) => (a.view_count > best.view_count ? a : best))
			: null;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const latestComments = ((comments ?? []) as any[]).slice(0, 5).map((c) => ({
		article_id: c.article_id,
		article_title: articleTitles.get(c.article_id) ?? "",
		content: c.content,
		created_at: c.created_at,
		id: c.id,
	}));

	return {
		articles: enrichedArticles,
		latest_comments: latestComments,
		most_popular: mostPopular
			? {
					id: mostPopular.id,
					title: mostPopular.title,
					slug: mostPopular.slug,
					view_count: mostPopular.view_count,
				}
			: null,
		total_views: totalViews,
	};
}
