/**
 * Portable article-series rules for the Azalée editorial product.
 *
 * The plans intentionally describe values and ordering only. Next actions,
 * API routes, desktop adapters, and background jobs choose their own
 * authenticated transport; no Supabase, Postgres, or framework dependency is
 * allowed here.
 */

export const ARTICLE_SERIES_IDENTIFIER_MAX_LENGTH = 512;
export const ARTICLE_SERIES_ORDER_MIN = 0;
export const ARTICLE_SERIES_ORDER_MAX = 2_147_483_647;

export const ARTICLE_SERIES_SELECT =
	"id, title, slug, description, cover_image_url, author_id";
export const ARTICLE_SERIES_ARTICLE_SELECT =
	"id, title, slug, excerpt, featured_image_url, category, published_at, series_order";

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

export interface CreateSeriesInput {
	title: string;
	slug: string;
	description?: string;
	cover_image_url?: string;
}

export interface SeriesBySlugPlan {
	slug: string;
}

export interface SeriesByIdPlan {
	id: string;
}

export interface SeriesArticlesPlan {
	seriesId: string;
	ascending: true;
	orderColumn: "series_order";
}

export interface SeriesArticleCountPlan {
	seriesId: string;
}

export interface CreateSeriesPlan {
	payload: {
		title: string;
		slug: string;
		description: string | null;
		cover_image_url: string | null;
	};
}

export interface AssignArticleToSeriesPlan {
	articleId: string;
	seriesId: string;
	seriesOrder: number;
}

export interface RemoveArticleFromSeriesPlan {
	articleId: string;
	seriesId: null;
	seriesOrder: 0;
}

function normalizeIdentifier(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new TypeError(`An article series ${label} must be a string`);
	}

	const identifier = value.trim();
	if (
		!identifier ||
		identifier.length > ARTICLE_SERIES_IDENTIFIER_MAX_LENGTH ||
		identifier.includes("\0")
	) {
		throw new RangeError(`Invalid article series ${label}`);
	}

	return identifier;
}

function normalizeOptionalText(value: unknown, label: string): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string" || value.includes("\0")) {
		throw new TypeError(`An article series ${label} must be text when provided`);
	}
	return value;
}

/** Normalizes a storage identity without requiring a UUID implementation. */
export function normalizeSeriesId(value: unknown): string {
	return normalizeIdentifier(value, "identifier");
}

/** Normalizes a public series slug before a transport turns it into a query. */
export function normalizeSeriesSlug(value: unknown): string {
	return normalizeIdentifier(value, "slug");
}

/** Normalizes an article identity without prescribing its backing store. */
export function normalizeSeriesArticleId(value: unknown): string {
	return normalizeIdentifier(value, "article identifier");
}

/** Validates the signed 32-bit sequence accepted by the existing SQL schema. */
export function normalizeSeriesOrder(value: unknown): number {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < ARTICLE_SERIES_ORDER_MIN ||
		value > ARTICLE_SERIES_ORDER_MAX
	) {
		throw new RangeError("Invalid article series order");
	}
	return value;
}

/** Validates and plans the insert payload without coupling it to PostgREST. */
export function planCreateSeries(input: CreateSeriesInput): CreateSeriesPlan {
	return {
		payload: {
			cover_image_url: normalizeOptionalText(input.cover_image_url, "cover image URL"),
			description: normalizeOptionalText(input.description, "description"),
			slug: normalizeSeriesSlug(input.slug),
			title: normalizeIdentifier(input.title, "title"),
		},
	};
}

/** Plans a public series lookup by its stable slug. */
export function planSeriesBySlug(slug: unknown): SeriesBySlugPlan {
	return { slug: normalizeSeriesSlug(slug) };
}

/** Plans an identity lookup used after an article reveals its series ID. */
export function planSeriesById(id: unknown): SeriesByIdPlan {
	return { id: normalizeSeriesId(id) };
}

/** Plans the ordered article collection that backs a series navigator. */
export function planSeriesArticles(seriesId: unknown): SeriesArticlesPlan {
	return {
		ascending: true,
		orderColumn: "series_order",
		seriesId: normalizeSeriesId(seriesId),
	};
}

/** Plans a count request for one series. */
export function planSeriesArticleCount(seriesId: unknown): SeriesArticleCountPlan {
	return { seriesId: normalizeSeriesId(seriesId) };
}

/** Plans a membership update while preserving the storage field semantics. */
export function planAssignArticleToSeries(
	articleId: unknown,
	seriesId: unknown,
	seriesOrder: unknown,
): AssignArticleToSeriesPlan {
	return {
		articleId: normalizeSeriesArticleId(articleId),
		seriesId: normalizeSeriesId(seriesId),
		seriesOrder: normalizeSeriesOrder(seriesOrder),
	};
}

/** Plans removal with the legacy zero order retained for compatibility. */
export function planRemoveArticleFromSeries(articleId: unknown): RemoveArticleFromSeriesPlan {
	return {
		articleId: normalizeSeriesArticleId(articleId),
		seriesId: null,
		seriesOrder: 0,
	};
}

/**
 * Returns a new ordered collection. Equal and missing order values preserve
 * their source order, matching the historical UI and database response.
 */
export function orderSeriesArticles<T extends Pick<SeriesArticle, "series_order">>(
	articles: readonly T[],
): T[] {
	return [...articles].sort(
		(left, right) => (left.series_order ?? 0) - (right.series_order ?? 0),
	);
}

/** Builds the public payload while applying the single shared order rule. */
export function toSeriesWithArticles(
	series: SeriesInfo,
	articles: readonly SeriesArticle[],
): SeriesWithArticles {
	return { articles: orderSeriesArticles(articles), series };
}

/** Maps the ordered collection position for a host-neutral series navigator. */
export function seriesArticleIndex(articles: readonly SeriesArticle[], articleId: unknown): number {
	const normalizedArticleId = normalizeSeriesArticleId(articleId);
	const index = orderSeriesArticles(articles).findIndex((article) => article.id === normalizedArticleId);
	return index >= 0 ? index : 0;
}

/** Combines counted rows with their public summary DTOs without leaking maps. */
export function toSeriesSummaries(
	series: readonly Omit<SeriesSummary, "article_count">[],
	articleCounts: ReadonlyMap<string, number>,
): SeriesSummary[] {
	return series.map((entry) => ({
		...entry,
		article_count: articleCounts.get(entry.id) ?? 0,
	}));
}
