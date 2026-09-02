export const dynamic = "force-dynamic";

import { ArrowLeft, ArrowRight, Award, Info, Trophy as TrophyIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTrophy, getTrophyNeighbors } from "@/lib/wiki/trophies";
import { CATEGORY_LABELS, type Trophy } from "@rosegriffon/azalee/wiki/trophies-shared";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const trophy = await getTrophy(id);
	const name = trophy?.name || "Succès";
	const description = trophy?.desc
		? `${name} — ${trophy.desc} Succès d'Inazuma Eleven: Victory Road (FR / EN / JP).`
		: `${name} — Succès d'Inazuma Eleven: Victory Road. Nom localisé FR / EN / JP.`;

	return {
		alternates: { canonical: `/succes/${id}` },
		description,
		openGraph: {
			description,
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${name} | Azalée`,
			type: "article",
			url: `/succes/${id}`,
		},
		title: `${name} | Inazuma Eleven Victory Road - Azalée`,
	};
}

/** Ligne d'une fiche d'attribut (clé / valeur). */
function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
	return (
		<div className="flex items-baseline justify-between gap-4 border-b border-outline-variant/20 py-2.5 last:border-0">
			<span className="shrink-0 text-sm font-medium text-on-surface-variant">{label}</span>
			<span className="text-right text-sm font-semibold text-on-surface">{value}</span>
		</div>
	);
}

/** Carte de navigation vers un succès adjacent. */
function NeighborLink({ trophy, dir }: { trophy: Trophy; dir: "prev" | "next" }) {
	const isPrev = dir === "prev";
	return (
		<Link
			href={`/succes/${trophy.id}`}
			className="group flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3 transition-colors hover:bg-surface-container"
		>
			{isPrev && (
				<ArrowLeft size={18} className="shrink-0 text-on-surface-variant" aria-hidden="true" />
			)}
			<div className={isPrev ? "min-w-0" : "min-w-0 text-right"}>
				<span className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
					{isPrev ? "Précédent" : "Suivant"}
				</span>
				<span className="block truncate text-sm font-semibold text-on-surface group-hover:text-primary">
					{trophy.name}
				</span>
			</div>
			{!isPrev && (
				<ArrowRight size={18} className="shrink-0 text-on-surface-variant" aria-hidden="true" />
			)}
		</Link>
	);
}

export default async function TrophyDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const trophy = await getTrophy(id);

	if (!trophy) {
		notFound();
	}

	const { prev, next } = await getTrophyNeighbors(trophy.id);
	const isOfficial = trophy.category === "trophy";
	const Icon = isOfficial ? TrophyIcon : Award;
	const categoryLabel = CATEGORY_LABELS[trophy.category];

	const breadcrumbJsonLd = {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr",
				name: "Accueil",
				position: 1,
			},
			{
				"@type": "ListItem",
				item: "https://azalee.rosegriffon.fr/succes",
				name: "Succès",
				position: 2,
			},
			{ "@type": "ListItem", name: trophy.name, position: 3 },
		],
	};

	return (
		<div className="w-full space-y-8">
			<script
				type="application/ld+json"
				dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
			/>

			{/* Fil d'Ariane */}
			<div className="flex items-center gap-2 text-sm font-medium text-on-surface-variant">
				<Link href="/succes" className="transition-colors hover:text-primary">
					Succès
				</Link>
				<span className="opacity-30">/</span>
				<span className="truncate text-on-surface">{trophy.name}</span>
			</div>

			{/* En-tête */}
			<div className="flex items-start gap-4">
				<div
					className={
						isOfficial
							? "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
							: "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-tertiary/10 text-tertiary"
					}
				>
					<Icon size={28} aria-hidden="true" />
				</div>
				<div className="min-w-0">
					<span
						className={
							isOfficial
								? "rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-primary"
								: "rounded-full bg-tertiary/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-tertiary"
						}
					>
						{categoryLabel} · {trophy.groupLabel}
					</span>
					<h1 className="mt-2 text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight text-on-surface font-display">
						{trophy.name}
					</h1>
					{trophy.desc && (
						<p className="mt-2 text-sm text-on-surface-variant">{trophy.desc}</p>
					)}
				</div>
			</div>

			{/* Nom localisé */}
			<section className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
				<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-on-surface-variant/70">
					Nom localisé
				</h2>
				<div className="space-y-2">
					{trophy.names.fr && (
						<p className="text-sm text-on-surface">
							<span className="mr-2 font-bold text-on-surface-variant">FR</span>
							{trophy.names.fr}
						</p>
					)}
					{trophy.names.en && (
						<p className="text-sm text-on-surface">
							<span className="mr-2 font-bold text-on-surface-variant">EN</span>
							{trophy.names.en}
						</p>
					)}
					{trophy.names.ja && (
						<p className="text-sm text-on-surface" lang="ja">
							<span className="mr-2 font-bold text-on-surface-variant">JP</span>
							{trophy.names.ja}
						</p>
					)}
				</div>
			</section>

			{/* Description localisée (si fournie par le jeu) */}
			{(trophy.descriptions.fr || trophy.descriptions.en || trophy.descriptions.ja) && (
				<section className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
					<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-on-surface-variant/70">
						Condition / description
					</h2>
					<div className="space-y-2">
						{trophy.descriptions.fr && (
							<p className="text-sm text-on-surface">
								<span className="mr-2 font-bold text-on-surface-variant">FR</span>
								{trophy.descriptions.fr}
							</p>
						)}
						{trophy.descriptions.en && (
							<p className="text-sm text-on-surface">
								<span className="mr-2 font-bold text-on-surface-variant">EN</span>
								{trophy.descriptions.en}
							</p>
						)}
						{trophy.descriptions.ja && (
							<p className="text-sm text-on-surface" lang="ja">
								<span className="mr-2 font-bold text-on-surface-variant">JP</span>
								{trophy.descriptions.ja}
							</p>
						)}
					</div>
				</section>
			)}

			{/* Attributs */}
			<section className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
				<h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-on-surface-variant/70">
					Détails
				</h2>
				<MetaRow label="Catégorie" value={categoryLabel} />
				<MetaRow label="Groupe" value={trophy.groupLabel} />
				<MetaRow
					label="Code interne"
					value={<code className="font-mono text-xs">{trophy.code}</code>}
				/>
			</section>

			{/* Note d'honnêteté : pas de récompense/icône extraites. */}
			{!trophy.desc && (
				<div className="flex items-start gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container p-4">
					<Info size={18} className="mt-0.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
					<p className="text-sm text-on-surface-variant">
						Le jeu ne fournit pas de texte de condition pour ce succès. Seul son nom localisé est
						affiché.
					</p>
				</div>
			)}

			{/* Navigation précédente / suivante */}
			{(prev || next) && (
				<nav className="flex gap-3">
					{prev ? <NeighborLink trophy={prev} dir="prev" /> : <span className="flex-1" />}
					{next ? <NeighborLink trophy={next} dir="next" /> : <span className="flex-1" />}
				</nav>
			)}
		</div>
	);
}
