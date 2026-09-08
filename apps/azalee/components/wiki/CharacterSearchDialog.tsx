"use client";

import { User } from "lucide-react";
import Image from "next/image";
import * as React from "react";
import { searchCompareCharacters } from "@/app/actions/search";
import type { CompareSearchResult } from "@/app/actions/search";
import { CharacterSearchDialogSurface } from "@niers/inacord-ui/components/wiki/wiki/CharacterSearchDialogSurface";
import { getSkillCategoryIconUrl, getSkillElementIconUrl } from "@rosegriffon/azalee/images";

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

	return (
		<CharacterSearchDialogSurface
			open={open}
			onOpenChange={onOpenChange}
			query={query}
			onQueryChange={setQuery}
			filters={filters}
			onFiltersChange={({ element, position, rarity }) => {
				setElementFilter(element);
				setPositionFilter(position);
				setRarityFilter(rarity);
			}}
			isSearching={isSearching}
			results={results}
			onSelect={(result) => onSelect(result.slug, result.name)}
			elementOptions={ELEMENT_OPTIONS}
			positionOptions={POSITION_OPTIONS}
			rarityOptions={RARITY_OPTIONS}
			labels={{
				title: "Rechercher un personnage",
				description: "Seuls les personnages avec stats sont affichés",
				searchPlaceholder: "Rechercher un personnage...",
				element: "Element",
				position: "Poste",
				rarity: "Rareté",
				clearFilters: "Effacer",
				filterElement: (label) => `Filtrer par élément ${label}`,
				filterPosition: (label) => `Filtrer par poste ${label}`,
				filterRarity: (label) => `Filtrer par rareté ${label}`,
				initialTitle: "Tapez un nom ou utilisez les filtres",
				initialDescription: "Seuls les personnages avec statistiques sont affichés",
				emptyForQuery: (value) => `Aucun personnage avec stats pour \"${value}\"`,
				emptyForFilters: "Aucun personnage pour ces filtres",
				results: (count) => `Personnages (${count})`,
				totalStats: (total) => `Total: ${total}`,
			}}
			renderFilterIcon={(kind, option) => {
				const icon = kind === "element"
					? getSkillElementIconUrl(option.value)
					: getSkillCategoryIconUrl(
						POSITION_OPTIONS.find(({ value }) => value === option.value)?.icon ?? option.value,
					);
				return icon ? <Image src={icon} alt="" width={12} height={12} className="size-3 object-contain" /> : null;
			}}
			renderElementIcon={(element) => {
				const icon = getSkillElementIconUrl(element);
				return icon ? <Image src={icon} alt="" width={10} height={10} className="size-2.5" /> : null;
			}}
			renderCharacterImage={(result) => result.zukanHash ? (
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
					onError={(event) => {
						(event.target as HTMLImageElement).style.display = "none";
					}}
				/>
			) : (
				<User size={18} aria-hidden="true" className="m-auto text-[var(--md-sys-color-on-surface-variant)]" />
			)}
			resolveElementLabel={(element) => ELEMENT_FR[element] || element}
			resolvePositionLabel={(position) => POSITION_FR[position] || position}
			rarityClassName={(rarity) => {
				if (rarity === "BASARA") return "text-pink-400";
				if (rarity === "Héros") return "text-violet-400";
				if (rarity === "Émérite") return "text-blue-300";
				if (rarity === "Expérimenté") return "text-cyan-400";
				return undefined;
			}}
		/>
	);
}
