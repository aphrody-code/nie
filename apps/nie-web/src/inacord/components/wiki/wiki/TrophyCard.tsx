"use client";

import { Award, Medal, Trophy } from "lucide-react";
import { cn } from "../../../lib/utils";

/**
 * A trophy row as `/api/v1/wiki/trophies` serves it.
 *
 * `description` is optional on purpose: 347 rows are served and most carry the mirror's
 * literal `\N` for an absent description. The host strips that marker; the card renders the
 * name alone rather than an empty line, which would read as a missing value.
 */
export interface TrophyCardTrophy {
	id: string;
	code: string;
	name: string;
	description?: string;
	/** Top-level bucket, e.g. `activity`. Decides the icon. */
	category: string;
	/** Sub-bucket, e.g. `story`. Rendered as the chip's second half. */
	group?: string;
}

export interface TrophyCardProps {
	trophy: TrophyCardTrophy;
	className?: string;
	/** Localized label for a category; the host owns the wording. */
	categoryLabel?: (category: string) => string;
}

/** Icon per category — three buckets the served rows actually use, `Medal` otherwise. */
function iconFor(category: string) {
	if (category === "activity") return Trophy;
	if (category === "collection") return Award;
	return Medal;
}

/** Shared trophy card. No link: trophies have no detail route. */
export function TrophyCard({ trophy, className, categoryLabel = category => category }: TrophyCardProps) {
	const Icon = iconFor(trophy.category);
	return (
		<article
			className={cn(
				"flex h-full items-start gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-3 transition-colors duration-200 hover:bg-surface-container",
				className,
			)}
		>
			<div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-tertiary/10 text-tertiary">
				<Icon size={20} aria-hidden="true" />
			</div>
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="rounded-full bg-tertiary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-tertiary">
						{categoryLabel(trophy.category)}
					</span>
					{trophy.group ? (
						<span className="text-[10px] font-medium text-on-surface-variant/60">{trophy.group}</span>
					) : null}
				</div>
				<h3 className="mt-1 line-clamp-2 text-sm font-bold leading-snug text-on-surface">{trophy.name}</h3>
				{trophy.description ? (
					<p className="mt-0.5 line-clamp-2 text-xs text-on-surface-variant/70">{trophy.description}</p>
				) : null}
				<p className="mt-1 truncate font-mono text-[10px] text-on-surface-variant/50">{trophy.code}</p>
			</div>
		</article>
	);
}
