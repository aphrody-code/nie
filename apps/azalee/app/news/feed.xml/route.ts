import { getPgPool } from "@/lib/db/pg";

const BASE_URL = "https://azalee.rosegriffon.fr";

function escapeXml(str: string): string {
	return str
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}

interface ArticleFeedRow {
	id: string;
	title: string;
	slug: string;
	excerpt: string | null;
	published_at: string | null;
	created_at: string | null;
	category: string | null;
	featured_image_url: string | null;
	author_id: string | null;
}

interface ProfileNameRow {
	id: string;
	full_name: string | null;
}

export async function GET() {
	let articles: ArticleFeedRow[] = [];
	try {
		const pool = getPgPool();
		const { rows } = await pool.query<ArticleFeedRow>(
			`SELECT id, title, slug, excerpt, published_at, created_at, category, featured_image_url, author_id
			 FROM articles
			 WHERE status = $1 AND app = $2
			 ORDER BY published_at DESC NULLS LAST, created_at DESC
			 LIMIT 50`,
			["published", "azalee"]
		);
		articles = rows;
	} catch (error) {
		console.error("Error fetching articles for feed.xml:", error);
	}

	// Récupérer les profils auteurs en bloc (pas de FK déclarée → join manuel).
	const authorIds = [
		...new Set(articles.map((a) => a.author_id).filter((id): id is string => Boolean(id))),
	];

	let authorMap = new Map<string, { full_name: string | null }>();
	if (authorIds.length > 0) {
		try {
			const pool = getPgPool();
			const { rows: profiles } = await pool.query<ProfileNameRow>(
				`SELECT id, full_name FROM profiles WHERE id = ANY($1::uuid[])`,
				[authorIds]
			);
			authorMap = new Map(profiles.map((p) => [p.id, { full_name: p.full_name }]));
		} catch (error) {
			console.error("Error fetching author profiles for feed.xml:", error);
		}
	}

	const items = articles
		.map((a) => {
			const dateSrc = a.published_at || a.created_at;
			const pubDate = dateSrc ? new Date(dateSrc).toUTCString() : "";
			const imageTag = a.featured_image_url
				? `<enclosure url="${escapeXml(a.featured_image_url)}" type="image/webp" length="0"/>`
				: "";
			const author = (a.author_id && authorMap.get(a.author_id)?.full_name) || "Azalée";

			return `    <item>
      <title>${escapeXml(a.title)}</title>
      <link>${BASE_URL}/news/${escapeXml(a.slug)}</link>
      <guid isPermaLink="true">${BASE_URL}/news/${escapeXml(a.slug)}</guid>
      <description>${escapeXml(a.excerpt || "")}</description>
      <pubDate>${pubDate}</pubDate>
      <dc:creator>${escapeXml(author)}</dc:creator>
      <category>${escapeXml(a.category || "")}</category>
      ${imageTag}
    </item>`;
		})
		.join("\n");

	const lastBuildDate = (() => {
		const first = articles[0];
		const src = first?.published_at || first?.created_at;
		return src ? new Date(src).toUTCString() : new Date().toUTCString();
	})();

	const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
  xmlns:atom="http://www.w3.org/2005/Atom"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
>
  <channel>
    <title>Azalée — Rose Griffon</title>
    <link>${BASE_URL}/news</link>
    <description>Actualités Inazuma Eleven: Victory Road</description>
    <language>fr</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${BASE_URL}/news/feed.xml" rel="self" type="application/rss+xml"/>
    <image>
      <url>${BASE_URL}/icon.webp</url>
      <title>Azalée</title>
      <link>${BASE_URL}</link>
    </image>
${items}
  </channel>
</rss>`;

	return new Response(rss, {
		headers: {
			"Cache-Control": "s-maxage=3600, stale-while-revalidate=600",
			"Content-Type": "application/rss+xml; charset=utf-8",
		},
	});
}
