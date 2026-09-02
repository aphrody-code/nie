"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { getItemIconUrl, PLACEHOLDERS, resolveAssetUrl } from "@rosegriffon/azalee/images";
import { cn } from "@/lib/utils";
import { SHOP_CATEGORY_FR, type ShopItem } from "@rosegriffon/azalee/wiki/shops-shared";

const CATEGORY_ICON: Record<string, string> = {
	accessory: "diamond",
	animal: "pets",
	consume: "local_pharmacy",
	costume: "apparel",
	craft_obj: "construction",
	emblem: "shield",
	fashion: "styler",
	important: "priority_high",
	kizuna_link: "link",
	misanga: "wrist_band",
	name_plate: "id_card",
	shoes: "steps",
	special: "star",
	special_tactics: "strategy",
	super_tactics: "military_tech",
	title: "badge",
};

function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "");
}

function ShopItemTile({ item }: { item: ShopItem }) {
	const [imgError, setImgError] = useState(false);
	const resolvedSrc =
		resolveAssetUrl(item.icon) || (item.internalCode ? getItemIconUrl(item.internalCode) : null);
	const hasRealImage = !!resolvedSrc && resolvedSrc !== PLACEHOLDERS.item && !imgError;
	const catIcon = (item.category && CATEGORY_ICON[item.category]) || "backpack";

	// L'objet est cliquable vers /item/[id] seulement si on a un id résolu.
	const inner = (
		<div className="p-3 flex gap-3 items-center">
			<div className="size-12 shrink-0 rounded-lg bg-surface-container-high flex items-center justify-center border border-outline-variant/20 overflow-hidden">
				{hasRealImage ? (
					<Image
						src={resolvedSrc as string}
						alt={item.name}
						width={40}
						height={40}
						className="object-contain size-10"
						unoptimized
						onError={() => setImgError(true)}
					/>
				) : (
					<Icon name={catIcon} size={20} className="text-on-surface-variant/30" />
				)}
			</div>
			<div className="flex-1 min-w-0">
				<p className="font-semibold text-sm text-on-surface leading-tight line-clamp-2 group-hover:text-primary transition-colors">
					{item.name}
				</p>
				{item.category ? (
					<span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-surface-container-highest/50 text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
						<Icon name={catIcon} size={11} />
						{SHOP_CATEGORY_FR[item.category] || item.category}
					</span>
				) : null}
			</div>
		</div>
	);

	const cls = cn(
		"block rounded-xl border border-outline-variant/30 bg-surface-container-low transition-all duration-200 group",
		item.resolved && item.id ? "hover:bg-surface-container hover:shadow-md hover:-translate-y-0.5" : "opacity-80"
	);

	if (item.resolved && item.id) {
		return (
			<Link href={`/item/${item.id}`} className={cls}>
				{inner}
			</Link>
		);
	}
	return <div className={cls}>{inner}</div>;
}

export function ShopItemsGrid({ items }: { items: ShopItem[] }) {
	const [query, setQuery] = useState("");
	const [activeCat, setActiveCat] = useState<string | null>(null);

	const categories = useMemo(() => {
		const map = new Map<string, number>();
		for (const it of items) {
			if (it.category) map.set(it.category, (map.get(it.category) || 0) + 1);
		}
		return Array.from(map.entries())
			.map(([category, count]) => ({ category, count }))
			.sort((a, b) => b.count - a.count);
	}, [items]);

	const filtered = useMemo(() => {
		const q = normalize(query.trim());
		return items.filter((it) => {
			if (activeCat && it.category !== activeCat) return false;
			if (q && !normalize(it.name).includes(q)) return false;
			return true;
		});
	}, [items, query, activeCat]);

	return (
		<div className="space-y-4">
			<div className="flex flex-col gap-3">
				<div className="relative">
					<Icon
						name="search"
						size={18}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
					/>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher un objet dans cette boutique…"
						className="w-full h-11 pl-10 pr-3 rounded-full bg-surface-container-low border border-outline-variant text-sm text-on-surface placeholder:text-on-surface-variant outline-none focus:border-primary transition-colors"
					/>
				</div>

				{categories.length > 1 ? (
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							onClick={() => setActiveCat(null)}
							className={cn(
								"px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
								activeCat === null
									? "bg-primary text-on-primary border-primary"
									: "bg-surface-container-low text-on-surface-variant border-outline-variant hover:bg-surface-container"
							)}
						>
							Tout ({items.length})
						</button>
						{categories.map(({ category, count }) => (
							<button
								key={category}
								type="button"
								onClick={() => setActiveCat(category === activeCat ? null : category)}
								className={cn(
									"inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors",
									activeCat === category
										? "bg-primary text-on-primary border-primary"
										: "bg-surface-container-low text-on-surface-variant border-outline-variant hover:bg-surface-container"
								)}
							>
								<Icon name={CATEGORY_ICON[category] || "category"} size={13} />
								{SHOP_CATEGORY_FR[category] || category} ({count})
							</button>
						))}
					</div>
				) : null}
			</div>

			<div className="text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				{filtered.length.toLocaleString("fr-FR")} objet{filtered.length > 1 ? "s" : ""}
			</div>

			{filtered.length > 0 ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{filtered.map((item, i) => (
						<ShopItemTile key={`${item.id || "na"}-${item.slotIndex}-${i}`} item={item} />
					))}
				</div>
			) : (
				<div className="py-16 text-center rounded-2xl border border-outline-variant bg-surface-container-low border-dashed">
					<p className="text-on-surface-variant italic">Aucun objet ne correspond.</p>
				</div>
			)}
		</div>
	);
}
