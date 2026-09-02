"use client";

import { ArrowRight, ArrowUpLeft } from "lucide-react";
import Image from "next/image";
import type { EnhancedSearchResult } from "@/app/actions/search";
import { Badge } from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { SearchResultHighlight } from "@/components/wiki/SearchResultHighlight";
import { getSkillElementIconUrl } from "@rosegriffon/azalee/images";
import { LANG_BADGE_STYLES, TYPE_LABELS } from "@rosegriffon/azalee/search/search-ui-config";
import { cn } from "@/lib/utils";

interface SearchResultRowProps {
	result: EnhancedSearchResult;
	query: string;
	onClick: () => void;
	/** Compact mode for Cmd+K dialog (smaller thumbnails, renders as div to avoid nested button) */
	compact?: boolean;
}

/**
 * Shared search result row used by both GlobalSearch (dialog) and SearchClient (full-page).
 * In compact mode, renders as a <div> (for use inside CommandItem which is already interactive).
 * In normal mode, renders as a <button>.
 */
export function SearchResultRow({ result, query, onClick, compact }: SearchResultRowProps) {
	const thumbSize = compact ? 36 : 40;
	const thumbClass = compact ? "size-9" : "size-10";

	const content = (
		<>
			{/* Thumbnail / Icon */}
			{result.imageUrl ? (
				<div
					className={cn(
						thumbClass,
						"rounded-lg overflow-hidden bg-surface-container-high shrink-0 flex items-center justify-center"
					)}
				>
					<Image
						src={result.imageUrl}
						alt={result.title}
						width={thumbSize}
						height={thumbSize}
						className={cn(thumbClass, "object-cover")}
						unoptimized
						onError={(e) => {
							const img = e.target as HTMLImageElement;
							img.style.display = "none";
							img.parentElement?.classList.add("search-img-fallback");
						}}
					/>
				</div>
			) : (
				<div
					className={cn(
						thumbClass,
						compact ? "rounded-lg" : "rounded-xl",
						"bg-surface-container-high flex items-center justify-center shrink-0"
					)}
				>
					<Icon name={result.icon} size={compact ? 18 : 20} className="text-primary" />
				</div>
			)}

			{/* Content */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-1.5">
					<span
						className={cn(
							"truncate",
							compact
								? "font-medium text-sm text-[var(--md-sys-color-on-surface)]"
								: "type-body-large text-on-surface"
						)}
					>
						<SearchResultHighlight text={result.title} query={query} />
					</span>
					{result.matchedLanguage && (
						<Badge
							className={cn(
								"text-[10px] px-1.5 py-0 h-4 font-bold shrink-0",
								LANG_BADGE_STYLES[result.matchedLanguage]
							)}
						>
							{result.matchedLanguage}
						</Badge>
					)}
				</div>
				<div className="flex items-center gap-1.5 mt-0.5">
					<span
						className={cn(
							compact
								? "text-[11px] text-[var(--md-sys-color-on-surface-variant)]"
								: "type-body-small text-on-surface-variant"
						)}
					>
						{TYPE_LABELS[result.type] || result.subtitle}
					</span>
					{result.element && getSkillElementIconUrl(result.element) && (
						<Image
							src={getSkillElementIconUrl(result.element)}
							alt={result.element}
							width={compact ? 12 : 14}
							height={compact ? 12 : 14}
							className={cn(compact ? "size-3" : "size-3.5", "object-contain shrink-0")}
							unoptimized
						/>
					)}
					{result.position && (
						<span
							className={cn(
								"font-bold shrink-0",
								compact
									? "text-[10px] text-[var(--md-sys-color-on-surface-variant)]/60"
									: "type-label-small text-on-surface-variant/60"
							)}
						>
							{result.position}
						</span>
					)}
					{result.rarity && <RarityBadge rarity={result.rarity} size="xs" />}
				</div>
			</div>

			{/* Trailing icon */}
			{compact ? (
				<ArrowRight
					size={16}
					aria-hidden="true"
					className="shrink-0 text-[var(--md-sys-color-on-surface-variant)] opacity-0 group-data-[selected=true]:opacity-100 transition-opacity"
				/>
			) : (
				<ArrowUpLeft size={18} aria-hidden="true" className="shrink-0 text-on-surface-variant/30" />
			)}
		</>
	);

	// Compact mode: render as div (avoids nested button inside CommandItem)
	if (compact) {
		return <div className="flex items-center gap-3 w-full text-left py-2.5 px-2">{content}</div>;
	}

	return (
		<button
			onClick={onClick}
			className="flex items-center gap-3 w-full text-left transition-colors px-4 py-3 hover:bg-on-surface/[0.04] active:bg-on-surface/[0.08]"
		>
			{content}
		</button>
	);
}
