export const dynamic = "force-dynamic";

import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { FilterChips } from "@/components/wiki/FilterChips";
import { CoachCard } from "@/components/wiki/CoachCard";
import { WikiSearchToolbar } from "@/components/wiki/WikiSearchToolbar";
import {
	COACH_ELEMENT_OPTIONS,
	COACH_PLAYSTYLE_OPTIONS,
	COACH_ROLE_OPTIONS,
	getCoachesList,
} from "@/lib/wiki/coaches";
import { parseSearchParams } from "@/lib/validations";

export const metadata: Metadata = {
	alternates: { canonical: "/entraineur" },
	description:
		"Liste complète des entraîneurs, managers et coachs d'Inazuma Eleven: Victory Road. Bonus passifs d'équipe, conditions d'activation, élément et style de jeu.",
	title: "Entraîneurs & Coachs | Inazuma Eleven Victory Road - Azalée",
};

export default async function CoachesPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const rawParams = await searchParams;
	const params = parseSearchParams(rawParams);

	const coaches = await getCoachesList({
		element: params.element,
		playstyle: params.playstyle,
		q: params.q || "",
		role: params.role,
	});

	const collectionJsonLd = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		description: `Liste complète des entraîneurs, managers et coachs d'Inazuma Eleven: Victory Road.`,
		isPartOf: { "@type": "WebSite", name: "Azalée", url: "https://azalee.rosegriffon.fr" },
		mainEntity: {
			"@type": "ItemList",
			itemListElement: coaches.slice(0, 10).map((c: any, i: number) => ({
				"@type": "ListItem",
				position: i + 1,
				url: `https://azalee.rosegriffon.fr/entraineur/${c.id}`,
				name: c.name,
			})),
			numberOfItems: coaches.length,
		},
		name: "Entraîneurs & Coachs - Inazuma Eleven: Victory Road",
		numberOfItems: coaches.length,
		url: "https://azalee.rosegriffon.fr/entraineur",
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
					Entraîneurs &amp; Coachs
				</h1>
				<p className="text-sm text-on-surface-variant">
					Liste complète des entraîneurs, managers et coachs d&apos;Inazuma Eleven: Victory Road.
				</p>
			</div>

			{/* Recherche + filtres */}
			<WikiSearchToolbar
				placeholder="Rechercher un entraîneur..."
				filterKeys={["role", "element", "playstyle"]}
			>
				<div className="space-y-4">
					<div>
						<p className="mb-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant/70">
							Rôle
						</p>
						<FilterChips paramName="role" options={[...COACH_ROLE_OPTIONS]} />
					</div>
					<div>
						<p className="mb-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant/70">
							Élément
						</p>
						<FilterChips paramName="element" options={[...COACH_ELEMENT_OPTIONS]} />
					</div>
					<div>
						<p className="mb-2 text-xs font-bold uppercase tracking-wider text-on-surface-variant/70">
							Style de jeu
						</p>
						<FilterChips paramName="playstyle" options={[...COACH_PLAYSTYLE_OPTIONS]} />
					</div>
				</div>
			</WikiSearchToolbar>

			<div className="flex items-center justify-between text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				<span>{coaches.length} entraîneur{coaches.length > 1 ? "s" : ""}</span>
			</div>

			{/* Grille */}
			{coaches.length > 0 ? (
				<FadeInStagger className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
					{coaches.map((c) => (
						<FadeInItem key={c.id}>
							<CoachCard
								id={c.id}
								name={c.name}
								role={c.role}
								roleFr={c.roleFr}
								playstyleFr={c.playstyleFr}
								elementKey={c.elementKey}
								elementFr={c.elementFr}
								internalCode={c.internalCode}
								stat={c.stat}
								buff={c.buff}
							/>
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
					<p className="text-on-surface-variant">Aucun entraîneur trouvé.</p>
				</div>
			)}
		</div>
	);
}
