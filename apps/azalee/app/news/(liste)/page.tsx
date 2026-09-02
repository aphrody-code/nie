import { getPopularArticles, getPopularTags, getTrendingArticles } from "@/app/actions/articles";
import { getCommentCounts } from "@/app/actions/comments";
import { getReactionCounts } from "@/app/actions/reactions";
import { getContinueReading } from "@/app/actions/reading-history";
import { getPgPool } from "@/lib/db/pg";
import { sanitizeNewsSearchQuery } from "@/lib/news-search";
import { parseSearchParams } from "@/lib/validations";
import { NewsFeedClient } from "../news-client";
import type { FeedItem } from "../news-client";

export const dynamic = "force-dynamic";

export const metadata = {
	alternates: { canonical: "/news" },
	description: "Toutes les dernières actualités, traductions exclusives, interviews et analyses détaillées sur le jeu Inazuma Eleven: Victory Road par l'équipe Azalée.",
	title: "Actualités | Azalée",
};

const ITEMS_PER_PAGE = 12;

const VALID_CATEGORIES = new Set(["announcement", "event", "critique", "community", "Tweet"]);

export default async function NewsFeedPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const searchParamsValue = await searchParams;
	const { page: currentPage } = parseSearchParams(searchParamsValue);
	const rawCategory = searchParamsValue.category as string | undefined;
	const categoryFilter = rawCategory && VALID_CATEGORIES.has(rawCategory) ? rawCategory : undefined;
	const rawQuery = (searchParamsValue.q as string | undefined) || "";
	const searchQuery = sanitizeNewsSearchQuery(rawQuery);

	let featuredArticles: FeedItem[] = [];
	const featuredIds = new Set<string>();

	// Lecture `articles` + `tweets` Postgres DIRECTE (bypass le Data API PostgREST
	// — cf. lib/db/pg.ts).
	const pool = getPgPool();

	// Featured (page 1, no filter, no search) — on prend le plus récent par
	// `published_at` pour rester cohérent avec le tri du feed (cf. ci-dessous).
	if (currentPage === 1 && !categoryFilter && !searchQuery) {
		const { rows: featured } = await pool.query(
			`SELECT id, title, slug, excerpt, created_at, published_at, featured_image_url, category, author_id
			 FROM articles
			 WHERE status = $1 AND app = $2
			 ORDER BY published_at DESC NULLS LAST, created_at DESC
			 LIMIT 1`,
			["published", "azalee"]
		);

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const featuredArr = (featured as any[]) || [];
		if (featuredArr.length > 0) {
			featuredArticles = featuredArr.map((a) => ({
				author_id: a.author_id,
				category: a.category,
				date: a.published_at || a.created_at,
				excerpt: a.excerpt,
				id: a.id,
				image: a.featured_image_url,
				slug: a.slug,
				title: a.title,
				type: "article",
			}));
			featuredArr.forEach((f) => featuredIds.add(f.id));
		}
	}

	// Pagination DB-side : chaque source a sa propre pagination, on les
	// Affiche dans des sections distinctes côté client. Plus de merge JS
	// Approximatif sur des fenêtres tronquées.
	const isTweetOnly = categoryFilter === "Tweet";
	const includeArticles = !isTweetOnly;
	const includeTweets = !categoryFilter || isTweetOnly;
	// La recherche full-text ne s'applique qu'aux articles.
	const tweetsAllowed = includeTweets && !searchQuery;

	const articleRangeStart = (currentPage - 1) * ITEMS_PER_PAGE;

	// Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts).
	// On trie par `published_at desc nulls last` puis `created_at desc` qui
	// matche l'ordre attendu côté client (équivalent au double `.order()` PostgREST).
	const articlesPromise = includeArticles
		? (async () => {
				const conditions: string[] = ["status = $1", "app = $2"];
				const params: unknown[] = ["published", "azalee"];

				if (searchQuery) {
					params.push(searchQuery);
					conditions.push(`search_vector @@ to_tsquery('french', $${params.length})`);
				}
				if (categoryFilter && categoryFilter !== "Tweet") {
					params.push(categoryFilter);
					conditions.push(`category = $${params.length}`);
				}
				for (const id of featuredIds) {
					params.push(id);
					conditions.push(`id <> $${params.length}`);
				}

				params.push(ITEMS_PER_PAGE);
				const limitIdx = params.length;
				params.push(articleRangeStart);
				const offsetIdx = params.length;

				try {
					const { rows } = await pool.query(
						`SELECT id, title, slug, excerpt, created_at, published_at, featured_image_url, category, author_id,
							count(*) OVER() AS full_count
						 FROM articles
						 WHERE ${conditions.join(" AND ")}
						 ORDER BY published_at DESC NULLS LAST, created_at DESC
						 LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
						params
					);

					const total = rows[0] ? Number((rows[0] as { full_count: string }).full_count) : 0;
					const items: FeedItem[] = (rows as any[]).map(
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(a: any) => ({
							author_id: a.author_id,
							category: a.category,
							date: a.published_at || a.created_at,
							excerpt: a.excerpt,
							id: a.id,
							image: a.featured_image_url,
							slug: a.slug,
							title: a.title,
							type: "article",
						})
					);
					return { items, total };
				} catch (error) {
					console.error("Error fetching articles:", error);
					return { items: [] as FeedItem[], total: 0 };
				}
			})()
		: Promise.resolve({ items: [] as FeedItem[], total: 0 });

	const tweetsPromise = tweetsAllowed
		? (async () => {
				// Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts).
				try {
					const { rows } = await pool.query(
						`SELECT id, text, translation, created_at, author_username, author_name, media,
							quoted_tweets, raw_tweets, count(*) OVER() AS full_count
						 FROM tweets
						 WHERE author_username = $1
						 ORDER BY created_at DESC
						 LIMIT $2 OFFSET $3`,
						["Azalee_IE", ITEMS_PER_PAGE, articleRangeStart]
					);
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const data = rows as any[];
					const count = data[0] ? Number((data[0] as { full_count: string }).full_count) : 0;
					const items: FeedItem[] = data.map(
						// eslint-disable-next-line @typescript-eslint/no-explicit-any
						(t: any) => ({
							author_id: t.author_username,
							author_name: t.author_name,
							author_username: t.author_username,
							category: "Tweet",
							date: t.created_at,
							excerpt: t.translation || t.text,
							id: t.id,
							image:
								t.media && t.media.length > 0 ? t.media[0].preview_url || t.media[0].url : null,
							media: t.media || [],
							quotedTweets: t.quoted_tweets || [],
							slug: t.id,
							threadTweets: t.raw_tweets || [],
							title: "",
							type: "tweet",
						})
					);
					return { items, total: count };
				} catch (error) {
					console.error("Error fetching tweets:", error);
					return { items: [] as FeedItem[], total: 0 };
				}
			})()
		: Promise.resolve({ items: [] as FeedItem[], total: 0 });

	const [articlesRes, tweetsRes] = await Promise.all([articlesPromise, tweetsPromise]);

	const feedItems: FeedItem[] = [...articlesRes.items, ...tweetsRes.items];
	// Tri stable global pour l'affichage (chaque section sera ré-extraite côté client).
	feedItems.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

	// Le total pour la pagination correspond à la source dominante : si on filtre
	// "Tweet" → total tweets, sinon → total articles (les tweets sont une bande
	// Secondaire). Ça rend la pagination prévisible et cohérente avec le tri.
	const totalItems = isTweetOnly
		? tweetsRes.total
		: articlesRes.total + (tweetsAllowed ? tweetsRes.total : 0);

	const articleIds = [
		...feedItems.filter((i) => i.type === "article").map((i) => i.id),
		...featuredArticles.map((i) => i.id),
	];

	const [
		popularTags,
		reactionCounts,
		popularArticles,
		trendingArticles,
		commentCounts,
		continueReadingArticles,
	] = await Promise.all([
		currentPage === 1 && !searchQuery ? getPopularTags(20) : Promise.resolve([]),
		articleIds.length > 0 ? getReactionCounts(articleIds) : Promise.resolve({}),
		currentPage === 1 && !searchQuery ? getPopularArticles(5) : Promise.resolve([]),
		currentPage === 1 && !searchQuery ? getTrendingArticles(5) : Promise.resolve([]),
		articleIds.length > 0 ? getCommentCounts(articleIds) : Promise.resolve({}),
		currentPage === 1 && !searchQuery ? getContinueReading(4) : Promise.resolve([]),
	]);

	const collectionJsonLd = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		description: "Actualités, traductions exclusives, interviews et analyses sur Inazuma Eleven: Victory Road.",
		isPartOf: { "@type": "WebSite", name: "Azalée", url: "https://azalee.rosegriffon.fr" },
		mainEntity: {
			"@type": "ItemList",
			itemListElement: feedItems.slice(0, 10).map((item, i) => ({
				"@type": "ListItem",
				position: i + 1,
				url: item.type === "article"
					? `https://azalee.rosegriffon.fr/news/${item.slug}`
					: `https://azalee.rosegriffon.fr/news/tweet/${item.id}`,
				name: item.title || "Actualité",
			})),
			numberOfItems: totalItems,
		},
		name: "Actualités Inazuma Eleven: Victory Road - Azalée",
		numberOfItems: totalItems,
		url: "https://azalee.rosegriffon.fr/news",
	};

	return (
		<>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
			/>
			<NewsFeedClient
			feedItems={feedItems}
			totalItems={totalItems}
			currentPage={currentPage}
			categoryFilter={categoryFilter}
			featuredArticles={featuredArticles}
			searchQuery={rawQuery}
			popularTags={popularTags}
			reactionCounts={reactionCounts}
			popularArticles={popularArticles}
			trendingArticles={trendingArticles}
			commentCounts={commentCounts}
			continueReadingArticles={continueReadingArticles}
		/>
		</>
	);
}
