export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { ItemFilterBar } from "@/components/wiki/filters/ItemFilterBar";
import { ItemCard } from "@/components/wiki/ItemCard";
import { WikiPagination } from "@/components/wiki/WikiPagination";
import { WikiSearchToolbar } from "@/components/wiki/WikiSearchToolbar";
import { buildCanonical } from "@/lib/seo";
import { parseSearchParams } from "@/lib/validations";
import { wikiService } from "@/lib/wiki-service";

export async function generateMetadata({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
	const rawParams = await searchParams;
	const { q, category } = parseSearchParams(rawParams);
	const page = typeof rawParams.page === "string" ? rawParams.page : undefined;

	const activeCategory = category || "shoes";
	const categoryLabel = CATEGORIES.find((t) => t.value === activeCategory)?.label || "Équipements";

	let title = `${categoryLabel} - Objets`;
	if (q) {
		title += ` : "${q}"`;
	}

	const pageNum = page ? Number.parseInt(page, 10) : 1;
	if (pageNum > 1) {
		title += ` (Page ${pageNum})`;
	}

	return {
		alternates: {
			// `page` vient des paramètres BRUTS : `parseSearchParams` lui donne un
			// défaut de 1, si bien que la page nue `/item` se canonicalisait vers
			// `/item?category=shoes&page=1` — une URL qui n'est pas celle servie.
			// Même raisonnement pour `category` : `activeCategory` porte le défaut
			// `shoes`, et `/item` se canonicalisait encore vers `/item?category=shoes`.
			// C'est `category` BRUT qu'il faut passer — la catégorie par défaut ne va
			// dans l'URL canonique que si le visiteur l'a réellement demandée.
			canonical: buildCanonical("/item", { category, page }, ["category", "page"]),
		},
		description: `Liste complète des ${categoryLabel.toLowerCase()} et objets dans Inazuma Eleven: Victory Road. Localisation, stats et effets.`,
		title: `${title} | Inazuma Eleven Victory Road - Azalée`,
	};
}

const ITEMS_PER_PAGE = 48;

// Toutes les catégories peuplées de inagle_items (équipement d'abord, puis le reste).
// Counts indicatifs du miroir : shoes 214, misanga 79, accessory 80, special 80,
// emblem 242, kizuna_link 82, consume 65, special_tactics 70, super_tactics 6,
// special_skill 43, performance 16, formation 11, fashion 168, costume 69,
// name_plate 54, title 110, craft_obj 137, important 135, animal 7.
const CATEGORIES = [
	{ icon: "steps", label: "Chaussures", value: "shoes" },
	{ icon: "watch", label: "Bracelets", value: "misanga" },
	{ icon: "diamond", label: "Pendentifs", value: "accessory" },
	{ icon: "auto_awesome", label: "Accessoires spéciaux", value: "special" },
	{ icon: "shield", label: "Emblèmes", value: "emblem" },
	{ icon: "link", label: "Lien Kizuna", value: "kizuna_link" },
	{ icon: "lunch_dining", label: "Consommables", value: "consume" },
	{ icon: "strategy", label: "Tactiques Sp.", value: "special_tactics" },
	{ icon: "bolt", label: "Super tactiques", value: "super_tactics" },
	{ icon: "stars", label: "Compétences sp.", value: "special_skill" },
	{ icon: "person_celebrate", label: "Performances", value: "performance" },
	{ icon: "groups", label: "Formations", value: "formation" },
	{ icon: "shopping_bag", label: "Mode", value: "fashion" },
	{ icon: "redeem", label: "Costumes", value: "costume" },
	{ icon: "tag", label: "Plaques", value: "name_plate" },
	{ icon: "verified", label: "Titres", value: "title" },
	{ icon: "build", label: "Objets d'artisanat", value: "craft_obj" },
	{ icon: "push_pin", label: "Objets importants", value: "important" },
	{ icon: "pets", label: "Animaux", value: "animal" },
];

export default async function ItemsPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const rawParams = await searchParams;
	const params: any = parseSearchParams(rawParams);
	const { q, page, category } = params;

	const pageNumber = page ? Number.parseInt(page.toString(), 10) : 1;
	const activeCategory = (category as string) || "shoes";
	const categoryLabel = CATEGORIES.find((t) => t.value === activeCategory)?.label || "Équipements";

	// Data First: Fetch paginated from DB
	const { data: items, total } = await wikiService.getItemsList({
		category: activeCategory,
		limit: ITEMS_PER_PAGE,
		page: pageNumber,
		q: q?.toString(),
	});

	const collectionJsonLd = {
		"@context": "https://schema.org",
		"@type": "CollectionPage",
		description: `Base de données des objets (${categoryLabel}) dans Inazuma Eleven: Victory Road.`,
		isPartOf: { "@type": "WebSite", name: "Azalée", url: "https://azalee.rosegriffon.fr" },
		mainEntity: {
			"@type": "ItemList",
			itemListElement: items.slice(0, 10).map((item: any, i: number) => ({
				"@type": "ListItem",
				position: (pageNumber - 1) * ITEMS_PER_PAGE + i + 1,
				url: `https://azalee.rosegriffon.fr/item/${item.itemId}`,
				name: item.name_FR || item.names?.en || "Objet",
			})),
			numberOfItems: total,
		},
		name: `${categoryLabel} - Objets - Inazuma Eleven: Victory Road`,
		numberOfItems: total,
		url: `https://azalee.rosegriffon.fr/item?category=${activeCategory}`,
	};

	return (
		<div className="space-y-6">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionJsonLd) }}
			/>
			<h1 className="sr-only">Objets</h1>
			<div className="space-y-4">
				<WikiSearchToolbar placeholder="Rechercher un objet..." showFilters={false} />
				<ItemFilterBar categories={CATEGORIES} currentCategory={activeCategory} />
			</div>

			<div className="flex items-center justify-between text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				<span>{total.toLocaleString("fr-FR")} objets</span>
				<span>
					Page {pageNumber} sur {Math.max(1, Math.ceil(total / ITEMS_PER_PAGE))}
				</span>
			</div>

			{items.length > 0 ? (
				<FadeInStagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
					{items.map((item: any) => (
						<FadeInItem key={item.itemId} className="h-full">
							<ItemCard
								id={item.itemId}
								name={item.name_FR || item.names?.en || "Inconnu"}
								category={item.category}
								categoryLabel={CATEGORIES.find((t) => t.value === item.category)?.label}
								rarity={item.rarity}
								internalCode={item.internalCode}
								icon={item.image}
								price={item.price}
								location={item.location}
								stats={item.stats}
								bonuses={item.bonuses}
								className="h-full"
							/>
						</FadeInItem>
					))}
				</FadeInStagger>
			) : (
				<div className="py-20 text-center rounded-[32px] border border-outline-variant bg-surface-container-low border-dashed">
					<p className="text-on-surface-variant italic">Aucun objet trouvé.</p>
				</div>
			)}

			<WikiPagination totalItems={total} itemsPerPage={ITEMS_PER_PAGE} currentPage={pageNumber} />
		</div>
	);
}
