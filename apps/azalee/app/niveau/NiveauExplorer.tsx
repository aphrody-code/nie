"use client";

/**
 * Explorateur de la table d'expérience — îlot interactif de la page `/niveau`.
 *
 * Quatre usages sur la MÊME donnée serveur (`inagle_exp_table`), sans aucun
 * appel réseau supplémentaire : la table complète est passée en props par le
 * composant serveur et tous les calculs sont les fonctions pures de
 * `lib/wiki/exp-table-shared.ts` (couvertes par `exp-table-shared.test.ts`).
 *
 * 1. courbe (cumul ou palier) pilotée par un curseur de niveau ;
 * 2. calculateur « du niveau X au niveau Y = tant d'EXP » ;
 * 3. recherche inverse « j'ai tant d'EXP, je suis niveau ? » ;
 * 4. tableau complet, filtrable par plage de niveaux.
 */

import { useId, useMemo, useState } from "react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@rosegriffon/ui";
import { CourbeExperience, type CourbeMode } from "@/components/wiki/CourbeExperience";
import {
	buildExpCurve,
	clampLevel,
	cumulativeExpToLevel,
	expBetweenLevels,
	formatExp,
	levelFromExp,
	type ExpTableData,
} from "@/lib/wiki/exp-table-shared";

/** Classes communes des champs de saisie (tokens uniquement, aucun hex). */
const CHAMP =
	"h-11 w-full rounded-xl border border-outline-variant/40 bg-surface-container-low px-3 text-sm text-on-surface tabular-nums focus:border-primary focus:outline-none";

/** Carte de section : même habillage que les blocs du calculateur de stats. */
function Bloc({
	titre,
	description,
	children,
}: {
	titre: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<section className="space-y-4 rounded-2xl border border-outline-variant/20 bg-surface-container p-4 sm:p-5">
			<header className="space-y-1">
				<h2 className="text-base font-bold text-on-surface">{titre}</h2>
				<p className="text-sm text-on-surface-variant">{description}</p>
			</header>
			{children}
		</section>
	);
}

/** Chiffre mis en avant (valeur + légende). */
function Resultat({ valeur, legende }: { valeur: string; legende: string }) {
	return (
		<div className="rounded-xl bg-surface-container-highest px-4 py-3">
			<p className="text-fluid-headline-md font-extrabold tabular-nums text-primary">{valeur}</p>
			<p className="text-xs text-on-surface-variant">{legende}</p>
		</div>
	);
}

export function NiveauExplorer({ data }: { data: ExpTableData }) {
	const idDepart = useId();
	const idArrivee = useId();
	const idExp = useId();
	const idCurseur = useId();
	const idFiltreMin = useId();
	const idFiltreMax = useId();

	const points = useMemo(() => buildExpCurve(data), [data]);

	const [mode, setMode] = useState<CourbeMode>("cumulative");
	const [niveauCourbe, setNiveauCourbe] = useState(() => data.maxLevel);
	const [depart, setDepart] = useState(() => data.minLevel);
	const [arrivee, setArrivee] = useState(() => data.maxLevel);
	const [expSaisie, setExpSaisie] = useState("");
	const [filtreMin, setFiltreMin] = useState(() => data.minLevel);
	const [filtreMax, setFiltreMax] = useState(() => data.maxLevel);

	const departValide = clampLevel(data, depart);
	const arriveeValide = clampLevel(data, arrivee);
	const coutTrajet = expBetweenLevels(data, departValide, arriveeValide);
	const nbPaliers = Math.max(0, arriveeValide - departValide);

	const expNombre = useMemo(() => {
		// On tolère les espaces de saisie et les séparateurs de milliers collés.
		const nettoye = expSaisie.replace(/[\s  .]/g, "");
		if (nettoye === "") {
			return null;
		}
		const valeur = Number(nettoye);
		return Number.isFinite(valeur) ? valeur : null;
	}, [expSaisie]);

	const inverse = useMemo(
		() => (expNombre === null ? null : levelFromExp(data, expNombre)),
		[data, expNombre]
	);

	const lignesFiltrees = useMemo(() => {
		const bas = Math.min(clampLevel(data, filtreMin), clampLevel(data, filtreMax));
		const haut = Math.max(clampLevel(data, filtreMin), clampLevel(data, filtreMax));
		return points.filter((p) => p.level >= bas && p.level <= haut);
	}, [data, points, filtreMin, filtreMax]);

	if (data.entries.length === 0) {
		return (
			<p className="rounded-2xl border border-outline-variant/20 bg-surface-container p-6 text-center text-sm text-on-surface-variant">
				La table d'expérience n'a pas pu être lue. Aucune courbe n'est affichée plutôt qu'une
				courbe approximative.
			</p>
		);
	}

	return (
		<div className="space-y-4">
			{/* — Courbe — */}
			<Bloc
				titre="Courbe d'expérience"
				description={`Les ${data.entries.length} paliers de la table du jeu, du niveau ${data.minLevel} au niveau ${data.maxLevel}.`}
			>
				<div
					className="flex flex-wrap gap-1.5"
					role="group"
					aria-label="Grandeur affichée sur la courbe"
				>
					{(
						[
							{ label: "EXP cumulée depuis le niveau 1", valeur: "cumulative" },
							{ label: "EXP du palier seul", valeur: "palier" },
						] as const
					).map((option) => (
						<button
							key={option.valeur}
							type="button"
							aria-pressed={mode === option.valeur}
							onClick={() => setMode(option.valeur)}
							className={
								mode === option.valeur
									? "rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary"
									: "rounded-full bg-surface-container-highest px-3 py-1.5 text-xs font-medium text-on-surface-variant hover:text-on-surface"
							}
						>
							{option.label}
						</button>
					))}
				</div>

				<CourbeExperience
					points={points}
					mode={mode}
					niveau={niveauCourbe}
					onNiveauChange={setNiveauCourbe}
				/>

				<div className="space-y-1.5">
					<label htmlFor={idCurseur} className="text-xs font-medium text-on-surface-variant">
						Niveau observé sur la courbe
					</label>
					<input
						id={idCurseur}
						type="range"
						min={data.minLevel}
						max={data.maxLevel}
						value={niveauCourbe}
						onChange={(e) => setNiveauCourbe(clampLevel(data, Number(e.target.value)))}
						className="w-full accent-primary"
					/>
				</div>

				<dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
					<div className="rounded-xl bg-surface-container-highest px-4 py-3">
						<dt className="text-xs text-on-surface-variant">
							EXP cumulée pour atteindre le niveau {niveauCourbe}
						</dt>
						<dd className="text-lg font-bold tabular-nums text-on-surface">
							{formatExp(cumulativeExpToLevel(data, niveauCourbe))}
						</dd>
					</div>
					<div className="rounded-xl bg-surface-container-highest px-4 py-3">
						<dt className="text-xs text-on-surface-variant">
							{niveauCourbe < data.maxLevel
								? `EXP du palier ${niveauCourbe} → ${niveauCourbe + 1}`
								: `EXP inscrite au niveau ${data.maxLevel}`}
						</dt>
						<dd className="text-lg font-bold tabular-nums text-on-surface">
							{formatExp(points.find((p) => p.level === niveauCourbe)?.needExp ?? 0)}
						</dd>
					</div>
					<div className="rounded-xl bg-surface-container-highest px-4 py-3">
						<dt className="text-xs text-on-surface-variant">
							EXP totale niveau {data.minLevel} → {data.maxLevel}
						</dt>
						<dd className="text-lg font-bold tabular-nums text-on-surface">
							{formatExp(data.totalExp)}
						</dd>
					</div>
				</dl>
			</Bloc>

			{/* — Calculateur de trajet — */}
			<Bloc
				titre="Du niveau X au niveau Y"
				description="Expérience nécessaire pour franchir une plage de niveaux : somme des paliers traversés."
			>
				<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<div className="space-y-1.5">
						<label htmlFor={idDepart} className="text-xs font-medium text-on-surface-variant">
							Niveau de départ
						</label>
						<input
							id={idDepart}
							type="number"
							inputMode="numeric"
							min={data.minLevel}
							max={data.maxLevel}
							value={depart}
							onChange={(e) => setDepart(Number(e.target.value))}
							className={CHAMP}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={idArrivee} className="text-xs font-medium text-on-surface-variant">
							Niveau d'arrivée
						</label>
						<input
							id={idArrivee}
							type="number"
							inputMode="numeric"
							min={data.minLevel}
							max={data.maxLevel}
							value={arrivee}
							onChange={(e) => setArrivee(Number(e.target.value))}
							className={CHAMP}
						/>
					</div>
				</div>

				<div aria-live="polite" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					<Resultat
						valeur={formatExp(coutTrajet)}
						legende={
							nbPaliers === 0
								? "Aucun palier à franchir : l'arrivée n'est pas au-dessus du départ."
								: `EXP du niveau ${departValide} au niveau ${arriveeValide} (${nbPaliers} palier${nbPaliers > 1 ? "s" : ""}).`
						}
					/>
					<Resultat
						valeur={formatExp(cumulativeExpToLevel(data, arriveeValide))}
						legende={`EXP totale depuis le niveau ${data.minLevel} pour atteindre le niveau ${arriveeValide}.`}
					/>
				</div>
			</Bloc>

			{/* — Recherche inverse — */}
			<Bloc
				titre="J'ai tant d'expérience, je suis niveau ?"
				description="Saisissez une expérience totale accumulée depuis le niveau 1 pour retrouver le niveau correspondant."
			>
				<div className="space-y-1.5">
					<label htmlFor={idExp} className="text-xs font-medium text-on-surface-variant">
						Expérience totale accumulée
					</label>
					<input
						id={idExp}
						type="text"
						inputMode="numeric"
						value={expSaisie}
						onChange={(e) => setExpSaisie(e.target.value)}
						placeholder={`Ex. ${formatExp(data.totalExp)}`}
						className={CHAMP}
					/>
				</div>

				<div aria-live="polite">
					{inverse === null ? (
						<p className="text-sm text-on-surface-variant">
							Entrez un nombre pour obtenir le niveau atteint.
						</p>
					) : (
						<div className="space-y-3">
							<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
								<Resultat
									valeur={`Niveau ${inverse.level}`}
									legende={
										inverse.capped
											? `Niveau maximum de la table. Excédent inutilisé : ${formatExp(inverse.overflow)} EXP.`
											: `${formatExp(inverse.expIntoLevel)} EXP engrangée dans ce palier.`
									}
								/>
								<Resultat
									valeur={
										inverse.expToNextLevel === null
											? "—"
											: formatExp(inverse.expToNextLevel)
									}
									legende={
										inverse.expToNextLevel === null
											? "Aucun palier suivant : le niveau maximum est atteint."
											: `EXP restante avant le niveau ${inverse.level + 1}.`
									}
								/>
							</div>
							<div>
								<div
									className="h-2.5 w-full overflow-hidden rounded-full bg-surface-container-highest"
									role="progressbar"
									aria-valuemin={0}
									aria-valuemax={100}
									aria-valuenow={Math.round(inverse.progress * 100)}
									aria-label={`Progression dans le niveau ${inverse.level}`}
								>
									<div
										className="h-full rounded-full bg-primary"
										style={{ width: `${Math.round(inverse.progress * 100)}%` }}
									/>
								</div>
								<p className="mt-1 text-xs text-on-surface-variant">
									{Math.round(inverse.progress * 100)} % du niveau {inverse.level}
								</p>
							</div>
						</div>
					)}
				</div>
			</Bloc>

			{/* — Tableau complet — */}
			<Bloc
				titre="Table complète"
				description="Valeurs brutes de la table du jeu : coût de chaque palier et cumul depuis le niveau 1."
			>
				<div className="grid grid-cols-2 gap-3">
					<div className="space-y-1.5">
						<label htmlFor={idFiltreMin} className="text-xs font-medium text-on-surface-variant">
							Du niveau
						</label>
						<input
							id={idFiltreMin}
							type="number"
							inputMode="numeric"
							min={data.minLevel}
							max={data.maxLevel}
							value={filtreMin}
							onChange={(e) => setFiltreMin(Number(e.target.value))}
							className={CHAMP}
						/>
					</div>
					<div className="space-y-1.5">
						<label htmlFor={idFiltreMax} className="text-xs font-medium text-on-surface-variant">
							Au niveau
						</label>
						<input
							id={idFiltreMax}
							type="number"
							inputMode="numeric"
							min={data.minLevel}
							max={data.maxLevel}
							value={filtreMax}
							onChange={(e) => setFiltreMax(Number(e.target.value))}
							className={CHAMP}
						/>
					</div>
				</div>

				<div className="max-h-[32rem] overflow-auto rounded-xl border border-outline-variant/20">
					<Table>
						<TableHeader className="sticky top-0 z-10 bg-surface-container">
							<TableRow>
								<TableHead className="w-20">Niveau</TableHead>
								<TableHead className="text-right">EXP du palier</TableHead>
								<TableHead className="text-right">EXP cumulée</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{lignesFiltrees.map((point) => (
								<TableRow key={point.level}>
									<TableCell className="font-semibold tabular-nums text-on-surface">
										{point.level}
									</TableCell>
									<TableCell className="text-right tabular-nums text-on-surface-variant">
										{point.level < data.maxLevel
											? `${formatExp(point.needExp)} → ${point.level + 1}`
											: formatExp(point.needExp)}
									</TableCell>
									<TableCell className="text-right tabular-nums text-on-surface">
										{formatExp(point.cumulative)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</div>
				<p className="text-xs text-on-surface-variant">
					{lignesFiltrees.length} niveau{lignesFiltrees.length > 1 ? "x" : ""} affiché
					{lignesFiltrees.length > 1 ? "s" : ""} sur {data.entries.length}.
				</p>
			</Bloc>
		</div>
	);
}
