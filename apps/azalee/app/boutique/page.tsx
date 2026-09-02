import type { Metadata } from "next";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { Icon } from "@/components/ui/Icon";
import { ShopCard } from "@/components/wiki/ShopCard";
import { getShopsList } from "@/lib/wiki/shops";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	alternates: { canonical: "/boutique" },
	description:
		"Toutes les boutiques d'Inazuma Eleven: Victory Road : Centre commercial Chronique, Marché aux esprits, Goal-Marché, BB Mart, Footech… Découvrez ce que chaque boutique vend et où acheter chaque objet.",
	title: "Boutiques | Inazuma Eleven Victory Road - Azalée",
};

export default async function BoutiquesPage() {
	const shops = await getShopsList();
	const totalItems = shops.reduce((acc, s) => acc + s.itemCount, 0);

	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", item: "https://azalee.rosegriffon.fr", name: "Accueil", position: 1 },
			{ "@type": "ListItem", name: "Boutiques", position: 2 },
		],
	};

	return (
		<div className="space-y-6">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
			/>

			<header className="space-y-2">
				<div className="flex items-center gap-2.5">
					<div className="size-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
						<Icon name="storefront" size={22} className="text-primary" />
					</div>
					<div>
						<h1 className="text-xl font-bold text-on-surface leading-tight">Boutiques</h1>
						<p className="text-xs text-on-surface-variant">
							Où acheter chaque objet du jeu
						</p>
					</div>
				</div>
			</header>

			<div className="flex items-center justify-between text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				<span>{shops.length} boutiques</span>
				<span>{totalItems.toLocaleString("fr-FR")} objets en vente</span>
			</div>

			{shops.length > 0 ? (
				<FadeInStagger className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{shops.map((shop) => (
						<FadeInItem key={shop.shopId} className="h-full">
							<ShopCard
								shopId={shop.shopId}
								name={shop.name}
								nameJa={shop.nameJa}
								itemCount={shop.itemCount}
								categories={shop.categories}
								className="h-full"
							/>
						</FadeInItem>
					))}
				</FadeInStagger>
			) : (
				<div className="py-20 text-center rounded-[32px] border border-outline-variant bg-surface-container-low border-dashed">
					<p className="text-on-surface-variant italic">Aucune boutique trouvée.</p>
				</div>
			)}
		</div>
	);
}
