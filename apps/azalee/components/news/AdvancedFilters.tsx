"use client";

import { ChevronDown, Filter, RotateCcw, Search, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { CATEGORIES } from "@/components/dashboard/news-editor/constants";
import { cn } from "@/lib/utils";

const SORT_OPTIONS = [
	{ label: "Plus récents", value: "recent" },
	{ label: "Plus populaires", value: "popular" },
	{ label: "Plus commentés", value: "commented" },
	{ label: "Tendances", value: "trending" },
] as const;

const DATE_OPTIONS = [
	{ label: "Tout", value: "" },
	{ label: "Cette semaine", value: "week" },
	{ label: "Ce mois", value: "month" },
	{ label: "Cette année", value: "year" },
] as const;

const ALL_CATEGORIES = [
	{ label: "Toutes les catégories", value: "" },
	...CATEGORIES.map((c) => ({ label: c.label, value: c.value })),
	{ label: "Tweets", value: "Tweet" },
];

interface AdvancedFiltersProps {
	currentCategory?: string;
	currentTag?: string;
	currentSort?: string;
}

export function AdvancedFilters({
	currentCategory = "",
	currentTag = "",
	currentSort = "recent",
}: AdvancedFiltersProps) {
	const router = useRouter();
	const searchParams = useSearchParams();
	const [isExpanded, setIsExpanded] = useState(false);
	const [isPending, startTransition] = useTransition();
	const panelRef = useRef<HTMLDivElement>(null);

	// État local des filtres
	const [category, setCategory] = useState(currentCategory);
	const [selectedTags, setSelectedTags] = useState<string[]>(
		currentTag ? currentTag.split(",").filter(Boolean) : []
	);
	const [sort, setSort] = useState(currentSort || "recent");
	const [dateRange, setDateRange] = useState(searchParams.get("date") ?? "");
	const [popularTags, setPopularTags] = useState<string[]>([]);

	// Charger les tags populaires côté client
	useEffect(() => {
		const fetchTags = async () => {
			try {
				const res = await fetch("/api/tags/popular?limit=15");
				if (res.ok) {
					const data = (await res.json()) as Array<{ tag: string; count: number }>;
					setPopularTags(data.map((t) => t.tag));
				}
			} catch {
				// Fallback silencieux
			}
		};
		if (isExpanded && popularTags.length === 0) {
			fetchTags();
		}
	}, [isExpanded, popularTags.length]);

	// Compter les filtres actifs
	const activeCount = [
		category !== "" && category !== currentCategory,
		selectedTags.length > 0,
		sort !== "recent",
		dateRange !== "",
	].filter(Boolean).length;

	const totalActiveFilters = [
		searchParams.get("category") && searchParams.get("category") !== "",
		searchParams.get("tag") && searchParams.get("tag") !== "",
		searchParams.get("sort") && searchParams.get("sort") !== "recent",
		searchParams.get("date") && searchParams.get("date") !== "",
	].filter(Boolean).length;

	const toggleTag = (tag: string) => {
		setSelectedTags((prev) =>
			prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
		);
	};

	const buildParams = useCallback(() => {
		const params = new URLSearchParams();
		if (category) {
			params.set("category", category);
		}
		if (selectedTags.length > 0) {
			params.set("tag", selectedTags.join(","));
		}
		if (sort && sort !== "recent") {
			params.set("sort", sort);
		}
		if (dateRange) {
			params.set("date", dateRange);
		}
		return params;
	}, [category, selectedTags, sort, dateRange]);

	const handleApply = () => {
		const params = buildParams();
		startTransition(() => {
			router.push(`/news${params.toString() ? `?${params.toString()}` : ""}`);
			setIsExpanded(false);
		});
	};

	const handleReset = () => {
		setCategory("");
		setSelectedTags([]);
		setSort("recent");
		setDateRange("");
		startTransition(() => {
			router.push("/news");
			setIsExpanded(false);
		});
	};

	// Fermer avec Escape
	useEffect(() => {
		if (!isExpanded) {
			return;
		}
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setIsExpanded(false);
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [isExpanded]);

	return (
		<div className="w-full">
			{/* Barre de déclenchement */}
			<button
				onClick={() => setIsExpanded((v) => !v)}
				aria-expanded={isExpanded}
				aria-controls="advanced-filters-panel"
				className={cn(
					"inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all",
					isExpanded || totalActiveFilters > 0
						? "bg-primary text-on-primary"
						: "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
				)}
			>
				<Filter className="size-4" />
				<span>Filtres</span>
				{totalActiveFilters > 0 && (
					<span className="flex items-center justify-center size-5 rounded-full bg-on-primary/20 text-[11px] font-bold">
						{totalActiveFilters}
					</span>
				)}
				<ChevronDown
					className={cn("size-4 transition-transform duration-200", isExpanded && "rotate-180")}
				/>
			</button>

			{/* Panneau de filtres */}
			{isExpanded && (
				<div
					id="advanced-filters-panel"
					ref={panelRef}
					className="mt-3 p-5 rounded-2xl bg-surface-container-low border border-outline-variant/20 space-y-5 animate-in fade-in slide-in-from-top-2 duration-150"
				>
					{/* Ligne 1 : Catégorie + Tri */}
					<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
						{/* Catégorie */}
						<div className="space-y-1.5">
							<label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60">
								Catégorie
							</label>
							<div className="relative">
								<Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-on-surface-variant/50 pointer-events-none" />
								<select
									value={category}
									onChange={(e) => setCategory(e.target.value)}
									className="w-full appearance-none pl-8 pr-8 py-2 rounded-xl bg-surface-container border border-outline-variant/30 text-sm text-on-surface focus:outline-hidden focus:ring-2 focus:ring-primary/40"
								>
									{ALL_CATEGORIES.map((c) => (
										<option key={c.value} value={c.value}>
											{c.label}
										</option>
									))}
								</select>
								<ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-on-surface-variant/50 pointer-events-none" />
							</div>
						</div>

						{/* Tri */}
						<div className="space-y-1.5">
							<label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60">
								Trier par
							</label>
							<div className="relative">
								<select
									value={sort}
									onChange={(e) => setSort(e.target.value)}
									className="w-full appearance-none px-3 pr-8 py-2 rounded-xl bg-surface-container border border-outline-variant/30 text-sm text-on-surface focus:outline-hidden focus:ring-2 focus:ring-primary/40"
								>
									{SORT_OPTIONS.map((o) => (
										<option key={o.value} value={o.value}>
											{o.label}
										</option>
									))}
								</select>
								<ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-on-surface-variant/50 pointer-events-none" />
							</div>
						</div>
					</div>

					{/* Ligne 2 : Période */}
					<div className="space-y-1.5">
						<label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60">
							Période
						</label>
						<div className="flex flex-wrap gap-2">
							{DATE_OPTIONS.map((opt) => (
								<button
									key={opt.value}
									onClick={() => setDateRange(opt.value)}
									className={cn(
										"px-3.5 py-1.5 rounded-full text-xs font-semibold transition-all",
										dateRange === opt.value
											? "bg-primary text-on-primary"
											: "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
									)}
								>
									{opt.label}
								</button>
							))}
						</div>
					</div>

					{/* Ligne 3 : Tags */}
					{popularTags.length > 0 && (
						<div className="space-y-1.5">
							<label className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60">
								Tags populaires
							</label>
							<div className="flex flex-wrap gap-1.5">
								{popularTags.map((tag) => {
									const active = selectedTags.includes(tag);
									return (
										<button
											key={tag}
											onClick={() => toggleTag(tag)}
											className={cn(
												"inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium transition-all",
												active
													? "bg-primary/15 text-primary ring-1 ring-primary/30"
													: "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
											)}
										>
											{tag}
											{active && <X className="size-2.5" />}
										</button>
									);
								})}
							</div>
						</div>
					)}

					{/* Actions */}
					<div className="flex items-center justify-between pt-2 border-t border-outline-variant/20">
						<button
							onClick={handleReset}
							disabled={isPending}
							className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-on-surface transition-colors"
						>
							<RotateCcw className="size-3.5" />
							Réinitialiser
						</button>

						<div className="flex items-center gap-2">
							<button
								onClick={() => setIsExpanded(false)}
								className="px-4 py-2 rounded-full text-sm font-medium text-on-surface-variant hover:bg-surface-container-high transition-colors"
							>
								Annuler
							</button>
							<button
								onClick={handleApply}
								disabled={isPending}
								className={cn(
									"px-5 py-2 rounded-full text-sm font-semibold transition-all",
									isPending
										? "opacity-60 cursor-not-allowed bg-primary text-on-primary"
										: "bg-primary text-on-primary hover:opacity-90"
								)}
							>
								{activeCount > 0 ? `Appliquer (${activeCount})` : "Appliquer"}
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
