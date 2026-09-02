import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ItemDetail } from "@/components/wiki/ItemDetail";
import { wikiService } from "@/lib/wiki-service";

export const dynamic = "force-dynamic";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const item = await wikiService.getItem(id);

	const name = item ? item.names?.fr || item.names?.en || item.itemId : "Objet";
	const cat = (item as any)?.category || "";
	const rarity = (item as any)?.rarity || "";
	const metaParts = [name, cat, rarity].filter(Boolean);
	const description = `${metaParts.join(" - ")}. Objet Inazuma Eleven: Victory Road. Effet, prix et localisation.`;
	const title = `${name} | Inazuma Eleven Victory Road - Azalée`;

	return {
		alternates: { canonical: `/item/${id}` },
		description,
		openGraph: {
			description,
			images: item?.imageUrl ? [{ url: item.imageUrl, alt: name }] : [],
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${name} | Azalée`,
			type: "article",
			url: `/item/${id}`,
		},
		title,
		twitter: {
			card: "summary",
			description,
			title: `${name} | Azalée`,
		},
	};
}

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const item = await wikiService.getItem(id);

	if (!item) {
		notFound();
	}

	const itemName = item.names?.fr || item.names?.en || item.itemId;
	const itemDesc =
		item.descriptions?.fr ||
		(item as any).description ||
		item.descriptions?.en ||
		"Aucune description.";

	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", item: "https://azalee.rosegriffon.fr", name: "Accueil", position: 1 },
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/item",
				name: "Objets",
				position: 2,
			},
			{ "@type": "ListItem", name: itemName, position: 3 },
		],
	};

	return (
		<div className="w-full space-y-8">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
			/>

			{/* Breadcrumb */}
			<div className="flex items-center gap-2 text-sm text-on-surface-variant font-medium">
				<Link href="/item" className="hover:text-primary transition-colors">
					Objets
				</Link>
				<span className="opacity-30">/</span>
				<span className="text-on-surface">{itemName}</span>
			</div>

			<ItemDetail item={item} itemName={itemName} itemDesc={itemDesc} />
		</div>
	);
}
