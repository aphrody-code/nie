import { NextResponse } from "next/server";
import { sanitizeNewsSearchQuery } from "@/lib/news-search";
import { getPgPool } from "@/lib/db/pg";

const VALID_CATEGORIES = new Set(["announcement", "event", "critique", "community"]);

interface ArticleFeedRow {
	id: string;
	title: string;
	slug: string;
	excerpt: string | null;
	created_at: string | null;
	published_at: string | null;
	featured_image_url: string | null;
	category: string | null;
	author_id: string | null;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const page = Math.max(1, Number.parseInt(searchParams.get("page") || "1", 10) || 1);
	const limit = 12;
	const rawCategory = searchParams.get("category");
	const category = rawCategory && VALID_CATEGORIES.has(rawCategory) ? rawCategory : null;
	const q = sanitizeNewsSearchQuery(searchParams.get("q"));

	const from = (page - 1) * limit;

	const conditions: string[] = ["status = $1", "app = $2"];
	const params: unknown[] = ["published", "azalee"];

	if (category) {
		params.push(category);
		conditions.push(`category = $${params.length}`);
	}
	if (q) {
		params.push(q);
		conditions.push(`search_vector @@ to_tsquery('french', $${params.length})`);
	}

	params.push(limit);
	const limitIdx = params.length;
	params.push(from);
	const offsetIdx = params.length;

	try {
		const pool = getPgPool();
		const { rows } = await pool.query<ArticleFeedRow>(
			`SELECT id, title, slug, excerpt, created_at, published_at, featured_image_url, category, author_id
			 FROM articles
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY published_at DESC NULLS LAST, created_at DESC
			 LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
			params
		);

		const items = rows.map((a) => ({
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

		return NextResponse.json({ hasMore: items.length === limit, items });
	} catch (error) {
		const message = error instanceof Error ? error.message : "Unknown error";
		return NextResponse.json({ error: message }, { status: 500 });
	}
}
