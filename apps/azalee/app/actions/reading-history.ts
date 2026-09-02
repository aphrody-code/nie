"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export interface ReadingHistoryEntry {
	article_id: string;
	title: string;
	slug: string;
	featured_image_url: string | null;
	excerpt: string | null;
	category: string | null;
	progress: number;
	last_read_at: string;
	read_count: number;
}

export interface ReadingStats {
	totalRead: number;
	totalInProgress: number;
	streak: number;
}

/**
 * Enregistre ou met à jour la progression de lecture d'un article.
 * Appelle la RPC upsert_reading_progress avec user_id, article_id, progress (0-100).
 */
export async function trackReading(articleId: string, progress: number): Promise<void> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const supabase = await createClient();
	await supabase.rpc("upsert_reading_progress", {
		p_article_id: articleId,
		p_progress: progress,
		p_user_id: session.user.id,
	});
}

/**
 * Récupère l'historique de lecture de l'utilisateur connecté.
 * Retourne les articles publiés sur azalee, ordonnés par dernière lecture.
 */
export async function getReadingHistory(limit = 10): Promise<ReadingHistoryEntry[]> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const supabase = await createClient();
	const { data } = await supabase
		.from("reading_history")
		.select(
			"article_id, progress, last_read_at, read_count, articles(title, slug, featured_image_url, excerpt, category)"
		)
		.eq("user_id", session.user.id)
		.eq("articles.status", "published")
		.eq("articles.app", "azalee")
		.order("last_read_at", { ascending: false })
		.limit(limit);

	if (!data) {
		return [];
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (data as any[])
		.filter((row) => row.articles !== null)
		.map((row) => ({
			article_id: row.article_id,
			category: row.articles.category,
			excerpt: row.articles.excerpt,
			featured_image_url: row.articles.featured_image_url,
			last_read_at: row.last_read_at,
			progress: row.progress,
			read_count: row.read_count,
			slug: row.articles.slug,
			title: row.articles.title,
		}));
}

/**
 * Récupère les articles commencés mais non terminés (progress < 100).
 * Permet d'afficher une section "Continuer la lecture".
 */
export async function getContinueReading(limit = 4): Promise<ReadingHistoryEntry[]> {
	const session = await getServerSession();
	if (!session?.user) {
		return [];
	}

	const supabase = await createClient();
	const { data } = await supabase
		.from("reading_history")
		.select(
			"article_id, progress, last_read_at, read_count, articles(title, slug, featured_image_url, excerpt, category)"
		)
		.eq("user_id", session.user.id)
		.lt("progress", 100)
		.eq("articles.status", "published")
		.eq("articles.app", "azalee")
		.order("last_read_at", { ascending: false })
		.limit(limit);

	if (!data) {
		return [];
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return (data as any[])
		.filter((row) => row.articles !== null)
		.map((row) => ({
			article_id: row.article_id,
			category: row.articles.category,
			excerpt: row.articles.excerpt,
			featured_image_url: row.articles.featured_image_url,
			last_read_at: row.last_read_at,
			progress: row.progress,
			read_count: row.read_count,
			slug: row.articles.slug,
			title: row.articles.title,
		}));
}

/**
 * Calcule les statistiques de lecture de l'utilisateur connecté.
 * - totalRead : articles lus en entier (progress = 100)
 * - totalInProgress : articles commencés mais non terminés (progress < 100)
 * - streak : nombre de jours consécutifs avec activité de lecture (en remontant depuis aujourd'hui)
 */
export async function getReadingStats(): Promise<ReadingStats> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const supabase = await createClient();
	const [{ count: totalRead }, { count: totalInProgress }, { data: history }] = await Promise.all([
		supabase
			.from("reading_history")
			.select("article_id", { count: "exact", head: true })
			.eq("user_id", session.user.id)
			.eq("progress", 100),
		supabase
			.from("reading_history")
			.select("article_id", { count: "exact", head: true })
			.eq("user_id", session.user.id)
			.lt("progress", 100),
		supabase
			.from("reading_history")
			.select("last_read_at")
			.eq("user_id", session.user.id)
			.order("last_read_at", { ascending: false }),
	]);

	// Calcul du streak : jours consécutifs avec activité en remontant depuis aujourd'hui
	let streak = 0;
	if (history && history.length > 0) {
		// Construire un Set des jours (format YYYY-MM-DD) ayant une activité
		const activeDays = new Set<string>(
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			(history as any[]).map((row) => new Date(row.last_read_at).toISOString().slice(0, 10))
		);

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const cursor = new Date(today);
		while (activeDays.has(cursor.toISOString().slice(0, 10))) {
			streak++;
			cursor.setDate(cursor.getDate() - 1);
		}
	}

	return {
		streak,
		totalInProgress: totalInProgress || 0,
		totalRead: totalRead || 0,
	};
}
