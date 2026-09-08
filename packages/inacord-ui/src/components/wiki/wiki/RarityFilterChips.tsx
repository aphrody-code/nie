"use client";

import type { ReactNode } from "react";

import { RarityBadge } from "../../ui/rarity-badge";
import { cn } from "../../../lib/utils";

export interface RarityFilterOption {
	/** Value written by the host's filter state. */
	value: string;
	/** Game-facing rarity label rendered in the chip. */
	rarity: string;
}

export interface RarityFilterChipsProps {
	options?: readonly RarityFilterOption[];
	selectedValue: string | null;
	onToggle: (value: string) => void;
	isPending?: boolean;
	className?: string;
	/** Hosts with a native rarity renderer can replace the shared badge. */
	renderBadge?: (option: RarityFilterOption) => ReactNode;
}

/**
 * Controlled, host-neutral rarity filter presentation. Routing, persistence,
 * and localized option discovery remain responsibilities of the mounted host.
 */
export function RarityFilterChips({
	options = DEFAULT_RARITY_OPTIONS,
	selectedValue,
	onToggle,
	isPending = false,
	className,
	renderBadge,
}: RarityFilterChipsProps) {
	return (
		<div className={cn("flex flex-wrap gap-2", isPending && "pointer-events-none", className)}>
			{options.map((option) => {
				const isSelected = selectedValue === option.value;
				return (
					<button
						key={option.value}
						type="button"
						onClick={() => onToggle(option.value)}
						aria-pressed={isSelected}
						className={cn(
							"inline-flex min-h-11 items-center justify-center rounded-full transition-all duration-200 sm:min-h-0",
							"focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50",
							isSelected
								? "scale-105 ring-2 ring-primary shadow-md"
								: "opacity-70 hover:scale-105 hover:opacity-100",
						)}
					>
						{renderBadge?.(option) ?? <RarityBadge rarity={option.rarity} size="md" />}
					</button>
				);
			})}
		</div>
	);
}

export const DEFAULT_RARITY_OPTIONS: readonly RarityFilterOption[] = [
	{ rarity: "Normal", value: "Normal" },
	{ rarity: "Expérimenté", value: "Expérimenté" },
	{ rarity: "Héros", value: "Héros" },
	{ rarity: "BASARA", value: "BASARA" },
];
