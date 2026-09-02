"use server";

import { requireAdmin } from "@/lib/auth-helpers";
import { getPgPool } from "@/lib/db/pg";
import { createClient } from "@/lib/supabase/server";

export interface SeriesInfo {
	id: string;
	title: string;
	slug: string;
	description: string | null;
	cover_image_url: string | null;
	author_id: string | null;
}

export interface SeriesArticle {
	id: string;
	title: string;
	slug: string;
	excerpt: string | null;
	featured_image_url: string | null;
	category: string | null;
	published_at: string | null;
	series_order: number | null;
}

export interface SeriesWithArticles {
	series: SeriesInfo;
	articles: SeriesArticle[];
}

export interface SeriesSummary {
	id: string;
	title: string;
	slug: string;
	description: string | null;
	cover_image_url: string | null;
	article_count: number;
}

/**
 * Récupère une série par son slug ainsi que tous ses articles, ordonnés par series_order.
 * Accès public.
 */
export async function getSeries(slug: string): Promise<SeriesWithArticles | null> {
	const supabase = await createClient();

	const { data: series, error } = await supabase
		.from("article_series")
		.select("id, title, slug, description, cover_image_url, author_id")
		.eq("slug", slug)
		.single();

	if (error || !series) {
		return null;
	}

	const { data: articles } = await supabase
		.from("articles")
		.select("id, title, slug, excerpt, featured_image_url, category, published_at, series_order")
		.eq("series_id", series.id)
		.order("series_order", { ascending: true });

	return {
		articles: articles || [],
		series,
	};
}

/**
 * Récupère la série associée à un article ainsi que tous les autres articles de cette série.
 * Retourne aussi l'index de position (currentIndex) de l'article dans la série.
 * Retourne null si l'article n'appartient à aucune série.
 * Accès public. Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts).
 */
export async function getArticleSeries(
	articleId: string
): Promise<(SeriesWithArticles & { currentIndex: number }) | null> {
	const pool = getPgPool();

	try {
		// Vérifier si l'article a une série
		const { rows: articleRows } = await pool.query<{
			id: string;
			series_id: string | null;
			series_order: number | null;
		}>("SELECT id, series_id, series_order FROM articles WHERE id = $1 LIMIT 1", [articleId]);

		const article = articleRows[0];
		if (!article || !article.series_id) {
			return null;
		}

		// Récupérer les infos de la série
		const { rows: seriesRows } = await pool.query<SeriesInfo>(
			`SELECT id, title, slug, description, cover_image_url, author_id
			 FROM article_series
			 WHERE id = $1
			 LIMIT 1`,
			[article.series_id]
		);

		const series = seriesRows[0];
		if (!series) {
			return null;
		}

		// Récupérer tous les articles de la série
		const { rows: seriesArticles } = await pool.query<SeriesArticle>(
			`SELECT id, title, slug, excerpt, featured_image_url, category, published_at, series_order
			 FROM articles
			 WHERE series_id = $1
			 ORDER BY series_order ASC`,
			[series.id]
		);

		const currentIndex = seriesArticles.findIndex((a) => a.id === articleId);

		return {
			articles: seriesArticles,
			currentIndex: currentIndex >= 0 ? currentIndex : 0,
			series,
		};
	} catch (error) {
		console.error("getArticleSeries error:", error);
		return null;
	}
}

/**
 * Récupère toutes les séries avec leur nombre d'articles.
 * Accès public.
 */
export async function getAllSeries(): Promise<SeriesSummary[]> {
	const supabase = await createClient();
	const { data } = await supabase
		.from("article_series")
		.select("id, title, slug, description, cover_image_url");

	if (!data) {
		return [];
	}

	// Récupérer le compte d'articles par série
	const counts = await Promise.all(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		(data as any[]).map(async (series) => {
			const { count } = await supabase
				.from("articles")
				.select("id", { count: "exact", head: true })
				.eq("series_id", series.id);
			return { count: count || 0, id: series.id };
		})
	);

	const countMap = new Map(counts.map((c) => [c.id, c.count]));

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (data as any[]).map((series) => ({
		article_count: countMap.get(series.id) || 0,
		cover_image_url: series.cover_image_url,
		description: series.description,
		id: series.id,
		slug: series.slug,
		title: series.title,
	}));
}

/**
 * Crée une nouvelle série d'articles.
 * Réservé aux administrateurs.
 */
export async function createSeries(data: {
	title: string;
	slug: string;
	description?: string;
	cover_image_url?: string;
}): Promise<SeriesInfo> {
	await requireAdmin();

	const supabase = await createClient();
	const { data: created, error } = await supabase
		.from("article_series")
		.insert({
			cover_image_url: data.cover_image_url ?? null,
			description: data.description ?? null,
			slug: data.slug,
			title: data.title,
		})
		.select("id, title, slug, description, cover_image_url, author_id")
		.single();

	if (error) {
		throw new Error(error.message);
	}

	return created;
}

/**
 * Ajoute un article à une série en définissant series_id et series_order.
 * Réservé aux administrateurs.
 */
export async function addArticleToSeries(
	articleId: string,
	seriesId: string,
	order: number
): Promise<{ success: boolean }> {
	await requireAdmin();

	const supabase = await createClient();
	const { error } = await supabase
		.from("articles")
		.update({ series_id: seriesId, series_order: order })
		.eq("id", articleId);

	if (error) {
		throw new Error(error.message);
	}

	return { success: true };
}

/**
 * Retire un article de sa série (series_id = null, series_order = 0).
 * Réservé aux administrateurs.
 */
export async function removeArticleFromSeries(articleId: string): Promise<{ success: boolean }> {
	await requireAdmin();

	const supabase = await createClient();
	const { error } = await supabase
		.from("articles")
		.update({ series_id: null, series_order: 0 })
		.eq("id", articleId);

	if (error) {
		throw new Error(error.message);
	}

	return { success: true };
}
