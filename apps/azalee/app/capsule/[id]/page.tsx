export const dynamic = "force-dynamic";

import { Gift } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CapsuleCard } from "@/components/wiki/GachaCard";
import { getCapsulePoolPrizes, getCapsulePrize } from "@/lib/wiki/gacha";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const prize = await getCapsulePrize(id);
	const name = prize ? `Lot ${prize.id}` : "Lot de capsule";
	const description = `${name} — détail d'un lot de capsule (gacha) d'Inazuma Eleven: Victory Road : contenu, pool de tirage et lots associés.`;

	return {
		alternates: { canonical: `/capsule/${id}` },
		description,
		openGraph: {
			description,
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${name} | Azalée`,
			type: "article",
			url: `/capsule/${id}`,
		},
		title: `${name} | Inazuma Eleven Victory Road - Azalée`,
	};
}

export default async function CapsuleDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const prize = await getCapsulePrize(id);

	if (!prize) {
		notFound();
	}

	// Lots du même pool (composition du tirage), sauf le lot courant.
	const siblings = (await getCapsulePoolPrizes(prize.poolRef)).filter((p) => p.id !== prize.id);

	const fields: Array<{ label: string; value: string }> = [
		{ label: "Identifiant du lot", value: prize.id },
		{ label: "Contenu (réf.)", value: prize.contentRef },
		{ label: "Pool de tirage", value: prize.poolRef },
		{ label: "Drapeau", value: String(prize.extraFlag) },
	];

	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", item: "https://azalee.rosegriffon.fr", name: "Accueil", position: 1 },
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/capsule",
				name: "Capsules & Costumes",
				position: 2,
			},
			{ "@type": "ListItem", name: `Lot ${prize.id}`, position: 3 },
		],
	};

	return (
		<div className="w-full space-y-8">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
			/>

			{/* Fil d'Ariane */}
			<div className="flex items-center gap-2 text-sm text-on-surface-variant font-medium">
				<Link href="/capsule" className="hover:text-primary transition-colors">
					Capsules & Costumes
				</Link>
				<span className="opacity-30">/</span>
				<span className="font-mono text-on-surface">{prize.id}</span>
			</div>

			{/* En-tête du lot */}
			<div className="flex items-start gap-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low p-5">
				<span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
					<Gift size={28} aria-hidden="true" />
				</span>
				<div className="min-w-0">
					<span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
						Lot de capsule
					</span>
					<h1 className="font-mono text-2xl font-extrabold tracking-tight text-on-surface font-display">{prize.id}</h1>
					<p className="mt-1 text-sm text-on-surface-variant">
						Référencé dans le pool de tirage{" "}
						<Link
							href={`/capsule?onglet=capsules&pool=${encodeURIComponent(prize.poolRef)}`}
							className="font-mono text-primary hover:underline"
						>
							{prize.poolRef}
						</Link>
						.
					</p>
				</div>
			</div>

			{/* Champs bruts */}
			<div>
				<h2 className="mb-3 text-lg font-bold text-on-surface">Données du lot</h2>
				<dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
					{fields.map((f) => (
						<div
							key={f.label}
							className="flex items-center justify-between gap-3 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3"
						>
							<dt className="text-sm text-on-surface-variant">{f.label}</dt>
							<dd className="truncate font-mono text-sm font-bold text-on-surface">{f.value}</dd>
						</div>
					))}
				</dl>
				<div className="mt-2 rounded-xl border border-outline-variant/20 bg-surface-container-low px-4 py-3">
					<span className="text-sm text-on-surface-variant">Variables brutes</span>
					<p className="mt-1 break-all font-mono text-xs text-on-surface">
						[{prize.vars.join(", ")}]
					</p>
				</div>
			</div>

			{/* Composition du pool */}
			{siblings.length > 0 && (
				<div>
					<h2 className="mb-3 text-lg font-bold text-on-surface">
						Autres lots du pool{" "}
						<span className="font-mono text-on-surface-variant">{prize.poolRef}</span>
						<span className="ml-2 text-sm font-normal text-on-surface-variant">
							({siblings.length})
						</span>
					</h2>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
						{siblings.slice(0, 48).map((p) => (
							<CapsuleCard key={p.id} prize={p} />
						))}
					</div>
				</div>
			)}
		</div>
	);
}
