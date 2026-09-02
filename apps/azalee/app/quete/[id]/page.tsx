export const dynamic = "force-dynamic";

import { ArrowLeft, ArrowRight, Flag, Info, ScrollText } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getQuest, getQuestNeighbors, type Quest } from "@/lib/wiki/quests";

/** Libellé du type in-game (enum inagle pour 1/2/3 ; sinon « Étape N »). */
function typeLabel(type: number): string {
	if (type === 1) return "Histoire principale";
	if (type === 2) return "Quête annexe";
	if (type === 3) return "Quête quotidienne";
	return `Étape ${type}`;
}

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const quest = await getQuest(id);
	const name = quest?.title || "Quête";
	const description = `${name} — Quête d'Inazuma Eleven: Victory Road. Titre localisé FR / EN / JP, chapitre et type.`;

	return {
		alternates: { canonical: `/quete/${id}` },
		description,
		openGraph: {
			description,
			locale: "fr_FR",
			siteName: "Azalée - Inazuma Eleven Victory Road",
			title: `${name} | Azalée`,
			type: "article",
			url: `/quete/${id}`,
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

/** Carte de navigation vers une quête adjacente. */
function NeighborLink({ quest, dir }: { quest: Quest; dir: "prev" | "next" }) {
	const isPrev = dir === "prev";
	return (
		<Link
			href={`/quete/${quest.id}`}
			className="group flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-outline-variant/30 bg-surface-container-low p-3 transition-colors hover:bg-surface-container"
		>
			{isPrev && (
				<ArrowLeft size={18} className="shrink-0 text-on-surface-variant" aria-hidden="true" />
			)}
			<div className={isPrev ? "min-w-0" : "min-w-0 text-right"}>
				<span className="block text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
					{isPrev ? "Précédente" : "Suivante"}
				</span>
				<span className="block truncate text-sm font-semibold text-on-surface group-hover:text-primary">
					{quest.title}
				</span>
			</div>
			{!isPrev && (
				<ArrowRight size={18} className="shrink-0 text-on-surface-variant" aria-hidden="true" />
			)}
		</Link>
	);
}

export default async function QuestDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const quest = await getQuest(id);

	if (!quest) {
		notFound();
	}

	const { prev, next } = await getQuestNeighbors(quest.id);
	const isMain = quest.kind === "main";
	const Icon = isMain ? Flag : ScrollText;

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
				item: "https://azalee.rosegriffon.fr/quete",
				name: "Quêtes",
				position: 2,
			},
			{ "@type": "ListItem", name: quest.title, position: 3 },
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
				<Link href="/quete" className="transition-colors hover:text-primary">
					Quêtes
				</Link>
				<span className="opacity-30">/</span>
				<span className="truncate text-on-surface">{quest.title}</span>
			</div>

			{/* En-tête */}
			<div className="flex items-start gap-4">
				<div
					className={
						isMain
							? "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"
							: "flex size-14 shrink-0 items-center justify-center rounded-2xl bg-tertiary/10 text-tertiary"
					}
				>
					<Icon size={28} aria-hidden="true" />
				</div>
				<div className="min-w-0">
					<span
						className={
							isMain
								? "rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-primary"
								: "rounded-full bg-tertiary/10 px-2.5 py-1 text-xs font-bold uppercase tracking-wider text-tertiary"
						}
					>
						{isMain ? "Histoire principale" : `Quête annexe${quest.area ? ` · Zone ${quest.area}` : ""}`}
					</span>
					<h1 className="mt-2 text-2xl sm:text-3xl font-extrabold leading-tight tracking-tight text-on-surface font-display">
						{quest.title}
					</h1>
				</div>
			</div>

			{/* Titres localisés */}
			<section className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
				<h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-on-surface-variant/70">
					Titre localisé
				</h2>
				<div className="space-y-2">
					{quest.titles.fr && (
						<p className="text-sm text-on-surface">
							<span className="mr-2 font-bold text-on-surface-variant">FR</span>
							{quest.titles.fr}
						</p>
					)}
					{quest.titles.en && (
						<p className="text-sm text-on-surface">
							<span className="mr-2 font-bold text-on-surface-variant">EN</span>
							{quest.titles.en}
						</p>
					)}
					{quest.titles.ja && (
						<p className="text-sm text-on-surface" lang="ja">
							<span className="mr-2 font-bold text-on-surface-variant">JP</span>
							{quest.titles.ja}
						</p>
					)}
				</div>
			</section>

			{/* Attributs */}
			<section className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
				<h2 className="mb-1 text-sm font-bold uppercase tracking-wider text-on-surface-variant/70">
					Détails
				</h2>
				<MetaRow label="Identifiant" value={<code className="font-mono text-xs">{quest.id}</code>} />
				<MetaRow label="Catégorie" value={isMain ? "Histoire principale" : "Quête annexe"} />
				<MetaRow label="Type in-game" value={typeLabel(quest.type)} />
				<MetaRow
					label={isMain ? "Chapitre" : "Code de phase"}
					value={quest.phase}
				/>
				{quest.area !== null && <MetaRow label="Zone" value={quest.area} />}
				{quest.image && (
					<MetaRow
						label="Asset image"
						value={<code className="font-mono text-xs">{quest.image}</code>}
					/>
				)}
			</section>

			{/* Note d'honnêteté : objectifs/récompenses non encore extraits. */}
			<div className="flex items-start gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container p-4">
				<Info size={18} className="mt-0.5 shrink-0 text-on-surface-variant" aria-hidden="true" />
				<p className="text-sm text-on-surface-variant">
					Les objectifs détaillés, récompenses et prérequis de cette quête ne sont pas encore
					extraits des données du jeu. Seules les informations vérifiées (titre, chapitre, type)
					sont affichées.
				</p>
			</div>

			{/* Navigation précédente / suivante */}
			{(prev || next) && (
				<nav className="flex gap-3">
					{prev ? <NeighborLink quest={prev} dir="prev" /> : <span className="flex-1" />}
					{next ? <NeighborLink quest={next} dir="next" /> : <span className="flex-1" />}
				</nav>
			)}
		</div>
	);
}
