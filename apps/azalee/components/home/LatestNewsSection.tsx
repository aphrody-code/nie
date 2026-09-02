"use client";

import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowRight, AtSign, Newspaper } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { isRemoteAvatar } from "@/lib/avatar";
import { getAuthorInfo } from "@/lib/author";

interface Article {
	id: string;
	title: string;
	slug: string;
	excerpt: string;
	featured_image_url: string | null;
	featured_image_alt: string | null;
	published_at: string | null;
	created_at: string | null;
	category: string | null;
	author: {
		full_name: string | null;
		avatar_url: string | null;
	} | null;
}

interface Tweet {
	id: string;
	text: string;
	translation?: string | null;
	created_at: string;
	author_username: string;
	author_name: string;
	media: Array<{ url: string; preview_url?: string; video_url?: string; type?: string }>;
}

interface LatestNewsSectionProps {
	articles: Article[];
	tweets?: Tweet[];
}

const CATEGORY_LABELS: Record<string, string> = {
	announcement: "Annonce",
	community: "Communauté",
	critique: "Critique",
	event: "Événement",
};

function CategoryBadge({
	category,
	variant,
}: {
	category: string | null;
	variant: "overlay" | "card";
}) {
	const label = CATEGORY_LABELS[category || ""] || category || "News";
	return (
		<span
			className={`inline-flex items-center px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider shadow-sm border border-white/10 ${
				variant === "overlay"
					? "bg-white/15 backdrop-blur-md text-white"
					: "bg-surface/90 backdrop-blur-md text-on-surface"
			}`}
		>
			{label}
		</span>
	);
}

function AuthorInfo({
	author,
	publishedAt,
	variant,
}: {
	author: Article["author"];
	publishedAt: string | null;
	variant: "light" | "dark";
}) {
	const isLight = variant === "light";
	const avatarSize = isLight ? 20 : 24;
	const timeAgo = publishedAt
		? formatDistanceToNow(new Date(publishedAt), {
				addSuffix: true,
				locale: fr,
			})
		: null;

	return (
		<div className="flex items-center gap-2">
			{author?.avatar_url ? (
				<Image
					src={author.avatar_url}
					alt=""
					width={avatarSize}
					height={avatarSize}
					className={`rounded-full border ${isLight ? "border-white/20" : "border-surface"}`}
					unoptimized={isRemoteAvatar(author.avatar_url)}
				/>
			) : (
				<div
					className={`rounded-full flex items-center justify-center font-bold ${
						isLight
							? "size-5 bg-white/20 text-white text-[8px]"
							: "size-6 bg-primary/20 text-primary text-[10px]"
					}`}
				>
					RG
				</div>
			)}
			<span
				className={`text-xs font-medium ${isLight ? "text-white/70" : "text-on-surface-variant"}`}
			>
				{author?.full_name || "Rose Griffon"}
			</span>
			{timeAgo && (
				<>
					<span className={isLight ? "text-white/30" : "text-on-surface-variant/30 mx-1"}>·</span>
					<span className={`text-xs ${isLight ? "text-white/50" : "text-on-surface-variant/60"}`}>
						{timeAgo}
					</span>
				</>
			)}
		</div>
	);
}

function SectionHeader({ size }: { size: "sm" | "lg" }) {
	const isSm = size === "sm";
	return (
		<h2
			className={`font-black text-on-surface font-grade-high flex items-center ${isSm ? "text-xl gap-2.5" : "text-2xl md:text-3xl gap-3"}`}
		>
			<span
				className={`flex items-center justify-center rounded-full bg-primary/10 text-primary ${isSm ? "size-9" : "size-10"}`}
			>
				<Newspaper size={isSm ? 20 : 24} aria-hidden="true" />
			</span>
			Dernières actualités
		</h2>
	);
}

function MobileCarouselDots({ count, activeIndex }: { count: number; activeIndex: number }) {
	return (
		<div className="flex justify-center gap-1.5 mt-4">
			{Array.from({ length: count }, (_, i) => (
				<div
					key={i}
					className={`h-1.5 rounded-full transition-all duration-300 ${
						i === activeIndex ? "w-6 bg-primary" : "w-1.5 bg-on-surface/20"
					}`}
				/>
			))}
		</div>
	);
}

function TweetCard({ tweet, variant }: { tweet: Tweet; variant: "chip" | "full" }) {
	const timeAgo = formatDistanceToNow(new Date(tweet.created_at), {
		addSuffix: true,
		locale: fr,
	});
	const paragraphs = (tweet.translation || tweet.text || "").split(/\n\n+/).filter(Boolean);
	const title = paragraphs[0]?.trim() || "";
	const excerpt = paragraphs.slice(1, 3).join(" ").trim();
	const heroImage = tweet.media?.[0]?.preview_url || tweet.media?.[0]?.url;

	const authorInfo = getAuthorInfo(tweet.author_username, tweet.author_name);

	if (variant === "chip") {
		return (
			<Link
				href={`/news/tweet/${tweet.id}`}
				className="shrink-0 min-w-[220px] max-w-[220px] flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-surface-container border border-outline-variant/10 hover:border-[#1DA1F2]/30 transition-colors"
			>
				{heroImage ? (
					<div className="size-10 rounded-lg overflow-hidden relative bg-surface-container-high shrink-0">
						<Image src={heroImage} alt="" fill sizes="40px" className="object-cover" />
					</div>
				) : authorInfo.avatar ? (
					<div className="size-7 rounded-full overflow-hidden relative bg-surface-container-high shrink-0">
						<Image
							src={authorInfo.avatar}
							alt={authorInfo.name}
							fill
							sizes="28px"
							className="object-cover"
						/>
					</div>
				) : (
					<div
						className={`size-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 ${authorInfo.color}`}
					>
						{authorInfo.initials}
					</div>
				)}
				<div className="min-w-0">
					<p className="text-xs font-semibold text-on-surface leading-snug line-clamp-2">{title}</p>
					<span className="text-[10px] text-on-surface-variant/50 mt-1 block">{timeAgo}</span>
				</div>
			</Link>
		);
	}

	return (
		<Link
			href={`/news/tweet/${tweet.id}`}
			className="group flex flex-col bg-surface-container rounded-2xl overflow-hidden border border-outline-variant/10 hover:border-[#1DA1F2]/30 transition-all duration-300 hover:shadow-md hover:-translate-y-0.5"
		>
			{/* Cover image */}
			{heroImage ? (
				<div className="relative aspect-[16/9] bg-surface-container-high overflow-hidden">
					<Image
						src={heroImage}
						alt={title}
						fill
						className="object-cover transition-transform duration-500 group-hover:scale-105"
						sizes="33vw"
					/>
				</div>
			) : (
				<div className="relative aspect-[16/9] bg-linear-to-br from-[#1DA1F2]/10 via-surface-container to-primary/5 flex items-center justify-center">
					<svg className="size-10 text-[#1DA1F2]/20" viewBox="0 0 24 24" fill="currentColor">
						<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
					</svg>
				</div>
			)}

			{/* Content */}
			<div className="p-4 flex flex-col flex-1">
				<span className="inline-flex items-center gap-1 w-fit bg-[#1DA1F2]/10 text-[#1DA1F2] rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider mb-2">
					<svg className="size-3" viewBox="0 0 24 24" fill="currentColor">
						<path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
					</svg>
					Post
				</span>
				<h3 className="text-base font-bold text-on-surface leading-snug line-clamp-2 group-hover:text-[#1DA1F2] transition-colors mb-1">
					{title}
				</h3>
				{excerpt && (
					<p className="text-sm text-on-surface-variant/70 leading-relaxed line-clamp-2 mb-3 flex-1">
						{excerpt}
					</p>
				)}
				<div className="flex items-center justify-between mt-auto pt-2 border-t border-outline-variant/10">
					<div className="flex items-center gap-2">
						{authorInfo.avatar ? (
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
						)}
						<span className="text-[11px] text-on-surface-variant/70 font-semibold max-w-[100px] truncate">
							{authorInfo.name}
						</span>
						<span className="text-[11px] text-on-surface-variant/50">{timeAgo}</span>
					</div>
					<span className="inline-flex items-center gap-1 text-[11px] text-[#1DA1F2]/60 font-medium group-hover:text-[#1DA1F2] transition-colors">
						Lire
						<ArrowRight
							size={12}
							aria-hidden="true"
							className="transition-transform group-hover:translate-x-0.5"
						/>
					</span>
				</div>
			</div>
		</Link>
	);
}

export function LatestNewsSection({ articles, tweets = [] }: LatestNewsSectionProps) {
	const hasArticles = articles && articles.length > 0;
	const hasTweets = tweets && tweets.length > 0;
	const [activeSlide, setActiveSlide] = useState(0);
	const carouselRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const container = carouselRef.current;
		if (!container || !hasArticles) {
			return;
		}

		const cards = container.querySelectorAll("[data-slide]");
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					if (entry.isIntersecting) {
						const idx = Number((entry.target as HTMLElement).dataset.slide);
						if (!Number.isNaN(idx)) {
							setActiveSlide(idx);
						}
					}
				}
			},
			{ root: container, threshold: 0.6 }
		);

		cards.forEach((card) => observer.observe(card));
		return () => observer.disconnect();
	}, [hasArticles]);

	if (!hasArticles && !hasTweets) {
		return null;
	}

	return (
		<section className="relative">
			{/* ── Mobile Layout ── */}
			<div className="md:hidden">
				<div className="flex items-center justify-between mb-4 px-0">
					<SectionHeader size="sm" />
					<Link href="/news" className="text-xs font-bold text-primary">
						Voir tout
					</Link>
				</div>

				{hasArticles && (
					<>
						<div
							ref={carouselRef}
							className="flex overflow-x-auto snap-x snap-mandatory gap-3 -mx-4 px-4 scrollbar-hide"
							role="region"
							aria-label="Carrousel d'actualités"
							aria-roledescription="carousel"
						>
							{articles.map((item, i) => (
								<Link
									key={item.id}
									href={`/news/${item.slug}`}
									data-slide={i}
									className="group relative min-w-[82vw] max-w-[82vw] snap-start shrink-0 rounded-2xl overflow-hidden"
									role="group"
									aria-roledescription="slide"
									aria-label={`${i + 1} sur ${articles.length}`}
								>
									<div className="relative aspect-[16/10]">
										<Image
											src={item.featured_image_url || "/images/placeholder-news.svg"}
											alt={item.title}
											fill
											className="object-cover"
											sizes="82vw"
										/>
										<div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/30 to-transparent" />
										<div className="absolute top-3 left-3">
											<CategoryBadge category={item.category} variant="overlay" />
										</div>
										<div className="absolute bottom-0 left-0 right-0 p-4">
											<h3 className="text-base font-bold text-white leading-snug line-clamp-2 drop-shadow-lg">
												{item.title}
											</h3>
											<div className="mt-2">
												<AuthorInfo
													author={item.author}
													publishedAt={item.published_at}
													variant="light"
												/>
											</div>
										</div>
									</div>
								</Link>
							))}
						</div>
						<MobileCarouselDots count={articles.length} activeIndex={activeSlide} />
					</>
				)}

				{hasTweets && (
					<div className={hasArticles ? "mt-5" : ""}>
						<div className="flex items-center gap-1.5 mb-3 px-0">
							<AtSign size={14} aria-hidden="true" className="text-[#1DA1F2]" />
							<span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">
								@Azalee_IE
							</span>
						</div>
						<div className="flex overflow-x-auto gap-2.5 -mx-4 px-4 scrollbar-hide">
							{tweets.slice(0, 4).map((tweet) => (
								<TweetCard key={tweet.id} tweet={tweet} variant="chip" />
							))}
						</div>
					</div>
				)}

				<div className="mt-5 px-0">
					<Link
						href="/news"
						className="flex items-center justify-center w-full gap-2 text-sm font-bold text-primary px-5 py-4 rounded-xl bg-surface-container-high hover:bg-primary hover:text-on-primary transition-all"
					>
						Toutes les news
						<ArrowRight size={18} aria-hidden="true" />
					</Link>
				</div>
			</div>

			{/* ── Desktop Layout ── */}
			<div className="hidden md:block">
				<div className="bg-surface-container-low/50 border border-outline-variant/20 rounded-[40px] p-10 shadow-sm backdrop-blur-sm">
					<div className="flex items-center justify-between mb-8">
						<SectionHeader size="lg" />
						<Link
							href="/news"
							className="flex items-center gap-2 text-sm font-bold text-primary px-5 py-2.5 rounded-full bg-surface-container-high hover:bg-primary hover:text-on-primary transition-all duration-300"
						>
							Toutes les news
							<ArrowRight size={18} aria-hidden="true" />
						</Link>
					</div>

					{hasArticles && (
						<div className="grid grid-cols-2 lg:grid-cols-3 gap-6">
							{articles.map((item, i) => (
								<Link
									key={item.id}
									href={`/news/${item.slug}`}
									className={`group relative flex flex-col h-full bg-surface-container rounded-3xl overflow-hidden border border-outline-variant/10 hover:border-primary/30 transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${
										i === 0 ? "lg:col-span-2 lg:row-span-2" : ""
									}`}
								>
									<div
										className={`relative overflow-hidden ${i === 0 ? "aspect-[16/9] lg:aspect-[16/10] lg:flex-1" : "aspect-[16/9]"}`}
									>
										<Image
											src={item.featured_image_url || "/images/placeholder-news.svg"}
											alt={item.title}
											fill
											className="object-cover transition-transform duration-700 group-hover:scale-105"
											sizes={i === 0 ? "(max-width: 1024px) 50vw, 66vw" : "33vw"}
										/>
										<div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
										<div className="absolute top-3 left-3">
											<CategoryBadge category={item.category} variant="card" />
										</div>
									</div>
									<div className={`p-5 flex flex-col flex-1 ${i === 0 ? "lg:p-6" : ""}`}>
										<h3
											className={`font-bold text-on-surface leading-snug mb-3 group-hover:text-primary transition-colors line-clamp-2 ${i === 0 ? "text-xl lg:text-2xl" : "text-lg"}`}
										>
											{item.title}
										</h3>
										{item.excerpt && (
											<p
												className={`text-sm text-on-surface-variant mb-4 ${i === 0 ? "line-clamp-3" : "line-clamp-2"}`}
											>
												{item.excerpt}
											</p>
										)}
										<div className="mt-auto pt-4 border-t border-outline-variant/10">
											<AuthorInfo
												author={item.author}
												publishedAt={item.published_at}
												variant="dark"
											/>
										</div>
									</div>
								</Link>
							))}
						</div>
					)}

					{hasTweets && (
						<div className={hasArticles ? "mt-8 pt-8 border-t border-outline-variant/20" : ""}>
							{hasArticles && (
								<div className="flex items-center gap-2 mb-5">
									<AtSign size={18} aria-hidden="true" className="text-[#1DA1F2]" />
									<h3 className="text-sm font-bold text-on-surface-variant uppercase tracking-wider">
										Derniers tweets @Azalee_IE
									</h3>
								</div>
							)}
							<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
								{tweets.slice(0, hasArticles ? 3 : 6).map((tweet) => (
									<TweetCard key={tweet.id} tweet={tweet} variant="full" />
								))}
							</div>
						</div>
					)}
				</div>
			</div>
		</section>
	);
}
