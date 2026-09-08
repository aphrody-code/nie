"use client";

import type { ReactNode } from "react";
import { cn } from "../../../lib/utils";

export interface FilterChipOption {
	label: string;
	value: string;
}

export interface FilterChipGroupProps<TOption extends FilterChipOption> {
	options: readonly TOption[];
	selectedValue: string | null;
	onToggle: (value: string) => void;
	isPending?: boolean;
	className?: string;
	hideLabel?: boolean;
	renderIcon?: (option: TOption, imageOnly: boolean) => ReactNode;
}

/**
 * Host-neutral filter-chip presentation. Hosts retain ownership of route or
 * in-memory filter state and of asset resolution; this component only renders
 * the shared interaction and selection affordance.
 */
export function FilterChipGroup<TOption extends FilterChipOption>({
	options,
	selectedValue,
	onToggle,
	isPending = false,
	className,
	hideLabel = false,
	renderIcon,
}: FilterChipGroupProps<TOption>) {
	return (
		<div
			className={cn(
				"flex flex-wrap gap-2",
				isPending && "pointer-events-none opacity-70",
				className,
			)}
		>
			{options.map((option) => {
				const isSelected = selectedValue === option.value;
				const icon = renderIcon?.(option, hideLabel);
				const isImageOnly = hideLabel && icon != null;

				return (
					<button
						key={option.value}
						onClick={() => onToggle(option.value)}
						title={option.label}
						aria-pressed={isSelected}
						className={cn(
							"inline-flex items-center gap-1.5 transition-all duration-200 ease-[cubic-bezier(0.2,0,0,1)]",
							"focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50",
							isImageOnly
								? "p-1 bg-transparent border-none hover:scale-110 active:scale-95 min-h-11 min-w-11 justify-center"
								: "px-4 py-2 rounded-full text-sm font-medium border min-h-11 sm:min-h-0",
							!isImageOnly &&
								(isSelected
									? "bg-secondary-container text-on-secondary-container border-transparent"
									: "bg-surface text-on-surface-variant border-outline-variant hover:bg-on-surface/[0.08]"),
							isImageOnly &&
								isSelected &&
								"brightness-125 scale-110 drop-shadow-[0_0_8px_rgba(var(--md-sys-color-primary-rgb),0.5)]",
						)}
					>
						{icon}
						{!hideLabel && option.label}
					</button>
				);
			})}
		</div>
	);
}
