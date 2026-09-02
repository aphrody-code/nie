import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Endpoint cron pour publier les articles programmés dont la date est passée.
 * Appeler via un cron externe : curl -X POST https://azalee.rosegriffon.fr/api/cron/publish-scheduled -H "Authorization: Bearer <CRON_SECRET>"
 */
export async function POST(request: NextRequest) {
	// Vérifier le secret d'authentification
	const authHeader = request.headers.get("authorization");
	const cronSecret = process.env.CRON_SECRET;

	if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
		return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
	}

	try {
		const supabase = createAdminClient();
		const now = new Date().toISOString();

		// Trouver les articles programmés dont la date est passée
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { data: articles, error: fetchError } = await (supabase as any)
			.from("articles")
			.select("id, title, slug, excerpt, featured_image_url")
			.eq("status", "scheduled")
			.eq("app", "azalee")
			.lte("scheduled_at", now);

		if (fetchError) {
			return NextResponse.json({ error: fetchError.message }, { status: 500 });
		}

		if (!articles || articles.length === 0) {
			return NextResponse.json({ published: 0 });
		}

		const ids = articles.map((a: { id: string }) => a.id);

		// Publier en masse — toujours scopé app=azalee.
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const { error: updateError } = await (supabase as any)
			.from("articles")
			.update({
				published_at: now,
				scheduled_at: null,
				status: "published",
			})
			.in("id", ids)
			.eq("app", "azalee");

		if (updateError) {
			return NextResponse.json({ error: updateError.message }, { status: 500 });
		}

		// Partager sur Discord si configuré
		const discordToken = process.env.DISCORD_BOT_TOKEN;
		const channelId = process.env.DISCORD_NEWS_CHANNEL_ID;

		if (discordToken && channelId) {
			for (const article of articles) {
				try {
					await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
						body: JSON.stringify({
							embeds: [
								{
									title: article.title,
									description: article.excerpt || "",
									url: `https://azalee.rosegriffon.fr/news/${article.slug}`,
									color: 0xf2a93b,
									image: article.featured_image_url
										? { url: article.featured_image_url }
										: undefined,
									footer: { text: "Azalée — Rose Griffon" },
								},
							],
						}),
						headers: {
							Authorization: `Bot ${discordToken}`,
							"Content-Type": "application/json",
						},
						method: "POST",
					});
				} catch {
					// Discord share failure is not critical
				}
			}
		}

		return NextResponse.json({
			articles: articles.map((a: { id: string; title: string }) => ({
				id: a.id,
				title: a.title,
			})),
			published: articles.length,
		});
	} catch (error) {
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "Erreur interne" },
			{ status: 500 }
		);
	}
}
