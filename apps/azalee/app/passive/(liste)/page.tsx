import { SearchX, User, Users } from "lucide-react";
import type { Metadata } from "next";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { PassiveFilters } from "@/components/wiki/filters/PassiveFilters";
import { PassivePlayerFilters } from "@/components/wiki/filters/PassivePlayerFilters";
import {
	NierPassiveFamilyCard,
	NierTeamPassiveCard,
} from "@/components/wiki/PassiveCard";
import type {
	NierPassiveFamily,
	NierPassiveInstance,
	NierTeamPassive,
} from "@/components/wiki/PassiveCard";
import { WikiSearchToolbar } from "@/components/wiki/WikiSearchToolbar";
import passivesFullData from "../../../../../data/azalee/passives-full.json";
import { normalizeText } from "@rosegriffon/azalee/search/utils";
import { parseSearchParams } from "@/lib/validations";
import { passiveCategory } from "@/lib/wiki-service";

export const metadata: Metadata = {
	alternates: { canonical: "/passive" },
	description:
		"Guide complet des passifs : joueur, personnalisé, coordinateur et manager. Valeurs par rareté et style de jeu.",
	title: "Talents & Passifs | Codex Stratégique - Azalée",
};

// ── Groupement nie-data ──

/** Regroupe les instances de passives joueur par effect_id (128 familles). */
function buildNierFamilies(player: NierPassiveInstance[]): NierPassiveFamily[] {
	const map = new Map<string, NierPassiveInstance[]>();
	for (const inst of player) {
		if (!map.has(inst.effect_id)) map.set(inst.effect_id, []);
		map.get(inst.effect_id)!.push(inst);
	}
	// Trier les familles par texte FR de la première instance (ordre alphabétique)
	return [...map.entries()]
		.map(([effect_id, instances]) => ({ effect_id, instances }))
		.sort((a, b) => {
			const ta = a.instances[0]?.description.fr ?? "";
			const tb = b.instances[0]?.description.fr ?? "";
			return ta.localeCompare(tb, "fr");
		});
}

/** Recherche dans une famille : compare le texte FR/EN/JA de la première instance. */
function familyMatchesSearch(family: NierPassiveFamily, qNorm: string): boolean {
	if (!qNorm) return true;
	const inst = family.instances[0];
	if (!inst) return false;
	const texts = [
		inst.description.fr,
		inst.description.en,
		inst.description.ja,
		inst.string_id,
	];
	return texts.some((t) => t && normalizeText(t).includes(qNorm));
}

interface NierFamilyFilters {
	qNorm: string;
	element: string;
	rarity: string;
	category: string;
}

/** Une famille passe les filtres si elle contient ≥1 instance qui matche tous les critères. */
function familyMatchesFilters(family: NierPassiveFamily, f: NierFamilyFilters): boolean {
	if (f.qNorm && !familyMatchesSearch(family, f.qNorm)) return false;
	if (!f.element && !f.rarity && !f.category) return true;
	return family.instances.some((inst) => {
		if (f.element && inst.element_name !== f.element) return false;
		if (f.rarity && String(inst.rarity) !== f.rarity) return false;
		if (f.category && passiveCategory(inst.string_id) !== f.category) return false;
		return true;
	});
}

export default async function PassivesPage({
	searchParams,
}: {
	searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
	const params = parseSearchParams(await searchParams);
	const {
		q,
		type: typeFilter,
		playstyle: playstyleFilter,
		category: statCatFilter,
		element: elementFilter,
		rarity: rarityFilter,
		pcat: passiveCatFilter,
	} = params;
	const qNorm = q ? normalizeText(q) : "";

	const elFilter = elementFilter?.toString() || "";
	const rarFilter = rarityFilter?.toString() || "";
	const pCatFilter = passiveCatFilter?.toString() || "";

	// ── Load nie-data passives (passives-full.json) ──
	const nierAllPlayer = passivesFullData.player as NierPassiveInstance[];
	const nierTeamPassives = passivesFullData.team as NierTeamPassive[];
	const nierFamiliesAll = buildNierFamilies(nierAllPlayer);

	// ── Filter nie-data families (recherche + élément + rareté + catégorie) ──
	const nierFilters: NierFamilyFilters = {
		category: pCatFilter,
		element: elFilter,
		qNorm,
		rarity: rarFilter,
	};
	const nierFamiliesFiltered = nierFamiliesAll.filter((f) =>
		familyMatchesFilters(f, nierFilters)
	);

	// ── Compteurs élément / rareté / catégorie (sur toutes les instances joueur) ──
	const elementCounts: Record<string, number> = {};
	const rarityCounts: Record<string, number> = {};
	const categoryCounts: Record<string, number> = {};
	for (const inst of nierAllPlayer) {
		elementCounts[inst.element_name] = (elementCounts[inst.element_name] || 0) + 1;
		const rk = String(inst.rarity);
		rarityCounts[rk] = (rarityCounts[rk] || 0) + 1;
		const ck = passiveCategory(inst.string_id);
		categoryCounts[ck] = (categoryCounts[ck] || 0) + 1;
	}

	const typeCounts: Record<string, number> = {
		player: nierFamiliesFiltered.length,
	};

	// ── Apply type filter ──
	const showPlayer = !typeFilter || typeFilter === "player";
	const nierFamilies = showPlayer ? nierFamiliesFiltered : [];
	const playstyleCounts: Record<string, number> = {};
	const totalCount = nierFamilies.length;

	return (
		<div className="space-y-8 pb-20" role="main" aria-label="Passifs et talents">
			<div className="space-y-1">
				<h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-on-surface font-display">
					Talents & Passifs
				</h1>
				<p className="text-sm text-on-surface-variant">
					Guide complet des talents et passifs d&apos;Inazuma Eleven: Victory Road.
				</p>
			</div>

			{/* Sticky Header */}
			<div className="sticky top-[64px] z-40 bg-surface/90 backdrop-blur-md -mx-4 px-4 py-4 border-b border-outline-variant/10">
				<div className="space-y-3">
					<div className="w-full md:max-w-md">
						<WikiSearchToolbar
							placeholder="Rechercher un passif (effet, condition...)"
							showFilters={false}
							className="bg-surface-container-high border-outline-variant/50"
						/>
					</div>

					<PassiveFilters typeCounts={typeCounts} playstyleCounts={playstyleCounts} />

					{/* Filtres spécifiques aux passifs joueur (nie-data) : élément / rareté / catégorie */}
					{showPlayer && (
						<PassivePlayerFilters
							elementCounts={elementCounts}
							rarityCounts={rarityCounts}
							categoryCounts={categoryCounts}
						/>
					)}

					<div
						className="text-xs font-medium text-on-surface-variant px-1 uppercase tracking-wider"
						aria-live="polite"
					>
						{totalCount} passif{totalCount !== 1 ? "s" : ""} trouv&eacute;
						{totalCount !== 1 ? "s" : ""}
					</div>
				</div>
			</div>

			{totalCount === 0 ? (
				<div className="py-32 text-center" role="status">
					<SearchX size={60} className="mb-4 text-on-surface-variant/30" aria-hidden="true" />
					<h3 className="text-xl font-bold text-on-surface mb-2">Aucun passif trouvé</h3>
					<p className="text-on-surface-variant">
						Essayez une autre recherche ou modifiez les filtres.
					</p>
				</div>
			) : (
				<div className="space-y-16">
					{/* Passifs joueur — données complètes nie-data (128 familles, 1716 instances) */}
					{nierFamilies.length > 0 && (
						<section id="player" className="scroll-mt-36" aria-labelledby="player-heading">
							<div className="flex items-center gap-4 mb-8 border-b border-outline-variant/30 pb-2">
								<User size={36} className="text-blue-600" aria-hidden="true" />
								<div>
									<h2 id="player-heading" className="text-2xl font-bold text-on-surface">
										Passifs joueur
									</h2>
									<p className="text-sm text-on-surface-variant font-medium">
										{nierFamilies.length} familles &mdash; {nierAllPlayer.length} instances totales
										(données gamedata IEVR, textes officiels FR/EN/JA résolus)
									</p>
								</div>
							</div>

							<FadeInStagger
								className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
								role="list"
								aria-label="Familles de passifs joueur"
							>
								{nierFamilies.map((family) => (
									<FadeInItem
										key={family.effect_id}
										className="h-full"
										role="listitem"
									>
										<NierPassiveFamilyCard family={family} />
									</FadeInItem>
								))}
							</FadeInStagger>
						</section>
					)}

					{/* Passifs d'équipe (team passives nie-data, 21 entrées) */}
					{!typeFilter && nierTeamPassives.length > 0 && (
						<section id="team" className="scroll-mt-36" aria-labelledby="team-heading">
							<div className="flex items-center gap-4 mb-8 border-b border-outline-variant/30 pb-2">
								<Users size={36} className="text-sky-600" aria-hidden="true" />
								<div>
									<h2 id="team-heading" className="text-2xl font-bold text-on-surface">
										Passifs d&apos;équipe
									</h2>
									<p className="text-sm text-on-surface-variant font-medium">
										{nierTeamPassives.length} passifs &mdash; appliqués à toute l&apos;équipe
									</p>
								</div>
							</div>

							<FadeInStagger
								className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
								role="list"
								aria-label="Passifs d'équipe"
							>
								{nierTeamPassives.map((t) => (
									<FadeInItem key={t.team_passive_id} className="h-full" role="listitem">
										<NierTeamPassiveCard passive={t} />
									</FadeInItem>
								))}
							</FadeInStagger>
						</section>
					)}

				</div>
			)}
		</div>
	);
}
