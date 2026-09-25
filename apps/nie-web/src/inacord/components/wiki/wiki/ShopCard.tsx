"use client";

import { Link } from "../../../compat/next";
import { Icon } from "../ui/Icon";
import { cn } from "../../../lib/utils";

const CATEGORY_ICON: Record<string, string> = {
	accessory: "diamond", animal: "pets", consume: "local_pharmacy", costume: "apparel", craft_obj: "construction", emblem: "shield", fashion: "styler", important: "priority_high", kizuna_link: "link", misanga: "wrist_band", name_plate: "id_card", shoes: "steps", special: "star", special_tactics: "strategy", super_tactics: "military_tech", title: "badge",
};

export interface ShopCardCategory { category: string; count: number; }
export interface ShopCardProps {
	shopId: number;
	name: string;
	nameJa?: string | null;
	itemCount: number;
	categories: ShopCardCategory[];
	className?: string;
	href?: string;
	itemCountLabel?: (count: number) => string;
	categoryLabel?: (category: string) => string;
}

/** Shared shop summary card. Category naming and navigation remain host concerns. */
export function ShopCard({ shopId, name, nameJa, itemCount, categories, className, href = `/boutique/${shopId}`, itemCountLabel = (count) => String(count), categoryLabel = (category) => category }: ShopCardProps) {
	const topCategories = categories.slice(0, 4);
	return (
		<Link href={href} className={cn("group relative block h-full overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-container hover:shadow-lg", className)}>
			<div className="flex gap-4 p-4"><div className="flex size-14 shrink-0 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container-high"><Icon name="storefront" size={26} className="text-primary" /></div><div className="min-w-0 flex-1"><h3 className="line-clamp-2 text-sm font-bold leading-tight text-on-surface transition-colors group-hover:text-primary">{name}</h3>{nameJa ? <p className="mt-0.5 truncate text-[11px] text-on-surface-variant/70">{nameJa}</p> : null}<div className="mt-1.5 flex items-center gap-1.5"><span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary"><Icon name="inventory_2" size={12} />{itemCountLabel(itemCount)}</span></div>{topCategories.length > 0 ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{topCategories.map(({ category, count }) => <span key={category} className="inline-flex items-center gap-0.5 rounded bg-surface-container-highest/50 px-1.5 py-0.5 text-[10px] font-medium text-on-surface-variant"><Icon name={CATEGORY_ICON[category] || "category"} size={12} />{categoryLabel(category)}<span className="opacity-60">·{count}</span></span>)}</div> : null}</div></div>
		</Link>
	);
}
