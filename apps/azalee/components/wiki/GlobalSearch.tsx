"use client";

import { Lightbulb, Search, SearchX } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { searchGlobal } from "@/app/actions/search";
import type { EnhancedSearchResult } from "@/app/actions/search";
import {
	Button,
	Skeleton,
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@rosegriffon/ui";
import { SearchResultRow } from "@/components/wiki/SearchResultRow";
import { TYPE_LABELS_PLURAL } from "@rosegriffon/azalee/search/search-ui-config";
import type { SearchContext } from "@rosegriffon/azalee/search/smart-search";
import { cn } from "@/lib/utils";

/**
 * Detect search context from current pathname
 */
function useSearchContext(): SearchContext {
	const pathname = usePathname();

	if (pathname.startsWith("/chara")) {
		return "chara";
	}
	if (pathname.startsWith("/skill")) {
		return "skill";
	}
	if (pathname.startsWith("/aura")) {
		return "aura";
	}
	if (pathname.startsWith("/passive")) {
		return "passive";
	}
	if (pathname.startsWith("/tactic")) {
		return "tactic";
	}
	if (pathname.startsWith("/team")) {
		return "team";
	}
	if (pathname.startsWith("/item")) {
		return "item";
	}
	if (pathname.startsWith("/news")) {
		return "news";
	}
	if (pathname.startsWith("/patch-notes")) {
		return "patchnotes";
	}

	return "global";
}

/**
 * Group results by type for organized display
 */
function groupResultsByType(results: EnhancedSearchResult[]) {
	const groups: Record<string, EnhancedSearchResult[]> = {};

	for (const result of results) {
		if (!groups[result.type]) {
			groups[result.type] = [];
		}
		groups[result.type].push(result);
	}

	return groups;
}

export function GlobalSearch({
	isCompact,
	isMobileHero,
	isHero,
}: {
	isCompact?: boolean;
	isMobileHero?: boolean;
	isHero?: boolean;
}) {
	const [open, setOpen] = React.useState(false);
	const [query, setQuery] = React.useState("");
	const [results, setResults] = React.useState<EnhancedSearchResult[]>([]);
	const [isSearching, setIsSearching] = React.useState(false);
	const router = useRouter();
	const context = useSearchContext();

	// Abort controller for canceling obsolete requests
	const abortControllerRef = React.useRef<AbortController | null>(null);

	// Keyboard shortcut (Cmd+K / Ctrl+K)
	React.useEffect(() => {
		const down = (e: KeyboardEvent) => {
			if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
				e.preventDefault();
				setOpen((open) => !open);
			}
		};
		document.addEventListener("keydown", down);
		return () => document.removeEventListener("keydown", down);
	}, []);

	// Debounced search with request cancellation
	React.useEffect(() => {
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		if (query.length < 2) {
			setResults([]);
			setIsSearching(false);
			return;
		}

		setIsSearching(true);

		const timer = setTimeout(async () => {
			try {
				abortControllerRef.current = new AbortController();
				const data = await searchGlobal(query, context);
				setResults(data);
			} catch (error) {
				if ((error as Error).name !== "AbortError") {
					console.error("Search error:", error);
					setResults([]);
				}
			} finally {
				setIsSearching(false);
			}
		}, 300);

		return () => {
			clearTimeout(timer);
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
		};
	}, [query, context]);

	// Reset query when dialog closes
	React.useEffect(() => {
		if (!open) {
			setQuery("");
			setResults([]);
			setIsSearching(false);
		}
	}, [open]);

	const runCommand = React.useCallback((command: () => unknown) => {
		setOpen(false);
		command();
	}, []);

	const groupedResults = React.useMemo(() => groupResultsByType(results), [results]);
	const hasSuggestion = results.length === 1 && results[0].type === "suggestion";

	const SearchDialog = (
		<CommandDialog open={open} onOpenChange={setOpen} shouldFilter={false}>
			<CommandInput
				placeholder="Rechercher personnages, techniques, auras, équipes..."
				value={query}
				onValueChange={setQuery}
			/>
			<CommandList>
				{query.length >= 2 && !isSearching && results.length === 0 && (
					<CommandEmpty>
						<div className="py-6 text-center">
							<SearchX
								size={36}
								aria-hidden="true"
								className="text-[var(--md-sys-color-on-surface-variant)] mb-2"
							/>
							<p className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
								Aucun résultat pour &quot;{query}&quot;
							</p>
						</div>
					</CommandEmpty>
				)}

				{isSearching && (
					<div className="px-2 py-3 space-y-2">
						{[...Array(3)].map((_, i) => (
							<div key={i} className="flex items-center gap-3 p-2">
								<Skeleton className="size-5 rounded-md" />
								<div className="flex-1 space-y-2">
									<Skeleton className="h-4 w-3/4" />
									<Skeleton className="h-3 w-1/2" />
								</div>
							</div>
						))}
					</div>
				)}

				{hasSuggestion && (
					<div className="px-4 py-6 text-center">
						<Lightbulb
							size={30}
							aria-hidden="true"
							className="text-[var(--md-sys-color-primary)] mb-2"
						/>
						<p className="text-sm text-[var(--md-sys-color-on-surface-variant)] mb-2">
							Vouliez-vous dire...
						</p>
						<Button
							variant="outline"
							onClick={() => setQuery(results[0].title)}
							className="rounded-full"
						>
							{results[0].title}
						</Button>
					</div>
				)}

				{!hasSuggestion &&
					Object.entries(groupedResults).map(([type, items]) => (
						<CommandGroup
							key={type}
							heading={TYPE_LABELS_PLURAL[type] || type}
							className="[&_[cmdk-group-heading]]:text-[var(--md-sys-color-primary)] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase"
						>
							{items.map((result) => (
								<CommandItem
									key={`${result.type}-${result.id}`}
									value={`${result.title} ${result.subtitle}`}
									onSelect={() => {
										runCommand(() => router.push(result.url));
									}}
									className={cn(
										"!p-0 rounded-xl",
										"data-[selected=true]:bg-[var(--md-sys-color-secondary-container)]/20",
										"transition-all duration-[var(--md-sys-motion-duration-short2)]",
										"ease-[var(--md-sys-motion-easing-standard)]"
									)}
								>
									<SearchResultRow result={result} query={query} onClick={() => {}} compact />
								</CommandItem>
							))}
						</CommandGroup>
					))}
			</CommandList>
		</CommandDialog>
	);

	if (isMobileHero || isHero) {
		return (
			<>
				<button
					onClick={() => setOpen(true)}
					className="flex items-center gap-3 w-full h-12 px-5 rounded-full bg-white/10 border border-white/15 backdrop-blur-md text-white/60 hover:bg-white/15 hover:border-white/25 transition-all active:scale-[0.98]"
				>
					<Search size={18} aria-hidden="true" className="shrink-0 text-white/50" />
					<span className="text-sm truncate">Rechercher un joueur, une technique...</span>
					{isHero && (
						<kbd className="ml-auto pointer-events-none hidden lg:inline-flex h-6 select-none items-center gap-1 rounded-md border border-white/15 bg-white/5 px-2 font-mono text-[11px] font-medium text-white/40">
							<span className="text-xs">⌘</span>K
						</kbd>
					)}
				</button>
				{SearchDialog}
			</>
		);
	}

	if (isCompact) {
		return (
			<div className="flex-1 h-full">
				<button
					onClick={() => setOpen(true)}
					className="flex items-center gap-3 w-full h-full text-on-surface-variant group px-1"
				>
					<Search
						size={20}
						aria-hidden="true"
						className="opacity-60 group-hover:opacity-100 transition-opacity"
					/>
					<span className="flex-1 opacity-50 group-hover:opacity-80 transition-opacity text-[15px] font-normal truncate">
						Rechercher
					</span>
				</button>
				{SearchDialog}
			</div>
		);
	}

	return (
		<>
			<Button
				variant="outline"
				className="
          relative h-10 w-full justify-start text-sm
          text-on-surface-variant
          bg-surface-container-high/60 dark:bg-surface-container-high/40
          border-outline-variant/20
          hover:bg-surface-container-highest/80
          hover:border-outline-variant/40
          hover:shadow-sm
          active:scale-[0.98]
          focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2
          transition-all duration-300
          rounded-full
          backdrop-blur-sm
        "
				onClick={() => setOpen(true)}
			>
				<Search size={20} aria-hidden="true" className="mr-2 text-primary" />
				<span className="hidden lg:inline-flex">Rechercher...</span>
				<span className="inline-flex lg:hidden truncate">Rechercher...</span>
			</Button>
			{SearchDialog}
		</>
	);
}
