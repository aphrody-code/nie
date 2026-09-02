export const dynamic = "force-dynamic";

import { SearchX } from "lucide-react";
import type { Metadata } from "next";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { TacticCard } from "@/components/wiki/TacticCard";
import { WikiPagination } from "@/components/wiki/WikiPagination";
import { WikiSearchToolbar } from "@/components/wiki/WikiSearchToolbar";
import { parseSearchParams } from "@/lib/validations";
import { wikiService } from "@/lib/wiki-service";

export const metadata: Metadata = {
	alternates: { canonical: "/tactic" },
	description:
		"Liste complète des tactiques spéciales dans Inazuma Eleven: Victory Road. Effets, durée et disponibilité en boutique.",
	title: "Tactiques | Inazuma Eleven Victory Road - Azalée",
};

const ITEMS_PER_PAGE = 48;

export default async function TacticsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const rawParams = await searchParams;
	const params = parseSearchParams(rawParams);
	const page = typeof params.page === "number" ? params.page : 1;
	const q = params.q || "";

	const { data: tactics, total } = await wikiService.getTacticsList({
		category: "special_tactics",
		limit: ITEMS_PER_PAGE,
		page,
		q,
	});

	const collectionJsonLd = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		description: `Base de données des tactiques spéciales dans Inazuma Eleven: Victory Road.`,
		isPartOf: { "@type": "WebSite", name: "Azalée", url: "https://azalee.rosegriffon.fr" },
		mainEntity: {
			"@type": "ItemList",
			itemListElement: tactics.slice(0, 10).map((t: any, i: number) => ({
				"@type": "ListItem",
				position: (page - 1) * ITEMS_PER_PAGE + i + 1,
				url: `https://azalee.rosegriffon.fr/tactic/${t.itemId}`,
				name: t.names?.fr || t.names?.en || t.name_FR || "Tactique",
			})),
			numberOfItems: total,
		},
		name: "Tactiques - Inazuma Eleven: Victory Road",
		numberOfItems: total,
		url: "https://azalee.rosegriffon.fr/tactic",
	};

	return (
		<div className="space-y-6">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
			/>

			{/* Header */}
			<div className="space-y-1">
				<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface font-display">
					Tactiques
				</h1>
				<p className="text-sm text-on-surface-variant">
					Liste complète des tactiques spéciales dans Inazuma Eleven: Victory Road.
				</p>
			</div>

			{/* Search */}
			<WikiSearchToolbar placeholder="Rechercher une tactique..." showFilters={false} />

			<div className="flex items-center justify-between text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				<span>{total} tactiques</span>
				<span>
					Page {page} sur {Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))}
				</span>
			</div>

			{/* Grid */}
			{tactics.length > 0 ? (
				<FadeInStagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
					{tactics.map((t: any) => (
						<FadeInItem key={t.itemId}>
							<TacticCard
								id={t.itemId}
								name={t.names?.fr || t.names?.en || t.name_FR}
								image={t.image}
								categoryLabel="Tactique"
							/>
						</FadeInItem>
					))}
				</FadeInStagger>
			) : (
				<div className="text-center py-16">
					<SearchX size={48} className="text-on-surface-variant/30 mb-4 block" aria-hidden="true" />
					<p className="text-on-surface-variant">Aucune tactique trouvée.</p>
				</div>
			)}

			{/* Pagination */}
			{total > ITEMS_PER_PAGE && (
				<WikiPagination currentPage={page} totalItems={total} itemsPerPage={ITEMS_PER_PAGE} />
			)}
		</div>
	);
}
