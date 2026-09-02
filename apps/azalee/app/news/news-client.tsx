"use client";

import { formatDistanceToNow } from "date-fns";
import { enUS, fr, ja } from "date-fns/locale";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArticleCard } from "@/components/news/ArticleCard";
import { CategoryChips } from "@/components/news/CategoryChips";
import { ContinueReading } from "@/components/news/ContinueReading";
import { FeaturedHero } from "@/components/news/FeaturedHero";
import { PopularArticles } from "@/components/news/PopularArticles";
import { TagCloud } from "@/components/news/TagCloud";
import { TrendingArticles } from "@/components/news/TrendingArticles";
import { useLanguage } from "@/components/providers/language-provider";
import {
	Button,
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@rosegriffon/ui";
import { SearchBar } from "@/components/ui/search-bar";
import { WikiPagination } from "@/components/wiki/WikiPagination";
import { ExternalLink, Newspaper, Twitter, X } from "@/lib/icons-config";
import { getAuthorInfo } from "@/lib/author";

export interface FeedItem {
	id: string;
	type: "article" | "tweet";
	title: string;
	slug: string;
	excerpt: string;
	date: string;
	image: string | null;
	category: string;
	author_id: string;
	author_name?: string | null;
	author_username?: string | null;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	media?: any[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	quotedTweets?: any[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	threadTweets?: any[];
}

const ITEMS_PER_PAGE = 12;

function TweetPost({ item }: { item: FeedItem }) {
	const { language } = useLanguage();
	const date = new Date(item.date);

	const cleanSlug = (s: string) => {
		if (s.startsWith("http")) {
			const parts = s.split("/").filter(Boolean);
			return parts.at(-1);
		}
		return s;
	};

	const safeSlug = cleanSlug(item.slug);
	const href = `/news/tweet/${safeSlug}`;

	const getDateLocale = () => {
		switch (language) {
			case "en": {
				return enUS;
			}
			case "ja": {
				return ja;
			}
			default: {
				return fr;
			}
		}
	};

	const locale = getDateLocale();

	// Extract title from first paragraph
	const paragraphs = (item.excerpt || "").split(/\n\n+/).filter(Boolean);
	const title = paragraphs[0]?.trim() || "";
	const excerpt = paragraphs.slice(1, 3).join(" ").trim();
	const heroImage = item.media?.[0]?.url || item.image;
	const isThread = Array.isArray(item.threadTweets) && item.threadTweets.length > 1;

	return (
		<Link href={href} className="group block">
			<article className="rounded-2xl overflow-hidden bg-surface-container-low border border-outline-variant/10 transition-all duration-300 hover:shadow-lg hover:shadow-[#1DA1F2]/5 hover:border-outline-variant/20">
				{/* Cover image */}
				{heroImage ? (
					<div className="relative aspect-[16/9] bg-surface-container overflow-hidden">
						<Image
							src={heroImage}
							alt={title}
							fill
							className="object-cover transition-transform duration-500 group-hover:scale-105"
							sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
						/>
					</div>
				) : (
					<div className="relative aspect-[16/9] bg-linear-to-br from-[#1DA1F2]/10 via-surface-container to-primary/5 flex items-center justify-center">
						<Twitter className="size-12 text-[#1DA1F2]/20 fill-[#1DA1F2]/20" />
					</div>
				)}

				{/* Content */}
				<div className="p-4 space-y-2">
					<div className="flex items-center gap-2">
						<span className="inline-flex items-center gap-1 bg-[#1DA1F2]/10 text-[#1DA1F2] rounded-md border-none px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
							<Twitter className="size-3 fill-current" />
							{isThread ? `Thread · ${item.threadTweets!.length}` : "Tweet"}
						</span>
					</div>

					<h3 className="text-base font-bold text-on-surface leading-snug line-clamp-2 group-hover:text-[#1DA1F2] transition-colors">
						{title}
					</h3>

					{excerpt && (
						<p className="text-sm text-on-surface-variant/70 leading-relaxed line-clamp-2">
							{excerpt}
						</p>
					)}

					<div className="flex items-center justify-between pt-1">
						<div className="flex items-center gap-2">
							{(() => {
								const authorInfo = getAuthorInfo(
									item.author_username || item.author_id,
									item.author_name
								);
								return authorInfo.avatar ? (
									<div className="size-5 rounded-full overflow-hidden relative bg-surface-container-high shrink-0">
										<Image
											src={authorInfo.avatar}
											alt={authorInfo.name}
											fill
											className="object-cover"
										/>
									</div>
								) : (
									<div
										className={`size-5 rounded-full flex items-center justify-center text-white text-[8px] font-bold shrink-0 ${authorInfo.color}`}
									>
										{authorInfo.initials}
									</div>
								);
							})()}
							<span className="text-xs text-on-surface-variant/70 font-semibold max-w-[120px] truncate">
								{(() => {
									const authorInfo = getAuthorInfo(
										item.author_username || item.author_id,
										item.author_name
									);
									return authorInfo.name;
								})()}
							</span>
							<span className="text-xs text-on-surface-variant/50 shrink-0">
								{formatDistanceToNow(date, { addSuffix: true, locale })}
							</span>
						</div>
						<span className="inline-flex items-center gap-1 text-xs text-[#1DA1F2]/70 font-medium group-hover:text-[#1DA1F2] transition-colors shrink-0">
							Lire
							<ExternalLink className="size-3 transition-transform group-hover:translate-x-0.5" />
						</span>
					</div>
				</div>
			</article>
		</Link>
	);
}

function EmptyState({ searchQuery, onReset }: { searchQuery?: string; onReset: () => void }) {
	const isSearch = Boolean(searchQuery?.trim());
	return (
		<Empty className="border-outline-variant/20 py-20">
			<EmptyHeader>
				<EmptyMedia variant="icon" className="size-14 rounded-2xl bg-surface-container-high">
					<Newspaper className="size-7 text-on-surface-variant/50" />
				</EmptyMedia>
				<EmptyTitle className="text-on-surface">
					{isSearch ? "Aucun résultat trouvé" : "Aucune actualité"}
				</EmptyTitle>
				<EmptyDescription>
					{isSearch ? (
						<>
							Aucun article ne correspond à{" "}
							<strong className="text-on-surface">«&nbsp;{searchQuery}&nbsp;»</strong>. Essayez
							d&apos;autres mots-clés ou parcourez les catégories.
						</>
					) : (
						"Revenez plus tard pour de nouvelles informations."
					)}
				</EmptyDescription>
			</EmptyHeader>
			{isSearch && (
				<EmptyContent>
					<Button variant="outline" onClick={onReset} className="rounded-full">
						<X />
						Effacer la recherche
					</Button>
				</EmptyContent>
			)}
		</Empty>
	);
}

export function NewsFeedClient({
	feedItems,
	totalItems,
	currentPage,
	categoryFilter,
	featuredArticles,
	searchQuery,
	popularTags,
	reactionCounts,
	popularArticles,
	trendingArticles,
	commentCounts,
	continueReadingArticles,
}: {
	feedItems: FeedItem[];
	totalItems: number;
	currentPage: number;
	categoryFilter: string | undefined;
	featuredArticles?: FeedItem[];
	searchQuery?: string;
	popularTags?: Array<{ tag: string; count: number }>;
	reactionCounts?: Record<string, { count: number; userReacted: boolean }>;
	popularArticles?: Array<{
		id: string;
		title: string;
		slug: string;
		category: string | null;
		view_count: number;
	}>;
	trendingArticles?: Array<{
		id: string;
		title: string;
		slug: string;
		category: string | null;
		view_count: number;
		trending_score: number;
	}>;
	commentCounts?: Record<string, number>;
	continueReadingArticles?: Array<{
		article_id: string;
		title: string;
		slug: string;
		featured_image_url: string | null;
		category: string | null;
		progress: number;
		last_read_at: string;
	}>;
}) {
	const router = useRouter();
	const featuredIds = new Set((featuredArticles || []).map((a) => a.id));
	const articles = feedItems.filter((item) => item.type === "article" && !featuredIds.has(item.id));
	const tweets = feedItems.filter((item) => item.type === "tweet");
	const isTweetFilter = categoryFilter === "Tweet";
	const isSearchActive = Boolean(searchQuery?.trim());
	const showFeatured =
		currentPage === 1 &&
		!categoryFilter &&
		!isSearchActive &&
		featuredArticles &&
		featuredArticles.length > 0;
	const totalArticleCount =
		feedItems.filter((item) => item.type === "article").length + (featuredArticles?.length || 0);
	const showSideSections = totalArticleCount >= 3 && currentPage === 1 && !isSearchActive;

	const handleSearch = (value: string) => {
		const trimmed = value.trim();
		if (trimmed) {
			router.push(`/news?q=${encodeURIComponent(trimmed)}`);
		} else {
			router.push("/news");
		}
	};

	return (
		<div className="w-full pb-20">
			{/* Header */}
			<div className="mb-6">
				<h1 className="text-2xl md:text-3xl font-black text-on-surface tracking-tight mb-4">
					Actualités
				</h1>
				<div className="mb-4">
					<SearchBar
						placeholder="Rechercher un article..."
						defaultValue={searchQuery}
						onSearch={handleSearch}
					/>
				</div>
				{isSearchActive ? (
					<div className="flex items-center gap-2 mb-2">
						<span className="text-sm text-on-surface-variant">
							Résultats pour &laquo; {searchQuery} &raquo;
						</span>
						<button
							onClick={() => router.push("/news")}
							className="inline-flex items-center gap-1 text-xs text-primary font-medium hover:underline"
						>
							<X className="size-3" />
							Effacer
						</button>
					</div>
				) : (
					<CategoryChips />
				)}
			</div>

			{/* Feed */}
			<div className="min-h-[50vh] space-y-6">
				{/* Featured Hero (page 1, no filter) */}
				{showFeatured && <FeaturedHero articles={featuredArticles} />}

				{/* Continue Reading (personalized) — only when enough content exists */}
				{showSideSections && continueReadingArticles && continueReadingArticles.length > 0 && (
					<ContinueReading articles={continueReadingArticles} />
				)}

				{/* Trending Articles — only when enough articles exist */}
				{showSideSections && trendingArticles && trendingArticles.length > 0 && (
					<TrendingArticles articles={trendingArticles} />
				)}

				{/* Popular Articles — only when enough articles exist */}
				{showSideSections && popularArticles && popularArticles.length > 0 && (
					<PopularArticles articles={popularArticles} />
				)}

				{/* Tag Cloud */}
				{popularTags && popularTags.length > 0 && currentPage === 1 && !isSearchActive && (
					<TagCloud tags={popularTags} />
				)}

				{/* ═══ ARTICLES SECTION ═══ */}
				{!isTweetFilter && articles.length > 0 && (
					<section>
						{/* Section header */}
						<div className="flex items-center gap-3 mb-4">
							<div className="flex items-center gap-2">
								<div className="size-8 rounded-lg bg-primary-container flex items-center justify-center">
									<Newspaper className="size-4 text-on-primary-container" />
								</div>
								<div>
									<h2 className="text-sm font-bold text-on-surface">Articles</h2>
									<p className="text-[10px] text-on-surface-variant">
										{articles.length} article{articles.length > 1 ? "s" : ""}
									</p>
								</div>
							</div>
							<div className="flex-1 h-px bg-outline-variant/20" />
						</div>

						{/* Articles grid */}
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
							{articles.map((item) => (
								<ArticleCard
									key={`article-${item.id}`}
									item={item}
									reactionData={reactionCounts?.[item.id]}
									commentCount={commentCounts?.[item.id] || 0}
								/>
							))}
						</div>
					</section>
				)}

				{/* ═══ TWEETS SECTION ═══ */}
				{(isTweetFilter ? feedItems : tweets).length > 0 && (
					<section>
						{/* Separator (only when both sections visible) */}
						{!isTweetFilter && articles.length > 0 && (
							<div className="my-8 flex items-center gap-4">
								<div className="flex-1 h-px bg-outline-variant/20" />
								<span className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-widest">
									Réseau social
								</span>
								<div className="flex-1 h-px bg-outline-variant/20" />
							</div>
						)}

						{/* Section header */}
						<div className="flex items-center gap-3 mb-4">
							<div className="flex items-center gap-2">
								<div className="size-8 rounded-lg bg-[#1DA1F2]/10 flex items-center justify-center">
									<Twitter className="size-4 text-[#1DA1F2]" />
								</div>
								<div>
									<h2 className="text-sm font-bold text-on-surface">Tweets</h2>
									<p className="text-[10px] text-on-surface-variant">
										{(isTweetFilter ? feedItems : tweets).length} tweet
										{(isTweetFilter ? feedItems : tweets).length > 1 ? "s" : ""}
									</p>
								</div>
							</div>
							<div className="flex-1 h-px bg-[#1DA1F2]/10" />
						</div>

						{/* Tweets grid */}
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
							{(isTweetFilter ? feedItems : tweets).map((item) => (
								<TweetPost key={`tweet-${item.id}`} item={item} />
							))}
						</div>
					</section>
				)}

				{/* Empty state */}
				{feedItems.length === 0 && !showFeatured && (
					<EmptyState searchQuery={searchQuery} onReset={() => router.push("/news")} />
				)}
			</div>

			{/* Pagination */}
			{totalItems > ITEMS_PER_PAGE && (
				<div className="px-4 py-6">
					<WikiPagination
						totalItems={totalItems}
						itemsPerPage={ITEMS_PER_PAGE}
						currentPage={currentPage}
					/>
				</div>
			)}
		</div>
	);
}
