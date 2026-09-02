"use client";

import { formatDistanceToNow } from "date-fns";
import { fr } from "date-fns/locale";
import Image from "next/image";
import Link from "next/link";
import { NewsActions } from "@/components/dashboard/news-actions";
import { Badge } from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";

import type { NewsItem } from "@/types/news";

export function NewsCard({ item }: { item: NewsItem }) {
	const viewCount = (item as any).view_count as number | undefined;
	const relativeDate = item.updated_at
		? formatDistanceToNow(new Date(item.updated_at), { addSuffix: true, locale: fr })
		: null;
	const href =
		item.status === "published" ? `/news/${item.slug || item.id}` : `/dashboard/news/${item.id}`;

	return (
		<div className="group flex flex-col">
			<div className="relative aspect-video w-full mb-4">
				<Link href={href} className="block w-full h-full">
					<div className="w-full h-full rounded-2xl overflow-hidden bg-surface-container border border-outline-variant/20 shadow-sm group-hover:shadow-level-2 group-hover:scale-[1.02] transition-all duration-300 ease-[cubic-bezier(0.2,0,0,1)] relative">
						<Image
							src={item.featured_image_url || "/images/placeholder-news.svg"}
							alt={item.title}
							fill
							sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
							className="object-cover transition-transform duration-700 group-hover:scale-105"
						/>
						{/* Overlay Gradient */}
						<div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-70 transition-opacity" />

						{/* Status Chip */}
						<div className="absolute top-4 right-4 z-10">
							<Badge
								className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shadow-sm backdrop-blur-md border-none transition-colors duration-200 ease-[cubic-bezier(0.2,0,0,1)] ${
									item.status === "published"
										? "bg-tertiary-container text-on-tertiary-container"
										: item.status === "archived"
											? "bg-surface-container-highest/80 text-on-surface-variant"
											: "bg-primary-container text-on-primary-container"
								}`}
							>
								{item.status === "published"
									? "Publié"
									: item.status === "archived"
										? "Archivé"
										: "Brouillon"}
							</Badge>
						</div>

						{/* Category Chip + Pin indicator */}
						<div className="absolute top-4 left-4 z-10 flex items-center gap-2">
							<span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider bg-surface/30 text-white border border-white/20 backdrop-blur-md">
								{item.category || "Général"}
							</span>
							{(item as any).pinned && (
								<span
									className="inline-flex items-center justify-center size-7 rounded-full bg-primary/80 text-on-primary backdrop-blur-md"
									title="Épinglé en une"
								>
									<Icon name="push_pin" size={14} />
								</span>
							)}
						</div>

						{/* View count badge */}
						{viewCount != null && viewCount > 0 && (
							<div className="absolute bottom-4 left-4 z-10">
								<span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-black/40 text-white/90 backdrop-blur-md">
									<Icon name="visibility" size={12} />
									{viewCount.toLocaleString("fr-FR")}
								</span>
							</div>
						)}

						{/* Quick Actions (Visible on Hover) - Prevent Link Propagation */}
						<div
							className="absolute bottom-4 right-4 translate-y-full opacity-0 group-hover:translate-y-0 group-hover:opacity-100 transition-all duration-300 ease-[cubic-bezier(0.05,0.7,0.1,1)]"
							onClick={(e) => {
								e.preventDefault();
								e.stopPropagation();
							}}
						>
							<div className="bg-surface/90 backdrop-blur-md rounded-full p-1 shadow-lg border border-white/20">
								<NewsActions
									newsId={item.id}
									slug={item.slug || ""}
									pinned={(item as any).pinned}
									currentStatus={item.status}
								/>
							</div>
						</div>
					</div>
				</Link>
			</div>

			{/* Meta Data */}
			<div className="space-y-1.5 px-2">
				<Link href={href}>
					<h3 className="text-xl font-medium leading-tight text-on-surface group-hover:text-primary transition-colors line-clamp-2">
						{item.title}
					</h3>
				</Link>
				{item.excerpt && (
					<p className="text-sm text-on-surface-variant/70 line-clamp-2 leading-relaxed">
						{item.excerpt}
					</p>
				)}
				<div className="flex items-center gap-3 text-sm text-on-surface-variant">
					<span
						className="flex items-center gap-1.5"
						title={
							item.updated_at ? new Date(item.updated_at).toLocaleDateString("fr-FR") : undefined
						}
					>
						<Icon name="schedule" size={14} className="opacity-60" />
						<span className="text-xs">{relativeDate || "—"}</span>
					</span>
					<span className="size-1 rounded-full bg-outline-variant" />
					<span className="font-medium text-on-surface text-sm truncate">
						{item.author?.full_name || "Azalée"}
					</span>
				</div>
			</div>
		</div>
	);
}
