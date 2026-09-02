"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { searchGlobal } from "@/app/actions/search";
import type { EnhancedSearchResult } from "@/app/actions/search";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { Icon } from "@/components/ui/Icon";
import { SearchResultRow } from "@/components/wiki/SearchResultRow";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { cn } from "@/lib/utils";

// ─── Wiki Database Sections ───────────────────────────────────────────────────

const WIKI_SECTIONS: Array<{
	href: string;
	sprite?: SpriteCommonKey;
	iconName?: string;
	title: string;
	description: string;
	accent: string;
}> = [
	{
		accent: "from-blue-500/20 to-cyan-500/5",
		description: "5 900+ personnages",
		href: "/chara",
		sprite: "chara",
		title: "Joueurs",
	},
	{
		accent: "from-amber-500/20 to-orange-500/5",
		description: "Tirs, dribbles, arrêts",
		href: "/skill",
		sprite: "skill",
		title: "Techniques",
	},
	{
		accent: "from-purple-500/20 to-fuchsia-500/5",
		description: "Esprits Guerriers, Totems",
		href: "/aura",
		sprite: "keshin",
		title: "Hyper Techniques",
	},
	{
		accent: "from-emerald-500/20 to-green-500/5",
		description: "Équipements, consommables",
		href: "/item",
		iconName: "backpack",
		title: "Objets",
	},
	{
		accent: "from-rose-500/20 to-pink-500/5",
		description: "Talents, coordinateurs",
		href: "/passive",
		sprite: "tension",
		title: "Passifs",
	},
	{
		accent: "from-sky-500/20 to-indigo-500/5",
		description: "Stratégies de match",
		href: "/tactic",
		iconName: "strategy",
		title: "Tactiques",
	},
];

// ─── Wiki Grid ────────────────────────────────────────────────────────────────

function WikiGrid() {
	return (
		<section className="space-y-3">
			<h2 className="type-title-small text-on-surface-variant px-1">Base de données</h2>
			<div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
				{WIKI_SECTIONS.map((section) => (
					<Link
						key={section.href}
						href={section.href}
						className="group flex flex-col gap-2 p-3 rounded-2xl bg-surface-container-low hover:bg-surface-container-high transition-all active:scale-[0.97] overflow-hidden relative"
					>
						{/* Gradient accent */}
						<div
							className={cn(
								"absolute inset-0 bg-linear-to-br opacity-0 group-hover:opacity-100 transition-opacity",
								section.accent
							)}
						/>

						<div className="relative flex items-center gap-2.5">
							<div className="size-10 rounded-xl flex items-center justify-center shrink-0 bg-primary/8">
								{section.sprite ? (
									<CommonSpriteIcon name={section.sprite} scale={0.45} />
								) : section.iconName ? (
									<Icon name={section.iconName} size={20} className="text-primary" />
								) : null}
							</div>
							<p className="type-label-large text-on-surface group-hover:text-primary transition-colors leading-tight">
								{section.title}
							</p>
						</div>

						<p className="relative type-body-small text-on-surface-variant/60 leading-snug line-clamp-1">
							{section.description}
						</p>
					</Link>
				))}
			</div>
		</section>
	);
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SearchClient({ defaultQuery }: { defaultQuery?: string }) {
	const router = useRouter();
	const inputRef = useRef<HTMLInputElement>(null);
	const [query, setQuery] = useState(defaultQuery || "");
	const [results, setResults] = useState<EnhancedSearchResult[]>([]);
	const [isSearching, setIsSearching] = useState(false);

	// Auto-focus on mount (desktop only — on mobile the virtual keyboard covers the grid)
	useEffect(() => {
		if (window.innerWidth >= 768) {
			const timer = setTimeout(() => inputRef.current?.focus(), 100);
			return () => clearTimeout(timer);
		}
	}, []);

	// Debounced search
	useEffect(() => {
		if (query.length < 2) {
			setResults([]);
			setIsSearching(false);
			return;
		}

		setIsSearching(true);
		const timer = setTimeout(async () => {
			try {
				const data = await searchGlobal(query);
				setResults(data.filter((r) => r.type !== "suggestion"));
			} catch {
				setResults([]);
			} finally {
				setIsSearching(false);
			}
		}, 250);

		return () => clearTimeout(timer);
	}, [query]);

	const navigate = useCallback(
		(url: string) => {
			router.push(url);
		},
		[router]
	);

	const clearQuery = useCallback(() => {
		setQuery("");
		setResults([]);
		inputRef.current?.focus();
	}, []);

	const hasResults = results.length > 0;
	const showEmpty = query.length >= 2 && !isSearching && !hasResults;
	const showLanding = query.length < 2;

	return (
		<div className="w-full min-h-[60vh]">
			{/* Logo + Search bar — Google-style when landing */}
			{showLanding && (
				<div className="flex flex-col items-center pt-4 sm:pt-10 pb-4 sm:pb-8">
					<div className="relative size-14 sm:size-20 mb-3 sm:mb-4">
						<Image
							src="/logo.webp"
							fill
							sizes="80px"
							alt="Azalée"
							className="object-contain"
							priority
						/>
					</div>
				</div>
			)}

			{/* Search bar */}
			<div
				className={cn(
					showLanding
						? "max-w-xl mx-auto px-1"
						: "sticky top-16 md:top-14 z-30 -mx-4 md:-mx-8 lg:-mx-12 px-4 md:px-8 lg:px-12 pb-3 pt-1 bg-surface-container"
				)}
			>
				<div
					className={cn(
						"relative flex items-center gap-3",
						"h-12 sm:h-14 rounded-full",
						"bg-surface-container-high",
						"border border-outline-variant/20",
						"focus-within:border-primary/40 focus-within:bg-surface",
						"shadow-sm",
						"transition-all duration-200"
					)}
				>
					<Icon name="search" size={20} className="text-on-surface-variant ml-4 shrink-0" />

					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher sur Azalée..."
						autoComplete="off"
						className="flex-1 bg-transparent outline-hidden type-body-large text-on-surface placeholder:text-on-surface-variant/50 min-w-0"
					/>

					{isSearching && (
						<div className="size-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin mr-3 shrink-0" />
					)}

					{query && !isSearching && (
						<button
							onClick={clearQuery}
							aria-label="Effacer la recherche"
							className="size-10 md:size-8 rounded-full flex items-center justify-center mr-3 shrink-0 hover:bg-on-surface/[0.08] transition-colors"
						>
							<Icon name="close" size={18} className="text-on-surface-variant" />
						</button>
					)}
				</div>
			</div>

			{/* Landing page — wiki grid */}
			{showLanding && (
				<div className="mt-5 sm:mt-8 space-y-6">
					<WikiGrid />
				</div>
			)}

			{/* Results */}
			{hasResults && (
				<div className="mt-2 -mx-4 md:mx-0">
					{results.map((result) => (
						<SearchResultRow
							key={`${result.type}-${result.id}`}
							result={result}
							query={query}
							onClick={() => navigate(result.url)}
						/>
					))}
				</div>
			)}

			{/* Empty state */}
			{showEmpty && (
				<div className="mt-16 text-center space-y-3">
					<Icon name="search_off" size={48} className="text-on-surface-variant/30 mx-auto" />
					<p className="type-body-large text-on-surface-variant">
						Aucun résultat pour &laquo; {query} &raquo;
					</p>
				</div>
			)}
		</div>
	);
}
