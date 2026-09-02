"use client";

import { Twitter } from "@/lib/brand-icons";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CATEGORIES } from "@/components/dashboard/news-editor/constants";

const ALL_FILTERS = [
	{ label: "Tout", value: "" },
	...CATEGORIES.map((c) => ({ label: c.label, value: c.value })),
	{ label: "Tweets", value: "Tweet" },
] as const;

export function CategoryChips() {
	const searchParams = useSearchParams();
	const activeCategory = searchParams.get("category") || "";

	return (
		<div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
			{ALL_FILTERS.map((filter) => {
				const isActive = activeCategory === filter.value;
				const href = filter.value ? `/news?category=${filter.value}` : "/news";

				return (
					<Link
						key={filter.value}
						href={href}
						className={`shrink-0 inline-flex items-center justify-center gap-1.5 min-h-11 sm:min-h-0 px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 ${
							isActive
								? "bg-primary text-on-primary shadow-sm"
								: "bg-surface-container-high text-on-surface-variant hover:bg-surface-container-highest"
						}`}
					>
						{filter.value === "Tweet" && <Twitter className="size-3 fill-current" />}
						{filter.label}
					</Link>
				);
			})}
		</div>
	);
}
