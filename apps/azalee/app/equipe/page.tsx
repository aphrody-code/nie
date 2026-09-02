export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { TeamsListClient } from "@/components/wiki/TeamsListClient";
import { getTeamsList } from "@/lib/wiki/teams";

export const metadata: Metadata = {
	alternates: {
		canonical: "/equipe",
	},
	description:
		"Liste complète des équipes d'Inazuma Eleven: Victory Road : emblèmes, kits/uniformes, apparitions et effectifs. Raimon, Royal Academy, et toutes les formations du jeu.",
	title: "Équipes | Inazuma Eleven Victory Road - Azalée",
};

export default async function TeamsPage() {
	const teams = await getTeamsList();

	return (
		<div className="space-y-6">
			<header className="space-y-1">
				<h1 className="text-fluid-headline-md font-extrabold text-on-surface">Équipes</h1>
				<p className="text-sm text-on-surface-variant">
					{teams.length.toLocaleString("fr-FR")} équipes recensées — emblèmes, uniformes et
					effectifs liés.
				</p>
			</header>

			<TeamsListClient teams={teams} />
		</div>
	);
}
