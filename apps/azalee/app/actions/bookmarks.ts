"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";
import {
	parseBookmarkToggleInput,
	planBookmarkCreate,
	planBookmarkDelete,
	planBookmarkLookup,
	planBookmarkStateQuery,
	planUserBookmarksQuery,
	toBookmarkArticleIds,
	toBookmarkStates,
	type BookmarkArticleRow,
} from "@rosegriffon/azalee/bookmarks";

export async function toggleBookmark(articleId: string): Promise<{ bookmarked: boolean }> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const input = parseBookmarkToggleInput(articleId, session.user.id);
	const lookup = planBookmarkLookup(input);
	const supabase = await createClient();

	const { data: existing } = await supabase
		.from("article_bookmarks")
		.select("id")
		.eq("article_id", lookup.articleId)
		.eq("user_id", lookup.userId)
		.maybeSingle();

	if (existing) {
		const deletion = planBookmarkDelete(existing.id);
		await supabase.from("article_bookmarks").delete().eq("id", deletion.bookmarkId);
		return { bookmarked: false };
	}

	const creation = planBookmarkCreate(input);
	await supabase.from("article_bookmarks").insert({
		article_id: creation.articleId,
		user_id: creation.userId,
	});
	return { bookmarked: true };
}

export async function getBookmarkStates(articleIds: string[]): Promise<Record<string, boolean>> {
	const session = await getServerSession();
	if (!session?.user) {
		return {};
	}
	const query = planBookmarkStateQuery(session.user.id, articleIds);
	if (!query) return {};

	const supabase = await createClient();
	const { data } = await supabase
		.from("article_bookmarks")
		.select("article_id")
		.eq("user_id", query.userId)
		.in("article_id", query.articleIds);

	return toBookmarkStates((data ?? []) as BookmarkArticleRow[]);
}

export async function getUserBookmarks(): Promise<string[]> {
	const session = await getServerSession();
	if (!session?.user) {
		return [];
	}

	const query = planUserBookmarksQuery(session.user.id);
	const supabase = await createClient();
	const { data } = await supabase
		.from("article_bookmarks")
		.select("article_id")
		.eq("user_id", query.userId)
		.order("created_at", { ascending: false });

	return toBookmarkArticleIds((data ?? []) as BookmarkArticleRow[]);
}
