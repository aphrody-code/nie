export const dynamic = "force-dynamic";

import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { StadiumCard } from "@/components/wiki/StadiumCard";
import { WikiSearchToolbar } from "@/components/wiki/WikiSearchToolbar";
import { parseSearchParams } from "@/lib/validations";
import { getStadiumsList } from "@/lib/wiki/stadiums";

export const metadata: Metadata = {
	alternates: { canonical: "/stade" },
	description:
		"Tous les terrains de match d'Inazuma Eleven: Victory Road : l'illustration in-game, le code interne et l'index de chaque terrain (le jeu n'expose ni nom ni équipe associée).",
	title: "Stades | Inazuma Eleven Victory Road - Azalée",
};

export default async function StadiumsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const rawParams = await searchParams;
	const params = parseSearchParams(rawParams);
	const q = params.q || "";

	const { data: stadiums, total } = await getStadiumsList({ q });

	return (
		<div className="w-full space-y-6">
			{/* Header */}
			<div>
				<h1 className="text-2xl lg:text-3xl font-black text-on-surface tracking-tight">Stades</h1>
				<p className="text-sm text-on-surface-variant mt-1">{total} terrains de match</p>
			</div>

			{/* Search */}
			<WikiSearchToolbar placeholder="Rechercher un stade..." showFilters={false} />

			{/* Grid */}
			{stadiums.length > 0 ? (
				<FadeInStagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
					{stadiums.map((s) => (
						<FadeInItem key={s.id}>
							<StadiumCard
								id={s.id}
								code={s.code}
								title={s.title}
								index={s.index}
								thumb={s.thumb}
							/>
						</FadeInItem>
					))}
				</FadeInStagger>
			) : (
				<div className="text-center py-16">
					<SearchX size={48} className="text-on-surface-variant/30 mb-4 block" aria-hidden="true" />
					<p className="text-on-surface-variant">Aucun stade trouvé.</p>
				</div>
			)}
		</div>
	);
}
