"use client";

import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowRight } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { FeedItem } from "@/app/news/news-client";
import { Badge } from "@rosegriffon/ui";

const CATEGORY_LABELS: Record<string, string> = {
	announcement: "Annonce",
	community: "Communauté",
	event: "Événement",
};

function FeaturedMain({ item }: { item: FeedItem }) {
	const date = new Date(item.date);
	const categoryLabel = CATEGORY_LABELS[item.category] || item.category;
	const [imgError, setImgError] = useState(false);

	return (
		<Link href={`/news/${item.slug}`} className="group block relative">
			<div className="relative w-full aspect-[21/9] md:aspect-[24/9] rounded-2xl overflow-hidden bg-surface-container">
				<Image
					src={imgError || !item.image ? "/images/placeholder-news.svg" : item.image}
					alt={item.title}
					fill
					className="object-cover transition-transform duration-700 group-hover:scale-105"
					sizes="(max-width: 768px) 100vw, 1200px"
					priority
					onError={() => setImgError(true)}
				/>
				<div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/30 to-transparent" />

				<div className="absolute bottom-0 left-0 w-full p-4 md:p-8">
					<div className="flex items-center gap-2 mb-3">
						<Badge className="bg-primary text-on-primary rounded-lg border-none px-2.5 py-0.5 text-[10px] md:text-xs font-bold uppercase tracking-wider">
							{categoryLabel}
						</Badge>
						<span className="text-white/70 text-xs">
							{formatDistanceToNow(date, { addSuffix: true, locale: fr })}
						</span>
					</div>
					<h2 className="text-2xl md:text-4xl lg:text-5xl font-black text-white leading-tight tracking-tight line-clamp-3 mb-2">
						{item.title}
					</h2>
					{item.excerpt && (
						<p className="text-sm md:text-base text-white/70 line-clamp-2 max-w-2xl">
							{item.excerpt}
						</p>
					)}
					<span className="inline-flex items-center gap-1.5 text-sm text-white/60 mt-3 group-hover:text-primary transition-colors">
						<span className="font-medium">Lire l&apos;article</span>
						<ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
					</span>
				</div>
			</div>
		</Link>
	);
}

function FeaturedSecondary({ item }: { item: FeedItem }) {
	const date = new Date(item.date);
	const categoryLabel = CATEGORY_LABELS[item.category] || item.category;
	const [imgError, setImgError] = useState(false);

	return (
		<Link href={`/news/${item.slug}`} className="group block relative">
			<div className="relative w-full aspect-video rounded-xl overflow-hidden bg-surface-container">
				<Image
					src={imgError || !item.image ? "/images/placeholder-news.svg" : item.image}
					alt={item.title}
					fill
					className="object-cover transition-transform duration-500 group-hover:scale-105"
					sizes="(max-width: 768px) 100vw, 600px"
					onError={() => setImgError(true)}
				/>
				<div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />

				<div className="absolute bottom-0 left-0 w-full p-3 md:p-4">
					<div className="flex items-center gap-2 mb-2">
						<Badge className="bg-primary text-on-primary rounded-md border-none px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider">
							{categoryLabel}
						</Badge>
						<span className="text-white/60 text-[10px]">
							{formatDistanceToNow(date, { addSuffix: true, locale: fr })}
						</span>
					</div>
					<h3 className="text-sm md:text-lg font-bold text-white leading-snug line-clamp-2 group-hover:text-primary/90 transition-colors">
						{item.title}
					</h3>
				</div>
			</div>
		</Link>
	);
}

export function FeaturedHero({ articles }: { articles: FeedItem[] }) {
	if (articles.length === 0) {
		return null;
	}

	const main = articles[0];
	const secondary = articles.slice(1, 3);

	return (
		<section className="space-y-3">
			<FeaturedMain item={main} />
			{secondary.length > 0 && (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-3">
					{secondary.map((item) => (
						<FeaturedSecondary key={item.id} item={item} />
					))}
				</div>
			)}
		</section>
	);
}
