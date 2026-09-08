"use client";

import {
	TeamFilter as SharedTeamFilter,
	type TeamOption as SharedTeamOption,
} from "@niers/inacord-ui/components/wiki/wiki/TeamFilter";
import { useFilterNavigation } from "@/lib/hooks/use-filter-navigation";

export type { TeamOption } from "@niers/inacord-ui/components/wiki/wiki/TeamFilter";

interface TeamFilterProps {
	teams: SharedTeamOption[];
}

export function TeamFilter({ teams }: TeamFilterProps) {
	const { isPending, navigate, searchParams } = useFilterNavigation();
	const currentTeamId = searchParams.get("team");

	return (
		<SharedTeamFilter
			teams={teams}
			selectedTeamId={currentTeamId}
			isPending={isPending}
			labels={{
				placeholder: "Rechercher une équipe...",
				searchPlaceholder: "Nom de l'équipe...",
				empty: "Aucune équipe trouvée.",
			}}
			onToggle={(teamId) => {
				navigate((params) => {
					if (params.get("team") === teamId) {
						params.delete("team");
					} else {
						params.set("team", teamId);
					}
				});
			}}
		/>
	);
}
