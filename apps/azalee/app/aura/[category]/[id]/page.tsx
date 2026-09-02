export const dynamic = "force-dynamic";

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AuraDetail } from "@/components/wiki/AuraDetail";
import { wikiService } from "@/lib/wiki-service";

const SUBTYPE_INFO: Record<string, { label: string; icon: string; color: string }> = {
	Aura: { color: "text-primary", icon: "wifi_tethering", label: "Aura" },
	Awakening: { color: "text-secondary", icon: "wb_twilight", label: "Éveil" },
	Keshin: { color: "text-primary", icon: "flash_on", label: "Esprit Guerrier" },
	Miximax: { color: "text-blue-500", icon: "group_work", label: "Miximax" },
	ModeChange: { color: "text-error", icon: "transform", label: "Changement de Mode" },
	Soul: { color: "text-tertiary", icon: "pets", label: "Totem" },
};

const CATEGORY_LABELS: Record<string, string> = {
	autres: "Autres",
	"changement-mode": "Changement de Mode",
	"esprits-guerriers": "Esprits Guerriers",
	eveil: "Éveil",
	miximax: "Miximax",
	totems: "Totems",
};

export async function generateMetadata({
	params,
}: {
	params: Promise<{ category: string; id: string }>;
}): Promise<Metadata> {
	const { id, category } = await params;
	const aura = await wikiService.getAura(id, category);

	const name = aura?.displayName || "Hyper Technique";
	const categoryLabel = CATEGORY_LABELS[category] || category;
	const description = aura?.desc_FR || `${categoryLabel} - Détails et statistiques.`;
	const title = `${name} | ${categoryLabel} - Azalée`;

	return {
		alternates: { canonical: `/aura/${category}/${id}` },
		description,
		openGraph: {
			description,
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${name} | Azalée`,
			type: "article",
			url: `/aura/${category}/${id}`,
		},
		title,
		twitter: {
			card: "summary",
			description,
			title: `${name} | Azalée`,
		},
	};
}

export default async function AuraDetailPage({
	params,
}: {
	params: Promise<{ category: string; id: string }>;
}) {
	const { id, category } = await params;
	const aura = await wikiService.getAura(id, category);

	if (!aura) {
		notFound();
	}

	const subTypeInfo = SUBTYPE_INFO[aura.subType || "Aura"] || SUBTYPE_INFO.Aura;

	const categoryLabel = CATEGORY_LABELS[category] || category;
	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", item: "https://azalee.rosegriffon.fr", name: "Accueil", position: 1 },
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/aura",
				name: "Hyper Techniques",
				position: 2,
			},
			{
				"@type": "ListItem",
				item: `https://azalee.rosegriffon.fr/aura/${category}`,
				name: categoryLabel,
				position: 3,
			},
			{ "@type": "ListItem", name: aura.displayName, position: 4 },
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
				<Link href="/aura" className="hover:text-primary transition-colors">
					Hyper Techniques
				</Link>
				<span className="opacity-30">/</span>
				<Link href={`/aura/${category}`} className="hover:text-primary transition-colors">
					{categoryLabel}
				</Link>
				<span className="opacity-30">/</span>
				<span className="text-on-surface">{aura.displayName}</span>
			</div>

			<AuraDetail
				aura={aura}
				category={category}
				subTypeInfo={subTypeInfo}
				prevAura={null}
				nextAura={null}
			/>
		</div>
	);
}
