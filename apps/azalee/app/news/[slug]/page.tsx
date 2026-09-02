export const dynamic = "force-dynamic";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import {
	Calendar,
	ChevronLeft,
	Clock,
	Eye,
	Heart,
	MessageCircle,
	Share2,
	Tag,
	User,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticleSeries } from "@/app/actions/article-series";
import { getRelatedArticles } from "@/app/actions/articles";
import { getBookmarkStates } from "@/app/actions/bookmarks";
import { getCommentCount } from "@/app/actions/comments";
import { getAllReactionCounts } from "@/app/actions/reactions";
import { ArticleShareButton } from "@/components/dashboard/news/article-share-button";
import { LexicalRenderer } from "@/components/editor/lexical-renderer";
import { ArticleViewTracker } from "@/components/news/article-view-tracker";
import { BackToTopButton } from "@/components/news/BackToTopButton";
import { BookmarkButton } from "@/components/news/BookmarkButton";
import { CollapseSidebarOnMount } from "@/components/news/CollapseSidebarOnMount";
import { CommentSection } from "@/components/news/CommentSection";
import { MobileTableOfContents } from "@/components/news/MobileTableOfContents";
import { PushOptIn } from "@/components/news/PushOptIn";
import { ReactionBar } from "@/components/news/ReactionBar";
import { ReadingProgressBar } from "@/components/news/ReadingProgressBar";
import { ReadingProgressTracker } from "@/components/news/ReadingProgressTracker";
import { RelatedArticles } from "@/components/news/RelatedArticles";
import { SeriesNavigation } from "@/components/news/SeriesNavigation";
import { TableOfContents } from "@/components/news/TableOfContents";
import { Badge } from "@rosegriffon/ui";
import { isRemoteAvatar } from "@/lib/avatar";
import { getPgPool } from "@/lib/db/pg";
import { extractTableOfContents } from "@/lib/lexical-utils";

interface ArticlePageProps {
	params: Promise<{ slug: string }>;
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const CATEGORY_LABELS: Record<string, string> = {
	announcement: "Annonce",
	community: "Communauté",
	critique: "Critique",
	event: "Événement",
};

function estimateReadTime(content: string): number {
	try {
		const parsed =
			typeof content === "string" && content.startsWith("{") ? JSON.parse(content) : null;
		if (parsed?.root) {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const extractText = (node: any): string => {
				if (node.text) {
					return node.text;
				}
				if (node.children) {
					return node.children.map(extractText).join(" ");
				}
				return "";
			};
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const countImages = (node: any): number => {
				let count = 0;
				if (node.type === "image" || node.type === "inline-image" || node.src) {
					count = 1;
				}
				if (node.children) {
					for (const child of node.children) {
						count += countImages(child);
					}
				}
				return count;
			};
			const text = extractText(parsed.root);
			// 300 wpm = lecture rapide adulte habitue (lecteur regulier de presse/web).
			// Public CMS oriente lecture rapide — temps affiche resterait sinon trop dissuasif.
			const wordMinutes = Math.ceil(text.trim().split(/\s+/).length / 300);
			const imageCount = countImages(parsed.root);
			let imageSeconds = 0;
			for (let i = 0; i < imageCount; i++) {
				imageSeconds += Math.max(3, 12 - i);
			}
			return Math.max(1, wordMinutes + Math.ceil(imageSeconds / 60));
		}
	} catch {
		// Fallback
	}
	const stripped = typeof content === "string" ? content.replaceAll(/<[^>]+>/g, "") : "";
	return Math.max(1, Math.ceil(stripped.split(/\s+/).length / 300));
}

async function getNews(slug: string, isPreview = false) {
	const pool = getPgPool();

	const params: unknown[] = [slug, "azalee"];
	let sql = "SELECT * FROM articles WHERE slug = $1 AND app = $2";
	if (!isPreview) {
		params.push("published");
		sql += ` AND status = $${params.length}`;
	}
	sql += " LIMIT 1";

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let news: any;
	try {
		const { rows } = await pool.query(sql, params);
		news = rows[0];
	} catch (error) {
		console.error(`Error fetching article ${slug}:`, error);
		return null;
	}
	if (!news) {
		return null;
	}

	if (news.author_id) {
		try {
			const { rows: profileRows } = await pool.query(
				"SELECT full_name, avatar_url, bio, username FROM profiles WHERE id = $1 LIMIT 1",
				[news.author_id]
			);
			news.author = profileRows[0] || null;
		} catch (error) {
			console.error(`Error fetching author profile for article ${slug}:`, error);
			news.author = null;
		}
	} else {
		news.author = null;
	}

	// Enrichit chaque co_author qui a un profile_id : ajoute profile_username
	// (lien /profil/<username>) + privilegie le full_name/avatar_url du
	// Profile s'il existe (potentiellement plus a jour que le snapshot Discord).
	const co = news.co_authors;
	if (Array.isArray(co) && co.length > 0) {
		const profileIds = co
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			.map((c: any) => c?.profile_id)
			.filter((x: unknown): x is string => typeof x === "string");
		if (profileIds.length > 0) {
			try {
				const { rows: linked } = await pool.query(
					"SELECT id, username, full_name, avatar_url FROM profiles WHERE id = ANY($1)",
					[profileIds]
				);
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				const byId = new Map<string, any>(linked.map((p) => [p.id, p]));
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				news.co_authors = co.map((c: any) => {
					const p = c?.profile_id ? byId.get(c.profile_id) : null;
					return p
						? {
								...c,
								profile_username: p.username ?? null,
								name: p.full_name || c.name,
								// Snapshot Discord (c.avatar_url) prioritaire — il est fraichement
								// Fetched a la creation du brouillon. Le profile.avatar_url peut
								// Etre stale (Kaen a change son avatar Discord depuis l'OAuth).
								avatar_url: c.avatar_url || p.avatar_url,
							}
						: c;
				});
			} catch (error) {
				console.error(`Error fetching co-authors profiles for article ${slug}:`, error);
			}
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return news as any;
}

/**
 * Variante minimale pour `generateMetadata` — n'inclut pas `content`
 * (le JSON Lexical peut peser plusieurs centaines de Ko et n'est pas utilisé
 * pour produire les balises meta/OpenGraph).
 */
async function getNewsMeta(slug: string, isPreview = false) {
	const pool = getPgPool();

	const params: unknown[] = [slug, "azalee"];
	let sql =
		"SELECT id, slug, title, excerpt, meta_title, meta_description, featured_image_url, featured_image_alt, status, category, published_at, updated_at, created_at, author_id FROM articles WHERE slug = $1 AND app = $2";
	if (!isPreview) {
		params.push("published");
		sql += ` AND status = $${params.length}`;
	}
	sql += " LIMIT 1";

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let news: any;
	try {
		const { rows } = await pool.query(sql, params);
		news = rows[0];
	} catch (error) {
		console.error(`Error fetching article meta ${slug}:`, error);
		return null;
	}
	if (!news) {
		return null;
	}

	if (news.author_id) {
		try {
			const { rows: profileRows } = await pool.query(
				"SELECT full_name FROM profiles WHERE id = $1 LIMIT 1",
				[news.author_id]
			);
			news.author = profileRows[0] || null;
		} catch (error) {
			console.error(`Error fetching author meta for article ${slug}:`, error);
			news.author = null;
		}
	} else {
		news.author = null;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return news as any;
}

/**
 * Vérifie si l'utilisateur courant peut prévisualiser un article non publié
 * (admin, éditeur, modérateur, ou Médaille Azalée — même politique que le
 * dashboard layout).
 */
async function isCurrentUserAdmin(): Promise<boolean> {
	try {
		const { getServerSession, hasMedailleAzaleeRole } = await import("@/lib/auth-helpers");
		const { ADMIN_ROLES } = await import("@/lib/auth-roles");
		const session = await getServerSession();
		if (!session?.user) {
			return false;
		}

		const pool = getPgPool();
		const { rows: profileRows } = await pool.query<{ role: string | null; discord_id: string | null }>(
			"SELECT role, discord_id FROM profiles WHERE id = $1 LIMIT 1",
			[session.user.id]
		);
		const profile = profileRows[0];

		if (!profile) {
			return false;
		}
		if (ADMIN_ROLES.includes(profile.role as (typeof ADMIN_ROLES)[number])) {
			return true;
		}
		return await hasMedailleAzaleeRole(profile.discord_id);
	} catch {
		return false;
	}
}

export async function generateMetadata({ params, searchParams }: ArticlePageProps) {
	const { slug } = await params;
	const sp = await searchParams;
	const isPreview = sp.preview === "true";
	const canPreview = isPreview ? await isCurrentUserAdmin() : false;
	const news = await getNewsMeta(slug, canPreview);
	if (!news) {
		return { title: "Article introuvable - Azalee" };
	}

	const seoTitle = news.meta_title || news.title;
	const seoDescription =
		news.meta_description ||
		news.excerpt ||
		`${news.title} - Actualites Inazuma Eleven Victory Road`;
	const publishedDate = news.published_at || news.created_at;
	const modifiedDate = news.updated_at || publishedDate;
	const canonicalUrl = `https://azalee.rosegriffon.fr/news/${slug}`;

	return {
		alternates: { canonical: canonicalUrl },
		description: seoDescription,
		openGraph: {
			authors: news.author?.full_name ? [news.author.full_name] : undefined,
			description: seoDescription,
			images: news.featured_image_url
				? [
						{
							url: news.featured_image_url,
							width: 1200,
							height: 630,
							alt: news.title,
						},
					]
				: [],
			locale: "fr_FR",
			modifiedTime: modifiedDate,
			publishedTime: publishedDate,
			siteName: "Azalée - Rose Griffon",
			title: seoTitle,
			type: "article",
			url: canonicalUrl,
		},
		robots: { follow: true, index: news.status === "published" },
		title: `${seoTitle} - Azalee`,
		twitter: {
			card: news.featured_image_url ? "summary_large_image" : ("summary" as const),
			description: seoDescription,
			images: news.featured_image_url ? [news.featured_image_url] : undefined,
			title: seoTitle,
		},
	};
}

export default async function ArticlePage({ params, searchParams }: ArticlePageProps) {
	const { slug } = await params;
	const sp = await searchParams;
	const isPreview = sp.preview === "true";
	const canPreview = isPreview ? await isCurrentUserAdmin() : false;
	const news = await getNews(slug, canPreview);
	if (!news) {
		notFound();
	}

	const publishedDate = news.published_at || news.created_at || new Date().toISOString();
	const readTime = estimateReadTime(news.content || "");
	const categoryLabel = news.category ? CATEGORY_LABELS[news.category] || news.category : "Article";
	const authorName = news.author?.full_name || "Azalée";
	const canonicalUrl = `https://azalee.rosegriffon.fr/news/${slug}`;
	const tocItems = extractTableOfContents(news.content || "");

	const [relatedArticles, allReactions, bookmarkStates, commentCount, seriesData] =
		await Promise.all([
			getRelatedArticles(news.id, news.category, news.tags),
			getAllReactionCounts(news.id),
			getBookmarkStates([news.id]),
			getCommentCount(news.id),
			getArticleSeries(news.id),
		]);

	const isBookmarked = bookmarkStates[news.id] || false;
	const totalReactions = Object.values(allReactions).reduce((sum, r) => sum + r.count, 0);

	// Structured Data
	const articleJsonLd = {
		"@context": "https://schema.org",
		"@type": "Article",
		author: { "@type": "Person", name: authorName },
		dateModified: news.updated_at || publishedDate,
		datePublished: publishedDate,
		description: news.excerpt || news.meta_description || "",
		headline: news.title,
		image: news.featured_image_url || undefined,
		mainEntityOfPage: { "@id": canonicalUrl, "@type": "WebPage" },
		publisher: {
			"@type": "Organization",
			logo: {
				"@type": "ImageObject",
				url: "https://azalee.rosegriffon.fr/icon.webp",
			},
			name: "Azalée - Rose Griffon",
		},
	};

	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/news",
				name: "Actualités",
				position: 1,
			},
			{
				"@type": "ListItem",
				item: canonicalUrl,
				name: news.title,
				position: 2,
			},
		],
	};

	const faqItems = tocItems
		.filter((item) => item.text.endsWith("?"))
		.map((item) => ({
			"@type": "Question",
			acceptedAnswer: {
				"@type": "Answer",
				text: "Voir l'article pour la réponse complète.",
			},
			name: item.text,
		}));
	const faqJsonLd =
		faqItems.length > 0
			? {
					"@context": "https://schema.org",
					"@type": "FAQPage",
					mainEntity: faqItems,
				}
			: null;

	return (
		<>
			{/* Structured Data */}
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }}
			/>
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
			/>
			{faqJsonLd && (
				<script
					type="application/ld+json"
					dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
				/>
			)}

			{/* Bandeau de prévisualisation pour les articles non publiés */}
			{canPreview && news.status !== "published" && (
				<div className="sticky top-0 z-50 bg-amber-500 text-amber-950 px-4 py-2 text-center text-sm font-bold flex items-center justify-center gap-3">
					<Eye className="size-4" />
					Mode prévisualisation — cet article est en statut «{" "}
					{news.status === "draft"
						? "brouillon"
						: news.status === "scheduled"
							? "programmé"
							: news.status}{" "}
					»
					<Link
						href={`/dashboard/news/${news.id}`}
						className="ml-2 underline hover:no-underline font-bold"
					>
						Modifier
					</Link>
				</div>
			)}

			<CollapseSidebarOnMount />
			<ReadingProgressBar />

			<article className="min-h-screen bg-background" id="main-content">
				{/* ================================================================
            HERO — Mobile-first : image pleine largeur, contenu dessous
            Desktop : image en fond avec overlay
            ================================================================ */}
				<header className="relative">
					{/* Image hero */}
					<div className="relative w-full aspect-[4/3] sm:aspect-[16/9] md:aspect-[21/9] bg-surface-container overflow-hidden">
						<Image
							src={news.featured_image_url || "/fond.webp"}
							alt={news.featured_image_alt || news.title}
							fill
							className="object-cover"
							priority
							sizes="100vw"
							unoptimized={!news.featured_image_url}
						/>
						{/* Gradient overlay */}
						<div className="absolute inset-0 bg-linear-to-t from-background via-background/50 to-transparent" />

						{/* Back button — always visible on image */}
						<div className="absolute top-3 left-3 sm:top-6 sm:left-6 z-10">
							<Link
								href="/news"
								className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs sm:text-sm font-medium
                  bg-black/30 backdrop-blur-md text-white/90 hover:bg-black/50 transition-colors"
							>
								<ChevronLeft className="size-4" />
								<span className="hidden sm:inline">Actualités</span>
							</Link>
						</div>

						{/* Quick actions — top right on image */}
						<div className="absolute top-3 right-3 sm:top-6 sm:right-6 z-10 flex items-center gap-2">
							<div className="bg-black/30 backdrop-blur-md rounded-full">
								<ArticleShareButton
									articleId={news.id}
									title={news.title}
									description={news.excerpt || undefined}
									url={canonicalUrl}
									compact
								/>
							</div>
							<div className="bg-black/30 backdrop-blur-md rounded-full">
								<BookmarkButton articleId={news.id} initialBookmarked={isBookmarked} compact />
							</div>
						</div>
					</div>

					{/* Article header content — overlaps the image bottom on larger screens */}
					<div className="relative -mt-20 sm:-mt-28 md:-mt-36 px-4 sm:px-6 md:px-8 lg:px-12 max-w-[900px] mx-auto z-10">
						{/* Category + meta chips */}
						<div className="flex flex-wrap items-center gap-2 mb-3">
							<Badge className="bg-primary text-on-primary rounded-full border-none px-3 py-1 text-xs font-bold uppercase tracking-wider shadow-lg">
								{categoryLabel}
							</Badge>
						</div>

						{/* Title */}
						<h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-black font-sans tracking-tight leading-[1.15] text-on-surface mb-3 sm:mb-4">
							{news.title}
						</h1>

						{/* Excerpt */}
						{news.excerpt && (
							<p className="text-sm sm:text-base md:text-lg text-on-surface-variant/80 leading-relaxed mb-4 max-w-2xl">
								{news.excerpt}
							</p>
						)}

						{/* Author + Meta row */}
						<div className="flex flex-wrap items-center gap-3 sm:gap-4 text-xs sm:text-sm text-on-surface-variant">
							{/* Author */}
							{(news.author || (Array.isArray(news.co_authors) && news.co_authors.length > 0)) && (
								<div className="flex items-center gap-2">
									<div className="flex -space-x-2">
										{news.author && (
											<div className="size-8 sm:size-9 rounded-full bg-surface-container-high overflow-hidden relative shrink-0 ring-2 ring-background z-[4]">
												{news.author.avatar_url ? (
													<Image
														src={news.author.avatar_url}
														alt={authorName}
														fill
														className="object-cover"
														unoptimized={isRemoteAvatar(news.author.avatar_url)}
													/>
												) : (
													<div className="w-full h-full flex items-center justify-center">
														<User className="size-4 text-on-surface-variant/50" />
													</div>
												)}
											</div>
										)}
										{Array.isArray(news.co_authors) &&
											news.co_authors.slice(0, 3).map(
												(
													co: {
														name: string;
														avatar_url?: string;
														profile_id?: string;
													},
													i: number
												) => (
													<div
														key={`${co.name}-${i}`}
														title={co.name}
														className="size-8 sm:size-9 rounded-full bg-surface-container-high overflow-hidden relative shrink-0 ring-2 ring-background"
														style={{ zIndex: 3 - i }}
													>
														{co.avatar_url ? (
															<Image
																src={co.avatar_url}
																alt={co.name}
																fill
																className="object-cover"
																unoptimized={isRemoteAvatar(co.avatar_url)}
															/>
														) : (
															<div className="w-full h-full flex items-center justify-center">
																<User className="size-4 text-on-surface-variant/50" />
															</div>
														)}
													</div>
												)
											)}
									</div>
									<div className="flex flex-col">
										{news.author?.username ? (
											<Link
												href={`/profil/${news.author.username}`}
												className="font-semibold text-on-surface hover:text-primary transition-colors"
											>
												{authorName}
											</Link>
										) : (
											<span className="font-semibold text-on-surface">{authorName}</span>
										)}
										{Array.isArray(news.co_authors) && news.co_authors.length > 0 && (
											<span className="text-[10px] sm:text-xs text-on-surface-variant/70">
												avec {news.co_authors.map((c: { name: string }) => c.name).join(", ")}
											</span>
										)}
									</div>
								</div>
							)}

							<span className="text-on-surface-variant/30 hidden sm:inline">|</span>

							{/* Date */}
							<div className="flex items-center gap-1.5">
								<Calendar className="size-3.5 text-on-surface-variant/50" />
								<time dateTime={publishedDate}>
									{format(new Date(publishedDate), "d MMMM yyyy", {
										locale: fr,
									})}
								</time>
							</div>

							{/* Reading time */}
							<div className="flex items-center gap-1.5">
								<Clock className="size-3.5 text-on-surface-variant/50" />
								{readTime} min
							</div>

							{/* Stats — compact on mobile */}
							<div className="flex items-center gap-3 sm:gap-4 ml-auto sm:ml-0">
								<span className="flex items-center gap-1">
									<Eye className="size-3.5 text-on-surface-variant/50" />
									{news.view_count || 0}
								</span>
								<span className="flex items-center gap-1">
									<Heart className="size-3.5 text-on-surface-variant/50" />
									{totalReactions}
								</span>
								<span className="flex items-center gap-1">
									<MessageCircle className="size-3.5 text-on-surface-variant/50" />
									{commentCount}
								</span>
							</div>
						</div>
					</div>
				</header>

				{/* ================================================================
            CONTENT GRID — Mobile: single column / Desktop: content + sidebar
            ================================================================ */}
				<div className="grid lg:grid-cols-[1fr_280px] xl:grid-cols-[1fr_320px] gap-8 lg:gap-12 px-4 sm:px-6 md:px-8 lg:px-12 pt-6 sm:pt-8 pb-8 max-w-[1400px] mx-auto">
					{/* === MAIN CONTENT === */}
					<div className="min-w-0 space-y-8 max-w-[900px]">
						{/* Series nav (above content if in a series) */}
						{seriesData && (
							<SeriesNavigation
								series={seriesData.series}
								articles={seriesData.articles}
								currentIndex={seriesData.currentIndex}
							/>
						)}

						{/* Article body */}
						<div className="article-content">
							<LexicalRenderer
								content={news.content}
								className="prose prose-base sm:prose-lg dark:prose-invert max-w-none
                  font-medium leading-relaxed text-on-surface/90
                  prose-headings:font-sans prose-headings:font-bold prose-headings:tracking-tight prose-headings:text-on-surface
                  prose-p:mb-5 prose-p:text-on-surface-variant/90 prose-p:leading-[1.8]
                  prose-img:rounded-2xl prose-img:shadow-lg prose-img:border prose-img:border-outline-variant/10
                  prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:bg-surface-container-low
                    prose-blockquote:py-4 prose-blockquote:px-5 prose-blockquote:rounded-r-2xl prose-blockquote:not-italic
                    prose-blockquote:text-on-surface-variant
                  prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                  prose-code:bg-surface-container prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:text-sm
                  prose-pre:bg-surface-container-high prose-pre:rounded-2xl prose-pre:border prose-pre:border-outline-variant/10
                  prose-li:text-on-surface-variant/90
                  prose-strong:text-on-surface prose-strong:font-bold
                  prose-hr:border-outline-variant/20"
							/>
						</div>

						{/* Tags */}
						{news.tags && news.tags.length > 0 && (
							<div className="flex flex-wrap items-center gap-2 pt-4">
								<Tag className="size-4 text-on-surface-variant/40 shrink-0" />
								{news.tags.map((tag: string) => (
									<Link key={tag} href={`/news/tag/${encodeURIComponent(tag)}`}>
										<Badge
											variant="secondary"
											className="rounded-full text-xs bg-secondary-container text-on-secondary-container
                        hover:bg-secondary-container/80 transition-colors cursor-pointer px-3 py-1"
										>
											{tag}
										</Badge>
									</Link>
								))}
							</div>
						)}

						{/* ============ ENGAGEMENT SECTION ============ */}
						<div className="space-y-5 pt-6 border-t border-outline-variant/15">
							{/* Reaction bar */}
							<ReactionBar articleId={news.id} initialReactions={allReactions} />

							{/* Action buttons row */}
							<div className="flex items-center gap-2 flex-wrap">
								<ArticleShareButton
									articleId={news.id}
									title={news.title}
									description={news.excerpt || undefined}
									url={canonicalUrl}
									imageUrl={news.featured_image_url || undefined}
								/>
								<BookmarkButton articleId={news.id} initialBookmarked={isBookmarked} />
								<div className="ml-auto">
									<ArticleViewTracker articleId={news.id} initialViewCount={news.view_count || 0} />
								</div>
							</div>
						</div>

						{/* AUTHOR CARD retiree (2026-05-03) — la liste auteurs est desormais
						    exposee en HEADER de l'article (bloc "Author + Meta row"). */}

						{/* ============ COMMENTS ============ */}
						<CommentSection articleId={news.id} initialCommentCount={commentCount} />
					</div>

					{/* === SIDEBAR (desktop only) === */}
					<aside className="hidden lg:block">
						<div className="sticky top-20 space-y-5">
							{/* Table of contents */}
							{tocItems.length > 0 && <TableOfContents items={tocItems} />}

							{/* Article info card */}
							<div className="p-4 rounded-2xl bg-surface-container-low border border-outline-variant/10">
								<h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50 mb-3">
									Informations
								</h3>
								<div className="space-y-2.5 text-sm">
									<div className="flex items-center justify-between">
										<span className="text-on-surface-variant/60 flex items-center gap-1.5">
											<Calendar className="size-3.5" /> Date
										</span>
										<span className="text-on-surface text-xs font-medium">
											{format(new Date(publishedDate), "d MMM yyyy", {
												locale: fr,
											})}
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="text-on-surface-variant/60 flex items-center gap-1.5">
											<Clock className="size-3.5" /> Lecture
										</span>
										<span className="text-on-surface text-xs font-medium">~{readTime} min</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="text-on-surface-variant/60 flex items-center gap-1.5">
											<Eye className="size-3.5" /> Vues
										</span>
										<span className="text-on-surface text-xs font-medium">
											{news.view_count || 0}
										</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="text-on-surface-variant/60 flex items-center gap-1.5">
											<Heart className="size-3.5" /> Réactions
										</span>
										<span className="text-on-surface text-xs font-medium">{totalReactions}</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="text-on-surface-variant/60 flex items-center gap-1.5">
											<MessageCircle className="size-3.5" /> Commentaires
										</span>
										<span className="text-on-surface text-xs font-medium">{commentCount}</span>
									</div>
									<div className="flex items-center justify-between">
										<span className="text-on-surface-variant/60 flex items-center gap-1.5">
											<Share2 className="size-3.5" /> Partages
										</span>
										<span className="text-on-surface text-xs font-medium">
											{news.share_count || 0}
										</span>
									</div>
								</div>
							</div>

							{/* Tags */}
							{news.tags && news.tags.length > 0 && (
								<div className="p-4 rounded-2xl bg-surface-container-low border border-outline-variant/10">
									<div className="flex items-center gap-2 mb-3">
										<Tag className="size-3.5 text-on-surface-variant/50" />
										<h3 className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50">
											Tags
										</h3>
									</div>
									<div className="flex flex-wrap gap-1.5">
										{news.tags.map((tag: string) => (
											<Link key={tag} href={`/news/tag/${encodeURIComponent(tag)}`}>
												<Badge
													variant="secondary"
													className="rounded-full text-[10px] bg-secondary-container text-on-secondary-container
                            hover:bg-secondary-container/80 transition-colors cursor-pointer"
												>
													{tag}
												</Badge>
											</Link>
										))}
									</div>
								</div>
							)}

							{/* Push notification opt-in */}
							<PushOptIn />
						</div>
					</aside>
				</div>

				{/* ================================================================
            BOTTOM SECTION — Full width, related articles + CTA
            ================================================================ */}
				<div className="border-t border-outline-variant/10 bg-surface-container-lowest/50">
					<div className="px-4 sm:px-6 md:px-8 lg:px-12 py-8 sm:py-12 max-w-[1400px] mx-auto space-y-8">
						<RelatedArticles articles={relatedArticles} />

						{/* Mobile-only push opt-in */}
						<div className="flex justify-center lg:hidden">
							<PushOptIn />
						</div>
					</div>
				</div>
			</article>

			{/* Mobile Table of Contents FAB */}
			{tocItems.length > 0 && <MobileTableOfContents items={tocItems} />}

			<BackToTopButton />
			<ReadingProgressTracker articleId={news.id} />
		</>
	);
}
