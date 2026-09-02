"use client";

import { useMemo, useState } from "react";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { TeamCard } from "@/components/wiki/TeamCard";
import { Icon } from "@/components/ui/Icon";
import { SERIES_LABELS, type TeamListItem } from "@rosegriffon/azalee/wiki/teams-shared";
import { cn } from "@/lib/utils";

interface TeamsListClientProps {
	teams: TeamListItem[];
}

const SERIES_FILTERS: Array<{ value: string; label: string }> = [
	{ value: "all", label: "Toutes" },
	{ value: "v", label: SERIES_LABELS.v },
	{ value: "go", label: SERIES_LABELS.go },
	{ value: "ie", label: SERIES_LABELS.ie },
	{ value: "aresOrion", label: SERIES_LABELS.aresOrion },
];

function normalize(s: string): string {
	return s
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "");
}

export function TeamsListClient({ teams }: TeamsListClientProps) {
	const [query, setQuery] = useState("");
	const [series, setSeries] = useState("all");

	const filtered = useMemo(() => {
		const q = normalize(query.trim());
		return teams.filter((t) => {
			if (series !== "all" && !t.seriesKeys.includes(series)) return false;
			if (!q) return true;
			const haystack = normalize(`${t.name} ${t.nameEn ?? ""} ${t.nameJa ?? ""}`);
			return haystack.includes(q);
		});
	}, [teams, query, series]);

	return (
		<div className="space-y-6">
			<div className="space-y-4">
				{/* Recherche */}
				<div className="relative">
					<Icon
						name="search"
						size={18}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60"
					/>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher une équipe..."
						className="w-full rounded-full border border-outline-variant bg-surface-container-low pl-10 pr-4 py-2.5 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus:ring-2 focus:ring-primary/40"
					/>
				</div>

				{/* Filtre série */}
				<div className="flex flex-wrap gap-2">
					{SERIES_FILTERS.map((f) => (
						<button
							key={f.value}
							type="button"
							onClick={() => setSeries(f.value)}
							className={cn(
								"px-3 py-1.5 rounded-full text-xs font-bold transition-colors border min-h-11 sm:min-h-0",
								series === f.value
									? "bg-primary text-on-primary border-primary"
									: "bg-surface-container-low text-on-surface-variant border-outline-variant hover:bg-surface-container"
							)}
						>
							{f.label}
						</button>
					))}
				</div>
			</div>

			<div className="flex items-center justify-between text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				<span>{filtered.length.toLocaleString("fr-FR")} équipes</span>
			</div>

			{filtered.length > 0 ? (
				<FadeInStagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{filtered.map((team) => (
						<FadeInItem key={team.id} className="h-full">
							<TeamCard team={team} className="h-full" />
						</FadeInItem>
					))}
				</FadeInStagger>
			) : (
				<div className="py-20 text-center rounded-[32px] border border-outline-variant bg-surface-container-low border-dashed">
					<p className="text-on-surface-variant italic">Aucune équipe trouvée.</p>
				</div>
			)}
		</div>
	);
}
