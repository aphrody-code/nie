"use server";

import { revalidatePath } from "next/cache";
import { requireEditorOrFail } from "@/lib/auth-helpers";
import { getPgPool } from "@/lib/db/pg";
import { createClient } from "@/lib/supabase/server";

const APP_SCOPE = "azalee";

/** Invalide les caches liés aux articles (feed + page article + RSS) */
export async function revalidateNews(slug?: string) {
	revalidatePath("/news", "page");
	revalidatePath("/news/feed.xml", "page");
	if (slug) {
		revalidatePath(`/news/${slug}`, "page");
	}
}

/**
 * Sauvegarde un article (création ou mise à jour).
 * Utilise le admin client côté serveur pour bypasser le RLS.
 * Toujours scoppé `app="azalee"`.
 */
export async function saveArticle(
	articleId: string | null,
	data: Record<string, unknown>
): Promise<{ id: string; error?: string }> {
	let session;
	try {
		({ session } = await requireEditorOrFail());
	} catch (error) {
		return { id: articleId ?? "", error: (error as Error).message };
	}

	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();

	if (articleId) {
		// UPDATE — scope `app="azalee"` pour empêcher l'écriture cross-app
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { error } = await (supabase as any)
			.from("articles")
			.update({ ...data, app: APP_SCOPE })
			.eq("id", articleId)
			.eq("app", APP_SCOPE);

		if (error) {
			return { id: articleId, error: error.message };
		}

		revalidateNews(data.slug as string | undefined);
		if (data.status === "published") {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const { data: art } = await (supabase as any)
				.from("articles")
				.select("title, slug, excerpt, featured_image_url")
				.eq("id", articleId)
				.maybeSingle();
			if (art) {
				void triggerDiscordAnnouncement({ ...art, type: "wiki" });
			}
		}
		return { id: articleId };
	}

	// INSERT — l'auteur est l'éditeur courant
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: inserted, error } = await (supabase as any)
		.from("articles")
		.insert([{ ...data, app: APP_SCOPE, author_id: session.user.id }])
		.select("id")
		.maybeSingle();

	if (error) {
		return { id: "", error: error.message };
	}

	revalidateNews(data.slug as string | undefined);
	if (data.status === "published") {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data: art } = await (supabase as any)
			.from("articles")
			.select("title, slug, excerpt, featured_image_url")
			.eq("id", inserted?.id || "")
			.maybeSingle();
		if (art) {
			void triggerDiscordAnnouncement({ ...art, type: "wiki" });
		}
	}
	return { id: inserted?.id || "" };
}

/**
 * Change le statut d'un article (publish, archive, draft...).
 * Met à jour published_at si besoin.
 */
export async function updateArticleStatus(
	articleId: string,
	newStatus: string,
	currentStatus?: string
): Promise<{ error?: string }> {
	try {
		await requireEditorOrFail();
	} catch (error) {
		return { error: (error as Error).message };
	}

	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();

	const updateData: Record<string, unknown> = {
		status: newStatus,
		updated_at: new Date().toISOString(),
	};
	if (newStatus === "published" && currentStatus !== "published") {
		updateData.published_at = new Date().toISOString();
		updateData.scheduled_at = null;
	}
	if (newStatus === "draft" || newStatus === "archived") {
		updateData.scheduled_at = null;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error } = await (supabase as any)
		.from("articles")
		.update(updateData)
		.eq("id", articleId)
		.eq("app", APP_SCOPE);

	if (error) {
		return { error: error.message };
	}

	if (newStatus === "published" && currentStatus !== "published") {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data: art } = await (supabase as any)
			.from("articles")
			.select("title, slug, excerpt, featured_image_url")
			.eq("id", articleId)
			.maybeSingle();
		if (art) {
			void triggerDiscordAnnouncement({ ...art, type: "wiki" });
		}
	}

	revalidateNews();
	return {};
}

/**
 * Supprime un article.
 */
export async function deleteArticle(articleId: string): Promise<{ error?: string }> {
	try {
		await requireEditorOrFail();
	} catch (error) {
		return { error: (error as Error).message };
	}

	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error } = await (supabase as any)
		.from("articles")
		.delete()
		.eq("id", articleId)
		.eq("app", APP_SCOPE);

	if (error) {
		return { error: error.message };
	}
	revalidateNews();
	return {};
}

/**
 * Pin/unpin un article.
 */
export async function toggleArticlePin(
	articleId: string,
	pinned: boolean
): Promise<{ error?: string }> {
	try {
		await requireEditorOrFail();
	} catch (error) {
		return { error: (error as Error).message };
	}

	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error } = await (supabase as any)
		.from("articles")
		.update({ pinned: !pinned })
		.eq("id", articleId)
		.eq("app", APP_SCOPE);

	if (error) {
		return { error: error.message };
	}
	revalidateNews();
	return {};
}

/**
 * Vérifie si un slug d'article est disponible (scopé app=azalee).
 */
export async function checkSlugAvailability(
	slug: string,
	excludeId?: string
): Promise<{ available: boolean; suggestion?: string }> {
	const supabase = await createClient();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let query = (supabase as any)
		.from("articles")
		.select("id, slug")
		.eq("slug", slug)
		.eq("app", APP_SCOPE);

	if (excludeId) {
		query = query.neq("id", excludeId);
	}

	const { data, error } = await query;

	if (error) {
		console.error("Error checking slug:", error);
		return { available: true };
	}

	if (data && data.length > 0) {
		const suggestion = `${slug}-${Date.now().toString(36).slice(-4)}`;
		return { available: false, suggestion };
	}

	return { available: true };
}

/**
 * Partage un article sur Discord via webhook/bot.
 * Réservé aux éditeurs.
 */
export async function shareToDiscord(article: {
	title: string;
	slug: string;
	excerpt: string;
	featured_image_url: string;
}) {
	await requireEditorOrFail();

	const botToken = process.env.DISCORD_BOT_TOKEN;
	const channelId = process.env.DISCORD_NEWS_CHANNEL_ID;

	if (!botToken || !channelId) {
		throw new Error("Configuration Discord manquante");
	}

	const articleUrl = `https://azalee.rosegriffon.fr/news/${article.slug}`;

	const embed = {
		color: 0xf2a93b,
		description: article.excerpt || undefined,
		footer: { text: "Azalée — Rose Griffon" },
		image: article.featured_image_url ? { url: article.featured_image_url } : undefined,
		timestamp: new Date().toISOString(),
		title: article.title,
		url: articleUrl,
	};

	const response = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
		body: JSON.stringify({ embeds: [embed] }),
		headers: {
			Authorization: `Bot ${botToken}`,
			"Content-Type": "application/json",
		},
		method: "POST",
	});

	if (!response.ok) {
		const errorText = await response.text();
		console.error("Discord API error:", response.status, errorText);
		throw new Error(`Erreur Discord: ${response.status}`);
	}

	return { success: true };
}

/**
 * Duplique un article comme nouveau brouillon (scopé app=azalee).
 */
export async function duplicateArticle(
	articleId: string
): Promise<{ id: string } | { error: string }> {
	try {
		await requireEditorOrFail();
	} catch (error) {
		return { error: (error as Error).message };
	}

	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: original, error: fetchError } = await (supabase as any)
		.from("articles")
		.select("*")
		.eq("id", articleId)
		.eq("app", APP_SCOPE)
		.single();

	if (fetchError || !original) {
		return { error: "Article introuvable" };
	}

	const now = new Date().toISOString();
	const newSlug = `${original.slug}-copie-${Date.now().toString(36).slice(-4)}`;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data: inserted, error: insertError } = await (supabase as any)
		.from("articles")
		.insert([
			{
				app: APP_SCOPE,
				author_id: original.author_id,
				category: original.category,
				content: original.content,
				created_at: now,
				excerpt: original.excerpt,
				featured_image_alt: original.featured_image_alt,
				featured_image_url: original.featured_image_url,
				meta_description: original.meta_description,
				meta_title: original.meta_title,
				slug: newSlug,
				status: "draft",
				tags: original.tags,
				title: `${original.title} (copie)`,
				updated_at: now,
			},
		])
		.select("id")
		.single();

	if (insertError) {
		console.error("Error duplicating article:", insertError);
		return { error: insertError.message };
	}

	revalidateNews();
	return { id: inserted.id };
}

/**
 * Récupère les tags populaires (scope public).
 * Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts).
 * La RPC `get_popular_tags` n'existe PAS côté Postgres (vérifié via pg_proc) —
 * on reproduit directement en SQL la même agrégation que l'ancien fallback
 * client-side (tags non-null des articles publiés, comptés puis triés desc).
 */
export async function getPopularTags(limit = 30): Promise<Array<{ tag: string; count: number }>> {
	const pool = getPgPool();

	try {
		const { rows } = await pool.query<{ tag: string; count: string }>(
			`SELECT tag, COUNT(*) AS count
			 FROM articles, unnest(tags) AS tag
			 WHERE status = $1 AND app = $2 AND tags IS NOT NULL
			 GROUP BY tag
			 ORDER BY count DESC
			 LIMIT $3`,
			["published", APP_SCOPE, limit]
		);

		return rows.map((row) => ({ count: Number(row.count), tag: row.tag }));
	} catch (error) {
		console.error("Error fetching popular tags:", error);
		return [];
	}
}

/**
 * Récupère les articles tendance (score basé sur vues récentes pondérées par fraîcheur).
 */
export async function getTrendingArticles(limit = 5): Promise<
	Array<{
		id: string;
		title: string;
		slug: string;
		excerpt: string | null;
		featured_image_url: string | null;
		category: string | null;
		view_count: number;
		published_at: string | null;
		trending_score: number;
	}>
> {
	const pool = getPgPool();

	try {
		// `get_trending_articles(days_window, result_limit)` existe en tant que
		// fonction SQL Postgres (vérifié via pg_proc) — on l'appelle en direct au
		// lieu de la RPC PostgREST, comportement identique (même fonction).
		const { rows } = await pool.query<{
			id: string;
			title: string;
			slug: string;
			excerpt: string | null;
			featured_image_url: string | null;
			category: string | null;
			view_count: number;
			published_at: string | null;
			trending_score: number;
		}>("SELECT * FROM get_trending_articles($1, $2)", [14, limit]);

		return rows;
	} catch (error) {
		console.error("Error fetching trending articles:", error);
		return [];
	}
}

/**
 * Récupère les articles les plus populaires par nombre de vues.
 */
export async function getPopularArticles(limit = 5): Promise<
	Array<{
		id: string;
		title: string;
		slug: string;
		category: string | null;
		view_count: number;
	}>
> {
	const pool = getPgPool();

	try {
		const { rows } = await pool.query<{
			id: string;
			title: string;
			slug: string;
			category: string | null;
			view_count: number;
		}>(
			`SELECT id, title, slug, category, view_count
			 FROM articles
			 WHERE status = $1 AND app = $2
			 ORDER BY view_count DESC
			 LIMIT $3`,
			["published", APP_SCOPE, limit]
		);

		return rows;
	} catch (error) {
		console.error("Error fetching popular articles:", error);
		return [];
	}
}

/**
 * Récupère les articles liés par tags et catégorie.
 */
export async function getRelatedArticles(
	articleId: string,
	category: string | null,
	tags: string[] | null,
	limit = 4
): Promise<
	Array<{
		id: string;
		title: string;
		slug: string;
		excerpt: string | null;
		featured_image_url: string | null;
		published_at: string | null;
		category: string | null;
	}>
> {
	const pool = getPgPool();
	type RelatedArticleRow = {
		id: string;
		title: string;
		slug: string;
		excerpt: string | null;
		featured_image_url: string | null;
		published_at: string | null;
		category: string | null;
	};
	const results = new Map<string, RelatedArticleRow>();
	const SELECT_COLS = "id, title, slug, excerpt, featured_image_url, published_at, category";

	// 1. Par tags communs
	if (tags && tags.length > 0) {
		try {
			const { rows } = await pool.query<RelatedArticleRow>(
				`SELECT ${SELECT_COLS}
				 FROM articles
				 WHERE status = $1 AND app = $2 AND id <> $3 AND tags && $4
				 ORDER BY published_at DESC
				 LIMIT $5`,
				["published", APP_SCOPE, articleId, tags, limit]
			);
			for (const item of rows) {
				results.set(item.id, item);
			}
		} catch (error) {
			console.error("Error fetching related articles by tags:", error);
		}
	}

	// 2. Compléter par catégorie si pas assez
	if (results.size < limit && category) {
		try {
			const { rows } = await pool.query<RelatedArticleRow>(
				`SELECT ${SELECT_COLS}
				 FROM articles
				 WHERE status = $1 AND app = $2 AND category = $3 AND id <> $4
				 ORDER BY published_at DESC
				 LIMIT $5`,
				["published", APP_SCOPE, category, articleId, limit]
			);
			for (const item of rows) {
				if (results.size < limit) {
					results.set(item.id, item);
				}
			}
		} catch (error) {
			console.error("Error fetching related articles by category:", error);
		}
	}

	// 3. Compléter par articles récents si toujours pas assez.
	// On exclut les ids déjà retenus côté JS (comme l'ancien code), pas via un IN
	// dynamique, pour éviter d'injecter une liste arbitraire dans le SQL.
	if (results.size < limit) {
		const excludeIds = new Set([articleId, ...results.keys()]);
		try {
			const { rows } = await pool.query<RelatedArticleRow>(
				`SELECT ${SELECT_COLS}
				 FROM articles
				 WHERE status = $1 AND app = $2
				 ORDER BY published_at DESC
				 LIMIT $3`,
				["published", APP_SCOPE, limit + excludeIds.size]
			);
			for (const item of rows) {
				if (results.size >= limit) {
					break;
				}
				if (!excludeIds.has(item.id)) {
					results.set(item.id, item);
				}
			}
		} catch (error) {
			console.error("Error fetching related articles fallback:", error);
		}
	}

	return [...results.values()];
}

/**
 * Actions en masse sur les articles (scope app=azalee).
 */
export async function bulkUpdateArticles(
	ids: string[],
	updates: { status?: string; category?: string; pinned?: boolean }
): Promise<{ success: boolean; count: number; error?: string }> {
	if (ids.length === 0) {
		return { success: false, count: 0, error: "Aucun article sélectionné" };
	}

	try {
		await requireEditorOrFail();
	} catch (error) {
		return { success: false, count: 0, error: (error as Error).message };
	}

	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error } = await (supabase as any)
		.from("articles")
		.update({ ...updates, updated_at: new Date().toISOString() })
		.in("id", ids)
		.eq("app", APP_SCOPE);

	if (error) {
		console.error("Bulk update error:", error);
		return { count: 0, error: error.message, success: false };
	}

	revalidateNews();
	return { count: ids.length, success: true };
}

export async function bulkDeleteArticles(
	ids: string[]
): Promise<{ success: boolean; count: number; error?: string }> {
	if (ids.length === 0) {
		return { success: false, count: 0, error: "Aucun article sélectionné" };
	}

	try {
		await requireEditorOrFail();
	} catch (error) {
		return { success: false, count: 0, error: (error as Error).message };
	}

	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { error } = await (supabase as any)
		.from("articles")
		.delete()
		.in("id", ids)
		.eq("app", APP_SCOPE);

	if (error) {
		console.error("Bulk delete error:", error);
		return { count: 0, error: error.message, success: false };
	}

	revalidateNews();
	return { count: ids.length, success: true };
}

/**
 * Statistiques des articles (4 statuts couverts, total views via SUM SQL).
 */
export async function getArticleStats(): Promise<{
	totalArticles: number;
	totalPublished: number;
	totalDrafts: number;
	totalScheduled: number;
	totalArchived: number;
	totalViews: number;
	topArticles: Array<{
		id: string;
		title: string;
		slug: string;
		view_count: number;
	}>;
	recentArticles: Array<{
		id: string;
		title: string;
		slug: string;
		view_count: number;
		published_at: string;
	}>;
}> {
	const supabase = await createClient();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const [
		{ count: totalArticles },
		{ count: totalPublished },
		{ count: totalDrafts },
		{ count: totalScheduled },
		{ count: totalArchived },
		viewsAgg,
		{ data: topArticles },
		{ data: recentArticles },
	] = await Promise.all([
		client.from("articles").select("*", { count: "exact", head: true }).eq("app", APP_SCOPE),
		client
			.from("articles")
			.select("*", { count: "exact", head: true })
			.eq("status", "published")
			.eq("app", APP_SCOPE),
		client
			.from("articles")
			.select("*", { count: "exact", head: true })
			.eq("status", "draft")
			.eq("app", APP_SCOPE),
		client
			.from("articles")
			.select("*", { count: "exact", head: true })
			.eq("status", "scheduled")
			.eq("app", APP_SCOPE),
		client
			.from("articles")
			.select("*", { count: "exact", head: true })
			.eq("status", "archived")
			.eq("app", APP_SCOPE),
		// SUM via une lecture des seules colonnes utiles. PostgREST n'expose pas
		// D'agrégat SUM natif via supabase-js sans vue dédiée — on streame uniquement
		// View_count (4 octets/ligne) côté serveur.
		client.from("articles").select("view_count").eq("status", "published").eq("app", APP_SCOPE),
		client
			.from("articles")
			.select("id, title, slug, view_count")
			.eq("status", "published")
			.eq("app", APP_SCOPE)
			.order("view_count", { ascending: false })
			.limit(10),
		client
			.from("articles")
			.select("id, title, slug, view_count, published_at")
			.eq("status", "published")
			.eq("app", APP_SCOPE)
			.order("published_at", { ascending: false })
			.limit(10),
	]);

	const totalViews = ((viewsAgg.data as Array<{ view_count: number | null }>) || []).reduce(
		(sum, a) => sum + (a.view_count || 0),
		0
	);

	return {
		recentArticles: recentArticles || [],
		topArticles: topArticles || [],
		totalArchived: totalArchived || 0,
		totalArticles: totalArticles || 0,
		totalDrafts: totalDrafts || 0,
		totalPublished: totalPublished || 0,
		totalScheduled: totalScheduled || 0,
		totalViews,
	};
}

/**
 * Crée un snapshot de la version actuelle d'un article.
 */
export async function createArticleVersion(
	articleId: string
): Promise<{ success: boolean; versionNumber?: number; error?: string }> {
	try {
		await requireEditorOrFail();
	} catch (error) {
		return { success: false, error: (error as Error).message };
	}

	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	const { data: article, error: fetchErr } = await client
		.from("articles")
		.select(
			"title, content, excerpt, category, tags, status, featured_image_url, meta_title, meta_description, author_id"
		)
		.eq("id", articleId)
		.eq("app", APP_SCOPE)
		.single();

	if (fetchErr || !article) {
		return { error: "Article introuvable", success: false };
	}

	// Trouver le numéro de version suivant. `maybeSingle` évite le 406 quand
	// Aucun snapshot n'existe encore.
	const { data: lastVersion } = await client
		.from("article_versions")
		.select("version_number")
		.eq("article_id", articleId)
		.order("version_number", { ascending: false })
		.limit(1)
		.maybeSingle();

	const nextVersion = (lastVersion?.version_number || 0) + 1;

	const { error: insertErr } = await client.from("article_versions").insert({
		article_id: articleId,
		category: article.category,
		content:
			typeof article.content === "object" ? JSON.stringify(article.content) : article.content,
		created_by: article.author_id,
		excerpt: article.excerpt,
		featured_image_url: article.featured_image_url,
		meta_description: article.meta_description,
		meta_title: article.meta_title,
		status: article.status,
		tags: article.tags,
		title: article.title,
		version_number: nextVersion,
	});

	if (insertErr) {
		console.error("Version create error:", insertErr);
		return { error: insertErr.message, success: false };
	}

	return { success: true, versionNumber: nextVersion };
}

/**
 * Liste les versions d'un article (lecture publique côté admin).
 */
export async function getArticleVersions(articleId: string): Promise<
	Array<{
		id: string;
		version_number: number;
		title: string;
		status: string | null;
		created_at: string;
	}>
> {
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data } = await (supabase as any)
		.from("article_versions")
		.select("id, version_number, title, status, created_at")
		.eq("article_id", articleId)
		.order("version_number", { ascending: false });

	return data || [];
}

/**
 * Récupère le contenu d'une version spécifique.
 */
export async function getArticleVersion(versionId: string): Promise<{
	id: string;
	version_number: number;
	title: string;
	content: string;
	excerpt: string | null;
	category: string | null;
	tags: string[] | null;
	featured_image_url: string | null;
	meta_title: string | null;
	meta_description: string | null;
	created_at: string;
} | null> {
	const supabase = await createClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { data } = await (supabase as any)
		.from("article_versions")
		.select("*")
		.eq("id", versionId)
		.maybeSingle();

	return data || null;
}

/**
 * Restaure un article à une version spécifique.
 * Vérifie que la version appartient bien à l'article cible.
 */
export async function restoreArticleVersion(
	articleId: string,
	versionId: string
): Promise<{ success: boolean; error?: string }> {
	try {
		await requireEditorOrFail();
	} catch (error) {
		return { success: false, error: (error as Error).message };
	}

	const { createAdminClient } = await import("@/lib/supabase/admin");
	const supabase = createAdminClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// Snapshot de la version actuelle avant restauration
	await createArticleVersion(articleId);

	// Récupérer la version à restaurer en s'assurant qu'elle correspond bien à l'article
	const { data: version, error: fetchErr } = await client
		.from("article_versions")
		.select(
			"title, content, excerpt, category, tags, featured_image_url, meta_title, meta_description, article_id"
		)
		.eq("id", versionId)
		.eq("article_id", articleId)
		.maybeSingle();

	if (fetchErr || !version) {
		return { error: "Version introuvable pour cet article", success: false };
	}

	const { error: updateErr } = await client
		.from("articles")
		.update({
			category: version.category,
			content: version.content,
			excerpt: version.excerpt,
			featured_image_url: version.featured_image_url,
			meta_description: version.meta_description,
			meta_title: version.meta_title,
			tags: version.tags,
			title: version.title,
			updated_at: new Date().toISOString(),
		})
		.eq("id", articleId)
		.eq("app", APP_SCOPE);

	if (updateErr) {
		return { error: updateErr.message, success: false };
	}

	revalidateNews();
	return { success: true };
}

async function triggerDiscordAnnouncement(article: {
	title: string;
	slug: string;
	excerpt?: string | null;
	featured_image_url?: string | null;
	type: "wiki" | "website";
}) {
	const secret = process.env.DISCORD_ANNOUNCE_SECRET || "default-secret-key-12345";
	try {
		const res = await fetch("http://localhost:3006/announce", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${secret}`,
			},
			body: JSON.stringify({
				type: article.type,
				title: article.title,
				slug: article.slug,
				excerpt: article.excerpt || "",
				featured_image_url: article.featured_image_url || "",
			}),
		});
		if (!res.ok) {
			console.warn(`[Discord Announcement] Failed to announce: ${res.status} ${await res.text()}`);
		} else {
			console.log(`[Discord Announcement] Announcement triggered successfully for ${article.slug}`);
		}
	} catch (err) {
		console.warn("[Discord Announcement] Error triggering announcement:", err);
	}
}
