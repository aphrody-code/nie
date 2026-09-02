"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export async function toggleBookmark(articleId: string): Promise<{ bookmarked: boolean }> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const userId = session.user.id;
	const supabase = await createClient();

	const { data: existing } = await supabase
		.from("article_bookmarks")
		.select("id")
		.eq("article_id", articleId)
		.eq("user_id", userId)
		.maybeSingle();

	if (existing) {
		await supabase.from("article_bookmarks").delete().eq("id", existing.id);
		return { bookmarked: false };
	}

	await supabase.from("article_bookmarks").insert({ article_id: articleId, user_id: userId });
	return { bookmarked: true };
}

export async function getBookmarkStates(articleIds: string[]): Promise<Record<string, boolean>> {
	const session = await getServerSession();
	if (!session?.user || articleIds.length === 0) {
		return {};
	}

	const supabase = await createClient();
	const { data } = await supabase
		.from("article_bookmarks")
		.select("article_id")
		.eq("user_id", session.user.id)
		.in("article_id", articleIds);

	const result: Record<string, boolean> = {};
	if (data) {
		for (const row of data) {
			result[row.article_id] = true;
		}
	}
	return result;
}

export async function getUserBookmarks(): Promise<string[]> {
	const session = await getServerSession();
	if (!session?.user) {
		return [];
	}

	const supabase = await createClient();
	const { data } = await supabase
		.from("article_bookmarks")
		.select("article_id")
		.eq("user_id", session.user.id)
		.order("created_at", { ascending: false });

	return (data || []).map((r: { article_id: string }) => r.article_id);
}
