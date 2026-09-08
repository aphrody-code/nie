"use client";

import { FeaturedHero as SharedFeaturedHero, type FeaturedHeroArticle } from "@niers/inacord-ui";
import Image from "next/image";
import type { FeedItem } from "@/app/news/news-client";

export function FeaturedHero({ articles }: { articles: FeedItem[] }) {
	return (
		<SharedFeaturedHero
			articles={articles as FeaturedHeroArticle[]}
			placeholderImage="/images/placeholder-news.svg"
			renderImage={({ src, alt, className, sizes, priority, onError }) => (
				<Image src={src} alt={alt} fill className={className} sizes={sizes} priority={priority} onError={onError} />
			)}
		/>
	);
}
