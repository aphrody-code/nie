"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Popover,
	PopoverContent,
	PopoverTrigger,
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
	ToggleGroup,
	ToggleGroupItem,
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@rosegriffon/ui";
import { Icon } from "@/components/ui/Icon";
import {
	Check as CheckIcon,
	ChevronsUpDown,
	Search as SearchIcon,
	X as XIcon,
} from "@/lib/icons-config";
import { cn } from "@/lib/utils";

const CATEGORY_OPTIONS = [
	{ label: "Toutes catégories", value: "_all" },
	{ label: "Annonce", value: "announcement" },
	{ label: "Événement", value: "event" },
	{ label: "Critique", value: "critique" },
	{ label: "Communauté", value: "community" },
];

const SORT_OPTIONS = [
	{ label: "Date de création", value: "created_at" },
	{ label: "Date de publication", value: "published_at" },
	{ label: "Dernière modification", value: "updated_at" },
	{ label: "Nombre de vues", value: "view_count" },
];

const PERPAGE_OPTIONS = [
	{ label: "10 / page", value: "10" },
	{ label: "20 / page", value: "20" },
	{ label: "50 / page", value: "50" },
];

const STATUS_FILTERS = [
	{ icon: "filter_list" as const, label: "Tous", status: "" },
	{ icon: "check_circle" as const, label: "Publiés", status: "published" },
	{ icon: "edit_note" as const, label: "Brouillons", status: "draft" },
	{ icon: "schedule" as const, label: "Programmés", status: "scheduled" },
	{ icon: "archive" as const, label: "Archivés", status: "archived" },
];

interface NewsFiltersProps {
	totalItems: number;
	rangeStart: number;
	rangeEnd: number;
	authors?: Array<{ id: string; name: string }>;
}

export function NewsFilters({ totalItems, rangeStart, rangeEnd, authors = [] }: NewsFiltersProps) {
	const searchParams = useSearchParams();
	const router = useRouter();
	const currentStatus = searchParams.get("status") || "";
	const currentView = searchParams.get("view") || "grid";
	const currentSort = searchParams.get("sort") || "created_at";
	const currentPerPage = searchParams.get("perPage") || "20";
	const currentQ = searchParams.get("q") || "";
	const currentCategory = searchParams.get("category") || "";
	const currentAuthor = searchParams.get("author") || "";

	const [searchValue, setSearchValue] = useState(currentQ);
	const [authorOpen, setAuthorOpen] = useState(false);
	const searchTimerRef = useRef<NodeJS.Timeout | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const currentAuthorName = useMemo(
		() => authors.find((a) => a.id === currentAuthor)?.name,
		[authors, currentAuthor]
	);

	useEffect(() => {
		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
				e.preventDefault();
				inputRef.current?.focus();
			}
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);

	function buildHref(overrides: Record<string, string | null>) {
		const params = new URLSearchParams(searchParams.toString());
		for (const [key, value] of Object.entries(overrides)) {
			if (value === null || value === "") {
				params.delete(key);
			} else {
				params.set(key, value);
			}
		}
		if (
			"status" in overrides ||
			"q" in overrides ||
			"perPage" in overrides ||
			"category" in overrides ||
			"author" in overrides
		) {
			params.delete("page");
		}
		const qs = params.toString();
		return qs ? `?${qs}` : "/dashboard/news";
	}

	const pushOverrides = (overrides: Record<string, string | null>) => {
		router.push(buildHref(overrides));
	};

	const handleSearch = (value: string) => {
		setSearchValue(value);
		if (searchTimerRef.current) {
			clearTimeout(searchTimerRef.current);
		}
		searchTimerRef.current = setTimeout(() => {
			pushOverrides({ q: value || null });
		}, 400);
	};

	const clearSearch = () => {
		setSearchValue("");
		pushOverrides({ q: null });
		inputRef.current?.focus();
	};

	const activeAdvancedFilters = [currentCategory, currentAuthor].filter(Boolean).length;

	return (
		<div className="flex flex-col gap-3">
			{/* Row 1: Search + status filters + view toggle */}
			<div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-4">
				{/* Search bar (raw input pour conserver le style M3 pill) */}
				<div className="relative w-full sm:w-72">
					<SearchIcon className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3.5 size-4 text-on-surface-variant/50" />
					<input
						ref={inputRef}
						type="search"
						value={searchValue}
						onChange={(e) => handleSearch(e.target.value)}
						placeholder="Rechercher  /  pour focus"
						className="h-12 w-full rounded-full border border-outline-variant/50 bg-surface-container-low pr-10 pl-10 text-on-surface text-sm placeholder:text-on-surface-variant/50 transition-all focus:border-primary/50 focus:outline-hidden focus:ring-2 focus:ring-primary/30"
					/>
					{searchValue && (
						<button
							type="button"
							onClick={clearSearch}
							className="-translate-y-1/2 absolute top-1/2 right-3 rounded-full p-1 text-on-surface-variant/50 transition-colors hover:bg-surface-container-highest hover:text-on-surface"
							aria-label="Effacer la recherche"
						>
							<XIcon className="size-4" />
						</button>
					)}
				</div>

				{/* Status filters via ToggleGroup */}
				<ToggleGroup
					type="single"
					value={currentStatus}
					onValueChange={(value) => pushOverrides({ status: value || null })}
					className="scrollbar-hide w-full overflow-x-auto sm:w-auto"
					aria-label="Filtre par statut"
				>
					{STATUS_FILTERS.map((f) => (
						<ToggleGroupItem
							key={f.status || "all"}
							value={f.status}
							aria-label={f.label}
							className="h-10 shrink-0 gap-1.5 whitespace-nowrap rounded-full border border-outline-variant/50 px-3 font-medium text-xs data-[state=on]:bg-secondary-container data-[state=on]:text-on-secondary-container data-[state=on]:shadow-sm sm:px-4"
						>
							<Icon name={f.icon} size={16} className="opacity-80" />
							<span>{f.label}</span>
						</ToggleGroupItem>
					))}
				</ToggleGroup>

				{/* View toggle (grid/list) */}
				<ToggleGroup
					type="single"
					value={currentView}
					onValueChange={(value) => pushOverrides({ view: value || "grid" })}
					className="ml-auto shrink-0 rounded-full border border-outline-variant/50 bg-surface p-1"
					aria-label="Mode d'affichage"
				>
					<ToggleGroupItem
						value="grid"
						aria-label="Vue grille"
						className="size-9 rounded-full data-[state=on]:bg-surface-container-highest"
					>
						<Icon name="grid_view" size={18} />
					</ToggleGroupItem>
					<ToggleGroupItem
						value="list"
						aria-label="Vue liste"
						className="size-9 rounded-full data-[state=on]:bg-surface-container-highest"
					>
						<Icon name="view_list" size={18} />
					</ToggleGroupItem>
				</ToggleGroup>
			</div>

			{/* Row 2: Category + Author + Sort + PerPage + Counter */}
			<div className="flex flex-wrap items-center gap-2">
				{/* Category */}
				<Select
					value={currentCategory || "_all"}
					onValueChange={(value) => pushOverrides({ category: value === "_all" ? null : value })}
				>
					<SelectTrigger
						size="sm"
						aria-label="Filtrer par catégorie"
						className={cn(
							"h-8 gap-1.5 rounded-full border-outline-variant/40 bg-surface-container-low text-xs",
							currentCategory && "border-primary/30 bg-primary/10 text-primary"
						)}
					>
						<Icon name="category" size={14} className="opacity-70" />
						<SelectValue placeholder="Toutes catégories" />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{CATEGORY_OPTIONS.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>

				{/* Author (Combobox via Popover + Command) */}
				{authors.length > 0 && (
					<Popover open={authorOpen} onOpenChange={setAuthorOpen}>
						<PopoverTrigger asChild>
							<button
								type="button"
								aria-label="Filtrer par auteur"
								aria-expanded={authorOpen}
								className={cn(
									"flex h-8 items-center gap-1.5 rounded-full border border-outline-variant/40 bg-surface-container-low px-3 font-medium text-xs transition-colors hover:bg-surface-container",
									currentAuthor && "border-primary/30 bg-primary/10 text-primary"
								)}
							>
								<Icon name="person" size={14} className="opacity-70" />
								<span className="max-w-[120px] truncate">
									{currentAuthorName ?? "Tous les auteurs"}
								</span>
								<ChevronsUpDown className="size-3 opacity-50" />
							</button>
						</PopoverTrigger>
						<PopoverContent className="w-64 p-0" align="start">
							<Command>
								<CommandInput placeholder="Rechercher un auteur..." />
								<CommandList>
									<CommandEmpty>Aucun auteur trouvé.</CommandEmpty>
									<CommandGroup>
										<CommandItem
											value="__all__"
											onSelect={() => {
												pushOverrides({ author: null });
												setAuthorOpen(false);
											}}
										>
											<CheckIcon
												className={cn("mr-2 size-4", !currentAuthor ? "opacity-100" : "opacity-0")}
											/>
											Tous les auteurs
										</CommandItem>
										{authors.map((a) => (
											<CommandItem
												key={a.id}
												value={a.name}
												onSelect={() => {
													pushOverrides({ author: a.id });
													setAuthorOpen(false);
												}}
											>
												<CheckIcon
													className={cn(
														"mr-2 size-4",
														currentAuthor === a.id ? "opacity-100" : "opacity-0"
													)}
												/>
												{a.name}
											</CommandItem>
										))}
									</CommandGroup>
								</CommandList>
							</Command>
						</PopoverContent>
					</Popover>
				)}

				{/* Reset filters */}
				{activeAdvancedFilters > 0 && (
					<Tooltip>
						<TooltipTrigger asChild>
							<Link
								href={buildHref({ author: null, category: null })}
								className="flex h-8 items-center gap-1 rounded-full border border-error/20 bg-error/10 px-3 font-medium text-error text-xs transition-colors hover:bg-error/20"
							>
								<XIcon className="size-3" />
								{activeAdvancedFilters}
							</Link>
						</TooltipTrigger>
						<TooltipContent>Effacer les filtres avancés</TooltipContent>
					</Tooltip>
				)}

				<span className="size-1 rounded-full bg-outline-variant/50" />

				{/* Sort */}
				<Select
					value={currentSort}
					onValueChange={(value) => pushOverrides({ sort: value === "created_at" ? null : value })}
				>
					<SelectTrigger
						size="sm"
						aria-label="Trier par"
						className="h-8 gap-1.5 rounded-full border-outline-variant/40 bg-surface-container-low text-xs"
					>
						<Icon name="sort" size={14} className="opacity-70" />
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{SORT_OPTIONS.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>

				<span className="size-1 rounded-full bg-outline-variant/50" />

				{/* Per page */}
				<Select
					value={currentPerPage}
					onValueChange={(value) => pushOverrides({ perPage: value === "20" ? null : value })}
				>
					<SelectTrigger
						size="sm"
						aria-label="Résultats par page"
						className="h-8 gap-1.5 rounded-full border-outline-variant/40 bg-surface-container-low text-xs"
					>
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectGroup>
							{PERPAGE_OPTIONS.map((opt) => (
								<SelectItem key={opt.value} value={opt.value}>
									{opt.label}
								</SelectItem>
							))}
						</SelectGroup>
					</SelectContent>
				</Select>

				<span className="ml-auto text-on-surface-variant/70 text-xs">
					{totalItems > 0 ? `${rangeStart}–${rangeEnd} sur ${totalItems}` : "Aucun résultat"}
				</span>
			</div>
		</div>
	);
}
