import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { ShopItemsGrid } from "@/components/wiki/ShopItemsGrid";
import { SHOP_CATEGORY_FR, getShop } from "@/lib/wiki/shops";

export const dynamic = "force-dynamic";

/**
 * Un identifiant de boutique est un entier décimal, rien d'autre.
 *
 * `Number.parseInt` s'arrêtait au premier caractère non chiffré : `/boutique/1629770002abc`
 * servait donc la boutique 1629770002 à l'identique, et chaque suffixe inventé créait une
 * URL de plus se déclarant canonique — un espace d'URL infini pour un seul contenu.
 * On exige la forme stricte pour que toute variante tombe en 404.
 */
function parseShopId(raw: string): number | null {
	if (!/^\d+$/.test(raw)) return null;
	const id = Number(raw);
	return Number.isSafeInteger(id) ? id : null;
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const shopId = parseShopId(id);
	const shop = shopId === null ? null : await getShop(shopId);

	// Pas de boutique → pas de canonique : la page rendra un 404, ne la déclarons pas indexable.
	if (!shop) {
		return {
			description: "Cette boutique d'Inazuma Eleven: Victory Road n'existe pas.",
			robots: { follow: true, index: false },
			title: "Boutique introuvable | Inazuma Eleven Victory Road - Azalée",
		};
	}

	const name = shop.name;
	const description = `${name} dans Inazuma Eleven: Victory Road — ${shop.itemCount} objets en vente. Liste complète et liens vers chaque objet.`;

	return {
		// Canonique construite sur l'identifiant normalisé, jamais sur le segment brut.
		alternates: { canonical: `/boutique/${shopId}` },
		description,
		openGraph: {
			description,
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${name} | Azalée`,
			type: "article",
			url: `/boutique/${shopId}`,
		},
		title: `${name} | Inazuma Eleven Victory Road - Azalée`,
	};
}

export default async function ShopDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const shopId = parseShopId(id);
	const shop = shopId === null ? null : await getShop(shopId);

	if (!shop) {
		notFound();
	}

	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", item: "https://azalee.rosegriffon.fr", name: "Accueil", position: 1 },
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/boutique",
				name: "Boutiques",
				position: 2,
			},
			{ "@type": "ListItem", name: shop.name, position: 3 },
		],
	};

	return (
		<div className="w-full space-y-6">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
			/>

			{/* Fil d'Ariane */}
			<div className="flex items-center gap-2 text-sm text-on-surface-variant font-medium">
				<Link href="/boutique" className="hover:text-primary transition-colors">
					Boutiques
				</Link>
				<span className="opacity-30">/</span>
				<span className="text-on-surface">{shop.name}</span>
			</div>

			{/* En-tête boutique */}
			<header className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-5">
				<div className="flex items-start gap-4">
					<div className="size-14 shrink-0 rounded-xl bg-primary/10 flex items-center justify-center">
						<Icon name="storefront" size={28} className="text-primary" />
					</div>
					<div className="flex-1 min-w-0">
						<h1 className="text-xl font-bold text-on-surface leading-tight">{shop.name}</h1>
						{shop.nameJa ? (
							<p className="text-sm text-on-surface-variant mt-0.5">{shop.nameJa}</p>
						) : null}
						<div className="flex flex-wrap items-center gap-2 mt-3">
							<span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-primary/10 text-xs font-bold text-primary">
								<Icon name="inventory_2" size={14} />
								{shop.itemCount.toLocaleString("fr-FR")} objets
							</span>
							{shop.categories.slice(0, 5).map(({ category, count }) => (
								<span
									key={category}
									className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-surface-container-highest/50 text-xs font-medium text-on-surface-variant"
								>
									{SHOP_CATEGORY_FR[category] || category}
									<span className="opacity-60">·{count}</span>
								</span>
							))}
						</div>
					</div>
				</div>
			</header>

			<ShopItemsGrid items={shop.items} />
		</div>
	);
}
