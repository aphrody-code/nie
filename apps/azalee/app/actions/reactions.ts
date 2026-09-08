"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { getPgPool } from "@/lib/db/pg";
import { createClient } from "@/lib/supabase/server";
import {
	accumulateReactionStates,
	normalizeReactionArticleId,
	parseReactionRequest,
	parseReactionType,
	type ReactionState,
	type ReactionToggleResult,
	type ReactionType,
} from "@rosegriffon/azalee/reactions";

export async function toggleReaction(
	articleId: string,
	reactionType: ReactionType = "like"
): Promise<ReactionToggleResult> {
	const request = parseReactionRequest(articleId, reactionType);
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
		.eq("article_id", request.articleId)
		.eq("user_id", userId)
		.eq("reaction_type", request.reactionType)
		.maybeSingle();

	if (existing) {
		// Remove reaction
		await client.from("article_reactions").delete().eq("id", existing.id);
	} else {
		// Add reaction
		await client
			.from("article_reactions")
			.insert({
				article_id: request.articleId,
				reaction_type: request.reactionType,
				user_id: userId,
			});
	}

	// Get updated count
	const { count } = await client
		.from("article_reactions")
		.select("id", { count: "exact", head: true })
		.eq("article_id", request.articleId)
		.eq("reaction_type", request.reactionType);

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
	const normalizedArticleIds = articleIds.map(normalizeReactionArticleId);
	const normalizedReactionType = parseReactionType(reactionType);

	const session = await getServerSession();
	const userId = session?.user?.id;

	const result: Record<string, ReactionState> = {};
	for (const id of normalizedArticleIds) {
		result[id] = { count: 0, userReacted: false };
	}

	const pool = getPgPool();

	try {
		// Get all reactions for these articles
		const { rows: reactions } = await pool.query<{ article_id: string; user_id: string }>(
			"SELECT article_id, user_id FROM article_reactions WHERE article_id = ANY($1) AND reaction_type = $2",
			[normalizedArticleIds, normalizedReactionType]
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
): Promise<Record<ReactionType, ReactionState>> {
	const normalizedArticleId = parseReactionRequest(articleId).articleId;
	const session = await getServerSession();
	const userId = session?.user?.id;

	let result = accumulateReactionStates([], userId);

	const pool = getPgPool();

	try {
		const { rows: reactions } = await pool.query<{ reaction_type: string; user_id: string }>(
			"SELECT reaction_type, user_id FROM article_reactions WHERE article_id = $1",
			[normalizedArticleId]
		);

		result = accumulateReactionStates(
			reactions.map((reaction) => ({ reactionType: reaction.reaction_type, userId: reaction.user_id })),
			userId
		);
	} catch (error) {
		console.error("getAllReactionCounts error:", error);
	}

	return result;
}
