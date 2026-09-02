export const dynamic = "force-dynamic";

import { Download } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getStadium } from "@/lib/wiki/stadiums";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const stadium = await getStadium(id);

	const name = stadium?.title || "Terrain";
	const description = `${name} — terrain de match d'Inazuma Eleven: Victory Road. Illustration in-game, code interne et index (le jeu n'expose ni nom ni équipe associée).`;

	return {
		alternates: { canonical: `/stade/${id}` },
		description,
		openGraph: {
			description,
			images: stadium?.full ? [{ url: stadium.full }] : undefined,
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${name} | Azalée`,
			type: "article",
			url: `/stade/${id}`,
		},
		title: `${name} | Inazuma Eleven Victory Road - Azalée`,
	};
}

export default async function StadiumDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const stadium = await getStadium(id);

	if (!stadium) {
		notFound();
	}

	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", item: "https://azalee.rosegriffon.fr", name: "Accueil", position: 1 },
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/stade",
				name: "Stades",
				position: 2,
			},
			{ "@type": "ListItem", name: stadium.title, position: 3 },
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
				<Link href="/stade" className="hover:text-primary transition-colors">
					Stades
				</Link>
				<span className="opacity-30">/</span>
				<span className="text-on-surface">{stadium.title}</span>
			</div>

			{/* Illustration plein cadre */}
			<div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-high">
				{stadium.full ? (
					<Image
						src={stadium.full}
						alt={stadium.title}
						fill
						sizes="(max-width: 1024px) 100vw, 1024px"
						className="object-cover"
						unoptimized
						priority
					/>
				) : null}
			</div>

			{/* En-tête + métadonnées (uniquement les données réellement extraites) */}
			<div className="space-y-4">
				<div>
					<span className="text-xs font-bold uppercase tracking-wider text-on-surface-variant/60">
						Terrain de match
					</span>
					<h1 className="text-2xl lg:text-3xl font-black text-on-surface tracking-tight">
						{stadium.title}
					</h1>
				</div>

				<dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
					<div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
						<dt className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant/60">
							Code interne
						</dt>
						<dd className="mt-1 font-mono text-sm text-on-surface">{stadium.code}</dd>
					</div>
					<div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
						<dt className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant/60">
							Index in-game
						</dt>
						<dd className="mt-1 font-mono text-sm text-on-surface">
							{typeof stadium.index === "number" ? stadium.index : "—"}
						</dd>
					</div>
					<div className="rounded-xl border border-outline-variant/30 bg-surface-container-low p-3">
						<dt className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant/60">
							Identifiant
						</dt>
						<dd className="mt-1 font-mono text-sm text-on-surface break-all">{stadium.id}</dd>
					</div>
				</dl>

				<a
					href={stadium.image}
					target="_blank"
					rel="noopener noreferrer"
					className="inline-flex items-center gap-2 rounded-full border border-outline-variant/40 bg-surface-container px-4 py-2 text-sm font-semibold text-on-surface transition-colors hover:bg-surface-container-high hover:text-primary"
				>
					<Download size={16} aria-hidden="true" />
					Illustration originale (PNG)
				</a>
			</div>
		</div>
	);
}
