"use server";

import { logAudit } from "@/lib/audit";
import { getServerSession, requireAdmin } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

export async function exportUserData(): Promise<{
	profiles: unknown;
	articles: unknown[];
	article_comments: unknown[];
	article_reactions: unknown[];
	article_bookmarks: unknown[];
	reading_history: unknown[];
	notifications: unknown[];
	push_subscriptions: unknown[];
	newsletter_subscriptions: unknown[];
	user_preferences: unknown;
} | null> {
	const session = await getServerSession();
	if (!session?.user) {
		return null;
	}

	const userId = session.user.id;
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const [
		{ data: profile },
		{ data: articles },
		{ data: comments },
		{ data: reactions },
		{ data: bookmarks },
		{ data: history },
		{ data: notifications },
		{ data: pushSubs },
		{ data: newsletter },
		{ data: preferences },
	] = await Promise.all([
		client.from("profiles").select("*").eq("id", userId).maybeSingle(),
		client
			.from("articles")
			.select("id, title, slug, status, category, created_at, published_at")
			.eq("author_id", userId),
		client
			.from("article_comments")
			.select("id, article_id, content, created_at")
			.eq("user_id", userId),
		client
			.from("article_reactions")
			.select("id, article_id, reaction_type, created_at")
			.eq("user_id", userId),
		client.from("article_bookmarks").select("id, article_id, created_at").eq("user_id", userId),
		client
			.from("reading_history")
			.select("id, article_id, last_read_at, read_count, progress")
			.eq("user_id", userId),
		client
			.from("notifications")
			.select("id, type, title, body, read, created_at")
			.eq("user_id", userId),
		client.from("push_subscriptions").select("id, endpoint, created_at").eq("user_id", userId),
		client
			.from("newsletter_subscriptions")
			.select("id, email, categories, frequency, is_active, created_at")
			.eq("user_id", userId)
			.maybeSingle(),
		client.from("user_preferences").select("*").eq("user_id", userId).maybeSingle(),
	]);

	return {
		article_bookmarks: bookmarks ?? [],
		article_comments: comments ?? [],
		article_reactions: reactions ?? [],
		articles: articles ?? [],
		newsletter_subscriptions: newsletter ?? null,
		notifications: notifications ?? [],
		profiles: profile ?? null,
		push_subscriptions: pushSubs ?? [],
		reading_history: history ?? [],
		user_preferences: preferences ?? null,
	};
}

export async function requestDataDeletion(): Promise<{
	success: boolean;
	message: string;
}> {
	const session = await getServerSession();
	if (!session?.user) {
		return { message: "Non authentifié.", success: false };
	}

	await logAudit(session.user.id, "gdpr_deletion_request", {
		email: session.user.email ?? null,
		requested_at: new Date().toISOString(),
	});

	return {
		message:
			"Votre demande de suppression a été enregistrée. Un administrateur traitera votre demande dans les meilleurs délais (30 jours maximum conformément au RGPD).",
		success: true,
	};
}

export async function deleteUserData(userId: string): Promise<{
	success: boolean;
	deletedEntities: Record<string, number>;
	error?: string;
}> {
	await requireAdmin();

	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const deletedEntities: Record<string, number> = {};

	// Supprimer dans l'ordre pour respecter les contraintes FK non-CASCADE
	const tables: Array<{ table: string; column: string }> = [
		{ column: "user_id", table: "reading_history" },
		{ column: "user_id", table: "article_reactions" },
		{ column: "user_id", table: "article_bookmarks" },
		{ column: "user_id", table: "article_comments" },
		{ column: "user_id", table: "notifications" },
		{ column: "user_id", table: "push_subscriptions" },
		{ column: "user_id", table: "newsletter_subscriptions" },
		{ column: "user_id", table: "user_preferences" },
	];

	for (const { table, column } of tables) {
		const { count, error } = await client.from(table).delete({ count: "exact" }).eq(column, userId);

		if (error) {
			console.error(`Delete error on ${table}:`, error);
		}

		deletedEntities[table] = count ?? 0;
	}

	// Anonymiser les articles plutôt que les supprimer (préservation du contenu éditorial)
	const { count: articlesCount } = await client
		.from("articles")
		.update({ author_id: null, updated_at: new Date().toISOString() }, { count: "exact" })
		.eq("author_id", userId);

	deletedEntities.articles_anonymized = articlesCount ?? 0;

	// Supprimer le profil
	const { error: profileError } = await client.from("profiles").delete().eq("id", userId);

	deletedEntities.profiles = profileError ? 0 : 1;

	// Supprimer l'utilisateur auth.users en dernier via l'API admin
	try {
		const { createSupabaseServiceClient } = await import("@rosegriffon/db/service");
		const adminClient = createSupabaseServiceClient();
		const { error: authError } = await adminClient.auth.admin.deleteUser(userId);

		if (authError) {
			console.error("Auth user delete error:", authError);
			deletedEntities.auth_users = 0;
		} else {
			deletedEntities.auth_users = 1;
		}
	} catch (error) {
		console.error("Admin client error:", error);
		deletedEntities.auth_users = 0;
	}

	return { deletedEntities, success: true };
}
