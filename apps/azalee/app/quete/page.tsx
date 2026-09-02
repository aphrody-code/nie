export const dynamic = "force-dynamic";

import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { QuestCard } from "@/components/wiki/QuestCard";
import { QuestFilterBar } from "@/components/wiki/QuestFilterBar";
import { getQuestsList, type QuestKind } from "@/lib/wiki/quests";

export const metadata: Metadata = {
	alternates: { canonical: "/quete" },
	description:
		"Liste complète des quêtes d'Inazuma Eleven: Victory Road — objectifs d'histoire principale et quêtes annexes, avec titres localisés (FR / EN / JP).",
	title: "Quêtes | Inazuma Eleven Victory Road - Azalée",
};

export default async function QuetesPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const raw = await searchParams;
	const q = typeof raw.q === "string" ? raw.q : "";
	const kindParam = typeof raw.kind === "string" ? raw.kind : "all";
	const kind: QuestKind | "all" =
		kindParam === "main" || kindParam === "side" ? kindParam : "all";

	const { quests, total, main, side } = await getQuestsList({ q, kind });

	const collectionJsonLd = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		description: `Liste complète des quêtes d'Inazuma Eleven: Victory Road — objectifs d'histoire principale et quêtes annexes.`,
		isPartOf: { "@type": "WebSite", name: "Azalée", url: "https://azalee.rosegriffon.fr" },
		mainEntity: {
			"@type": "ItemList",
			itemListElement: quests.slice(0, 10).map((quest: any, i: number) => ({
				"@type": "ListItem",
				position: i + 1,
				url: `https://azalee.rosegriffon.fr/quete/${quest.id}`,
				name: quest.title,
			})),
			numberOfItems: quests.length,
		},
		name: "Quêtes - Inazuma Eleven: Victory Road",
		numberOfItems: quests.length,
		url: "https://azalee.rosegriffon.fr/quete",
	};

	return (
		<div className="space-y-6">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
			/>

			{/* En-tête */}
			<div className="space-y-1">
				<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface font-display">
					Quêtes
				</h1>
				<p className="text-sm text-on-surface-variant">
					Liste complète des objectifs d&apos;histoire principale et des quêtes annexes.
				</p>
			</div>

			<div className="flex items-center justify-between text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				<span>
					{quests.length} quête{quests.length > 1 ? "s" : ""} ({main} principales · {side} annexes)
				</span>
			</div>

			{/* Filtre + recherche */}
			<QuestFilterBar counts={{ all: total, main, side }} />

			{/* Grille */}
			{quests.length > 0 ? (
				<FadeInStagger className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{quests.map((quest) => (
						<FadeInItem key={quest.id}>
							<QuestCard quest={quest} />
						</FadeInItem>
					))}
				</FadeInStagger>
			) : (
				<div className="py-16 text-center">
					<SearchX
						size={48}
						className="mb-4 block text-on-surface-variant/30"
						aria-hidden="true"
					/>
					<p className="text-on-surface-variant">Aucune quête trouvée.</p>
				</div>
			)}
		</div>
	);
}
