"use client";

import { useState, type ReactNode } from "react";
import { Link } from "../../../compat/next";
import { Icon } from "../ui/Icon";
import { cn } from "../../../lib/utils";

/** The resolved fields a host must provide for one concrete game drop. */
export interface DropCardEntry {
	id: string;
	source: "win_treasure" | "item_emission";
	sourceId: string;
	itemId: string;
	itemName: string;
	itemCategory: string | null;
	itemInternalCode: string | null;
	itemImageUrl: string | null;
	weight: number;
	chance: number;
}

export interface DropCardImage {
	src: string;
	alt: string;
	className: string;
	onError: () => void;
}

export interface DropsCardProps {
	drop: DropCardEntry;
	className?: string;
	itemHref?: string;
	resolveImage?: (image: string | null, internalCode: string | null) => string | null;
	renderImage?: (image: DropCardImage) => ReactNode;
	sourceLabel?: (source: DropCardEntry["source"]) => string;
	categoryLabel?: (category: string | null) => string;
	groupLabel?: (sourceId: string) => string;
	weightLabel?: (weight: number) => string;
}

const SOURCE_ICON: Record<DropCardEntry["source"], string> = {
	win_treasure: "stars",
	item_emission: "auto_awesome",
};

function chanceTone(chance: number): string {
	if (chance >= 20) return "bg-primary/10 text-primary";
	if (chance >= 5) return "bg-tertiary/10 text-tertiary";
	return "bg-error/10 text-error";
}

/** Shared display card for a resolved item drop. Data and image pipelines stay in the host. */
export function DropsCard({
	drop,
	className,
	itemHref,
	resolveImage,
	renderImage,
	sourceLabel = (source) => source,
	categoryLabel = (category) => category ?? "",
	groupLabel = (sourceId) => sourceId,
	weightLabel = (weight) => String(weight),
}: DropsCardProps) {
	const [imageFailed, setImageFailed] = useState(false);
	const imageUrl = resolveImage?.(drop.itemImageUrl, drop.itemInternalCode) ?? drop.itemImageUrl;
	const isTactic = drop.itemCategory === "special_tactics" || drop.itemCategory === "super_tactics";
	const href = itemHref ?? (isTactic ? `/tactic/${drop.itemId}` : `/item/${drop.itemId}`);

	return (
		<Link
			href={href}
			className={cn(
				"group relative block h-full overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low transition-all duration-200",
				"hover:-translate-y-0.5 hover:bg-surface-container hover:shadow-lg",
				className,
			)}
		>
			<div className="flex gap-4 p-4">
				<div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-high">
					{imageUrl && !imageFailed && renderImage ? (
						renderImage({
							src: imageUrl,
							alt: drop.itemName,
							className: "size-11 object-contain",
							onError: () => setImageFailed(true),
						})
					) : (
						<Icon name="backpack" size={24} className="text-on-surface-variant/30" />
					)}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-start justify-between gap-2">
						<h3 className="line-clamp-2 text-sm font-bold leading-tight text-on-surface transition-colors group-hover:text-primary">{drop.itemName}</h3>
						<span className={cn("inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-extrabold tabular-nums", chanceTone(drop.chance))} title={weightLabel(drop.weight)}>
							{drop.chance.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%
						</span>
					</div>
					<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
						<span className="inline-flex items-center gap-1 rounded bg-surface-container-highest/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
							<Icon name={SOURCE_ICON[drop.source]} size={12} />
							{sourceLabel(drop.source)}
						</span>
						{drop.itemCategory ? <span className="inline-flex items-center gap-0.5 rounded bg-secondary/10 px-1.5 py-0.5 text-[10px] font-bold text-secondary">{categoryLabel(drop.itemCategory)}</span> : null}
					</div>
					<p className="mt-2 truncate font-mono text-[10px] text-on-surface-variant/70" title={drop.sourceId}>{groupLabel(drop.sourceId)}</p>
				</div>
			</div>
		</Link>
	);
}
