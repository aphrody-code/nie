/**
 * Host-neutral article bookmark contracts.
 *
 * Authentication and persistence belong to the caller.  These helpers keep
 * validation and database-shaped plans identical for the web action, desktop
 * bindings, CLI adapters, and any future HTTP transport.
 */

const MAX_IDENTIFIER_LENGTH = 512;

export interface BookmarkToggleInput {
	articleId: string;
	userId: string;
}

export interface BookmarkLookupPlan {
	articleId: string;
	userId: string;
}

export interface BookmarkCreatePlan extends BookmarkToggleInput {}

export interface BookmarkDeletePlan {
	bookmarkId: string;
}

export interface BookmarkStateQueryPlan {
	articleIds: string[];
	userId: string;
}

export interface UserBookmarksQueryPlan {
	userId: string;
}

/** The minimal storage projection consumed by bookmark state adapters. */
export interface BookmarkArticleRow {
	article_id: string;
}

function normalizeIdentifier(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new TypeError(`A bookmark ${label} must be a string`);
	}

	const identifier = value.trim();
	if (!identifier || identifier.length > MAX_IDENTIFIER_LENGTH || identifier.includes("\0")) {
		throw new RangeError(`Invalid bookmark ${label}`);
	}

	return identifier;
}

/** Normalizes an article key without coupling the contract to a UUID backend. */
export function normalizeBookmarkArticleId(value: unknown): string {
	return normalizeIdentifier(value, "article identifier");
}

/** Normalizes the authenticated principal supplied by a host adapter. */
export function normalizeBookmarkUserId(value: unknown): string {
	return normalizeIdentifier(value, "user identifier");
}

/** Validates an untrusted bookmark mutation before it reaches persistence. */
export function parseBookmarkToggleInput(articleId: unknown, userId: unknown): BookmarkToggleInput {
	return {
		articleId: normalizeBookmarkArticleId(articleId),
		userId: normalizeBookmarkUserId(userId),
	};
}

/** Plans the unique lookup used to decide whether a toggle creates or removes. */
export function planBookmarkLookup(input: BookmarkToggleInput): BookmarkLookupPlan {
	return { articleId: input.articleId, userId: input.userId };
}

/** Plans the insert payload while preserving the storage column names. */
export function planBookmarkCreate(input: BookmarkToggleInput): BookmarkCreatePlan {
	return { articleId: input.articleId, userId: input.userId };
}

/** Plans deletion by the bookmark record identity returned by a storage adapter. */
export function planBookmarkDelete(bookmarkId: unknown): BookmarkDeletePlan {
	return { bookmarkId: normalizeIdentifier(bookmarkId, "record identifier") };
}

/**
 * Plans a batch state lookup. Duplicate article identifiers are removed so an
 * adapter never sends redundant keys to SQLite, PostgreSQL, or PostgREST.
 */
export function planBookmarkStateQuery(
	userId: unknown,
	articleIds: readonly unknown[],
): BookmarkStateQueryPlan | null {
	const normalizedIds = [...new Set(articleIds.map(normalizeBookmarkArticleId))];
	if (normalizedIds.length === 0) return null;

	return {
		articleIds: normalizedIds,
		userId: normalizeBookmarkUserId(userId),
	};
}

/** Plans the reverse-chronological list of an authenticated user's bookmarks. */
export function planUserBookmarksQuery(userId: unknown): UserBookmarksQueryPlan {
	return { userId: normalizeBookmarkUserId(userId) };
}

/** Converts storage rows to the legacy sparse article-id → bookmarked map. */
export function toBookmarkStates(rows: Iterable<BookmarkArticleRow>): Record<string, boolean> {
	const states: Record<string, boolean> = {};
	for (const row of rows) {
		const articleId = normalizeBookmarkArticleId(row.article_id);
		states[articleId] = true;
	}
	return states;
}

/** Converts an ordered storage projection to the public list result. */
export function toBookmarkArticleIds(rows: Iterable<BookmarkArticleRow>): string[] {
	return [...rows].map((row) => normalizeBookmarkArticleId(row.article_id));
}
