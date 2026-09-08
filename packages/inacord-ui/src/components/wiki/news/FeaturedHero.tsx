"use client";

import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import { ArrowRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "../../../compat/next";
import { cn } from "../../../lib/utils";
import { Badge } from "../../ui/badge";

const CATEGORY_LABELS: Record<string, string> = {
	announcement: "Annonce",
	community: "Communauté",
	event: "Événement",
};

export interface FeaturedHeroArticle {
	id: string;
	title: string;
	slug: string;
	category: string;
	date: string;
	excerpt?: string | null;
	image?: string | null;
}

export interface FeaturedHeroImage {
	src: string;
	alt: string;
	className: string;
	sizes: string;
	priority?: boolean;
	onError: () => void;
}

export interface FeaturedHeroProps {
	articles: FeaturedHeroArticle[];
	renderImage: (image: FeaturedHeroImage) => ReactNode;
	placeholderImage: string;
	articleHref?: (article: FeaturedHeroArticle) => string;
}

interface FeaturedTileProps {
	article: FeaturedHeroArticle;
	variant: "main" | "secondary";
	className: string;
	contentClassName: string;
	imageClassName: string;
	sizes: string;
	priority?: boolean;
	showExcerpt?: boolean;
	showReadMore?: boolean;
	renderImage: FeaturedHeroProps["renderImage"];
	placeholderImage: string;
	articleHref: NonNullable<FeaturedHeroProps["articleHref"]>;
}

function FeaturedTile({ article, variant, className, contentClassName, imageClassName, sizes, priority, showExcerpt, showReadMore, renderImage, placeholderImage, articleHref }: FeaturedTileProps) {
	const [imageFailed, setImageFailed] = useState(false);
	const categoryLabel = CATEGORY_LABELS[article.category] || article.category;
	const image = imageFailed || !article.image ? placeholderImage : article.image;

	return (
		<Link href={articleHref(article)} className="group relative block">
			<div className={cn("relative w-full overflow-hidden bg-surface-container", className)}>
				{renderImage({ src: image, alt: article.title, className: imageClassName, sizes, priority, onError: () => setImageFailed(true) })}
				<div className={cn("absolute inset-0 bg-linear-to-t from-black/80 to-transparent", variant === "main" ? "via-black/30" : "via-black/20")} />
				<div className={contentClassName}>
					<div className={cn("flex items-center gap-2", variant === "main" ? "mb-3" : "mb-2")}>
						<Badge className={cn("border-none bg-primary font-bold text-on-primary uppercase tracking-wider", variant === "main" ? "rounded-lg px-2.5 py-0.5 text-[10px] md:text-xs" : "rounded-md px-2 py-0.5 text-[9px]")}>{categoryLabel}</Badge>
						<span className={variant === "main" ? "text-xs text-white/70" : "text-[10px] text-white/60"}>{formatDistanceToNow(new Date(article.date), { addSuffix: true, locale: fr })}</span>
					</div>
					{showReadMore ? <h2 className="mb-2 line-clamp-3 font-black text-2xl text-white leading-tight tracking-tight md:text-4xl lg:text-5xl">{article.title}</h2> : <h3 className="line-clamp-2 font-bold text-sm text-white leading-snug transition-colors group-hover:text-primary/90 md:text-lg">{article.title}</h3>}
					{showExcerpt && article.excerpt ? <p className="line-clamp-2 max-w-2xl text-sm text-white/70 md:text-base">{article.excerpt}</p> : null}
					{showReadMore ? <span className="mt-3 inline-flex items-center gap-1.5 text-sm text-white/60 transition-colors group-hover:text-primary"><span className="font-medium">Lire l&apos;article</span><ArrowRight className="size-4 transition-transform group-hover:translate-x-1" /></span> : null}
				</div>
			</div>
		</Link>
	);
}

/** Shared featured-news layout. Hosts supply image rendering and route policy. */
export function FeaturedHero({ articles, renderImage, placeholderImage, articleHref = (article) => `/news/${article.slug}` }: FeaturedHeroProps) {
	if (articles.length === 0) return null;
	const [main, ...secondary] = articles.slice(0, 3);
	return (
		<section className="space-y-3">
			<FeaturedTile article={main} variant="main" className="aspect-[21/9] rounded-2xl md:aspect-[24/9]" contentClassName="absolute bottom-0 left-0 w-full p-4 md:p-8" imageClassName="object-cover transition-transform duration-700 group-hover:scale-105" sizes="(max-width: 768px) 100vw, 1200px" priority showExcerpt showReadMore renderImage={renderImage} placeholderImage={placeholderImage} articleHref={articleHref} />
			{secondary.length > 0 ? <div className="grid grid-cols-1 gap-3 md:grid-cols-2">{secondary.map((article) => <FeaturedTile key={article.id} article={article} variant="secondary" className="aspect-video rounded-xl" contentClassName="absolute bottom-0 left-0 w-full p-3 md:p-4" imageClassName="object-cover transition-transform duration-500 group-hover:scale-105" sizes="(max-width: 768px) 100vw, 600px" renderImage={renderImage} placeholderImage={placeholderImage} articleHref={articleHref} />)}</div> : null}
		</section>
	);
}
