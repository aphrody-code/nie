import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { CoachFace } from "@/components/wiki/CoachFace";
import { ElementIcon } from "@/components/wiki/ElementIcon";
import type { Coach } from "@/lib/wiki/coaches";

interface InfoRowProps {
	label: string;
	value: React.ReactNode;
}

function InfoRow({ label, value }: InfoRowProps) {
	return (
		<div className="flex items-center justify-between gap-4 border-b border-outline-variant/20 py-2 last:border-b-0">
			<span className="text-sm text-on-surface-variant">{label}</span>
			<span className="text-right text-sm font-semibold text-on-surface">{value}</span>
		</div>
	);
}

/**
 * Fiche détaillée d'un entraîneur / coach.
 *
 * Met en avant le passif d'équipe accordé : sa condition d'activation, la stat
 * affectée et — si la table de référence `inagle_manager_passives` a résolu le
 * passif — la grille de valeurs selon le rôle (Coordinateur / Manager) et la
 * rareté (commune / légendaire).
 */
export function CoachDetail({ coach }: { coach: Coach }) {
	const { scaling } = coach;

	return (
		<div className="mx-auto w-full max-w-3xl space-y-6">
			<Link
				href="/entraineur"
				className="inline-flex items-center gap-1.5 text-sm text-on-surface-variant transition-colors hover:text-primary"
			>
				<ArrowLeft size={16} aria-hidden="true" />
				Tous les entraîneurs
			</Link>

			{/* En-tête */}
			<div className="flex flex-col gap-4 rounded-3xl border border-outline-variant/30 bg-surface-container-low p-5 sm:flex-row sm:items-center">
				<div className="relative flex aspect-square w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-surface-container-high">
					<CoachFace
						internalCode={coach.internalCode}
						alt={coach.name}
						className="text-primary opacity-40"
					/>
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="rounded-full bg-primary-container px-2.5 py-0.5 text-xs font-bold text-on-primary-container">
							{coach.roleFr}
						</span>
						{coach.elementKey ? <ElementIcon element={coach.elementKey} size="md" /> : null}
					</div>
					<h1 className="mt-2 text-2xl font-extrabold leading-tight text-on-surface font-display">{coach.name}</h1>
					{coach.nameKanji && coach.nameKanji !== coach.name ? (
						<p className="text-sm text-on-surface-variant">
							{coach.nameKanji}
							{coach.nameRomaji ? ` · ${coach.nameRomaji}` : ""}
						</p>
					) : null}
				</div>
			</div>

			{/* Informations */}
			<div className="rounded-3xl border border-outline-variant/30 bg-surface-container-low p-5">
				<h2 className="mb-3 text-lg font-bold text-on-surface">Informations</h2>
				<div className="flex flex-col">
					<InfoRow label="Rôle" value={coach.roleFr} />
					{coach.playstyleFr ? <InfoRow label="Style de jeu" value={coach.playstyleFr} /> : null}
					{coach.elementFr ? (
						<InfoRow
							label="Élément"
							value={
								<span className="inline-flex items-center gap-1.5">
									{coach.elementKey ? <ElementIcon element={coach.elementKey} size="sm" /> : null}
									{coach.elementFr}
								</span>
							}
						/>
					) : null}
					{coach.nameRomaji ? <InfoRow label="Nom (romaji)" value={coach.nameRomaji} /> : null}
					{coach.passiveNo != null ? (
						<InfoRow label="Passif n°" value={coach.passiveNo} />
					) : null}
				</div>
			</div>

			{/* Passif d'équipe */}
			{coach.stat || coach.requirements ? (
				<div className="rounded-3xl border border-outline-variant/30 bg-surface-container-low p-5">
					<h2 className="mb-3 text-lg font-bold text-on-surface">Passif d'équipe</h2>
					{coach.requirements ? (
						<p className="mb-3 text-sm text-on-surface-variant">
							<span className="font-semibold text-on-surface">Condition : </span>
							{coach.requirements}
						</p>
					) : null}
					{coach.stat ? (
						<div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-container-high p-4">
							<span className="font-semibold text-on-surface">{coach.stat}</span>
							{coach.buff ? (
								<span className="rounded-full bg-primary px-3 py-1 text-sm font-bold text-on-primary">
									{coach.buff}
								</span>
							) : null}
						</div>
					) : null}

					{/* Grille rôle × rareté résolue depuis inagle_manager_passives */}
					{scaling &&
					(scaling.coordCommon ||
						scaling.coordLegendary ||
						scaling.managerCommon ||
						scaling.managerLegendary) ? (
						<div className="mt-4 overflow-hidden rounded-2xl border border-outline-variant/20">
							<div className="overflow-x-auto">
								<table className="w-full min-w-[18rem] text-sm">
								<thead>
									<tr className="bg-surface-container-high text-on-surface-variant">
										<th className="px-3 py-2 text-left font-semibold">Rôle</th>
										<th className="px-3 py-2 text-right font-semibold">Commun</th>
										<th className="px-3 py-2 text-right font-semibold">Légendaire</th>
									</tr>
								</thead>
								<tbody className="text-on-surface">
									<tr className="border-t border-outline-variant/20">
										<td className="px-3 py-2 font-medium">Coordinateur</td>
										<td className="px-3 py-2 text-right">{scaling.coordCommon ?? "—"}</td>
										<td className="px-3 py-2 text-right">{scaling.coordLegendary ?? "—"}</td>
									</tr>
									<tr className="border-t border-outline-variant/20">
										<td className="px-3 py-2 font-medium">Manager</td>
										<td className="px-3 py-2 text-right">{scaling.managerCommon ?? "—"}</td>
										<td className="px-3 py-2 text-right">{scaling.managerLegendary ?? "—"}</td>
									</tr>
								</tbody>
							</table>
							</div>
						</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}
