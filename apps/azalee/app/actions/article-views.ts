"use server";

import { createAdminClient } from "@/lib/supabase/admin";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Incrémente le compteur de vues d'un article via le RPC dédié, mais en
 * passant par le service-role côté serveur — ce qui (a) garantit que le
 * compteur n'est appelable que sur des articles `app="azalee"` connus, et
 * (b) évite d'exposer le RPC directement au navigateur (rate-limit / abus).
 *
 * Le déduplication par sessionStorage côté client reste en place pour limiter
 * le double-comptage par bounce.
 */
export async function trackArticleView(articleId: string): Promise<{ success: boolean }> {
	if (!articleId || !UUID_RE.test(articleId)) {
		return { success: false };
	}

	const supabase = createAdminClient();
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const client = supabase as any;

	// On vérifie que l'article appartient bien à l'app "azalee" avant
	// D'incrémenter quoi que ce soit — un user qui devine un UUID rpb
	// Ou website ne peut pas booster un compteur étranger via cette route.
	const { data: row } = await client
		.from("articles")
		.select("id")
		.eq("id", articleId)
		.eq("app", "azalee")
		.maybeSingle();

	if (!row) {
		return { success: false };
	}

	const { error } = await client.rpc("increment_article_views", {
		article_id: articleId,
	});

	if (error) {
		console.error("trackArticleView rpc error:", error);
		return { success: false };
	}

	return { success: true };
}
