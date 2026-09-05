import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
	PASSIVE_CATEGORY_LABELS,
	PassiveDetailView,
} from "@/components/wiki/PassiveDetail";
import { wikiService } from "@/lib/wiki-service";

// Donnée de jeu immuable entre deux dumps : rendue une fois, revalidée à l'heure, et les
// identifiants inconnus au build restent servis à la demande (`dynamicParams`).
export const dynamic = "force-static";
export const revalidate = 3600;
export const dynamicParams = true;

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const passive = await wikiService.getPassive(id);

	const name = passive
		? passive.description.fr || passive.description.en || passive.string_id
		: "Passif";
	const cleanName = name.replace(/\s*\n\s*/g, " ").trim();
	const cat = passive ? PASSIVE_CATEGORY_LABELS[passive.category] || "" : "";
	const description = `${[cleanName, cat].filter(Boolean).join(" - ")}. Passif Inazuma Eleven: Victory Road : effet, valeurs par variante, élément et rareté.`;
	const title = `${cleanName} | Passifs Inazuma Eleven Victory Road - Azalée`;

	return {
		alternates: { canonical: `/passive/${id}` },
		description,
		openGraph: {
			description,
			images: passive?.imageUrl ? [{ alt: cleanName, url: passive.imageUrl }] : [],
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${cleanName} | Azalée`,
			type: "article",
			url: `/passive/${id}`,
		},
		title,
		twitter: {
			card: "summary",
			description,
			title: `${cleanName} | Azalée`,
		},
	};
}

export default async function PassiveDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const passive = await wikiService.getPassive(id);

	if (!passive) {
		notFound();
	}

	const passiveName =
		passive.description.fr || passive.description.en || passive.string_id;
	const cleanName = passiveName.replace(/\s*\n\s*/g, " ").trim();

	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", item: "https://azalee.rosegriffon.fr", name: "Accueil", position: 1 },
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/passive",
				name: "Passifs",
				position: 2,
			},
			{ "@type": "ListItem", name: cleanName, position: 3 },
		],
	};

	return (
		<div className="w-full space-y-8 pb-20">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
			/>

			{/* Fil d'Ariane */}
			<div className="flex items-center gap-2 text-sm text-on-surface-variant font-medium">
				<Link href="/passive" className="hover:text-primary transition-colors">
					Passifs
				</Link>
				<span className="opacity-30">/</span>
				<span className="text-on-surface truncate max-w-[60vw]">{cleanName}</span>
			</div>

			<PassiveDetailView passive={passive} />
		</div>
	);
}
