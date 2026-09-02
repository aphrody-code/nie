"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { getPgPool } from "@/lib/db/pg";
import { REACTION_TYPES } from "@/lib/reaction-types";
import type { ReactionType } from "@/lib/reaction-types";
import { createClient } from "@/lib/supabase/server";

export async function toggleReaction(
	articleId: string,
	reactionType: ReactionType = "like"
): Promise<{ reacted: boolean; count: number }> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const userId = session.user.id;
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Check if reaction already exists
	const { data: existing } = await client
		.from("article_reactions")
		.select("id")
		.eq("article_id", articleId)
		.eq("user_id", userId)
		.eq("reaction_type", reactionType)
		.maybeSingle();

	if (existing) {
		// Remove reaction
		await client.from("article_reactions").delete().eq("id", existing.id);
	} else {
		// Add reaction
		await client
			.from("article_reactions")
			.insert({ article_id: articleId, reaction_type: reactionType, user_id: userId });
	}

	// Get updated count
	const { count } = await client
		.from("article_reactions")
		.select("id", { count: "exact", head: true })
		.eq("article_id", articleId)
		.eq("reaction_type", reactionType);

	return { count: count || 0, reacted: !existing };
}

/**
 * Récupère les compteurs de réactions pour un seul type (rétrocompatible)
 * Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts).
 */
export async function getReactionCounts(
	articleIds: string[],
	reactionType = "like"
): Promise<Record<string, { count: number; userReacted: boolean }>> {
	if (articleIds.length === 0) {
		return {};
	}

	const session = await getServerSession();
	const userId = session?.user?.id;

	const result: Record<string, { count: number; userReacted: boolean }> = {};
	for (const id of articleIds) {
		result[id] = { count: 0, userReacted: false };
	}

	const pool = getPgPool();

	try {
		// Get all reactions for these articles
		const { rows: reactions } = await pool.query<{ article_id: string; user_id: string }>(
			"SELECT article_id, user_id FROM article_reactions WHERE article_id = ANY($1) AND reaction_type = $2",
			[articleIds, reactionType]
		);

		for (const r of reactions) {
			if (!result[r.article_id]) {
				result[r.article_id] = { count: 0, userReacted: false };
			}
			result[r.article_id].count++;
			if (userId && r.user_id === userId) {
				result[r.article_id].userReacted = true;
			}
		}
	} catch (error) {
		console.error("getReactionCounts error:", error);
	}

	return result;
}

/**
 * Récupère TOUS les types de réactions pour un article (pour la page détail)
 * Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts).
 */
export async function getAllReactionCounts(
	articleId: string
): Promise<Record<ReactionType, { count: number; userReacted: boolean }>> {
	const session = await getServerSession();
	const userId = session?.user?.id;

	const result = {} as Record<ReactionType, { count: number; userReacted: boolean }>;
	for (const type of REACTION_TYPES) {
		result[type] = { count: 0, userReacted: false };
	}

	const pool = getPgPool();

	try {
		const { rows: reactions } = await pool.query<{ reaction_type: string; user_id: string }>(
			"SELECT reaction_type, user_id FROM article_reactions WHERE article_id = $1",
			[articleId]
		);

		for (const r of reactions) {
			const type = r.reaction_type as ReactionType;
			if (result[type]) {
				result[type].count++;
				if (userId && r.user_id === userId) {
					result[type].userReacted = true;
				}
			}
		}
	} catch (error) {
		console.error("getAllReactionCounts error:", error);
	}

	return result;
}
