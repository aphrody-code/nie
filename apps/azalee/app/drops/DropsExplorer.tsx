"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { DropsCard } from "@/components/wiki/DropsCard";
import { normalizeText } from "@rosegriffon/azalee/search/utils";
import { cn } from "@/lib/utils";
import {
	type DropsPageData,
	type SpiritGroup,
	type TeamBean,
	dropCategoryLabel,
} from "@rosegriffon/azalee/wiki/drops-shared";

type Tab = "drops" | "spirits" | "beans";

const TABS: Array<{ value: Tab; label: string; icon: string }> = [
	{ value: "drops", label: "Drops d'objets", icon: "shopping_bag" },
	{ value: "spirits", label: "Esprits (paliers)", icon: "casino" },
	{ value: "beans", label: "Fèves d'équipe", icon: "fitness_center" },
];

/** Probabilité formatée FR (1 décimale max). */
function pct(n: number): string {
	return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}%`;
}

/** Onglet « Drops d'objets » : grille filtrable de cartes (objet + source + taux). */
function DropsTab({ data }: { data: DropsPageData }) {
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState("");
	const [source, setSource] = useState("");

	const filtered = useMemo(() => {
		const q = normalizeText(query.trim());
		return data.drops.filter((d) => {
			if (category && d.itemCategory !== category) {
				return false;
			}
			if (source && d.source !== source) {
				return false;
			}
			if (q && !normalizeText(d.itemName).includes(q) && !normalizeText(d.sourceId).includes(q)) {
				return false;
			}
			return true;
		});
	}, [data.drops, query, category, source]);

	return (
		<div className="space-y-4">
			<div className="flex flex-col sm:flex-row gap-3">
				<label className="relative flex-1">
					<Icon
						name="search"
						size={18}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60"
					/>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher un objet ou un groupe..."
						className="w-full h-11 pl-10 pr-4 rounded-full bg-surface-container-low border border-outline-variant/40 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
					/>
				</label>
				<select
					value={source}
					onChange={(e) => setSource(e.target.value)}
					className="h-11 px-4 rounded-full bg-surface-container-low border border-outline-variant/40 text-sm text-on-surface focus:outline-none focus:border-primary"
					aria-label="Filtrer par source"
				>
					<option value="">Toutes sources</option>
					<option value="win_treasure">Coffre de victoire</option>
					<option value="item_emission">Émission d'objet</option>
				</select>
			</div>

			{data.categories.length > 0 && (
				<div className="flex flex-wrap gap-2">
					<FilterChip active={category === ""} onClick={() => setCategory("")}>
						Toutes catégories
					</FilterChip>
					{data.categories.map((c) => (
						<FilterChip key={c} active={category === c} onClick={() => setCategory(c)}>
							{dropCategoryLabel(c)}
						</FilterChip>
					))}
				</div>
			)}

			<p className="text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				{filtered.length.toLocaleString("fr-FR")} drop{filtered.length > 1 ? "s" : ""}
			</p>

			{filtered.length > 0 ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
					{filtered.map((d) => (
						<DropsCard key={d.id} drop={d} className="h-full" />
					))}
				</div>
			) : (
				<EmptyState />
			)}
		</div>
	);
}

/** Onglet « Esprits » : tables de paliers de rareté (probabilités non nominatives). */
function SpiritsTab({ groups }: { groups: SpiritGroup[] }) {
	return (
		<div className="space-y-4">
			<p className="text-sm text-on-surface-variant">
				Chaque esprit possède une table de paliers de rareté : la probabilité affichée est
				le pourcentage ABSOLU de tomber sur ce palier (et non un objet précis). La somme des
				paliers d'un groupe peut être inférieure à 100 % : le complément correspond à la
				chance de ne rien obtenir. Les combats associés utilisent cette table.
			</p>
			<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
				{groups.map((g) => (
					<div
						key={g.sourceId}
						className="rounded-2xl border border-outline-variant/30 bg-surface-container-low p-4"
					>
						<div className="flex items-center justify-between gap-2 mb-3">
							<span className="font-mono text-xs font-bold text-on-surface truncate" title={g.sourceId}>
								{g.sourceId}
							</span>
							{g.battleGroupIds.length > 0 && (
								<span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[10px] font-bold">
									<Icon name="swords" size={12} />
									{g.battleGroupIds.length} combat{g.battleGroupIds.length > 1 ? "s" : ""}
								</span>
							)}
						</div>
						{typeof g.anyChance === "number" && (
							<p className="mb-3 text-xs text-on-surface-variant">
								<span className="font-bold tabular-nums text-on-surface">{pct(g.anyChance)}</span>{" "}
								d'obtenir un esprit
							</p>
						)}
						<ul className="space-y-1.5">
							{g.tiers.map((t) => (
								<li
									key={t.id}
									className="flex items-center justify-between gap-3 text-sm"
								>
									<span className="inline-flex items-center gap-2 text-on-surface-variant">
										<span className="inline-flex items-center justify-center size-6 rounded-md bg-surface-container-high text-[10px] font-bold tabular-nums">
											R{t.rarity ?? "?"}
										</span>
										<span className="text-xs">
											bonus de rareté +{t.dropRarity ?? 0}
										</span>
									</span>
									<span className="font-bold tabular-nums text-on-surface">{pct(t.chance)}</span>
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
		</div>
	);
}

/** Onglet « Fèves » : bonus passifs d'équipe (mécanique distincte du drop d'objet). */
function BeansTab({ beans, games }: { beans: TeamBean[]; games: string[] }) {
	const [query, setQuery] = useState("");
	const [game, setGame] = useState("");

	const filtered = useMemo(() => {
		const q = normalizeText(query.trim());
		return beans.filter((b) => {
			if (game && b.game !== game) {
				return false;
			}
			if (q && !normalizeText(b.team).includes(q) && !normalizeText(b.stat ?? "").includes(q)) {
				return false;
			}
			return true;
		});
	}, [beans, query, game]);

	return (
		<div className="space-y-4">
			<p className="text-sm text-on-surface-variant">
				Les Fèves accordent un bonus passif lié à une équipe, sous conditions. C'est une
				mécanique distincte du drop d'objet (séries IE1 à VR).
			</p>
			<div className="flex flex-col sm:flex-row gap-3">
				<label className="relative flex-1">
					<Icon
						name="search"
						size={18}
						className="absolute left-3 top-1/2 -translate-y-1/2 text-on-surface-variant/60"
					/>
					<input
						type="search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Rechercher une équipe ou une stat..."
						className="w-full h-11 pl-10 pr-4 rounded-full bg-surface-container-low border border-outline-variant/40 text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-none focus:border-primary"
					/>
				</label>
				<select
					value={game}
					onChange={(e) => setGame(e.target.value)}
					className="h-11 px-4 rounded-full bg-surface-container-low border border-outline-variant/40 text-sm text-on-surface focus:outline-none focus:border-primary"
					aria-label="Filtrer par jeu"
				>
					<option value="">Tous les jeux</option>
					{games.map((g) => (
						<option key={g} value={g}>
							{g}
						</option>
					))}
				</select>
			</div>

			<p className="text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider">
				{filtered.length.toLocaleString("fr-FR")} fève{filtered.length > 1 ? "s" : ""}
			</p>

			{filtered.length > 0 ? (
				<div className="overflow-x-auto rounded-2xl border border-outline-variant/30">
					<table className="w-full text-sm">
						<thead>
							<tr className="bg-surface-container-high text-on-surface-variant text-left text-xs uppercase tracking-wider">
								<th className="px-3 py-2 font-bold">Équipe</th>
								<th className="px-3 py-2 font-bold">Jeu</th>
								<th className="px-3 py-2 font-bold">Type</th>
								<th className="px-3 py-2 font-bold">Condition</th>
								<th className="px-3 py-2 font-bold">Bonus</th>
								<th className="px-3 py-2 font-bold text-right">Valeur</th>
							</tr>
						</thead>
						<tbody>
							{filtered.map((b) => (
								<tr
									key={b.id}
									className="border-t border-outline-variant/20 hover:bg-surface-container-low"
								>
									<td className="px-3 py-2 font-bold text-on-surface">{b.team}</td>
									<td className="px-3 py-2 text-on-surface-variant">{b.game}</td>
									<td className="px-3 py-2 text-on-surface-variant">
										{b.passiveType || b.fixedBeans || "—"}
									</td>
									<td className="px-3 py-2 text-on-surface-variant text-xs">
										{b.requirement || "—"}
									</td>
									<td className="px-3 py-2 text-on-surface-variant">{b.stat || "—"}</td>
									<td className="px-3 py-2 text-right font-bold tabular-nums text-primary">
										{b.value || "—"}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<EmptyState />
			)}
		</div>
	);
}

function FilterChip({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"inline-flex items-center justify-center min-h-11 sm:min-h-0 px-3 py-1.5 rounded-full text-xs font-bold transition-colors border",
				active
					? "bg-primary text-on-primary border-primary"
					: "bg-surface-container-low text-on-surface-variant border-outline-variant/40 hover:bg-surface-container"
			)}
		>
			{children}
		</button>
	);
}

function EmptyState() {
	return (
		<div className="py-20 text-center rounded-[32px] border border-outline-variant bg-surface-container-low border-dashed">
			<p className="text-on-surface-variant italic">Aucun résultat.</p>
		</div>
	);
}

/** Explorateur principal de la section Drops (3 onglets, filtres client-side). */
export function DropsExplorer({ data }: { data: DropsPageData }) {
	const [tab, setTab] = useState<Tab>("drops");

	return (
		<div className="space-y-6">
			<div
				role="tablist"
				aria-label="Catégories de drops"
				className="flex flex-wrap gap-2 border-b border-outline-variant/30 pb-3"
			>
				{TABS.map((t) => (
					<button
						key={t.value}
						type="button"
						role="tab"
						aria-selected={tab === t.value}
						onClick={() => setTab(t.value)}
						className={cn(
							"inline-flex items-center gap-2 min-h-11 sm:min-h-0 px-4 py-2 rounded-full text-sm font-bold transition-colors",
							tab === t.value
								? "bg-primary text-on-primary"
								: "bg-surface-container-low text-on-surface-variant hover:bg-surface-container"
						)}
					>
						<Icon name={t.icon} size={16} />
						{t.label}
					</button>
				))}
			</div>

			{tab === "drops" && <DropsTab data={data} />}
			{tab === "spirits" && <SpiritsTab groups={data.spiritGroups} />}
			{tab === "beans" && <BeansTab beans={data.beans} games={data.beanGames} />}
		</div>
	);
}
