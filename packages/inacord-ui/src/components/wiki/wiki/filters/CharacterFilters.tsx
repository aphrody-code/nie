"use client";

import type { ReactNode } from "react";

import {
	type GameFilterFamily,
	GameFilterPanel,
	type GameFilterValue,
} from "../../../game/GameFilterPanel";
import type { FilterChipOption } from "../FilterChipGroup";
import { DEFAULT_RARITY_OPTIONS, type RarityFilterOption } from "../RarityFilterChips";
import { RarityBadge } from "../../ui/rarity-badge";

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
	/** Dismissing the dialog without applying. Hosts that mount it inline omit it. */
	readonly onClose?: () => void;
	/** The count the current selection retains, when the host measures it. */
	readonly count?: number;
	readonly countUnit?: string;
}

/**
 * One section becomes one family of the game's FILTERS dialog.
 *
 * A section holds at most one value in the host state (`Record<string, string | null>`), which
 * is exactly the panel's `single` mode: ticking a box replaces the previous one, unticking the
 * ticked box goes back to « Tout ».
 */
function familyOf(section: CharacterFilterSection): GameFilterFamily {
	if (section.kind === "rarity") {
		const options = section.options ?? DEFAULT_RARITY_OPTIONS;
		return {
			id: section.id,
			label: section.title,
			mode: "single" as const,
			// The family strip shows one icon per section: the first badge of the section, so
			// the strip reads like the list it opens.
			icon: options[0]
				? (section.renderBadge?.(options[0]) ?? <RarityBadge rarity={options[0].rarity} size="md" />)
				: section.title.slice(0, 1),
			options: options.map((option) => ({
				value: option.value,
				label: option.rarity,
				icon: section.renderBadge?.(option) ?? <RarityBadge rarity={option.rarity} size="md" />,
			})),
		};
	}
	const first = section.options[0];
	return {
		id: section.id,
		label: section.title,
		mode: "single" as const,
		icon: (first ? section.renderIcon?.(first, true) : undefined) ?? section.title.slice(0, 1),
		options: section.options.map((option) => ({
			value: option.value,
			// `hideLabel` asked the chips to render the icon alone. The dialog always names its
			// boxes — a grid of unlabelled pictures is not the screen the game draws — so the
			// host renderer is asked for the icon only, and the label stays.
			label: option.label,
			icon: section.renderIcon?.(option, section.hideLabel ?? false),
		})),
	};
}

/**
 * Controlled character catalogue filters shared by Inacord and web hosts, rendered as the
 * game's own FILTERS dialog (`data/menu/filters_*.png`) instead of rows of chips.
 *
 * Navigation, persistence, localization lookup, and asset resolution stay in the mounting
 * host; this component only owns the common visual hierarchy. The host keeps its `onToggle`
 * contract: confirming the dialog reports each section whose value actually changed, and a
 * section brought back to « Tout » is reported with the value it previously held — the same
 * call a second click on a selected chip used to make.
 */
export function CharacterFilters({
	sections,
	selectedValues,
	onToggle,
	isPending = false,
	teamControl,
	onClose,
	count,
	countUnit,
}: CharacterFiltersProps) {
	const families = sections.map(familyOf);
	const value: GameFilterValue = Object.fromEntries(
		sections.map((section) => {
			const selected = selectedValues[section.id];
			return [section.id, selected ? [selected] : []];
		}),
	);

	const confirm = (next: GameFilterValue) => {
		if (isPending) return;
		for (const section of sections) {
			const before = selectedValues[section.id] ?? null;
			const after = next[section.id]?.[0] ?? null;
			if (after === before) continue;
			// Clearing a section is a toggle of the value it held: the host owns the semantics
			// of its own query state, and it already answers that call.
			onToggle(section.id, after ?? before ?? "");
		}
		onClose?.();
	};

	return (
		<div className="flex flex-col gap-4 px-1 pb-6">
			<GameFilterPanel
				families={families}
				value={value}
				onConfirm={confirm}
				onClose={onClose}
				count={count}
				countUnit={countUnit}
			/>
			{teamControl ? (
				<>
					<hr className="border-outline-variant/20" />
					<section className="space-y-2">{teamControl}</section>
				</>
			) : null}
		</div>
	);
}
