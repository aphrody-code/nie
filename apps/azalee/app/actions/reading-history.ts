"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import {
	planReadingHistoryQuery,
	planReadingProgress,
	toReadingHistoryEntries,
	toReadingStats,
	type ReadingHistoryEntry,
	type ReadingHistoryRow,
	type ReadingStats,
} from "@rosegriffon/azalee";

export type { ReadingHistoryEntry, ReadingStats } from "@rosegriffon/azalee";

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
	await supabase.rpc("upsert_reading_progress", planReadingProgress({
		articleId,
		progress,
		userId: session.user.id,
	}));
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
	const query = planReadingHistoryQuery(session.user.id, limit);
	const { data } = await supabase
		.from("reading_history")
		.select(
			"article_id, progress, last_read_at, read_count, articles(title, slug, featured_image_url, excerpt, category)"
		)
		.eq("user_id", query.userId)
		.eq("articles.status", "published")
		.eq("articles.app", "azalee")
		.order("last_read_at", { ascending: false })
		.limit(query.limit);

	return toReadingHistoryEntries((data ?? []) as unknown as ReadingHistoryRow[]);
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
	const query = planReadingHistoryQuery(session.user.id, limit, true);
	const { data } = await supabase
		.from("reading_history")
		.select(
			"article_id, progress, last_read_at, read_count, articles(title, slug, featured_image_url, excerpt, category)"
		)
		.eq("user_id", query.userId)
		.lt("progress", 100)
		.eq("articles.status", "published")
		.eq("articles.app", "azalee")
		.order("last_read_at", { ascending: false })
		.limit(query.limit);

	return toReadingHistoryEntries((data ?? []) as unknown as ReadingHistoryRow[]);
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

	return toReadingStats(
		totalRead,
		totalInProgress,
		(history ?? []).map((row) => row.last_read_at),
	);
}
