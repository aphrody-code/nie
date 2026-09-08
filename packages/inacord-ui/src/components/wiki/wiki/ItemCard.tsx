"use client";

import { Store } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "../../../compat/next";
import { cn } from "../../../lib/utils";
import { Icon } from "../../ui/Icon";

export interface ItemCardImage {
	src: string;
	alt: string;
	width: number;
	height: number;
	className: string;
	onError: () => void;
}

export interface ItemCardProps {
	id: string;
	name: string;
	category: string;
	categoryLabel?: string;
	rarity?: number;
	internalCode?: string;
	icon?: string;
	price?: number | null;
	location?: string | null;
	stats?: Record<string, unknown> | null;
	bonuses?: Record<string, number> | null;
	className?: string;
	/** The host resolves CDN or VFS artwork. */
	resolveImage?: (icon: string | undefined, internalCode: string | undefined) => string | null;
	/** The host keeps its own image renderer. */
	renderImage?: (image: ItemCardImage) => ReactNode;
	/** Locale names are host data, not card geometry. */
	locationLabel?: (location: string) => string;
}

const CATEGORY_ICONS: Record<string, string> = {
	accessory: "diamond", animal: "pets", consume: "local_pharmacy", costume: "apparel", craft_obj: "construction", emblem: "shield", fashion: "styler", formation: "sports", important: "priority_high", kizuna_link: "link", misanga: "wrist_band", name_plate: "id_card", performance: "music_note", shoes: "steps", special: "star", special_skill: "auto_awesome", special_tactics: "strategy", super_tactics: "military_tech", title: "badge",
};

const STAT_SHORT: Record<string, string> = {
	agility: "AGI", control: "CTR", intelligence: "INT", kick: "TIR", physical: "PHY", pressure: "PRE", technique: "TEC",
};

/** Shared item/tactic card. Resource resolution and locale data remain host adapters. */
export function ItemCard({
	id, name, category, categoryLabel, rarity: _rarity, internalCode, icon, price: _price, location, stats,
	bonuses, className, resolveImage, renderImage, locationLabel = (value) => value,
}: ItemCardProps) {
	const resolvedSrc = resolveImage?.(icon, internalCode) ?? icon ?? null;
	const [imgError, setImgError] = useState(false);
	const catIcon = CATEGORY_ICONS[category] || "backpack";
	const hasRealImage = Boolean(resolvedSrc) && !imgError && Boolean(renderImage);
	const bonusEntries = bonuses
		? Object.entries(bonuses).filter(([key, value]) => key in STAT_SHORT && value !== 0)
		: [];
	const fallbackStatEntries = bonusEntries.length === 0 && stats
		? Object.entries(stats).filter(([key, value]): value is number => key in STAT_SHORT && typeof value === "number" && value > 0)
		: [];
	const topStats = [...(bonusEntries.length > 0 ? bonusEntries : fallbackStatEntries)]
		.sort(([, left], [, right]) => Math.abs(right) - Math.abs(left))
		.slice(0, 2);
	const isTactic = category === "special_tactics";
	const effects = isTactic && stats
		? [stats.effect1, stats.effect2, stats.effect3].filter((value): value is string => typeof value === "string" && value.length > 0)
		: [];
	const duration = stats?.duration;
	const cooldown = stats?.cooldown;

	return (
		<Link href={isTactic ? `/tactic/${id}` : `/item/${id}`} className={cn("group relative block h-full overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-container hover:shadow-lg", className)}>
			<div className="flex gap-4 p-4">
				<div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-high">
					{hasRealImage && resolvedSrc && renderImage ? renderImage({ src: resolvedSrc, alt: name, width: 48, height: 48, className: "size-11 object-contain", onError: () => setImgError(true) }) : <Icon name={catIcon} size={24} className="text-on-surface-variant/30" />}
				</div>
				<div className="min-w-0 flex-1">
					<h3 className="line-clamp-2 text-sm font-bold leading-tight text-on-surface transition-colors group-hover:text-primary">{name}</h3>
					<div className="mt-1.5 flex flex-wrap items-center gap-1.5">
						<span className="inline-flex items-center gap-1 rounded bg-surface-container-highest/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant"><Icon name={catIcon} size={12} />{categoryLabel || category}</span>
						{topStats.map(([key, value]) => <span key={key} className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">{STAT_SHORT[key] || key} {value > 0 ? "+" : ""}{value}</span>)}
						{isTactic && typeof duration === "number" ? <span className="inline-flex items-center gap-0.5 rounded bg-tertiary/10 px-1.5 py-0.5 text-[10px] font-bold text-tertiary">⏱ {duration}s</span> : null}
						{isTactic && typeof cooldown === "number" ? <span className="inline-flex items-center gap-0.5 rounded bg-error/10 px-1.5 py-0.5 text-[10px] font-bold text-error">⏳ {cooldown}s</span> : null}
					</div>
					{effects.length > 0 ? <div className="mt-2 space-y-1">{effects.slice(0, 2).map((effect, index) => <p key={index} className="truncate text-[10px] leading-tight text-on-surface-variant" title={effect}>• {effect}</p>)}</div> : null}
					{location ? <div className="mt-2 flex items-center gap-3 text-xs text-on-surface-variant"><span className="inline-flex truncate"><Store size={14} aria-hidden="true" />{locationLabel(location)}</span></div> : null}
				</div>
			</div>
		</Link>
	);
}
