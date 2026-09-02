"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { isAdminRole } from "@/lib/auth-roles";
import { getPgPool } from "@/lib/db/pg";
import { createClient } from "@/lib/supabase/server";

export interface Comment {
	id: string;
	content: string;
	is_edited: boolean;
	is_pinned: boolean;
	created_at: string;
	updated_at: string;
	parent_id: string | null;
	author: {
		id: string;
		username: string | null;
		full_name: string | null;
		avatar_url: string | null;
	};
	reply_count: number;
	likes: number;
	user_liked: boolean;
}

export interface Reply {
	id: string;
	content: string;
	is_edited: boolean;
	is_pinned: boolean;
	created_at: string;
	updated_at: string;
	parent_id: string | null;
	author: {
		id: string;
		username: string | null;
		full_name: string | null;
		avatar_url: string | null;
	};
}

/**
 * Récupère les commentaires de premier niveau d'un article, avec le nombre de réponses.
 * Les commentaires épinglés apparaissent toujours en premier.
 */
export async function getComments(
	articleId: string,
	sortBy: "newest" | "oldest" | "popular" = "newest"
): Promise<Comment[]> {
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const session = await getServerSession();
	const userId = session?.user?.id;

	// Construire la requête de tri
	// Les épinglés passent toujours devant, puis on applique le tri demandé
	// "popular" est traité en JS après récupération des likes
	const ascending = sortBy === "oldest";

	const { data: rawComments, error } = await client
		.from("article_comments")
		.select(
			`id, content, is_edited, is_pinned, created_at, updated_at, parent_id,
       profiles:author_id ( id, username, full_name, avatar_url )`
		)
		.eq("article_id", articleId)
		.is("parent_id", null)
		.order("is_pinned", { ascending: false })
		.order("created_at", { ascending });

	if (error) {
		console.error("getComments error:", error);
		return [];
	}

	if (!rawComments || rawComments.length === 0) {
		return [];
	}

	const commentIds: string[] = rawComments.map((c: { id: string }) => c.id);

	// Compter les réponses groupées par parent_id
	const { data: repliesData } = await client
		.from("article_comments")
		.select("parent_id")
		.in("parent_id", commentIds);

	const replyCountMap = new Map<string, number>();
	if (repliesData) {
		for (const row of repliesData as Array<{ parent_id: string }>) {
			replyCountMap.set(row.parent_id, (replyCountMap.get(row.parent_id) || 0) + 1);
		}
	}

	// Récupérer les likes (article_reactions avec reaction_type = 'comment_like'
	// Et article_id formaté comme `comment:{commentId}`)
	const commentRefIds = commentIds.map((id) => `comment:${id}`);

	const { data: likesData } = await client
		.from("article_reactions")
		.select("article_id, user_id")
		.in("article_id", commentRefIds)
		.eq("reaction_type", "comment_like");

	const likesCountMap = new Map<string, number>();
	const userLikedSet = new Set<string>();

	if (likesData) {
		for (const row of likesData as Array<{ article_id: string; user_id: string }>) {
			likesCountMap.set(row.article_id, (likesCountMap.get(row.article_id) || 0) + 1);
			if (userId && row.user_id === userId) {
				userLikedSet.add(row.article_id);
			}
		}
	}

	const comments: Comment[] = rawComments.map(
		(c: {
			id: string;
			content: string;
			is_edited: boolean;
			is_pinned: boolean;
			created_at: string;
			updated_at: string;
			parent_id: string | null;
			profiles: {
				id: string;
				username: string | null;
				full_name: string | null;
				avatar_url: string | null;
			} | null;
		}) => {
			const ref = `comment:${c.id}`;
			return {
				author: {
					avatar_url: c.profiles?.avatar_url ?? null,
					full_name: c.profiles?.full_name ?? null,
					id: c.profiles?.id ?? "",
					username: c.profiles?.username ?? null,
				},
				content: c.content,
				created_at: c.created_at,
				id: c.id,
				is_edited: c.is_edited,
				is_pinned: c.is_pinned,
				likes: likesCountMap.get(ref) || 0,
				parent_id: c.parent_id,
				reply_count: replyCountMap.get(c.id) || 0,
				updated_at: c.updated_at,
				user_liked: userLikedSet.has(ref),
			};
		}
	);

	if (sortBy === "popular") {
		// Épinglés en premier, puis tri par likes décroissant
		comments.sort((a, b) => {
			if (a.is_pinned !== b.is_pinned) {
				return a.is_pinned ? -1 : 1;
			}
			return b.likes - a.likes;
		});
	}

	return comments;
}

/**
 * Récupère les réponses à un commentaire spécifique.
 */
export async function getReplies(parentId: string): Promise<Reply[]> {
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { data, error } = await client
		.from("article_comments")
		.select(
			`id, content, is_edited, is_pinned, created_at, updated_at, parent_id,
       profiles:author_id ( id, username, full_name, avatar_url )`
		)
		.eq("parent_id", parentId)
		.order("created_at", { ascending: true });

	if (error) {
		console.error("getReplies error:", error);
		return [];
	}

	if (!data) {
		return [];
	}

	return (
		data as Array<{
			id: string;
			content: string;
			is_edited: boolean;
			is_pinned: boolean;
			created_at: string;
			updated_at: string;
			parent_id: string | null;
			profiles: {
				id: string;
				username: string | null;
				full_name: string | null;
				avatar_url: string | null;
			} | null;
		}>
	).map((c) => ({
		author: {
			avatar_url: c.profiles?.avatar_url ?? null,
			full_name: c.profiles?.full_name ?? null,
			id: c.profiles?.id ?? "",
			username: c.profiles?.username ?? null,
		},
		content: c.content,
		created_at: c.created_at,
		id: c.id,
		is_edited: c.is_edited,
		is_pinned: c.is_pinned,
		parent_id: c.parent_id,
		updated_at: c.updated_at,
	}));
}

/**
 * Crée un commentaire ou une réponse à un commentaire existant.
 */
export async function createComment(
	articleId: string,
	content: string,
	parentId?: string
): Promise<Comment> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const trimmed = content.trim();
	if (trimmed.length === 0 || trimmed.length > 2000) {
		throw new Error("Le commentaire doit contenir entre 1 et 2000 caractères");
	}

	const userId = session.user.id;
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Vérifier que le commentaire parent existe et appartient au même article
	if (parentId) {
		const { data: parent, error: parentError } = await client
			.from("article_comments")
			.select("id, article_id")
			.eq("id", parentId)
			.maybeSingle();

		if (parentError || !parent) {
			throw new Error("Commentaire parent introuvable");
		}
		if (parent.article_id !== articleId) {
			throw new Error("Le commentaire parent n'appartient pas à cet article");
		}
	}

	const now = new Date().toISOString();

	const { data: inserted, error: insertError } = await client
		.from("article_comments")
		.insert({
			article_id: articleId,
			author_id: userId,
			content: trimmed,
			created_at: now,
			is_edited: false,
			is_pinned: false,
			parent_id: parentId ?? null,
			updated_at: now,
		})
		.select(
			`id, content, is_edited, is_pinned, created_at, updated_at, parent_id,
       profiles:author_id ( id, username, full_name, avatar_url )`
		)
		.single();

	if (insertError || !inserted) {
		console.error("createComment error:", insertError);
		throw new Error("Impossible de créer le commentaire");
	}

	const c = inserted as {
		id: string;
		content: string;
		is_edited: boolean;
		is_pinned: boolean;
		created_at: string;
		updated_at: string;
		parent_id: string | null;
		profiles: {
			id: string;
			username: string | null;
			full_name: string | null;
			avatar_url: string | null;
		} | null;
	};

	return {
		author: {
			avatar_url: c.profiles?.avatar_url ?? null,
			full_name: c.profiles?.full_name ?? null,
			id: c.profiles?.id ?? "",
			username: c.profiles?.username ?? null,
		},
		content: c.content,
		created_at: c.created_at,
		id: c.id,
		is_edited: c.is_edited,
		is_pinned: c.is_pinned,
		likes: 0,
		parent_id: c.parent_id,
		reply_count: 0,
		updated_at: c.updated_at,
		user_liked: false,
	};
}

/**
 * Modifie le contenu d'un commentaire. Seul l'auteur peut modifier son commentaire.
 */
export async function updateComment(commentId: string, content: string): Promise<Comment> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const trimmed = content.trim();
	if (trimmed.length === 0 || trimmed.length > 2000) {
		throw new Error("Le commentaire doit contenir entre 1 et 2000 caractères");
	}

	const userId = session.user.id;
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Vérifier que l'utilisateur est bien l'auteur
	const { data: existing, error: fetchError } = await client
		.from("article_comments")
		.select("id, author_id")
		.eq("id", commentId)
		.maybeSingle();

	if (fetchError || !existing) {
		throw new Error("Commentaire introuvable");
	}
	if (existing.author_id !== userId) {
		throw new Error("Non autorisé");
	}

	const { data: updated, error: updateError } = await client
		.from("article_comments")
		.update({
			content: trimmed,
			is_edited: true,
			updated_at: new Date().toISOString(),
		})
		.eq("id", commentId)
		.select(
			`id, content, is_edited, is_pinned, created_at, updated_at, parent_id,
       profiles:author_id ( id, username, full_name, avatar_url )`
		)
		.single();

	if (updateError || !updated) {
		console.error("updateComment error:", updateError);
		throw new Error("Impossible de modifier le commentaire");
	}

	// Compter les réponses actuelles
	const { count: replyCount } = await client
		.from("article_comments")
		.select("id", { count: "exact", head: true })
		.eq("parent_id", commentId);

	const c = updated as {
		id: string;
		content: string;
		is_edited: boolean;
		is_pinned: boolean;
		created_at: string;
		updated_at: string;
		parent_id: string | null;
		profiles: {
			id: string;
			username: string | null;
			full_name: string | null;
			avatar_url: string | null;
		} | null;
	};

	return {
		author: {
			avatar_url: c.profiles?.avatar_url ?? null,
			full_name: c.profiles?.full_name ?? null,
			id: c.profiles?.id ?? "",
			username: c.profiles?.username ?? null,
		},
		content: c.content,
		created_at: c.created_at,
		id: c.id,
		is_edited: c.is_edited,
		is_pinned: c.is_pinned,
		likes: 0,
		parent_id: c.parent_id,
		reply_count: replyCount || 0,
		updated_at: c.updated_at,
		user_liked: false,
	};
}

/**
 * Supprime un commentaire. L'auteur peut supprimer le sien ; les admins peuvent tout supprimer.
 * La suppression en cascade s'applique aux réponses (géré par la BDD).
 */
export async function deleteComment(commentId: string): Promise<void> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const userId = session.user.id;
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Récupérer le commentaire
	const { data: comment, error: fetchError } = await client
		.from("article_comments")
		.select("id, author_id")
		.eq("id", commentId)
		.maybeSingle();

	if (fetchError || !comment) {
		throw new Error("Commentaire introuvable");
	}

	// Vérifier si l'utilisateur est l'auteur ou un admin
	if (comment.author_id !== userId) {
		const { data: profile } = await client
			.from("profiles")
			.select("role")
			.eq("id", userId)
			.single();

		if (!profile || !isAdminRole(profile.role)) {
			throw new Error("Non autorisé");
		}
	}

	const { error: deleteError } = await client.from("article_comments").delete().eq("id", commentId);

	if (deleteError) {
		console.error("deleteComment error:", deleteError);
		throw new Error("Impossible de supprimer le commentaire");
	}
}

/**
 * Épingle ou désépingle un commentaire. Action réservée aux admins.
 */
export async function pinComment(commentId: string): Promise<{ is_pinned: boolean }> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const userId = session.user.id;
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Vérifier le rôle admin
	const { data: profile } = await client.from("profiles").select("role").eq("id", userId).single();

	if (!profile || !isAdminRole(profile.role)) {
		throw new Error("Non autorisé");
	}

	// Récupérer l'état actuel
	const { data: comment, error: fetchError } = await client
		.from("article_comments")
		.select("id, is_pinned")
		.eq("id", commentId)
		.maybeSingle();

	if (fetchError || !comment) {
		throw new Error("Commentaire introuvable");
	}

	const newPinnedState = !comment.is_pinned;

	const { error: updateError } = await client
		.from("article_comments")
		.update({
			is_pinned: newPinnedState,
			updated_at: new Date().toISOString(),
		})
		.eq("id", commentId);

	if (updateError) {
		console.error("pinComment error:", updateError);
		throw new Error("Impossible de modifier l'épinglage");
	}

	return { is_pinned: newPinnedState };
}

/**
 * Retourne le nombre total de commentaires (y compris réponses) pour un article.
 * Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts).
 */
export async function getCommentCount(articleId: string): Promise<number> {
	const pool = getPgPool();

	try {
		const { rows } = await pool.query<{ count: string }>(
			"SELECT COUNT(*) AS count FROM article_comments WHERE article_id = $1",
			[articleId]
		);

		return Number(rows[0]?.count ?? 0);
	} catch (error) {
		console.error("getCommentCount error:", error);
		return 0;
	}
}

/**
 * Version batch de getCommentCount — retourne une map articleId → nombre de commentaires.
 * Utilisé sur le fil d'actualité pour afficher les compteurs sur les cartes.
 * Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts).
 */
export async function getCommentCounts(articleIds: string[]): Promise<Record<string, number>> {
	if (articleIds.length === 0) {
		return {};
	}

	const result: Record<string, number> = {};
	for (const id of articleIds) {
		result[id] = 0;
	}

	const pool = getPgPool();

	try {
		const { rows } = await pool.query<{ article_id: string }>(
			"SELECT article_id FROM article_comments WHERE article_id = ANY($1)",
			[articleIds]
		);

		for (const row of rows) {
			result[row.article_id] = (result[row.article_id] || 0) + 1;
		}

		return result;
	} catch (error) {
		console.error("getCommentCounts error:", error);
		return {};
	}
}

/**
 * Ajoute ou retire un like sur un commentaire pour l'utilisateur connecté.
 */
export async function toggleCommentLike(
	commentId: string
): Promise<{ liked: boolean; count: number }> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const userId = session.user.id;
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const reactionArticleId = `comment:${commentId}`;

	const { data: existing } = await client
		.from("article_reactions")
		.select("id")
		.eq("article_id", reactionArticleId)
		.eq("user_id", userId)
		.eq("reaction_type", "comment_like")
		.maybeSingle();

	if (existing) {
		await client.from("article_reactions").delete().eq("id", existing.id);
	} else {
		await client.from("article_reactions").insert({
			article_id: reactionArticleId,
			reaction_type: "comment_like",
			user_id: userId,
		});
	}

	const { count } = await client
		.from("article_reactions")
		.select("id", { count: "exact", head: true })
		.eq("article_id", reactionArticleId)
		.eq("reaction_type", "comment_like");

	return { count: count || 0, liked: !existing };
}
