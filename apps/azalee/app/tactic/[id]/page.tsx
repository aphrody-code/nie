// Donnée de jeu immuable entre deux dumps : rendue une fois, revalidée à l'heure, et les
// identifiants inconnus au build restent servis à la demande (`dynamicParams`).
export const dynamic = "force-static";
export const revalidate = 3600;
export const dynamicParams = true;

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TacticDetail } from "@/components/wiki/TacticDetail";
import { wikiService } from "@/lib/wiki-service";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const tactic = await wikiService.getTactic(id);

	const name = tactic?.name_fr || tactic?.name || "Tactique";
	const description = `${name} - Tactique spéciale Inazuma Eleven: Victory Road. Effets, durée, recharge et boutique.`;

	return {
		alternates: { canonical: `/tactic/${id}` },
		description,
		openGraph: {
			description,
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${name} | Azalée`,
			type: "article",
			url: `/tactic/${id}`,
		},
		title: `${name} | Inazuma Eleven Victory Road - Azalée`,
	};
}

export default async function TacticDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const tactic = await wikiService.getTactic(id);

	if (!tactic) {
		notFound();
	}

	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", item: "https://azalee.rosegriffon.fr", name: "Accueil", position: 1 },
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/tactic",
				name: "Tactiques",
				position: 2,
			},
			{ "@type": "ListItem", name: tactic.name_fr || tactic.name, position: 3 },
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
				<Link href="/tactic" className="hover:text-primary transition-colors">
					Tactiques
				</Link>
				<span className="opacity-30">/</span>
				<span className="text-on-surface">{tactic.name_fr || tactic.name}</span>
			</div>

			<TacticDetail tactic={tactic} />
		</div>
	);
}
