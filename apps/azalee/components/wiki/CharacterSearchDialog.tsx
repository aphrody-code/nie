"use client";

import { SearchX, User } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { searchCompareCharacters } from "@/app/actions/search";
import type { CompareSearchResult } from "@/app/actions/search";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
	Skeleton,
} from "@rosegriffon/ui";
import { getSkillCategoryIconUrl, getSkillElementIconUrl } from "@rosegriffon/azalee/images";
import { cn } from "@/lib/utils";

interface CharacterSearchDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSelect: (slug: string, name: string) => void;
}

const ELEMENT_OPTIONS = [
	{ label: "Feu", sprite: "fire", value: "Fire" },
	{ label: "Vent", sprite: "wind", value: "Wind" },
	{ label: "Forêt", sprite: "forest", value: "Forest" },
	{ label: "Montagne", sprite: "mountain", value: "Mountain" },
] as const;

const POSITION_OPTIONS = [
	{ icon: "gardien", label: "GAR", value: "GK" },
	{ icon: "defense", label: "DEF", value: "DF" },
	{ icon: "dribble", label: "MIL", value: "MF" },
	{ icon: "tir", label: "ATT", value: "FW" },
] as const;

const RARITY_OPTIONS = [
	{ label: "Normal", value: "0" },
	{ label: "Expérimenté", value: "2" },
	{ label: "Héros", value: "10" },
	{ label: "BASARA", value: "20" },
] as const;

const POSITION_FR: Record<string, string> = {
	DF: "DEF",
	FW: "ATT",
	GK: "GAR",
	MF: "MIL",
};

const ELEMENT_FR: Record<string, string> = {
	Fire: "Feu",
	Forest: "Forêt",
	Mountain: "Montagne",
	Wind: "Vent",
};

export function CharacterSearchDialog({
	open,
	onOpenChange,
	onSelect,
}: CharacterSearchDialogProps) {
	const [query, setQuery] = React.useState("");
	const [results, setResults] = React.useState<CompareSearchResult[]>([]);
	const [isSearching, setIsSearching] = React.useState(false);
	const [elementFilter, setElementFilter] = React.useState<string | undefined>();
	const [positionFilter, setPositionFilter] = React.useState<string | undefined>();
	const [rarityFilter, setRarityFilter] = React.useState<string | undefined>();
	const abortRef = React.useRef<AbortController | null>(null);

	const filters = React.useMemo(
		() => ({
			element: elementFilter,
			position: positionFilter,
			rarity: rarityFilter,
		}),
		[elementFilter, positionFilter, rarityFilter]
	);

	const hasActiveFilters = elementFilter || positionFilter || rarityFilter;
	const hasText = query.length >= 2;
	const canSearch = hasText || hasActiveFilters;

	// Debounced search — triggers on text query OR filter-only browse
	React.useEffect(() => {
		if (abortRef.current) {
			abortRef.current.abort();
		}

		if (!canSearch) {
			setResults([]);
			setIsSearching(false);
			return;
		}

		setIsSearching(true);
		const timer = setTimeout(
			async () => {
				try {
					abortRef.current = new AbortController();
					const data = await searchCompareCharacters(query, filters);
					setResults(data);
				} catch (error) {
					if ((error as Error).name !== "AbortError") {
						console.error("Compare search error:", error);
						setResults([]);
					}
				} finally {
					setIsSearching(false);
				}
			},
			hasText ? 250 : 100
		);

		return () => {
			clearTimeout(timer);
			abortRef.current?.abort();
		};
	}, [query, filters, canSearch, hasText]);

	// Reset on close
	React.useEffect(() => {
		if (!open) {
			setQuery("");
			setResults([]);
			setIsSearching(false);
		}
	}, [open]);

	const toggleFilter = (
		setter: React.Dispatch<React.SetStateAction<string | undefined>>,
		value: string
	) => {
		setter((prev) => (prev === value ? undefined : value));
	};

	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title="Rechercher un personnage"
			description="Seuls les personnages avec stats sont affichés"
		>
			<CommandInput
				placeholder="Rechercher un personnage..."
				value={query}
				onValueChange={setQuery}
			/>

			{/* Filter chips */}
			<div className="px-3 py-2 space-y-2 border-b border-[var(--md-sys-color-outline-variant)]/20">
				{/* Element */}
				<div className="flex items-center gap-1.5 flex-wrap">
					<span className="text-[10px] font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase tracking-wider w-14 shrink-0">
						Element
					</span>
					{ELEMENT_OPTIONS.map(({ value, label, sprite: _sprite }) => (
						<button
							key={value}
							onClick={() => toggleFilter(setElementFilter, value)}
							aria-label={`Filtrer par élément ${label}`}
							aria-pressed={elementFilter === value}
							className={cn(
								"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold transition-all",
								elementFilter === value
									? "bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]"
									: "bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-highest)]"
							)}
						>
							{getSkillElementIconUrl(value) && (
								<Image
									src={getSkillElementIconUrl(value)}
									alt=""
									width={12}
									height={12}
									className="size-3 object-contain"
								/>
							)}
							{label}
						</button>
					))}
				</div>

				{/* Position */}
				<div className="flex items-center gap-1.5 flex-wrap">
					<span className="text-[10px] font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase tracking-wider w-14 shrink-0">
						Poste
					</span>
					{POSITION_OPTIONS.map(({ value, label, icon }) => (
						<button
							key={value}
							onClick={() => toggleFilter(setPositionFilter, value)}
							aria-label={`Filtrer par poste ${label}`}
							aria-pressed={positionFilter === value}
							className={cn(
								"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold transition-all",
								positionFilter === value
									? "bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]"
									: "bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-highest)]"
							)}
						>
							{getSkillCategoryIconUrl(icon) && (
								<Image
									src={getSkillCategoryIconUrl(icon)}
									alt=""
									width={12}
									height={12}
									className="size-3 object-contain"
								/>
							)}
							{label}
						</button>
					))}
				</div>

				{/* Rarity */}
				<div className="flex items-center gap-1.5 flex-wrap">
					<span className="text-[10px] font-bold text-[var(--md-sys-color-on-surface-variant)] uppercase tracking-wider w-14 shrink-0">
						Rareté
					</span>
					{RARITY_OPTIONS.map(({ value, label }) => (
						<button
							key={value}
							onClick={() => toggleFilter(setRarityFilter, value)}
							aria-label={`Filtrer par rareté ${label}`}
							aria-pressed={rarityFilter === value}
							className={cn(
								"inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold transition-all",
								rarityFilter === value
									? "bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]"
									: "bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-highest)]"
							)}
						>
							{label}
						</button>
					))}
					{hasActiveFilters && (
						<button
							onClick={() => {
								setElementFilter(undefined);
								setPositionFilter(undefined);
								setRarityFilter(undefined);
							}}
							aria-label="Effacer tous les filtres"
							className="text-[10px] text-[var(--md-sys-color-primary)] hover:underline ml-1"
						>
							Effacer
						</button>
					)}
				</div>
			</div>

			<CommandList className="max-h-[350px]">
				{/* Guide initial — aucun texte ni filtre actif */}
				{!canSearch && !isSearching && results.length === 0 && (
					<div className="py-8 text-center px-4">
						<User
							size={32}
							aria-hidden="true"
							className="mx-auto text-[var(--md-sys-color-on-surface-variant)]/40 mb-3"
						/>
						<p className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
							Tapez un nom ou utilisez les filtres
						</p>
						<p className="text-[11px] text-[var(--md-sys-color-on-surface-variant)]/50 mt-1">
							Seuls les personnages avec statistiques sont affichés
						</p>
					</div>
				)}

				{canSearch && !isSearching && results.length === 0 && (
					<CommandEmpty>
						<div className="py-6 text-center">
							<SearchX
								size={36}
								aria-hidden="true"
								className="text-[var(--md-sys-color-on-surface-variant)] mb-2"
							/>
							<p className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
								{hasText
									? `Aucun personnage avec stats pour "${query}"`
									: "Aucun personnage pour ces filtres"}
							</p>
						</div>
					</CommandEmpty>
				)}

				{isSearching && (
					<div className="px-2 py-3 space-y-2">
						{[...Array(3)].map((_, i) => (
							<div key={i} className="flex items-center gap-3 p-2">
								<Skeleton className="size-8 rounded-lg" />
								<div className="space-y-1 flex-1">
									<Skeleton className="h-4 w-3/4" />
									<Skeleton className="h-3 w-1/2" />
								</div>
							</div>
						))}
					</div>
				)}

				{results.length > 0 && (
					<CommandGroup
						heading={`Personnages (${results.length})`}
						className="[&_[cmdk-group-heading]]:text-[var(--md-sys-color-primary)] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:uppercase"
					>
						{results.map((result) => {
							const elemIcon = result.element ? getSkillElementIconUrl(result.element) : null;
							// value unique par slug : sinon cmdk confond les versions d’un même nom
							// (Byron IE / Ares / GO → un seul item sélectionnable)
							const seriesLabel = result.series
								? result.series.replace(/^Inazuma Eleven\s*/i, "").trim() || result.series
								: undefined;
							return (
								<CommandItem
									key={result.slug}
									value={`${result.name} ${seriesLabel || ""} ${result.rarity || ""} ${result.slug}`}
									onSelect={() => {
										onSelect(result.slug, result.name);
										onOpenChange(false);
									}}
									className={cn(
										"flex items-center gap-3 py-2.5 px-2 rounded-xl cursor-pointer",
										"data-[selected=true]:bg-[var(--md-sys-color-secondary-container)]/20",
										"transition-all duration-200"
									)}
								>
									{/* Character icon */}
									<div className="relative size-8 rounded-lg overflow-hidden bg-[var(--md-sys-color-surface-container-high)] shrink-0">
										{result.zukanHash ? (
											<Image
												src={`https://dxi4wb638ujep.cloudfront.net/1/${result.zukanHash}.png`}
												alt=""
												fill
												className="object-contain"
												unoptimized
											/>
										) : result.imageUrl ? (
											<Image
												src={result.imageUrl}
												alt=""
												fill
												className="object-contain"
												unoptimized
												onError={(e) => {
													(e.target as HTMLImageElement).style.display = "none";
												}}
											/>
										) : (
											<User
												size={18}
												aria-hidden="true"
												className="text-[var(--md-sys-color-on-surface-variant)] m-auto"
											/>
										)}
									</div>

									<div className="flex-1 min-w-0">
										<span className="font-medium text-sm text-[var(--md-sys-color-on-surface)] truncate block">
											{result.name}
											{seriesLabel && seriesLabel !== "Inazuma Eleven" && (
												<span className="ml-1.5 font-semibold text-[var(--md-sys-color-primary)]">
													({seriesLabel})
												</span>
											)}
										</span>
										<div className="flex items-center gap-1.5 text-[10px] text-[var(--md-sys-color-on-surface-variant)]">
											{result.position && (
												<span className="font-bold">
													{POSITION_FR[result.position] || result.position}
												</span>
											)}
											{elemIcon && (
												<Image src={elemIcon} alt="" width={10} height={10} className="size-2.5" />
											)}
											{result.element && (
												<span>{ELEMENT_FR[result.element] || result.element}</span>
											)}
											{result.rarity && result.rarity !== "Normal" && (
												<span
													className={cn(
														"font-bold",
														result.rarity === "BASARA" && "text-pink-400",
														result.rarity === "Héros" && "text-violet-400",
														result.rarity === "Émérite" && "text-blue-300",
														result.rarity === "Expérimenté" && "text-cyan-400"
													)}
												>
													{result.rarity}
												</span>
											)}
											{result.totalStats > 0 && (
												<span className="ml-auto tabular-nums text-[var(--md-sys-color-on-surface-variant)]/60">
													Total: {result.totalStats}
												</span>
											)}
										</div>
									</div>
								</CommandItem>
							);
						})}
					</CommandGroup>
				)}
			</CommandList>
		</CommandDialog>
	);
}
