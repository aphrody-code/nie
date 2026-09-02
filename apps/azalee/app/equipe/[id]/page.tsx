export const dynamic = "force-dynamic";

import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import {
	getTeamDetail,
	type TeamKit,
	type TeamRosterMember,
	SEASON_LABELS,
} from "@/lib/wiki/teams";

export async function generateMetadata({
	params,
}: {
	params: Promise<{ id: string }>;
}): Promise<Metadata> {
	const { id } = await params;
	const team = await getTeamDetail(id);
	if (!team) {
		return { title: "Équipe introuvable | Azalée" };
	}
	return {
		alternates: { canonical: `/equipe/${id}` },
		description: `${team.name} dans Inazuma Eleven: Victory Road — effectif (${team.roster.length} joueurs), emblème, uniformes et apparitions.`,
		title: `${team.name} | Équipes - Inazuma Eleven Victory Road - Azalée`,
	};
}

const KIT_TYPE_LABELS: Record<number, string> = {
	0: "Domicile",
	1: "Extérieur",
};

function KitBlock({ kit }: { kit: TeamKit }) {
	return (
		<div className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4">
			<div className="flex items-center justify-between mb-3">
				<h3 className="font-bold text-sm text-on-surface">{kit.seriesLabel}</h3>
				<span className="text-[10px] font-mono text-on-surface-variant/60">{kit.nameId}</span>
			</div>
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
				{kit.models.map((m, i) => (
					<div
						key={`${kit.nameId}-${m.typeId}-${i}`}
						className="rounded-xl bg-surface-container-high border border-outline-variant/20 p-3 space-y-1.5"
					>
						<p className="text-xs font-bold text-primary uppercase tracking-wider">
							{KIT_TYPE_LABELS[m.typeId] ?? `Type ${m.typeId}`}
						</p>
						<dl className="space-y-1 text-[11px] text-on-surface-variant">
							<div className="flex items-center justify-between gap-2">
								<dt>Joueur</dt>
								<dd className="font-mono text-on-surface">{m.uniformFielderModelIdCrc}</dd>
							</div>
							<div className="flex items-center justify-between gap-2">
								<dt>Gardien</dt>
								<dd className="font-mono text-on-surface">{m.uniformKeeperModelIdCrc}</dd>
							</div>
							<div className="flex items-center justify-between gap-2">
								<dt>Crampons</dt>
								<dd className="font-mono text-on-surface">{m.shoesFielderModelIdCrc}</dd>
							</div>
							<div className="flex items-center justify-between gap-2">
								<dt>Gants</dt>
								<dd className="font-mono text-on-surface">{m.gloveModelIdCrc}</dd>
							</div>
						</dl>
					</div>
				))}
				{kit.models.length === 0 && (
					<p className="text-xs text-on-surface-variant italic col-span-full">
						Uniforme non résolu dans les données.
					</p>
				)}
			</div>
		</div>
	);
}

function RosterMember({ member }: { member: TeamRosterMember }) {
	const inner = (
		<div className="flex items-center gap-3 rounded-xl border border-outline-variant/30 bg-surface-container-low p-2.5 transition-colors hover:bg-surface-container group">
			<div className="size-11 shrink-0 rounded-lg bg-surface-container-high border border-outline-variant/20 overflow-hidden flex items-center justify-center">
				<Image
					src={member.imageUrl}
					alt={member.name}
					width={44}
					height={44}
					className="object-cover size-11"
					unoptimized
				/>
			</div>
			<div className="min-w-0 flex-1">
				<p className="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors">
					{member.name}
				</p>
				<div className="flex flex-wrap items-center gap-1.5 mt-0.5">
					{member.position && (
						<span className="text-[10px] font-bold text-on-surface-variant/80 uppercase tracking-wide">
							{member.position}
						</span>
					)}
					{member.element && (
						<span className="text-[10px] text-tertiary font-medium">{member.element}</span>
					)}
				</div>
			</div>
		</div>
	);

	if (member.slug) {
		return <Link href={`/chara/${member.slug}`}>{inner}</Link>;
	}
	return inner;
}

export default async function TeamDetailPage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const { id } = await params;
	const team = await getTeamDetail(id);
	if (!team) {
		notFound();
	}

	const seasonEntries = Object.entries(team.seasons).sort(([, a], [, b]) => b - a);
	const hasEmblem = Boolean(team.emblemUrl);

	return (
		<div className="space-y-8">
			<Link
				href="/equipe"
				className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant hover:text-primary transition-colors"
			>
				<ArrowLeft size={16} aria-hidden="true" />
				Toutes les équipes
			</Link>

			{/* En-tête */}
			<header className="flex items-start gap-5">
				<div className="size-20 shrink-0 rounded-2xl bg-surface-container-high border border-outline-variant/30 overflow-hidden flex items-center justify-center">
					{hasEmblem ? (
						<Image
							src={team.emblemUrl as string}
							alt={team.name}
							width={72}
							height={72}
							className="object-contain size-16"
							unoptimized
						/>
					) : (
						<Icon name="shield" size={36} className="text-on-surface-variant/30" />
					)}
				</div>
				<div className="min-w-0 flex-1 space-y-1.5">
					<h1 className="text-fluid-headline-md font-extrabold text-on-surface leading-tight">
						{team.name}
					</h1>
					{(team.nameJa || team.nameEn) && (
						<p className="text-sm text-on-surface-variant">
							{[team.nameJa, team.nameEn].filter(Boolean).join(" · ")}
						</p>
					)}
					{team.descriptionFr && (
						<p className="text-sm text-on-surface-variant/90 max-w-prose">{team.descriptionFr}</p>
					)}
					{seasonEntries.length > 0 && (
						<div className="flex flex-wrap items-center gap-1.5 pt-1">
							{seasonEntries.map(([code, n]) => (
								<span
									key={code}
									className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-tertiary/10 text-[11px] font-medium text-tertiary"
									title={`${SEASON_LABELS[code] ?? code} — ${n} personnages`}
								>
									{SEASON_LABELS[code] ?? code}
									<span className="opacity-60">{n}</span>
								</span>
							))}
						</div>
					)}
				</div>
			</header>

			{/* Emblèmes par série */}
			{team.emblems.length > 0 && (
				<section className="space-y-3">
					<h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
						Emblèmes
					</h2>
					<div className="flex flex-wrap gap-2">
						{team.emblems.map((e) => (
							<span
								key={e.series}
								className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-outline-variant/30 bg-surface-container-low text-xs"
							>
								<span className="font-bold text-on-surface">{e.seriesLabel}</span>
								<span className="font-mono text-on-surface-variant/60">{e.crc}</span>
							</span>
						))}
					</div>
				</section>
			)}

			{/* Kits / uniformes */}
			{team.kits.length > 0 && (
				<section className="space-y-3">
					<h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
						Uniformes
					</h2>
					<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
						{team.kits.map((kit) => (
							<KitBlock key={`${kit.series}-${kit.nameId}`} kit={kit} />
						))}
					</div>
				</section>
			)}

			{/* Effectif */}
			<section className="space-y-3">
				<h2 className="text-sm font-bold uppercase tracking-wider text-on-surface-variant">
					Effectif{" "}
					<span className="text-on-surface-variant/60">({team.roster.length})</span>
				</h2>
				{team.roster.length > 0 ? (
					<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{team.roster.map((m) => (
							<RosterMember key={m.charaId} member={m} />
						))}
					</div>
				) : (
					<div className="py-12 text-center rounded-2xl border border-outline-variant bg-surface-container-low border-dashed">
						<p className="text-on-surface-variant italic text-sm">
							Aucun joueur lié à cette équipe dans les données.
						</p>
					</div>
				)}
			</section>
		</div>
	);
}
