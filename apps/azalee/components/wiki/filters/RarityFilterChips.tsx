"use client";

import { RarityBadge } from "@/components/ui/rarity-badge";
import { useFilterNavigation } from "@/lib/hooks/use-filter-navigation";
import { cn } from "@/lib/utils";

// Tiers de rareté in-game (progression Normal → Expérimenté → Héros → BASARA).
// "Expérimenté" (≈150 perso en DB) était manquant → filtre incomplet.
const RARITY_OPTIONS = [
	{ rarity: "Normal", value: "Normal" },
	{ rarity: "Expérimenté", value: "Expérimenté" },
	{ rarity: "Héros", value: "Héros" },
	{ rarity: "BASARA", value: "BASARA" },
] as const;

export function RarityFilterChips() {
	const { isPending, navigate, searchParams } = useFilterNavigation();
	const currentValue = searchParams.get("rarity");

	const toggle = (value: string) => {
		navigate((params) => {
			if (params.get("rarity") === value) {
				params.delete("rarity");
			} else {
				params.set("rarity", value);
			}
		});
	};

	return (
		<div className={cn("flex flex-wrap gap-2", isPending && "pointer-events-none")}>
			{RARITY_OPTIONS.map(({ value, rarity }) => {
				const isSelected = currentValue === value;
				return (
					<button
						key={value}
						onClick={() => toggle(value)}
						className={cn(
							"inline-flex items-center justify-center min-h-11 sm:min-h-0 transition-all duration-200 rounded-full",
							"focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary/50",
							isSelected
								? "ring-2 ring-primary scale-105 shadow-md"
								: "opacity-70 hover:opacity-100 hover:scale-105"
						)}
					>
						<RarityBadge rarity={rarity} size="md" />
					</button>
				);
			})}
		</div>
	);
}
