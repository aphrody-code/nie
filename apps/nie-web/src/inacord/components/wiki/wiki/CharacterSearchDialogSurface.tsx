"use client";

import { SearchX, User } from "lucide-react";
import type { ReactNode } from "react";
import {
	CommandDialog,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "../../ui/command";
import { Skeleton } from "../../ui/skeleton";
import { cn } from "../../../lib/utils";

export interface CharacterSearchFilterOption {
	label: string;
	value: string;
}

export interface CharacterSearchFilters {
	element?: string;
	position?: string;
	rarity?: string;
}

export interface CharacterSearchResult {
	element?: string | null;
	imageUrl?: string | null;
	name: string;
	position?: string | null;
	rarity?: string | null;
	series?: string | null;
	slug: string;
	totalStats: number;
	zukanHash?: string | null;
}

export interface CharacterSearchDialogLabels {
	clearFilters: string;
	description: string;
	element: string;
	emptyForFilters: string;
	emptyForQuery: (query: string) => string;
	filterElement: (label: string) => string;
	filterPosition: (label: string) => string;
	filterRarity: (label: string) => string;
	initialDescription: string;
	initialTitle: string;
	position: string;
	rarity: string;
	results: (count: number) => string;
	searchPlaceholder: string;
	title: string;
	totalStats: (total: number) => string;
}

export interface CharacterSearchDialogSurfaceProps<TResult extends CharacterSearchResult> {
	elementOptions: readonly CharacterSearchFilterOption[];
	filters: CharacterSearchFilters;
	isSearching: boolean;
	labels: CharacterSearchDialogLabels;
	onFiltersChange: (filters: CharacterSearchFilters) => void;
	onOpenChange: (open: boolean) => void;
	onQueryChange: (query: string) => void;
	onSelect: (result: TResult) => void;
	open: boolean;
	positionOptions: readonly CharacterSearchFilterOption[];
	query: string;
	rarityClassName?: (rarity: string) => string | undefined;
	rarityOptions: readonly CharacterSearchFilterOption[];
	results: readonly TResult[];
	renderCharacterImage: (result: TResult) => ReactNode;
	renderElementIcon?: (element: string) => ReactNode;
	renderFilterIcon?: (
		kind: "element" | "position",
		option: CharacterSearchFilterOption,
	) => ReactNode;
	resolveElementLabel: (element: string) => string;
	resolvePositionLabel: (position: string) => string;
}

/**
 * Host-neutral character lookup presentation.
 *
 * The host owns its search transport, locale data, navigation and image source.
 * This component owns only the controlled dialog, filter affordances and result rows.
 */
export function CharacterSearchDialogSurface<TResult extends CharacterSearchResult>({
	elementOptions,
	filters,
	isSearching,
	labels,
	onFiltersChange,
	onOpenChange,
	onQueryChange,
	onSelect,
	open,
	positionOptions,
	query,
	rarityClassName,
	rarityOptions,
	results,
	renderCharacterImage,
	renderElementIcon,
	renderFilterIcon,
	resolveElementLabel,
	resolvePositionLabel,
}: CharacterSearchDialogSurfaceProps<TResult>) {
	const hasActiveFilters = Boolean(filters.element || filters.position || filters.rarity);
	const hasText = query.length >= 2;
	const canSearch = hasText || hasActiveFilters;

	const toggleFilter = (kind: keyof CharacterSearchFilters, value: string) => {
		onFiltersChange({
			...filters,
			[kind]: filters[kind] === value ? undefined : value,
		});
	};

	return (
		<CommandDialog
			open={open}
			onOpenChange={onOpenChange}
			title={labels.title}
			description={labels.description}
		>
			<CommandInput
				placeholder={labels.searchPlaceholder}
				value={query}
				onValueChange={onQueryChange}
			/>

			<div className="space-y-2 border-b border-[var(--md-sys-color-outline-variant)]/20 px-3 py-2">
				<FilterRow
					activeValue={filters.element}
					ariaLabel={labels.filterElement}
					label={labels.element}
					onToggle={(value) => toggleFilter("element", value)}
					options={elementOptions}
					renderIcon={(option) => renderFilterIcon?.("element", option)}
				/>
				<FilterRow
					activeValue={filters.position}
					ariaLabel={labels.filterPosition}
					label={labels.position}
					onToggle={(value) => toggleFilter("position", value)}
					options={positionOptions}
					renderIcon={(option) => renderFilterIcon?.("position", option)}
				/>
				<FilterRow
					activeValue={filters.rarity}
					ariaLabel={labels.filterRarity}
					label={labels.rarity}
					onToggle={(value) => toggleFilter("rarity", value)}
					options={rarityOptions}
					trailing={hasActiveFilters ? (
						<button
							onClick={() => onFiltersChange({})}
							aria-label={labels.clearFilters}
							className="ml-1 text-[10px] text-[var(--md-sys-color-primary)] hover:underline"
						>
							{labels.clearFilters}
						</button>
					) : undefined}
				/>
			</div>

			<CommandList className="max-h-[350px]">
				{!canSearch && !isSearching && results.length === 0 && (
					<div className="px-4 py-8 text-center">
						<User
							size={32}
							aria-hidden="true"
							className="mx-auto mb-3 text-[var(--md-sys-color-on-surface-variant)]/40"
						/>
						<p className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
							{labels.initialTitle}
						</p>
						<p className="mt-1 text-[11px] text-[var(--md-sys-color-on-surface-variant)]/50">
							{labels.initialDescription}
						</p>
					</div>
				)}

				{canSearch && !isSearching && results.length === 0 && (
					<CommandEmpty>
						<div className="py-6 text-center">
							<SearchX
								size={36}
								aria-hidden="true"
								className="mb-2 text-[var(--md-sys-color-on-surface-variant)]"
							/>
							<p className="text-sm text-[var(--md-sys-color-on-surface-variant)]">
								{hasText ? labels.emptyForQuery(query) : labels.emptyForFilters}
							</p>
						</div>
					</CommandEmpty>
				)}

				{isSearching && <SearchSkeleton />}

				{results.length > 0 && (
					<CommandGroup
						heading={labels.results(results.length)}
						className="[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:text-[var(--md-sys-color-primary)]"
					>
						{results.map((result) => {
							const seriesLabel = result.series
								? result.series.replace(/^Inazuma Eleven\s*/i, "").trim() || result.series
								: undefined;
							const rarityClass = result.rarity ? rarityClassName?.(result.rarity) : undefined;

							return (
								<CommandItem
									key={result.slug}
									value={`${result.name} ${seriesLabel || ""} ${result.rarity || ""} ${result.slug}`}
									onSelect={() => {
										onSelect(result);
										onOpenChange(false);
									}}
									className={cn(
										"flex cursor-pointer items-center gap-3 rounded-xl px-2 py-2.5",
										"transition-all duration-200 data-[selected=true]:bg-[var(--md-sys-color-secondary-container)]/20",
									)}
								>
									<div className="relative size-8 shrink-0 overflow-hidden rounded-lg bg-[var(--md-sys-color-surface-container-high)]">
										{renderCharacterImage(result)}
									</div>
									<div className="min-w-0 flex-1">
										<span className="block truncate text-sm font-medium text-[var(--md-sys-color-on-surface)]">
											{result.name}
											{seriesLabel && seriesLabel !== "Inazuma Eleven" && (
												<span className="ml-1.5 font-semibold text-[var(--md-sys-color-primary)]">
													({seriesLabel})
												</span>
											)}
										</span>
										<div className="flex items-center gap-1.5 text-[10px] text-[var(--md-sys-color-on-surface-variant)]">
											{result.position && (
												<span className="font-bold">{resolvePositionLabel(result.position)}</span>
											)}
											{result.element && renderElementIcon?.(result.element)}
											{result.element && <span>{resolveElementLabel(result.element)}</span>}
											{result.rarity && result.rarity !== "Normal" && (
												<span className={cn("font-bold", rarityClass)}>{result.rarity}</span>
											)}
											{result.totalStats > 0 && (
												<span className="ml-auto tabular-nums text-[var(--md-sys-color-on-surface-variant)]/60">
													{labels.totalStats(result.totalStats)}
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

interface FilterRowProps {
	activeValue?: string;
	ariaLabel: (label: string) => string;
	label: string;
	onToggle: (value: string) => void;
	options: readonly CharacterSearchFilterOption[];
	renderIcon?: (option: CharacterSearchFilterOption) => ReactNode;
	trailing?: ReactNode;
}

function FilterRow({ activeValue, ariaLabel, label, onToggle, options, renderIcon, trailing }: FilterRowProps) {
	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<span className="w-14 shrink-0 text-[10px] font-bold uppercase tracking-wider text-[var(--md-sys-color-on-surface-variant)]">
				{label}
			</span>
			{options.map((option) => {
				const selected = activeValue === option.value;
				return (
					<button
						key={option.value}
						onClick={() => onToggle(option.value)}
						aria-label={ariaLabel(option.label)}
						aria-pressed={selected}
						className={cn(
							"inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold transition-all",
							selected
								? "bg-[var(--md-sys-color-primary)] text-[var(--md-sys-color-on-primary)]"
								: "bg-[var(--md-sys-color-surface-container-high)] text-[var(--md-sys-color-on-surface-variant)] hover:bg-[var(--md-sys-color-surface-container-highest)]",
						)}
					>
						{renderIcon?.(option)}
						{option.label}
					</button>
				);
			})}
			{trailing}
		</div>
	);
}

function SearchSkeleton() {
	return (
		<div className="space-y-2 px-2 py-3">
			{Array.from({ length: 3 }, (_, index) => (
				<div key={index} className="flex items-center gap-3 p-2">
					<Skeleton className="size-8 rounded-lg" />
					<div className="flex-1 space-y-1">
						<Skeleton className="h-4 w-3/4" />
						<Skeleton className="h-3 w-1/2" />
					</div>
				</div>
			))}
		</div>
	);
}
