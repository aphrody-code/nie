export const dynamic = "force-dynamic";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowLeft, Tag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { Badge, Button } from "@rosegriffon/ui";
import { WikiPagination } from "@/components/wiki/WikiPagination";
import { getPgPool } from "@/lib/db/pg";
import { parseSearchParams } from "@/lib/validations";

const ITEMS_PER_PAGE = 12;

interface TagPageProps {
	params: Promise<{ tag: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Le segment arrive DÉJÀ décodé : Next décode chaque paramètre de route dans
 * `getRouteMatcher` (`shared/lib/router/utils/route-matcher.js`). Le `decodeURIComponent`
 * qui traînait ici était un second décodage : `/news/tag/100%25` levait une `URIError`
 * sur `decodeURIComponent("100%")` et renvoyait une page d'erreur sans titre en HTTP 200.
 * Pour reconstruire une URL à partir du tag, c'est donc `encodeURIComponent` qu'il faut.
 */
export async function generateMetadata({ params }: TagPageProps) {
	const { tag } = await params;
	return {
		alternates: { canonical: `/news/tag/${encodeURIComponent(tag)}` },
		description: `Tous les articles avec le tag "${tag}" sur Azalée.`,
		title: `Articles tagués "${tag}" - Azalée`,
	};
}

export default async function TagPage({ params, searchParams }: TagPageProps) {
	const { tag } = await params;
	const { page: currentPage } = parseSearchParams(await searchParams);

	// Lecture Postgres DIRECTE (bypass le Data API PostgREST — cf. lib/db/pg.ts).
	const pool = getPgPool();

	// Count
	const { rows: countRows } = await pool.query<{ count: string }>(
		`SELECT count(*) AS count FROM articles WHERE status = $1 AND app = $2 AND tags @> $3`,
		["published", "azalee", [tag]]
	);

	const totalItems = countRows[0] ? Number(countRows[0].count) : 0;

	// Data
	const { rows: articles } = await pool.query(
		`SELECT id, title, slug, excerpt, published_at, featured_image_url, category, tags, author_id
		 FROM articles
		 WHERE status = $1 AND app = $2 AND tags @> $3
		 ORDER BY published_at DESC
		 LIMIT $4 OFFSET $5`,
		[
			"published",
			"azalee",
			[tag],
			ITEMS_PER_PAGE,
			(currentPage - 1) * ITEMS_PER_PAGE,
		]
	);

	return (
		<div className="space-y-8 pb-16">
			{/* Header */}
			<div className="bg-surface-container-low rounded-b-[32px] px-4 md:px-8 pt-12 lg:pt-20 pb-8">
				<Link href="/news">
					<Button variant="ghost" size="sm" className="rounded-full mb-4 text-on-surface-variant">
						<ArrowLeft className="mr-2 size-4" /> Retour aux actualités
					</Button>
				</Link>
				<div className="flex items-center gap-3">
					<div className="size-12 rounded-2xl bg-secondary-container flex items-center justify-center">
						<Tag className="size-5 text-on-secondary-container" />
					</div>
					<div>
						<h1 className="text-2xl md:text-3xl font-black font-sans tracking-tight text-on-surface">
							{tag}
						</h1>
						<p className="text-sm text-on-surface-variant">
							{totalItems} article{totalItems !== 1 ? "s" : ""}
						</p>
					</div>
				</div>
			</div>

			{/* Articles grid */}
			{articles && articles.length > 0 ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 px-4 md:px-8">
					{/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
					{(articles as any[]).map((article: any) => (
						<Link
							key={article.id}
							href={`/news/${article.slug}`}
							className="group rounded-2xl overflow-hidden bg-surface-container-lowest border border-outline-variant/20 hover:shadow-lg transition-all duration-300"
						>
							<div className="relative aspect-[16/9] bg-surface-container">
								<Image
									src={article.featured_image_url || "/images/placeholder-news.svg"}
									alt={article.title}
									fill
									className="object-cover group-hover:scale-105 transition-transform duration-500"
								/>
							</div>
							<div className="p-4 space-y-2">
								<div className="flex items-center gap-2">
									{article.category && (
										<Badge className="bg-primary/10 text-primary border-none text-[10px] rounded-lg">
											{article.category}
										</Badge>
									)}
									<span className="text-[10px] text-on-surface-variant">
										{article.published_at &&
											format(new Date(article.published_at), "d MMM yyyy", { locale: fr })}
									</span>
								</div>
								<h2 className="text-sm font-bold text-on-surface group-hover:text-primary transition-colors line-clamp-2">
									{article.title}
								</h2>
								{article.excerpt && (
									<p className="text-xs text-on-surface-variant line-clamp-2">{article.excerpt}</p>
								)}
								{/* Tags */}
								{article.tags && article.tags.length > 0 && (
									<div className="flex flex-wrap gap-1 pt-1">
										{article.tags.slice(0, 3).map((t: string) => (
											<span
												key={t}
												className="text-[10px] px-2 py-0.5 rounded-md bg-surface-container-high text-on-surface-variant"
											>
												{t}
											</span>
										))}
									</div>
								)}
							</div>
						</Link>
					))}
				</div>
			) : (
				<div className="text-center py-20 text-on-surface-variant">
					<p>Aucun article avec ce tag.</p>
				</div>
			)}

			<div className="px-4 md:px-8">
				<WikiPagination
					totalItems={totalItems}
					itemsPerPage={ITEMS_PER_PAGE}
					currentPage={currentPage}
				/>
			</div>
		</div>
	);
}
