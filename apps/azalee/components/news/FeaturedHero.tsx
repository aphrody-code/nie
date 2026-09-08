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
	const [imageFailed, setImageFailed] = useState(false);

	return (
		<Link href={`/news/${item.slug}`} className="group relative block">
			<div className="relative aspect-[21/9] w-full overflow-hidden rounded-2xl bg-surface-container md:aspect-[24/9]">
				<Image
					src={imageFailed || !item.image ? "/images/placeholder-news.svg" : item.image}
					alt={item.title}
					fill
					className="object-cover transition-transform duration-700 group-hover:scale-105"
					sizes="(max-width: 768px) 100vw, 1200px"
					priority
					onError={() => setImageFailed(true)}
				/>
				<div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/30 to-transparent" />

				<div className="absolute bottom-0 left-0 w-full p-4 md:p-8">
					<div className="mb-3 flex items-center gap-2">
						<Badge className="rounded-lg border-none bg-primary px-2.5 py-0.5 font-bold text-[10px] text-on-primary uppercase tracking-wider md:text-xs">
							{categoryLabel}
						</Badge>
						<span className="text-white/70 text-xs">
							{formatDistanceToNow(date, { addSuffix: true, locale: fr })}
						</span>
					</div>
					<h2 className="mb-2 line-clamp-3 font-black text-2xl text-white leading-tight tracking-tight md:text-4xl lg:text-5xl">
						{item.title}
					</h2>
					{item.excerpt ? (
						<p className="line-clamp-2 max-w-2xl text-sm text-white/70 md:text-base">
							{item.excerpt}
						</p>
					) : null}
					<span className="mt-3 inline-flex items-center gap-1.5 text-sm text-white/60 transition-colors group-hover:text-primary">
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
	const [imageFailed, setImageFailed] = useState(false);

	return (
		<Link href={`/news/${item.slug}`} className="group relative block">
			<div className="relative aspect-video w-full overflow-hidden rounded-xl bg-surface-container">
				<Image
					src={imageFailed || !item.image ? "/images/placeholder-news.svg" : item.image}
					alt={item.title}
					fill
					className="object-cover transition-transform duration-500 group-hover:scale-105"
					sizes="(max-width: 768px) 100vw, 600px"
					onError={() => setImageFailed(true)}
				/>
				<div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />

				<div className="absolute bottom-0 left-0 w-full p-3 md:p-4">
					<div className="mb-2 flex items-center gap-2">
						<Badge className="rounded-md border-none bg-primary px-2 py-0.5 font-bold text-[9px] text-on-primary uppercase tracking-wider">
							{categoryLabel}
						</Badge>
						<span className="text-[10px] text-white/60">
							{formatDistanceToNow(date, { addSuffix: true, locale: fr })}
						</span>
					</div>
					<h3 className="line-clamp-2 font-bold text-sm text-white leading-snug transition-colors group-hover:text-primary/90 md:text-lg">
						{item.title}
					</h3>
				</div>
			</div>
		</Link>
	);
}

export function FeaturedHero({ articles }: { articles: FeedItem[] }) {
	if (articles.length === 0) return null;

	const main = articles[0];
	const secondary = articles.slice(1, 3);

	return (
		<section className="space-y-3">
			<FeaturedMain item={main} />
			{secondary.length > 0 ? (
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					{secondary.map((item) => (
						<FeaturedSecondary key={item.id} item={item} />
					))}
				</div>
			) : null}
		</section>
	);
}
