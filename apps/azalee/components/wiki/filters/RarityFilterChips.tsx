"use client";

import { RarityFilterChips as SharedRarityFilterChips } from "@niers/inacord-ui/components/wiki/wiki/RarityFilterChips";
import { useFilterNavigation } from "@/lib/hooks/use-filter-navigation";

/** Azalée adapter: URL search-state navigation remains local to the Next host. */
export function RarityFilterChips() {
	const { isPending, navigate, searchParams } = useFilterNavigation();
	const currentValue = searchParams.get("rarity");

	return (
		<SharedRarityFilterChips
			selectedValue={currentValue}
			isPending={isPending}
			onToggle={(value) => {
				navigate((params) => {
					if (params.get("rarity") === value) {
						params.delete("rarity");
					} else {
						params.set("rarity", value);
					}
				});
			}}
		/>
	);
}
