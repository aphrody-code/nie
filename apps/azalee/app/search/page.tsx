export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { parseSearchParams } from "@/lib/validations";
import { SearchClient } from "./search-client";

export async function generateMetadata({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
	const { q } = parseSearchParams(await searchParams);

	return {
		// La recherche interne se rattache toujours à `/search` : garder `q` dans le
		// canonique ouvrait un espace d'URLs sans fin, une page par requête tapée,
		// toutes déclarées indexables. Une page de résultats n'est pas un document
		// du site, c'est une vue sur ceux qui existent déjà.
		alternates: { canonical: "/search" },
		description:
			"Explorez la base de données complète : joueurs, techniques, hyper techniques, objets, passifs, tactiques et équipes.",
		// Une page de résultats ne s'indexe pas, mais ses liens mènent aux fiches :
		// on la laisse suivre.
		robots: q ? { follow: true, index: false } : undefined,
		title: q
			? `"${q}" - Recherche | Azalée`
			: "Encyclopédie | Inazuma Eleven Victory Road - Azalée",
	};
}

export default async function SearchPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const { q } = parseSearchParams(await searchParams);

	return <SearchClient defaultQuery={q?.toString()} />;
}
