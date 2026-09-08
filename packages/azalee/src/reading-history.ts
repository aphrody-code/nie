/**
 * Portable reading-history contracts.
 *
 * This module deliberately contains no framework, authentication, or database
 * client dependency. Browser, desktop, API, and server adapters can use the
 * same query inputs and transform the same joined reading-history rows.
 */

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

/** The article projection selected by each reading-history adapter. */
export interface ReadingHistoryArticle {
	title: string;
	slug: string;
	featured_image_url: string | null;
	excerpt: string | null;
	category: string | null;
}

/** A reading-history row with the optional article join returned by the API. */
export interface ReadingHistoryRow {
	article_id: string;
	progress: number;
	last_read_at: string;
	read_count: number;
	articles: ReadingHistoryArticle | null;
}

/** Input for the database RPC that records a reading milestone. */
export interface ReadingProgressInput {
	userId: string;
	articleId: string;
	progress: number;
}

/**
 * Values passed to the existing `upsert_reading_progress` RPC.
 *
 * Validation remains at the database boundary: the SQL schema owns the
 * 0..100 constraint and the RPC owns monotonic progress/read-count updates.
 * Keeping this planner lossless preserves the existing action's behaviour.
 */
export function planReadingProgress(input: ReadingProgressInput): {
	p_user_id: string;
	p_article_id: string;
	p_progress: number;
} {
	return {
		p_article_id: input.articleId,
		p_progress: input.progress,
		p_user_id: input.userId,
	};
}

export interface ReadingHistoryQuery {
	userId: string;
	limit: number;
	inProgressOnly: boolean;
}

/** Creates the source-neutral filters used to list a user's reading history. */
export function planReadingHistoryQuery(
	userId: string,
	limit: number,
	inProgressOnly = false,
): ReadingHistoryQuery {
	return { inProgressOnly, limit, userId };
}

/** Drops removed articles and converts the remaining joined rows to UI data. */
export function toReadingHistoryEntries(rows: readonly ReadingHistoryRow[]): ReadingHistoryEntry[] {
	return rows.flatMap((row) => {
		if (row.articles === null) {
			return [];
		}

		return [{
			article_id: row.article_id,
			category: row.articles.category,
			excerpt: row.articles.excerpt,
			featured_image_url: row.articles.featured_image_url,
			last_read_at: row.last_read_at,
			progress: row.progress,
			read_count: row.read_count,
			slug: row.articles.slug,
			title: row.articles.title,
		}];
	});
}

/**
 * Calculates the consecutive UTC calendar-day streak used by the current
 * profile surface. `now` is injectable for every host and deterministic tests.
 */
export function calculateReadingStreak(
	lastReadAt: readonly string[],
	now: Date = new Date(),
): number {
	const activeDays = new Set(lastReadAt.map((timestamp) => new Date(timestamp).toISOString().slice(0, 10)));
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);

	let streak = 0;
	const cursor = new Date(today);
	while (activeDays.has(cursor.toISOString().slice(0, 10))) {
		streak += 1;
		cursor.setDate(cursor.getDate() - 1);
	}

	return streak;
}

/** Builds the public statistics shape from source-neutral aggregate values. */
export function toReadingStats(
	totalRead: number | null,
	totalInProgress: number | null,
	lastReadAt: readonly string[],
	now?: Date,
): ReadingStats {
	return {
		streak: calculateReadingStreak(lastReadAt, now),
		totalInProgress: totalInProgress || 0,
		totalRead: totalRead || 0,
	};
}
