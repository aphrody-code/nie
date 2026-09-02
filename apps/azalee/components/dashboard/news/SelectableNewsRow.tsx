"use client";

import { format } from "date-fns";
import { fr } from "date-fns/locale";
import { Pin } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { NewsActions } from "@/components/dashboard/news-actions";
import { Badge } from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";

interface SelectableNewsRowProps {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	item: any;
	selected: boolean;
	onToggle: () => void;
}

const STATUS_LABELS: Record<string, { label: string; className: string }> = {
	archived: {
		className: "bg-surface-container-high text-on-surface-variant",
		label: "Archivé",
	},
	draft: {
		className: "bg-primary-container text-on-primary-container",
		label: "Brouillon",
	},
	published: {
		className: "bg-tertiary-container text-on-tertiary-container",
		label: "Publié",
	},
	scheduled: {
		className: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
		label: "Programmé",
	},
};

const CATEGORY_LABELS: Record<string, string> = {
	announcement: "Annonce",
	community: "Communauté",
	critique: "Critique",
	event: "Événement",
};

export function SelectableNewsRow({ item, selected, onToggle }: SelectableNewsRowProps) {
	const statusInfo = STATUS_LABELS[item.status] || STATUS_LABELS.draft;
	const categoryLabel = CATEGORY_LABELS[item.category] || item.category;
	const viewCount = item.view_count as number | undefined;
	const tags = item.tags as string[] | null;

	return (
		<div
			className={`flex items-center gap-3 sm:gap-4 p-3 sm:p-4 hover:bg-surface-container-low/50 transition-all duration-300 group ${
				selected ? "bg-primary/5" : ""
			}`}
		>
			{/* Checkbox */}
			<button
				type="button"
				onClick={onToggle}
				className="shrink-0"
				aria-label={selected ? "Désélectionner" : "Sélectionner"}
			>
				<div
					className={`size-5 rounded border transition-all flex items-center justify-center ${
						selected ? "bg-primary border-primary" : "border-outline-variant hover:border-primary"
					}`}
				>
					{selected && (
						<svg className="size-3 text-on-primary" viewBox="0 0 12 12" fill="none">
							<path
								d="M2 6L5 9L10 3"
								stroke="currentColor"
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
							/>
						</svg>
					)}
				</div>
			</button>

			{/* Content */}
			<Link
				href={`/dashboard/news/${item.id}`}
				className="flex items-center gap-3 sm:gap-4 flex-1 min-w-0"
			>
				{/* Thumbnail */}
				<div className="relative size-14 sm:size-16 rounded-xl sm:rounded-2xl overflow-hidden bg-surface-container shrink-0">
					<Image
						src={item.featured_image_url || "/images/placeholder-news.svg"}
						alt={item.title}
						fill
						className="object-cover"
					/>
				</div>

				{/* Main info */}
				<div className="flex-1 min-w-0 space-y-1">
					<h3 className="text-sm sm:text-base font-bold text-on-surface group-hover:text-primary transition-colors truncate flex items-center gap-2">
						{item.pinned && (
							<span title="Épinglé en une">
								<Pin size={14} className="text-primary shrink-0" aria-hidden />
							</span>
						)}
						{item.title}
					</h3>
					<div className="flex items-center gap-2 text-xs text-on-surface-variant flex-wrap">
						<span>{item.author?.full_name || "Azalée"}</span>
						<span className="size-1 rounded-full bg-outline-variant" />
						<span>
							{format(new Date(item.updated_at || item.created_at || new Date()), "d MMM yyyy", {
								locale: fr,
							})}
						</span>
						{categoryLabel && (
							<>
								<span className="size-1 rounded-full bg-outline-variant" />
								<span className="text-on-surface-variant/70">{categoryLabel}</span>
							</>
						)}
						{viewCount != null && viewCount > 0 && (
							<>
								<span className="size-1 rounded-full bg-outline-variant" />
								<span className="inline-flex items-center gap-0.5 text-on-surface-variant/70">
									<Icon name="visibility" size={12} />
									{viewCount.toLocaleString("fr-FR")}
								</span>
							</>
						)}
					</div>
					{/* Tags */}
					{tags && tags.length > 0 && (
						<div className="hidden sm:flex items-center gap-1 flex-wrap">
							{tags.slice(0, 3).map((tag) => (
								<span
									key={tag}
									className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-container-high text-[10px] font-medium text-on-surface-variant"
								>
									{tag}
								</span>
							))}
							{tags.length > 3 && (
								<span className="text-[10px] text-on-surface-variant/50">+{tags.length - 3}</span>
							)}
						</div>
					)}
				</div>
			</Link>

			{/* Status badge */}
			<Badge
				className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-widest border-none ${statusInfo.className}`}
			>
				{statusInfo.label}
			</Badge>

			{/* Actions menu */}
			<div
				className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
				onClick={(e) => e.stopPropagation()}
			>
				<NewsActions
					newsId={item.id}
					slug={item.slug || ""}
					pinned={item.pinned}
					currentStatus={item.status}
				/>
			</div>
		</div>
	);
}
