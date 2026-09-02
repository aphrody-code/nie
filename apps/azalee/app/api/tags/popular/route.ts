import { NextResponse } from "next/server";

import { getPgPool } from "@/lib/db/pg";

// Top N tags les + utilisés sur articles publiés (app=azalee).
// Agrège côté JS (volume articles azalee modeste — ~1k rows max).
// Format consommé par components/news/AdvancedFilters.tsx :
//   Array<{ tag: string; count: number }>
export const revalidate = 600; // 10 min — pas critique de l'avoir frais

interface ArticleTagsRow {
	tags: string[] | null;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const limitRaw = Number.parseInt(searchParams.get("limit") || "15", 10);
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 15;

	let rows: ArticleTagsRow[];
	try {
		const pool = getPgPool();
		const result = await pool.query<ArticleTagsRow>(
			`SELECT tags FROM articles WHERE status = $1 AND app = $2 AND tags IS NOT NULL`,
			["published", "azalee"]
		);
		rows = result.rows;
	} catch {
		return NextResponse.json([], { status: 200 });
	}

	const counts = new Map<string, number>();
	for (const row of rows) {
		const { tags } = row;
		if (!Array.isArray(tags)) {
			continue;
		}
		for (const raw of tags) {
			const tag = typeof raw === "string" ? raw.trim() : "";
			if (!tag) {
				continue;
			}
			counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
	}

	const result = [...counts.entries()]
		.map(([tag, count]) => ({ count, tag }))
		.toSorted((a, b) => b.count - a.count)
		.slice(0, limit);

	return NextResponse.json(result);
}
