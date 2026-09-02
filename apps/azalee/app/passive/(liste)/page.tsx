import { SearchX, SlidersHorizontal, User, Users, Wand2 } from "lucide-react";
import type { Metadata } from "next";
import type React from "react";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { FadeInItem, FadeInStagger } from "@/components/ui/fade-in";
import { PassiveFilters } from "@/components/wiki/filters/PassiveFilters";
import { PassivePlayerFilters } from "@/components/wiki/filters/PassivePlayerFilters";
import {
	CoordinatorPassiveCard,
	CustomPassiveCard,
	NierPassiveFamilyCard,
	NierTeamPassiveCard,
	PLAYSTYLE_FR,
	PlayerPassiveCard,
	REQUIREMENT_FR,
	STAT_FR,
} from "@/components/wiki/PassiveCard";
import type {
	CoordinatorPassiveData,
	CustomPassiveData,
	NierPassiveFamily,
	NierPassiveInstance,
	NierTeamPassive,
	PlayerPassiveData,
} from "@/components/wiki/PassiveCard";
import { WikiSearchToolbar } from "@/components/wiki/WikiSearchToolbar";
import type { SpriteCommonKey } from "@/config/sprites-common";
import passiveData from "@/data/passive-sheets.json";
import passivesFullData from "@rosegriffon/azalee/data/passives-full.json";
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

// ── Helpers passive-sheets ──

function passiveSearchText(p: { requirement: string; stat: string; playstyle?: string }): string {
	const req = REQUIREMENT_FR[p.requirement] || p.requirement;
	const stat = STAT_FR[p.stat] || p.stat;
	const ps = p.playstyle ? PLAYSTYLE_FR[p.playstyle] || p.playstyle : "";
	return normalizeText(`${req} ${stat} ${ps}`);
}

/** Map stat EN key to a filter category */
function statCategory(stat: string): string {
	const s = stat.toLowerCase();
	if (s.includes("shot")) {
		return "shot";
	}
	if (s.includes("focus")) {
		return "focus";
	}
	if (s.includes("scramble")) {
		return "scramble";
	}
	if (s.includes("castle")) {
		return "castle";
	}
	if (
		s.startsWith("team") ||
		s.startsWith("[mf]") ||
		s.startsWith("[df]") ||
		s.startsWith("[kp]") ||
		s.startsWith("[substitute")
	) {
		return "team";
	}
	if (s.startsWith("own")) {
		return "own";
	}
	return "";
}

function matchesFilters(
	p: { requirement: string; stat: string; playstyle?: string },
	qNorm: string,
	playstyleFilter: string | null,
	statCatFilter: string
): boolean {
	if (qNorm && !passiveSearchText(p).includes(qNorm)) {
		return false;
	}
	if (playstyleFilter !== null && (p.playstyle ?? "") !== playstyleFilter) {
		return false;
	}
	if (statCatFilter && statCategory(p.stat) !== statCatFilter) {
		return false;
	}
	return true;
}

// ── Section config ──

const PLAYSTYLE_SECTIONS: Array<{
	key: string;
	label: string;
	icon?: React.ComponentType<{ size?: number; className?: string; "aria-hidden"?: boolean }>;
	sprite?: SpriteCommonKey;
	color: string;
}> = [
	{ color: "text-on-surface-variant", icon: SlidersHorizontal, key: "", label: "Généraux" },
	{ color: "text-red-500", key: "Breach", label: "Brèche", sprite: "breche" },
	{ color: "text-amber-500", key: "Tension", label: "Tension", sprite: "tension" },
	{ color: "text-blue-500", key: "Counter", label: "Contre-attaque", sprite: "contre" },
	{ color: "text-pink-500", key: "Bond", label: "Lien", sprite: "lien" },
	{ color: "text-orange-500", key: "Rough Play", label: "Jeu brutal", sprite: "jeu_violent" },
	{ color: "text-emerald-500", key: "Justice", label: "Justice", sprite: "justice" },
];

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

	const psFilter = playstyleFilter !== undefined ? (playstyleFilter?.toString() ?? "") : null;
	const catFilter = statCatFilter?.toString() || "";
	const elFilter = elementFilter?.toString() || "";
	const rarFilter = rarityFilter?.toString() || "";
	const pCatFilter = passiveCatFilter?.toString() || "";

	// ── Load passive-sheets data (custom + coordinator) ──
	const allPlayerPassivesSheets = passiveData.playerPassives as PlayerPassiveData[];
	const allCustomPassives = passiveData.customPassives as CustomPassiveData[];
	const allCoordinatorPassives = passiveData.coordinatorPassives as CoordinatorPassiveData[];

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

	// ── Compute type counts ──
	const playerFiltered = allPlayerPassivesSheets.filter((p) =>
		matchesFilters(p, qNorm, psFilter, catFilter)
	);
	const customFiltered = allCustomPassives.filter((p) =>
		matchesFilters(p, qNorm, null, catFilter)
	);
	const coordFiltered = allCoordinatorPassives.filter((p) =>
		matchesFilters(p, qNorm, psFilter, catFilter)
	);

	const typeCounts: Record<string, number> = {
		coordinator: coordFiltered.length,
		custom: customFiltered.length,
		player: nierFamiliesFiltered.length,
	};

	// ── Apply type filter ──
	const showPlayer = !typeFilter || typeFilter === "player";
	const showCustom = !typeFilter || typeFilter === "custom";
	const showCoord = !typeFilter || typeFilter === "coordinator";

	const nierFamilies = showPlayer ? nierFamiliesFiltered : [];
	const customPassives = showCustom ? customFiltered : [];
	const coordinatorPassives = showCoord ? coordFiltered : [];

	// ── Playstyle counts (sheets fallback, used for filters) ──
	const allForPlaystyleCounts = [
		...(showPlayer
			? (allPlayerPassivesSheets as Array<{
					playstyle?: string;
					requirement: string;
					stat: string;
				}>).filter(
					(p) =>
						(!qNorm || passiveSearchText(p as { requirement: string; stat: string; playstyle?: string }).includes(qNorm)) &&
						(!catFilter || statCategory(p.stat) === catFilter)
				)
			: []),
		...(showCoord
			? (
					allCoordinatorPassives as Array<{
						playstyle?: string;
						requirement: string;
						stat: string;
					}>
				).filter(
					(p) =>
						(!qNorm || passiveSearchText(p as { requirement: string; stat: string; playstyle?: string }).includes(qNorm)) &&
						(!catFilter || statCategory(p.stat) === catFilter)
				)
			: []),
	];
	const playstyleCounts: Record<string, number> = {};
	for (const p of allForPlaystyleCounts) {
		const ps = p.playstyle ?? "";
		playstyleCounts[ps] = (playstyleCounts[ps] || 0) + 1;
	}

	// ── Legacy player passive groups (sheets) ──
	const sheetPlayerPassives = showPlayer ? playerFiltered : [];
	const playerGroups = PLAYSTYLE_SECTIONS.map((section) => ({
		...section,
		passives: sheetPlayerPassives.filter((p) => p.playstyle === section.key),
	})).filter((g) => g.passives.length > 0);

	// ── Coordinator groups ──
	const coordGroups = PLAYSTYLE_SECTIONS.map((section) => ({
		...section,
		passives: coordinatorPassives.filter((p) => p.playstyle === section.key),
	})).filter((g) => g.passives.length > 0);

	const totalCount =
		nierFamilies.length + customPassives.length + coordinatorPassives.length;

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

					{/* Passifs joueur legacy (passive-sheets, groupés par style de jeu) — affiché si pas de nie-data */}
					{nierFamilies.length === 0 && playerGroups.length > 0 && (
						<section id="player-legacy" className="scroll-mt-36" aria-labelledby="player-legacy-heading">
							<div className="flex items-center gap-4 mb-8 border-b border-outline-variant/30 pb-2">
								<User size={36} className="text-blue-600" aria-hidden="true" />
								<div>
									<h2 id="player-legacy-heading" className="text-2xl font-bold text-on-surface">
										Passifs joueur
									</h2>
									<p className="text-sm text-on-surface-variant font-medium">
										{sheetPlayerPassives.length} passifs &mdash; valeurs par rareté
									</p>
								</div>
							</div>

							<div className="space-y-10">
								{playerGroups.map((group) => (
									<div
										key={group.key || "general"}
										role="region"
										aria-label={`Style de jeu : ${group.label}`}
									>
										<div className="flex items-center gap-2 mb-4">
											{group.sprite ? (
												<div className="size-6 flex items-center justify-center">
													<CommonSpriteIcon name={group.sprite} scale={0.5} />
												</div>
											) : (
												group.icon && <group.icon size={20} className={group.color} aria-hidden />
											)}
											<h3 className="text-lg font-bold text-on-surface">{group.label}</h3>
											<span
												className="text-xs text-on-surface-variant"
												aria-label={`${group.passives.length} passifs`}
											>
												({group.passives.length})
											</span>
										</div>

										<FadeInStagger
											className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
											role="list"
											aria-label={`Passifs ${group.label}`}
										>
											{group.passives.map((p) => (
												<FadeInItem key={p.no} className="h-full" role="listitem">
													<PlayerPassiveCard passive={p} />
												</FadeInItem>
											))}
										</FadeInStagger>
									</div>
								))}
							</div>
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

					{/* Custom Passives */}
					{customPassives.length > 0 && (
						<section id="custom" className="scroll-mt-36" aria-labelledby="custom-heading">
							<div className="flex items-center gap-4 mb-8 border-b border-outline-variant/30 pb-2">
								<Wand2 size={36} className="text-purple-600" aria-hidden="true" />
								<div>
									<h2 id="custom-heading" className="text-2xl font-bold text-on-surface">
										Passifs personnalisés
									</h2>
									<p className="text-sm text-on-surface-variant font-medium">
										{customPassives.length} passifs &mdash; valeur fixe unique
									</p>
								</div>
							</div>

							<FadeInStagger
								className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
								role="list"
								aria-label="Passifs personnalisés"
							>
								{customPassives.map((p) => (
									<FadeInItem key={p.no} className="h-full" role="listitem">
										<CustomPassiveCard passive={p} />
									</FadeInItem>
								))}
							</FadeInStagger>
						</section>
					)}

					{/* Coordinator / Manager Passives */}
					{coordinatorPassives.length > 0 && (
						<section
							id="coordinator"
							className="scroll-mt-36"
							aria-labelledby="coordinator-heading"
						>
							<div className="flex items-center gap-4 mb-8 border-b border-outline-variant/30 pb-2">
								<Users size={36} className="text-amber-600" aria-hidden="true" />
								<div>
									<h2 id="coordinator-heading" className="text-2xl font-bold text-on-surface">
										Passifs coordinateur / manager
									</h2>
									<p className="text-sm text-on-surface-variant font-medium">
										{coordinatorPassives.length} passifs &mdash; valeurs par rôle et rareté
									</p>
								</div>
							</div>

							<div className="space-y-10">
								{coordGroups.map((group) => (
									<div
										key={group.key || "general-coord"}
										role="region"
										aria-label={`Style de jeu : ${group.label}`}
									>
										<div className="flex items-center gap-2 mb-4">
											{group.sprite ? (
												<div className="size-6 flex items-center justify-center">
													<CommonSpriteIcon name={group.sprite} scale={0.5} />
												</div>
											) : (
												group.icon && <group.icon size={20} className={group.color} aria-hidden />
											)}
											<h3 className="text-lg font-bold text-on-surface">{group.label}</h3>
											<span
												className="text-xs text-on-surface-variant"
												aria-label={`${group.passives.length} passifs`}
											>
												({group.passives.length})
											</span>
										</div>

										<FadeInStagger
											className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
											role="list"
											aria-label={`Passifs coordinateur ${group.label}`}
										>
											{group.passives.map((p) => (
												<FadeInItem key={p.no} className="h-full" role="listitem">
													<CoordinatorPassiveCard passive={p} />
												</FadeInItem>
											))}
										</FadeInStagger>
									</div>
								))}
							</div>
						</section>
					)}
				</div>
			)}
		</div>
	);
}
