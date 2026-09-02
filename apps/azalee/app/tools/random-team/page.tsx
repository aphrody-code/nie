export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { RandomTeamGenerator } from "@/components/wiki/RandomTeamGenerator";
import { wikiService } from "@/lib/wiki-service";

export const metadata: Metadata = {
	alternates: { canonical: "/tools/random-team" },
	description:
		"Génère une équipe aléatoire complète avec coach, managers et 11 joueurs dans Inazuma Eleven: Victory Road.",
	title: "Équipe aléatoire | Inazuma Eleven Victory Road - Azalée",
};

export default async function RandomTeamPage() {
	const [pools, coordinators] = await Promise.all([
		wikiService.getRandomTeamPools(),
		wikiService.getCoordinatorPools(),
	]);

	return (
		<div className="w-full">
			<RandomTeamGenerator pools={pools} coordinators={coordinators} />
		</div>
	);
}
