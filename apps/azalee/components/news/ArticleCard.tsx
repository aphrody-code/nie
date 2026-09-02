"use client";

import { format, formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { FeedItem } from "@/app/news/news-client";
import { LikeButton } from "@/components/news/LikeButton";
import { Badge, HoverCard, HoverCardContent, HoverCardTrigger } from "@rosegriffon/ui";
import { ArrowRight, MessageCircle } from "@/lib/icons-config";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
	announcement: "Annonce",
	community: "Communauté",
	critique: "Critique",
	event: "Événement",
};

const CATEGORY_TONE: Record<string, string> = {
	announcement: "bg-primary/10 text-primary",
	community: "bg-blue-500/10 text-blue-500",
	critique: "bg-rose-500/10 text-rose-600",
	event: "bg-tertiary-container/30 text-tertiary",
};

interface ArticleCardProps {
	item: FeedItem;
	reactionData?: { count: number; userReacted: boolean };
	commentCount?: number;
}

export function ArticleCard({ item, reactionData, commentCount }: ArticleCardProps) {
	const date = new Date(item.date);
	const categoryLabel = CATEGORY_LABELS[item.category] || item.category;
	const categoryTone = CATEGORY_TONE[item.category] || "bg-primary/10 text-primary";
	const [imgError, setImgError] = useState(false);
	const href = `/news/${item.slug}`;

	const card = (
		<Link href={href} className="group block">
			<article className="overflow-hidden rounded-2xl border border-outline-variant/10 bg-surface-container-low transition-all duration-300 hover:border-outline-variant/30 hover:shadow-lg hover:shadow-primary/5">
				{/* Cover image */}
				<div className="relative aspect-video overflow-hidden bg-surface-container">
					<Image
						src={imgError || !item.image ? "/images/placeholder-news.svg" : item.image}
						alt={item.title}
						fill
						className="object-cover transition-transform duration-500 group-hover:scale-105"
						sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
						onError={() => setImgError(true)}
					/>
					{/* Subtle bottom gradient for legibility hint on hover */}
					<div className="absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/30 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />
				</div>

				{/* Content */}
				<div className="flex flex-col gap-2 p-4">
					<div className="flex items-center gap-2">
						<Badge
							className={cn(
								"rounded-md border-none px-2 py-0.5 font-bold text-[10px] uppercase tracking-wider",
								categoryTone
							)}
						>
							{categoryLabel}
						</Badge>
					</div>

					<h3 className="line-clamp-2 font-bold text-base text-on-surface leading-snug transition-colors group-hover:text-primary">
						{item.title}
					</h3>

					{item.excerpt && (
						<p className="line-clamp-2 text-on-surface-variant/70 text-sm leading-relaxed">
							{item.excerpt}
						</p>
					)}

					<div className="flex items-center justify-between pt-1">
						<div className="flex items-center gap-2">
							<time
								dateTime={date.toISOString()}
								className="text-on-surface-variant/50 text-xs"
								title={format(date, "d MMMM yyyy 'à' HH:mm", { locale: fr })}
							>
								{formatDistanceToNow(date, { addSuffix: true, locale: fr })}
							</time>
							{reactionData && (
								<LikeButton
									articleId={item.id}
									initialCount={reactionData.count}
									initialLiked={reactionData.userReacted}
									compact
								/>
							)}
							{typeof commentCount === "number" && commentCount > 0 && (
								<span className="inline-flex items-center gap-1 text-on-surface-variant/50 text-xs">
									<MessageCircle className="size-3.5" />
									{commentCount}
								</span>
							)}
						</div>
						<span className="inline-flex items-center gap-1 font-medium text-primary/70 text-xs transition-colors group-hover:text-primary">
							Lire
							<ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
						</span>
					</div>
				</div>
			</article>
		</Link>
	);

	// Pas d'excerpt ou pas d'image → on n'enrichit pas le hover
	if (!item.excerpt) {
		return card;
	}

	return (
		<HoverCard openDelay={350} closeDelay={120}>
			<HoverCardTrigger asChild>{card}</HoverCardTrigger>
			<HoverCardContent
				align="start"
				side="top"
				sideOffset={8}
				className="hidden w-80 overflow-hidden rounded-2xl border-outline-variant/30 bg-surface-container-high p-0 shadow-2xl md:block"
			>
				{item.image && !imgError && (
					<div className="relative aspect-video">
						<Image src={item.image} alt="" fill className="object-cover" sizes="320px" />
						<div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent" />
						<Badge
							className={cn(
								"absolute top-3 left-3 rounded-md border-none px-2 py-0.5 font-bold text-[10px] uppercase tracking-wider",
								categoryTone
							)}
						>
							{categoryLabel}
						</Badge>
					</div>
				)}
				<div className="flex flex-col gap-2 p-4">
					<h4 className="font-bold text-on-surface text-sm leading-snug">{item.title}</h4>
					<p className="line-clamp-4 text-on-surface-variant text-xs leading-relaxed">
						{item.excerpt}
					</p>
					<div className="flex items-center justify-between border-outline-variant/20 border-t pt-2 text-on-surface-variant/70 text-xs">
						<span title={format(date, "PPPp", { locale: fr })}>
							{formatDistanceToNow(date, { addSuffix: true, locale: fr })}
						</span>
						<span className="inline-flex items-center gap-1 font-medium text-primary">
							Lire l&apos;article
							<ArrowRight className="size-3" />
						</span>
					</div>
				</div>
			</HoverCardContent>
		</HoverCard>
	);
}
