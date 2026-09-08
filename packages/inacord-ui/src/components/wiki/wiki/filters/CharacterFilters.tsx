"use client";

import type { ReactNode } from "react";

import {
	FilterChipGroup,
	type FilterChipOption,
} from "../FilterChipGroup";
import {
	RarityFilterChips,
	type RarityFilterOption,
} from "../RarityFilterChips";

export interface CharacterFilterOption extends FilterChipOption {
	/** Host-owned image source resolved before mounting the shared surface. */
	readonly imageIcon?: string;
	/** Host-owned sprite key. The shared surface asks the host to render it. */
	readonly commonSprite?: string;
	/** Host-owned vector icon name. The shared surface asks the host to render it. */
	readonly icon?: string;
}

interface CharacterFilterSectionBase {
	/** Query-state key owned by the host adapter. */
	readonly id: string;
	readonly title: string;
}

export interface CharacterChoiceFilterSection extends CharacterFilterSectionBase {
	readonly kind?: "choices";
	readonly options: readonly CharacterFilterOption[];
	readonly hideLabel?: boolean;
	readonly renderIcon?: (option: CharacterFilterOption, imageOnly: boolean) => ReactNode;
}

export interface CharacterRarityFilterSection extends CharacterFilterSectionBase {
	readonly kind: "rarity";
	readonly options?: readonly RarityFilterOption[];
	readonly renderBadge?: (option: RarityFilterOption) => ReactNode;
}

export type CharacterFilterSection = CharacterChoiceFilterSection | CharacterRarityFilterSection;

export interface CharacterFiltersProps {
	/** Localized section labels and host-resolved asset metadata. */
	readonly sections: readonly CharacterFilterSection[];
	/** Controlled values; the component never reads a URL or a data source. */
	readonly selectedValues: Readonly<Record<string, string | null | undefined>>;
	readonly onToggle: (filter: string, value: string) => void;
	readonly isPending?: boolean;
	/** A host-specific selector (for example, a searchable team combobox). */
	readonly teamControl?: ReactNode;
}

/**
 * Controlled character catalogue filters shared by Inacord and web hosts.
 * Navigation, persistence, localization lookup, and asset resolution stay in
 * the mounting host; this component only owns the common visual hierarchy.
 */
export function CharacterFilters({
	sections,
	selectedValues,
	onToggle,
	isPending = false,
	teamControl,
}: CharacterFiltersProps) {
	return (
		<div className="flex flex-col gap-4 px-1 pb-6">
			{sections.map((section, index) => (
				<div key={section.id}>
					{index > 0 ? <hr className="mb-4 border-outline-variant/20" /> : null}
					<section className="space-y-2">
						<h4 className="text-xs font-bold uppercase tracking-wider text-primary">{section.title}</h4>
						{section.kind === "rarity" ? (
							<RarityFilterChips
								options={section.options}
								selectedValue={selectedValues[section.id] ?? null}
								onToggle={(value) => onToggle(section.id, value)}
								isPending={isPending}
								renderBadge={section.renderBadge}
							/>
						) : (
							<FilterChipGroup
								options={section.options}
								selectedValue={selectedValues[section.id] ?? null}
								onToggle={(value) => onToggle(section.id, value)}
								isPending={isPending}
								className="flex flex-wrap gap-1.5"
								hideLabel={section.hideLabel}
								renderIcon={section.renderIcon}
							/>
						)}
					</section>
				</div>
			))}
			{teamControl ? (
				<>
					<hr className="border-outline-variant/20" />
					<section className="space-y-2">{teamControl}</section>
				</>
			) : null}
		</div>
	);
}
