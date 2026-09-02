"use server";

import { getServerSession, requireAdmin } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export type ReportReason = "spam" | "harassment" | "inappropriate" | "misinformation" | "other";

export type ReportStatus = "pending" | "reviewed" | "resolved" | "dismissed";

export interface CommentReport {
	id: string;
	comment_id: string;
	reason: ReportReason;
	details: string | null;
	status: ReportStatus;
	created_at: string;
	reviewed_at: string | null;
	reviewed_by: string | null;
	comment: {
		id: string;
		content: string;
		article_id: string;
	} | null;
	reporter: {
		id: string;
		username: string | null;
		full_name: string | null;
		avatar_url: string | null;
	} | null;
	reported_user: {
		id: string;
		username: string | null;
		full_name: string | null;
		avatar_url: string | null;
	} | null;
}

/** Limite de signalements par utilisateur sur une fenêtre d'1 heure */
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Signale un commentaire. Nécessite d'être authentifié.
 * Applique une limite de 10 signalements par heure par utilisateur.
 */
export async function reportComment(
	commentId: string,
	reason: ReportReason,
	details?: string
): Promise<{ success: boolean }> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const userId = session.user.id;
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Vérification du rate limit
	const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
	const { count: recentCount } = await client
		.from("comment_reports")
		.select("id", { count: "exact", head: true })
		.eq("reporter_id", userId)
		.gte("created_at", windowStart);

	if ((recentCount || 0) >= RATE_LIMIT_MAX) {
		throw new Error("Limite de signalements atteinte. Veuillez réessayer dans une heure.");
	}

	// Vérifier que le commentaire existe
	const { data: comment, error: commentError } = await client
		.from("article_comments")
		.select("id")
		.eq("id", commentId)
		.maybeSingle();

	if (commentError || !comment) {
		throw new Error("Commentaire introuvable");
	}

	const { error: insertError } = await client.from("comment_reports").insert({
		comment_id: commentId,
		created_at: new Date().toISOString(),
		details: details?.trim() || null,
		reason,
		reporter_id: userId,
		status: "pending",
	});

	if (insertError) {
		console.error("reportComment error:", insertError);
		throw new Error("Impossible d'enregistrer le signalement");
	}

	return { success: true };
}

/**
 * Récupère les signalements (admin uniquement).
 * Peut être filtré par statut.
 */
export async function getReports(status?: ReportStatus): Promise<CommentReport[]> {
	await requireAdmin();

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	let query = client
		.from("comment_reports")
		.select(
			`id, comment_id, reason, details, status, created_at, reviewed_at, reviewed_by,
       article_comments:comment_id ( id, content, article_id ),
       reporter:reporter_id ( id, username, full_name, avatar_url )`
		)
		.order("created_at", { ascending: false });

	if (status) {
		query = query.eq("status", status);
	}

	const { data, error } = await query;

	if (error) {
		console.error("getReports error:", error);
		return [];
	}

	if (!data) {
		return [];
	}

	return (
		data as Array<{
			id: string;
			comment_id: string;
			reason: ReportReason;
			details: string | null;
			status: ReportStatus;
			created_at: string;
			reviewed_at: string | null;
			reviewed_by: string | null;
			article_comments: {
				id: string;
				content: string;
				article_id: string;
				author_id?: string;
			} | null;
			reporter: {
				id: string;
				username: string | null;
				full_name: string | null;
				avatar_url: string | null;
			} | null;
		}>
	).map((row) => ({
		id: row.id,
		comment_id: row.comment_id,
		reason: row.reason,
		details: row.details,
		status: row.status,
		created_at: row.created_at,
		reviewed_at: row.reviewed_at,
		reviewed_by: row.reviewed_by,
		comment: row.article_comments
			? {
					id: row.article_comments.id,
					content: row.article_comments.content,
					article_id: row.article_comments.article_id,
				}
			: null,
		reporter: row.reporter,
		reported_user: null,
	}));
}

/**
 * Met à jour le statut d'un signalement (admin uniquement).
 * Enregistre l'admin qui a traité le signalement.
 */
export async function resolveReport(
	reportId: string,
	status: "reviewed" | "resolved" | "dismissed"
): Promise<{ success: boolean }> {
	const { session } = await requireAdmin();

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { error } = await client
		.from("comment_reports")
		.update({
			reviewed_at: new Date().toISOString(),
			reviewed_by: session.user.id,
			status,
		})
		.eq("id", reportId);

	if (error) {
		console.error("resolveReport error:", error);
		throw new Error("Impossible de mettre à jour le signalement");
	}

	return { success: true };
}

/**
 * Vérifie si l'utilisateur connecté a déjà signalé un commentaire donné.
 * Retourne false si non authentifié.
 */
export async function hasUserReported(commentId: string): Promise<boolean> {
	const session = await getServerSession();
	if (!session?.user) {
		return false;
	}

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { data } = await client
		.from("comment_reports")
		.select("id")
		.eq("comment_id", commentId)
		.eq("reporter_id", session.user.id)
		.maybeSingle();

	return data !== null;
}
