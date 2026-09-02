"use client";

import type { BaseCharacter } from "@rosegriffon/inagle";
import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { Icon } from "@/components/ui/Icon";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { SafeImage } from "@/components/ui/SafeImage";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { getCharacterImageUrl } from "@rosegriffon/azalee/images";
import { cn } from "@/lib/utils";

// ---------- Constants ----------

const ELEMENT_SPRITE: Record<string, SpriteCommonKey> = {
	Fire: "fire",
	Forest: "forest",
	Mountain: "mountain",
	Wind: "wind",
};

// Les données joueurs en DB stockent l'élément en FRANÇAIS (Feu/Vent/Forêt/Montagne/Néant),
// alors que les filtres UI utilisent la valeur anglaise (Fire/Wind/Forest/Mountain).
// On normalise les deux côtés vers une clé canonique anglaise pour que le filtre matche.
const ELEMENT_CANONICAL: Record<string, string> = {
	Fire: "Fire",
	Feu: "Fire",
	Wind: "Wind",
	Vent: "Wind",
	Forest: "Forest",
	Forêt: "Forest",
	Foret: "Forest",
	Mountain: "Mountain",
	Montagne: "Mountain",
	Void: "Void",
	Néant: "Void",
	Neant: "Void",
	Aucun: "Void",
};

function canonicalElement(el: string | undefined | null): string | undefined {
	if (!el) return undefined;
	return ELEMENT_CANONICAL[el] || el;
}

const POS_LABEL: Record<string, string> = { DF: "DEF", FW: "ATT", GK: "GAR", MF: "MIL" };
const POS_COLOR: Record<string, string> = {
	DF: "bg-blue-600",
	FW: "bg-red-600",
	GK: "bg-amber-500",
	MF: "bg-emerald-600",
};

const PLAYSTYLE_SPRITE: Record<string, SpriteCommonKey> = {
	Bond: "lien",
	Breach: "breche",
	Counter: "contre",
	Justice: "justice",
	"Rough Play": "jeu_violent",
	Tension: "tension",
};

const PLAYSTYLES = [
	{ key: "Bond", label: "Lien" },
	{ key: "Justice", label: "Justice" },
	{ key: "Breach", label: "Percée" },
	{ key: "Tension", label: "Tension" },
	{ key: "Rough Play", label: "Jeu violent" },
	{ key: "Counter", label: "Contre" },
];

const ELEMENTS = [
	{ label: "Feu", value: "Fire" },
	{ label: "Vent", value: "Wind" },
	{ label: "Forêt", value: "Forest" },
	{ label: "Montagne", value: "Mountain" },
];

// Genre — gender 0 = garçon, 1 = fille (cf. mapDbCharacterToBase)
const GENDERS = [
	{ icon: "male", label: "Garçon", value: 0 },
	{ icon: "female", label: "Fille", value: 1 },
] as const;

// Rareté — labels in-game FR tels que stockés dans bestRarity
const RARITIES = ["Normal", "Expérimenté", "Héros", "BASARA"];

// Ordre canonique d'affichage des séries (les autres sont ajoutées après par fréquence)
const SERIES_ORDER = [
	"Victory Road",
	"Galaxy",
	"Orion",
	"Ares",
	"Chrono Stone",
	"Inazuma Eleven GO",
	"Inazuma Eleven 3",
	"Inazuma Eleven 2",
	"Inazuma Eleven",
];

interface Formation {
	name: string;
	layout: string;
	df: number;
	mf: number;
	fw: number;
	off: number;
	def: number;
}

// Formations dédupliquées par distribution de joueurs (df-mf-fw)
// Le GK (toujours 1) n'est pas compté dans le layout
const FORMATIONS: Formation[] = [
	{ def: 3, df: 4, fw: 2, layout: "4-4-2", mf: 4, name: "4-4-2", off: 3 },
	{ def: 2, df: 4, fw: 3, layout: "4-3-3", mf: 3, name: "4-3-3", off: 4 },
	{ def: 2, df: 3, fw: 3, layout: "3-4-3", mf: 4, name: "3-4-3", off: 4 },
	{ def: 3, df: 3, fw: 2, layout: "3-5-2", mf: 5, name: "3-5-2", off: 3 },
	{ def: 4, df: 4, fw: 1, layout: "4-5-1", mf: 5, name: "4-5-1", off: 2 },
	{ def: 3, df: 3, fw: 1, layout: "3-6-1", mf: 6, name: "3-6-1", off: 3 },
	{ def: 4, df: 5, fw: 1, layout: "5-4-1", mf: 4, name: "5-4-1", off: 2 },
	{ def: 1, df: 2, fw: 4, layout: "2-4-4", mf: 4, name: "2-4-4", off: 5 },
	{ def: 2, df: 2, fw: 3, layout: "2-5-3", mf: 5, name: "2-5-3", off: 4 },
	{ def: 4, df: 5, fw: 4, layout: "5-1-4", mf: 1, name: "5-1-4", off: 2 },
	{ def: 5, df: 3, fw: 4, layout: "3-3-4", mf: 3, name: "3-3-4", off: 1 },
	{ def: 3, df: 5, fw: 2, layout: "5-3-2", mf: 3, name: "5-3-2", off: 3 },
];

// ---------- Helpers ----------

function pickRandom<T>(arr: T[], n: number): T[] {
	const copy = [...arr];
	const result: T[] = [];
	for (let i = 0; i < n && copy.length > 0; i++) {
		const idx = Math.floor(Math.random() * copy.length);
		result.push(copy.splice(idx, 1)[0]);
	}
	return result;
}

function resolveImageUrl(char: BaseCharacter): string {
	const charAny = char as any;
	const variant = char.variants?.[0] as any;
	const zukanHash = charAny.zukanHash || variant?.zukanHash;
	if (zukanHash) {
		const clean = zukanHash.startsWith("/") ? zukanHash.slice(1) : zukanHash;
		return `https://dxi4wb638ujep.cloudfront.net/1/${clean}.png`;
	}
	return getCharacterImageUrl(char.internalCode);
}

function getCharHref(char: BaseCharacter): string {
	const charAny = char as any;
	const variant = char.variants?.[0] as any;
	return `/chara/${charAny.slug || variant?.slug || variant?.charaParamId || char.charaId}`;
}

function getCharName(char: BaseCharacter): string {
	return char.names?.fr || char.names?.en || char.names?.ja || "?";
}

// ---------- Per-character field accessors (mêmes chemins que mapDbCharacterToBase) ----------

function getCharElement(c: BaseCharacter): string | undefined {
	const variant = c.variants?.[0] as any;
	return canonicalElement(variant?.element || (c as any).element);
}

function getCharPlaystyle(c: BaseCharacter): string | undefined {
	return (c as any).sheetData?.playstyle || (c as any).playstyle;
}

function getCharGender(c: BaseCharacter): number | undefined {
	const g = (c as any).gender;
	return g === 0 || g === 1 ? g : undefined;
}

function getCharRarity(c: BaseCharacter): string {
	return (c as any).bestRarity || (c.variants?.[0] as any)?.rarity || "Normal";
}

function getCharSeries(c: BaseCharacter): string | undefined {
	return (c as any).series || undefined;
}

// ---------- Types ----------

interface Coordinator {
	id: number;
	name_localised: string;
	name_romaji: string;
	name_kanji?: string;
	role: string;
	playstyle?: string;
	element?: string;
	image?: string;
	buff?: string;
}

interface RandomTeamGeneratorProps {
	pools: {
		gk: BaseCharacter[];
		df: BaseCharacter[];
		mf: BaseCharacter[];
		fw: BaseCharacter[];
	};
	coordinators: {
		coaches: Coordinator[];
		managers: Coordinator[];
	};
}

interface GeneratedTeam {
	gk: BaseCharacter[];
	df: BaseCharacter[];
	mf: BaseCharacter[];
	fw: BaseCharacter[];
	coach: Coordinator | null;
	managers: Coordinator[];
}

// ---------- Generic Filter Chip (MD3) ----------

function FilterChip({
	active,
	onClick,
	label,
	icon,
	sprite,
	spriteScale = 0.25,
}: {
	active: boolean;
	onClick: () => void;
	label: string;
	icon?: string;
	sprite?: SpriteCommonKey;
	spriteScale?: number;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-pressed={active}
			aria-label={label}
			className={cn(
				"inline-flex items-center gap-1.5 h-9 sm:h-8 px-3 rounded-full text-xs font-bold transition-all",
				"min-h-[44px] sm:min-h-0",
				active
					? "bg-secondary-container text-on-secondary-container elevation-1 shadow-sm"
					: "border border-outline text-on-surface-variant hover:bg-on-surface/[0.08]"
			)}
		>
			{active && <Icon name="check" size={14} />}
			{!active && icon && <Icon name={icon} size={14} />}
			{sprite && <CommonSpriteIcon name={sprite} scale={spriteScale} />}
			<span>{label}</span>
		</button>
	);
}

// ---------- Sub-components ----------

function PlayerCard({
	player,
	locked,
	onToggleLock,
	animDelay,
	animating,
}: {
	player: BaseCharacter;
	locked: boolean;
	onToggleLock: () => void;
	animDelay: number;
	animating: boolean;
}) {
	const charAny = player as any;
	const variant = player.variants?.[0] as any;
	const position = variant?.position || charAny.position || "MF";
	const element = canonicalElement(variant?.element || charAny.element) || "Void";
	const rarity = charAny.bestRarity || variant?.rarity || "Normal";
	const imageUrl = resolveImageUrl(player);
	const name = getCharName(player);
	const href = getCharHref(player);
	const elSprite = ELEMENT_SPRITE[element];

	return (
		<div
			className={cn(
				"relative group w-full transition-all",
				animating && !locked ? "animate-slot-roll" : "opacity-100 scale-100"
			)}
			style={{
				animationDelay: animating && !locked ? `${animDelay}ms` : undefined,
				transitionDuration: "300ms",
			}}
		>
			<Link
				href={href}
				className="block w-full rounded-lg sm:rounded-xl overflow-hidden border border-outline-variant/20 hover:border-primary/40 bg-neutral-950 transition-all"
			>
				<div className="relative w-full aspect-square overflow-hidden">
					<SafeImage
						src={imageUrl}
						zukanHash={(player as any).zukanHash || player.variants?.[0]?.zukanHash}
						fallbackSrc={getCharacterImageUrl(player.internalCode)}
						alt={name}
						fill
						sizes="(max-width: 640px) 20vw, 140px"
						className="object-cover"
						unoptimized
					/>
					<div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent" />

					{/* Rarity */}
					<div className="absolute top-0.5 left-0.5 sm:top-1.5 sm:left-1.5">
						<RarityBadge rarity={rarity} size="xs" />
					</div>

					{/* Element + Position */}
					<div className="absolute bottom-5 sm:bottom-8 left-0.5 sm:left-1.5 flex items-center gap-0.5">
						{elSprite && <CommonSpriteIcon name={elSprite} scale={0.2} className="sm:scale-125" />}
						<span
							className={cn(
								"px-0.5 sm:px-1 py-px rounded text-[7px] sm:text-[9px] font-black text-white leading-none",
								POS_COLOR[position] || "bg-slate-600"
							)}
						>
							{POS_LABEL[position] || position}
						</span>
					</div>

					{/* Name */}
					<div className="absolute bottom-0 inset-x-0 px-1 sm:px-2 pb-0.5 sm:pb-1.5">
						<p className="text-white font-bold text-[8px] sm:text-xs truncate drop-shadow-lg">
							{name}
						</p>
					</div>
				</div>
			</Link>

			{/* Lock toggle */}
			<button
				onClick={(e) => {
					e.preventDefault();
					e.stopPropagation();
					onToggleLock();
				}}
				className={cn(
					"absolute top-0.5 right-0.5 sm:top-1.5 sm:right-1.5 z-10 p-2 sm:p-1 rounded-full transition-all",
					locked
						? "bg-primary text-on-primary elevation-1"
						: "bg-black/40 text-white/70 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 hover:bg-black/60"
				)}
				aria-label={locked ? `Débloquer ${name}` : `Bloquer ${name}`}
				aria-pressed={locked}
				title={locked ? "Débloquer" : "Bloquer ce joueur"}
			>
				{locked ? (
					<Icon name="lock" size={12} className="sm:w-3 sm:h-3" />
				) : (
					<Icon name="lock_open" size={12} className="sm:w-3 sm:h-3" />
				)}
			</button>
		</div>
	);
}

function resolveCoordinatorImage(person: Coordinator): string | null {
	if (!person.image) {
		return null;
	}
	const clean = person.image.startsWith("/") ? person.image.slice(1) : person.image;
	return `https://dxi4wb638ujep.cloudfront.net/1/${clean}.png`;
}

const COORD_ELEMENT_MAP: Record<string, string> = {
	火: "Fire",
	風: "Wind",
	林: "Forest",
	山: "Mountain",
	無: "Void",
};

function StaffSlot({
	person,
	role,
	team,
}: {
	person: Coordinator;
	role: string;
	team: GeneratedTeam;
}) {
	const imageUrl = resolveCoordinatorImage(person);
	const [imgError, setImgError] = useState(false);

	const coordElement = canonicalElement(COORD_ELEMENT_MAP[person.element || ""] || person.element);
	const elSprite = coordElement ? ELEMENT_SPRITE[coordElement] : null;

	const players = [...team.gk, ...team.df, ...team.mf, ...team.fw];
	const compatibility = players.filter((p) => {
		const el = getCharElement(p);
		const ps = getCharPlaystyle(p);
		return (coordElement && el === coordElement) || ps === person.playstyle;
	}).length;

	return (
		<div className="flex flex-col gap-2 p-3 rounded-2xl bg-surface-container hover:bg-surface-container-high border border-outline/5 transition-all">
			<div className="flex items-center gap-2 px-1">
				<div className="size-10 sm:w-12 sm:h-12 rounded-full bg-surface-container-high flex items-center justify-center shrink-0 overflow-hidden border border-outline/10 shadow-inner">
					{imageUrl && !imgError ? (
						<Image
							src={imageUrl}
							alt={person.name_localised || person.name_romaji}
							width={48}
							height={48}
							className="object-cover w-full h-full"
							unoptimized
							onError={() => setImgError(true)}
						/>
					) : (
						<Icon
							name={role === "Coach" ? "sports" : "person"}
							size={20}
							className="text-on-surface-variant"
						/>
					)}
				</div>
				<div className="min-w-0 flex-1">
					<p className="text-xs sm:text-sm font-bold text-on-surface truncate">
						{person.name_localised || person.name_romaji}
					</p>
					<div className="flex items-center gap-1 mt-0.5">
						<span className="text-[9px] font-semibold text-on-surface-variant uppercase tracking-wider">
							{role === "Coach" ? "Coach" : "Manager"}
						</span>
						{elSprite && <CommonSpriteIcon name={elSprite} scale={0.2} />}
					</div>
				</div>
			</div>

			<div className="mt-1 pt-1.5 border-t border-outline/5 space-y-1 text-[10px] text-on-surface-variant">
				{person.playstyle && (
					<p className="flex justify-between">
						<span>Style :</span>
						<span className="font-semibold text-on-surface">
							{PLAYSTYLES.find((p) => p.key === person.playstyle)?.label || person.playstyle}
						</span>
					</p>
				)}
				{person.buff && (
					<p className="flex justify-between">
						<span>Buff :</span>
						<span className="font-bold text-primary">{person.buff}</span>
					</p>
				)}
				<p className="flex justify-between">
					<span>Affinité :</span>
					<span className="font-semibold text-on-surface">
						{compatibility} joueur{compatibility > 1 ? "s" : ""}
					</span>
				</p>
			</div>
		</div>
	);
}

// ---------- Formation Picker (mobile: select, desktop: chips) ----------

function FormationPicker({
	formations,
	selectedIdx,
	onSelect,
}: {
	formations: Formation[];
	selectedIdx: number;
	onSelect: (idx: number) => void;
}) {
	const selected = formations[selectedIdx];

	return (
		<div>
			<p className="type-label-medium text-on-surface-variant mb-1.5 font-bold">Formation</p>

			{/* Mobile: native select */}
			<div className="sm:hidden">
				<div className="relative">
					<select
						value={selectedIdx}
						onChange={(e) => onSelect(Number(e.target.value))}
						className="w-full appearance-none rounded-xl bg-surface-container border border-outline-variant/30 px-3 min-h-[44px] py-2.5 pr-8 text-sm font-bold text-on-surface focus:outline-hidden focus:ring-2 focus:ring-primary/50"
					>
						{formations.map((f, i) => (
							<option key={i} value={i}>
								{f.name} ({f.layout})
							</option>
						))}
					</select>
					<Icon
						name="expand_more"
						size={16}
						className="absolute right-2.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
					/>
				</div>
				<div className="flex items-center gap-2 mt-1.5 px-1">
					<span className="text-[10px] text-on-surface-variant">{selected.layout}</span>
					<span className="text-[10px] text-on-surface-variant">
						ATT {"★".repeat(selected.off)}
						{"☆".repeat(5 - selected.off)}
					</span>
					<span className="text-[10px] text-on-surface-variant">
						DEF {"★".repeat(selected.def)}
						{"☆".repeat(5 - selected.def)}
					</span>
				</div>
			</div>

			{/* Desktop: chip grid — Filter Chips MD3 */}
			<div className="hidden sm:flex flex-wrap gap-1.5">
				{formations.map((f, i) => {
					const isActive = i === selectedIdx;
					return (
						<button
							key={`${f.name}-${i}`}
							onClick={() => onSelect(i)}
							aria-label={`Formation ${f.name}`}
							aria-pressed={isActive}
							className={cn(
								"inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-xs font-bold transition-all",
								isActive
									? "bg-secondary-container text-on-secondary-container elevation-1 shadow-sm"
									: "border border-outline text-on-surface-variant hover:bg-on-surface/[0.08]"
							)}
						>
							{isActive && <Icon name="check" size={14} />}
							<span>{f.name}</span>
							<span
								className={cn(
									"text-[10px] font-normal opacity-70",
									isActive ? "text-on-secondary-container/70" : ""
								)}
							>
								{f.layout}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

// ---------- Stat Progress Bar Helper ----------

function StatBar({ label, value, max = 150 }: { label: string; value: number; max?: number }) {
	const percentage = Math.min(100, Math.round((value / max) * 100));
	return (
		<div className="space-y-1">
			<div className="flex justify-between text-[11px] font-semibold text-on-surface-variant">
				<span>{label}</span>
				<span className="font-bold text-on-surface">{value}</span>
			</div>
			<div className="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden">
				<div
					className="h-full rounded-full bg-linear-to-r from-primary/75 to-primary transition-all duration-500"
					style={{ width: `${percentage}%` }}
				/>
			</div>
		</div>
	);
}

// ---------- Stats Extraction Helper ----------

const getPlayerStats = (player: BaseCharacter) => {
	const variant = player.variants?.[0];
	const dbStats = variant?.stats?.lv99;
	const sd = (player as any).sheetData || (variant as any)?.sheetData;
	const sdStats = sd?.stats;

	return {
		kick: dbStats?.kick || sdStats?.kick || 0,
		control: dbStats?.control || sdStats?.control || 0,
		technique: dbStats?.technique || sdStats?.technique || 0,
		pressure: dbStats?.pressure || sdStats?.pressure || 0,
		physical: dbStats?.physical || sdStats?.physical || 0,
		agility: dbStats?.agility || sdStats?.agility || 0,
		intelligence: dbStats?.intelligence || sdStats?.intelligence || 0,
	};
};

const getTeamAverageStats = (team: GeneratedTeam) => {
	const players = [...team.gk, ...team.df, ...team.mf, ...team.fw];

	const total = {
		kick: 0,
		control: 0,
		technique: 0,
		pressure: 0,
		physical: 0,
		agility: 0,
		intelligence: 0,
	};

	for (const p of players) {
		const stats = getPlayerStats(p);
		total.kick += stats.kick;
		total.control += stats.control;
		total.technique += stats.technique;
		total.pressure += stats.pressure;
		total.physical += stats.physical;
		total.agility += stats.agility;
		total.intelligence += stats.intelligence;
	}

	const count = players.length || 1;
	return {
		kick: Math.round(total.kick / count),
		control: Math.round(total.control / count),
		technique: Math.round(total.technique / count),
		pressure: Math.round(total.pressure / count),
		physical: Math.round(total.physical / count),
		agility: Math.round(total.agility / count),
		intelligence: Math.round(total.intelligence / count),
	};
};

const getTeamSynergies = (team: GeneratedTeam) => {
	const players = [...team.gk, ...team.df, ...team.mf, ...team.fw];

	const elementCounts: Record<string, number> = {
		Fire: 0,
		Wind: 0,
		Forest: 0,
		Mountain: 0,
		Void: 0,
	};

	const playstyleCounts: Record<string, number> = {
		Bond: 0,
		Justice: 0,
		Breach: 0,
		Tension: 0,
		"Rough Play": 0,
		Counter: 0,
	};

	for (const p of players) {
		const el = getCharElement(p) || "Void";
		if (elementCounts[el] !== undefined) {
			elementCounts[el]++;
		}

		const ps = getCharPlaystyle(p);
		if (ps && playstyleCounts[ps] !== undefined) {
			playstyleCounts[ps]++;
		}
	}

	// Synergies list
	const list: Array<{ element: string; count: number; boost: number }> = [];
	for (const [el, count] of Object.entries(elementCounts)) {
		if (count >= 3) {
			const boost = count >= 6 ? 15 : count >= 4 ? 10 : 5;
			list.push({ element: el, count, boost });
		}
	}

	return { elementCounts, playstyleCounts, list };
};

// ---------- Main component ----------

export function RandomTeamGenerator({ pools, coordinators }: RandomTeamGeneratorProps) {
	const [selectedPlaystyles, setSelectedPlaystyles] = useState<string[]>([]);
	const [selectedElement, setSelectedElement] = useState<string | undefined>();
	const [selectedGender, setSelectedGender] = useState<number | undefined>();
	const [selectedRarity, setSelectedRarity] = useState<string | undefined>();
	const [selectedSeries, setSelectedSeries] = useState<string | undefined>();
	const [formationIdx, setFormationIdx] = useState(0);
	const [animating, setAnimating] = useState(false);
	const [copied, setCopied] = useState(false);
	const [filtersOpen, setFiltersOpen] = useState(false);

	const formation = FORMATIONS[formationIdx];

	// Séries disponibles dérivées des pools (ordre canonique d'abord, reste par fréquence)
	const availableSeries = useMemo(() => {
		const counts = new Map<string, number>();
		for (const arr of [pools.gk, pools.df, pools.mf, pools.fw]) {
			for (const c of arr) {
				const s = getCharSeries(c);
				if (s) counts.set(s, (counts.get(s) || 0) + 1);
			}
		}
		const known = SERIES_ORDER.filter((s) => counts.has(s));
		const rest = [...counts.keys()]
			.filter((s) => !SERIES_ORDER.includes(s))
			.sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0));
		return [...known, ...rest];
	}, [pools]);

	// Filtered pools — applique chaque filtre seulement s'il reste >= minCount joueurs,
	// sinon le filtre est ignoré pour ne jamais casser la génération.
	const filteredPools = useCallback(() => {
		const filterPool = (arr: BaseCharacter[], minCount: number) => {
			let filtered = arr;

			if (selectedPlaystyles.length > 0) {
				const psFiltered = filtered.filter((c) => {
					const ps = getCharPlaystyle(c);
					return ps && selectedPlaystyles.includes(ps);
				});
				if (psFiltered.length >= minCount) {
					filtered = psFiltered;
				}
			}

			if (selectedElement) {
				const target = canonicalElement(selectedElement);
				const elFiltered = filtered.filter((c) => getCharElement(c) === target);
				if (elFiltered.length >= minCount) {
					filtered = elFiltered;
				}
			}

			if (selectedGender !== undefined) {
				const gFiltered = filtered.filter((c) => getCharGender(c) === selectedGender);
				if (gFiltered.length >= minCount) {
					filtered = gFiltered;
				}
			}

			if (selectedRarity) {
				const rFiltered = filtered.filter((c) => getCharRarity(c) === selectedRarity);
				if (rFiltered.length >= minCount) {
					filtered = rFiltered;
				}
			}

			if (selectedSeries) {
				const sFiltered = filtered.filter((c) => getCharSeries(c) === selectedSeries);
				if (sFiltered.length >= minCount) {
					filtered = sFiltered;
				}
			}

			return filtered;
		};

		return {
			df: filterPool(pools.df, formation.df),
			fw: filterPool(pools.fw, formation.fw),
			gk: filterPool(pools.gk, 1),
			mf: filterPool(pools.mf, formation.mf),
		};
	}, [
		pools,
		selectedPlaystyles,
		selectedElement,
		selectedGender,
		selectedRarity,
		selectedSeries,
		formation,
	]);

	const generate = useCallback(
		(deterministic = false): GeneratedTeam => {
			const p = filteredPools();
			// SSR + 1er rendu client : sélection déterministe (slice) pour éviter le
			// mismatch d'hydratation (#418) dû à Math.random. On rebrasse au montage.
			const pick = <T,>(arr: T[], n: number): T[] =>
				deterministic ? arr.slice(0, n) : pickRandom(arr, n);
			return {
				coach: pick(coordinators.coaches, 1)[0] || null,
				df: pick(p.df, formation.df),
				fw: pick(p.fw, formation.fw),
				gk: pick(p.gk, 1),
				managers: pick(coordinators.managers, 3),
				mf: pick(p.mf, formation.mf),
			};
		},
		[filteredPools, formation, coordinators]
	);

	const [team, setTeam] = useState<GeneratedTeam>(() => generate(true));

	// Rebrasse aléatoirement après le montage (l'init déterministe ci-dessus garde
	// SSR et 1er rendu client identiques → pas d'erreur d'hydratation React #418).
	const didShuffleRef = useRef(false);
	useEffect(() => {
		if (didShuffleRef.current) return;
		didShuffleRef.current = true;
		setTeam(generate());
	}, [generate]);

	// Auto-regenerate when formation or any filter changes
	const prevFormationRef = useRef(formationIdx);
	const prevElementRef = useRef(selectedElement);
	const prevPlaystyleRef = useRef(selectedPlaystyles);
	const prevGenderRef = useRef(selectedGender);
	const prevRarityRef = useRef(selectedRarity);
	const prevSeriesRef = useRef(selectedSeries);
	useEffect(() => {
		if (
			prevFormationRef.current !== formationIdx ||
			prevElementRef.current !== selectedElement ||
			prevPlaystyleRef.current !== selectedPlaystyles ||
			prevGenderRef.current !== selectedGender ||
			prevRarityRef.current !== selectedRarity ||
			prevSeriesRef.current !== selectedSeries
		) {
			prevFormationRef.current = formationIdx;
			prevElementRef.current = selectedElement;
			prevPlaystyleRef.current = selectedPlaystyles;
			prevGenderRef.current = selectedGender;
			prevRarityRef.current = selectedRarity;
			prevSeriesRef.current = selectedSeries;
			setAnimating(true);
			setTimeout(() => {
				setTeam(generate());
				setAnimating(false);
			}, 200);
		}
	}, [
		formationIdx,
		selectedElement,
		selectedPlaystyles,
		selectedGender,
		selectedRarity,
		selectedSeries,
		generate,
	]);

	// Locked players
	const [locked, setLocked] = useState<Set<string>>(new Set());

	const toggleLock = useCallback((key: string) => {
		setLocked((prev) => {
			const next = new Set(prev);
			if (next.has(key)) {
				next.delete(key);
			} else {
				next.add(key);
			}
			return next;
		});
	}, []);

	const regenerate = useCallback(() => {
		if (animating) return;
		setAnimating(true);

		let ticks = 0;
		const maxTicks = 6;

		const interval = setInterval(() => {
			setTeam((prev) => {
				const fresh = generate();
				const mergePosition = (
					position: "gk" | "df" | "mf" | "fw",
					freshArr: BaseCharacter[]
				): BaseCharacter[] =>
					freshArr.map((freshPlayer, i) => {
						const key = `${position}-${i}`;
						if (locked.has(key) && prev[position][i]) {
							return prev[position][i];
						}
						return freshPlayer;
					});
				return {
					...fresh,
					df: mergePosition("df", fresh.df),
					fw: mergePosition("fw", fresh.fw),
					gk: mergePosition("gk", fresh.gk),
					mf: mergePosition("mf", fresh.mf),
				};
			});

			ticks++;
			if (ticks >= maxTicks) {
				clearInterval(interval);
				setAnimating(false);
			}
		}, 80);
	}, [generate, locked, animating]);

	const handleCopyLink = useCallback(async () => {
		try {
			await navigator.clipboard.writeText(window.location.href);
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		} catch {
			/* Silent */
		}
	}, []);

	const togglePlaystyle = (key: string) => {
		setSelectedPlaystyles((prev) => {
			if (prev.includes(key)) {
				return prev.filter((p) => p !== key);
			}
			if (prev.length >= 2) {
				return [prev[1], key];
			}
			return [...prev, key];
		});
	};

	const clearAllFilters = () => {
		setSelectedPlaystyles([]);
		setSelectedElement(undefined);
		setSelectedGender(undefined);
		setSelectedRarity(undefined);
		setSelectedSeries(undefined);
	};

	const hasLocked = locked.size > 0;
	const activeFilterCount =
		selectedPlaystyles.length +
		(selectedElement ? 1 : 0) +
		(selectedGender !== undefined ? 1 : 0) +
		(selectedRarity ? 1 : 0) +
		(selectedSeries ? 1 : 0);
	const hasActiveFilters = activeFilterCount > 0;

	// Staggered animation delay counter
	let slotIndex = 0;

	const renderRow = (position: "gk" | "df" | "mf" | "fw", players: BaseCharacter[]) =>
		players.map((p, i) => {
			const key = `${position}-${i}`;
			const delay = slotIndex++ * 40;
			return (
				<PlayerCard
					key={`${key}-${p.charaId}`}
					player={p}
					locked={locked.has(key)}
					onToggleLock={() => toggleLock(key)}
					animDelay={delay}
					animating={animating}
				/>
			);
		});

	// Calculate metrics for stats, element synergy and dominant playstyle
	const synergies = getTeamSynergies(team);
	const averageStats = getTeamAverageStats(team);

	// Find MVP (highest stat player)
	const allPlayersList = [...team.gk, ...team.df, ...team.mf, ...team.fw];
	let mvpPlayer = allPlayersList[0];
	let maxSingleStat = 0;
	for (const p of allPlayersList) {
		const s = getPlayerStats(p);
		const max = Math.max(
			s.kick,
			s.control,
			s.technique,
			s.pressure,
			s.physical,
			s.agility,
			s.intelligence
		);
		if (max > maxSingleStat) {
			maxSingleStat = max;
			mvpPlayer = p;
		}
	}

	// ---------- Filter section (réutilisée dans le panneau) ----------
	const filterSection = (
		<div className="space-y-3.5">
			{/* Element filter */}
			<div>
				<p className="type-label-medium text-on-surface-variant mb-1.5 font-bold">Élément</p>
				<div className="flex flex-wrap gap-1.5">
					{ELEMENTS.map(({ value, label }) => (
						<FilterChip
							key={value}
							active={selectedElement === value}
							onClick={() => setSelectedElement((prev) => (prev === value ? undefined : value))}
							label={label}
							sprite={ELEMENT_SPRITE[value]}
						/>
					))}
				</div>
			</div>

			{/* Playstyle filter */}
			<div>
				<p className="type-label-medium text-on-surface-variant mb-1.5 font-bold">
					Style de jeu (max 2)
				</p>
				<div className="flex flex-wrap gap-1.5">
					{PLAYSTYLES.map((ps) => (
						<FilterChip
							key={ps.key}
							active={selectedPlaystyles.includes(ps.key)}
							onClick={() => togglePlaystyle(ps.key)}
							label={ps.label}
							sprite={PLAYSTYLE_SPRITE[ps.key]}
						/>
					))}
				</div>
			</div>

			{/* Gender filter */}
			<div>
				<p className="type-label-medium text-on-surface-variant mb-1.5 font-bold">Genre</p>
				<div className="flex flex-wrap gap-1.5">
					{GENDERS.map(({ value, label, icon }) => (
						<FilterChip
							key={value}
							active={selectedGender === value}
							onClick={() => setSelectedGender((prev) => (prev === value ? undefined : value))}
							label={label}
							icon={icon}
						/>
					))}
				</div>
			</div>

			{/* Rarity filter — RarityBadge chips */}
			<div>
				<p className="type-label-medium text-on-surface-variant mb-1.5 font-bold">Rareté</p>
				<div className="flex flex-wrap gap-1.5">
					{RARITIES.map((rarity) => {
						const active = selectedRarity === rarity;
						return (
							<button
								type="button"
								key={rarity}
								onClick={() => setSelectedRarity((prev) => (prev === rarity ? undefined : rarity))}
								aria-pressed={active}
								aria-label={`Rareté ${rarity}`}
								className={cn(
									"inline-flex items-center gap-1.5 h-9 sm:h-8 px-2.5 rounded-full transition-all",
									"min-h-[44px] sm:min-h-0",
									active
										? "bg-secondary-container elevation-1 shadow-sm"
										: "border border-outline hover:bg-on-surface/[0.08]"
								)}
							>
								{active && <Icon name="check" size={14} className="text-on-secondary-container" />}
								<RarityBadge rarity={rarity} size="xs" />
							</button>
						);
					})}
				</div>
			</div>

			{/* Series filter */}
			{availableSeries.length > 0 && (
				<div>
					<p className="type-label-medium text-on-surface-variant mb-1.5 font-bold">Série</p>
					<div className="flex flex-wrap gap-1.5">
						{availableSeries.map((series) => (
							<FilterChip
								key={series}
								active={selectedSeries === series}
								onClick={() => setSelectedSeries((prev) => (prev === series ? undefined : series))}
								label={series}
							/>
						))}
					</div>
				</div>
			)}

			{/* Clear all */}
			{hasActiveFilters && (
				<div className="pt-0.5">
					<button
						type="button"
						onClick={clearAllFilters}
						className="inline-flex items-center gap-1.5 h-9 sm:h-8 px-3 rounded-full type-label-large text-primary hover:bg-primary/[0.08] transition-all min-h-[44px] sm:min-h-0"
					>
						<Icon name="filter_alt_off" size={16} />
						Tout effacer
					</button>
				</div>
			)}
		</div>
	);

	return (
		<div className="w-full max-w-full overflow-x-hidden space-y-4 sm:space-y-6">
			{/* CSS slot-machine roll animation */}
			<style>{`
				@keyframes slot-machine {
					0% { transform: translateY(0); filter: blur(0px); opacity: 1; }
					25% { transform: translateY(-16px); filter: blur(1.5px); opacity: 0.5; }
					30% { transform: translateY(16px); filter: blur(1.5px); opacity: 0; }
					100% { transform: translateY(0); filter: blur(0px); opacity: 1; }
				}
				.animate-slot-roll {
					animation: slot-machine 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94) infinite;
				}
			`}</style>

			{/* Header: title + actions */}
			<div className="flex items-center justify-between gap-2">
				<div className="min-w-0">
					<h1 className="font-[BradBunR] text-lg sm:text-2xl md:text-3xl text-on-surface tracking-wide truncate">
						Équipe aléatoire
					</h1>
					<p className="text-[11px] sm:text-sm text-on-surface-variant mt-0.5 truncate">
						{formation.name} · {formation.layout}
					</p>
				</div>
				<div className="flex items-center gap-1.5 shrink-0">
					{hasLocked && (
						<button
							onClick={() => setLocked(new Set())}
							className="inline-flex items-center justify-center size-11 rounded-full bg-surface-container-high state-layer relative overflow-hidden text-on-surface-variant transition-all hover:bg-surface-container-highest"
							aria-label="Débloquer tous les joueurs"
							title="Tout débloquer"
						>
							<Icon name="lock_open" size={18} />
						</button>
					)}
					<button
						onClick={handleCopyLink}
						className="inline-flex items-center justify-center size-11 rounded-full bg-surface-container-high state-layer relative overflow-hidden text-on-surface-variant transition-all hover:bg-surface-container-highest"
						aria-label="Copier le lien"
						title="Copier le lien"
					>
						{copied ? (
							<Icon name="check" size={18} className="text-green-500" />
						) : (
							<Icon name="content_copy" size={18} />
						)}
					</button>
					{/* Extended FAB — Régénérer */}
					<button
						onClick={regenerate}
						disabled={animating}
						aria-label="Régénérer l'équipe"
						className="inline-flex items-center gap-2 h-14 px-4 sm:px-5 rounded-2xl bg-primary-container text-on-primary-container font-bold text-sm shadow-md active:scale-[0.98] transition-all disabled:opacity-50 hover:bg-primary-container-highest"
					>
						<Icon name="casino" size={20} className={cn(animating && "animate-spin")} />
						<span className="hidden sm:inline">Régénérer</span>
					</button>
				</div>
			</div>

			{/* Formation picker */}
			<FormationPicker
				formations={FORMATIONS}
				selectedIdx={formationIdx}
				onSelect={(i) => {
					setFormationIdx(i);
					setLocked(new Set());
				}}
			/>

			{/* Filters panel — collapsible on mobile, persistant on desktop */}
			<div className="rounded-3xl bg-surface-container border border-outline/5">
				{/* Mobile header (toggle) */}
				<button
					type="button"
					onClick={() => setFiltersOpen(!filtersOpen)}
					aria-expanded={filtersOpen}
					className="sm:hidden flex w-full items-center justify-between gap-2 p-4 min-h-[44px]"
				>
					<span className="flex items-center gap-2 type-label-large font-bold text-on-surface">
						<Icon name="tune" size={18} />
						Filtres
						{hasActiveFilters && (
							<span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-on-primary text-[11px] font-black">
								{activeFilterCount}
							</span>
						)}
					</span>
					<Icon name={filtersOpen ? "expand_less" : "expand_more"} size={20} />
				</button>

				{/* Desktop header (static label) */}
				<div className="hidden sm:flex items-center justify-between gap-2 px-4 pt-4">
					<span className="flex items-center gap-2 type-label-large font-bold text-on-surface">
						<Icon name="tune" size={18} />
						Filtres
						{hasActiveFilters && (
							<span className="inline-flex items-center justify-center min-w-5 h-5 px-1.5 rounded-full bg-primary text-on-primary text-[11px] font-black">
								{activeFilterCount}
							</span>
						)}
					</span>
				</div>

				{/* Filter body */}
				<div className={cn("px-4 pb-4", "sm:block", filtersOpen ? "block" : "hidden")}>
					{filterSection}
				</div>
			</div>

			{/* Main Grid: Pitch + Info Column */}
			<div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
				{/* Beautiful Soccer Field Preview */}
				<div className="lg:col-span-2 relative w-full bg-linear-to-b from-emerald-950 via-emerald-900 to-emerald-950 rounded-3xl border border-emerald-800/80 overflow-hidden shadow-2xl p-3 sm:p-6 flex flex-col justify-between gap-4 sm:gap-6 min-h-[450px] sm:min-h-[580px]">
					{/* Pitch markings background */}
					<div className="absolute inset-0 pointer-events-none opacity-15 m-2 sm:m-4 border border-white rounded-lg">
						{/* Center line */}
						<div className="absolute inset-x-0 top-1/2 h-px bg-white -translate-y-1/2" />
						{/* Center circle */}
						<div className="absolute top-1/2 left-1/2 w-20 h-20 sm:w-28 sm:h-28 border border-white rounded-full -translate-x-1/2 -translate-y-1/2" />
						{/* Penalty box top */}
						<div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/2 h-[15%] border-b border-x border-white" />
						{/* Goal area top */}
						<div className="absolute top-0 left-1/2 -translate-x-1/2 w-1/4 h-[5%] border-b border-x border-white" />
						{/* Penalty box bottom */}
						<div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/2 h-[15%] border-t border-x border-white" />
						{/* Goal area bottom */}
						<div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-1/4 h-[5%] border-t border-x border-white" />
					</div>

					{/* Field contents: Players */}
					<div className="relative z-10 w-full h-full flex flex-col justify-between gap-4 sm:gap-6">
						{/* FW */}
						{team.fw.length > 0 && (
							<div
								className="mx-auto gap-1 sm:gap-2 grid w-full"
								style={{
									gridTemplateColumns: `repeat(${formation.fw}, minmax(0, 1fr))`,
									maxWidth: `${Math.min(100, formation.fw * 22)}%`,
								}}
							>
								{renderRow("fw", team.fw)}
							</div>
						)}

						{/* MF */}
						<div
							className="mx-auto gap-1 sm:gap-2 grid w-full"
							style={{
								gridTemplateColumns: `repeat(${formation.mf}, minmax(0, 1fr))`,
								maxWidth: `${Math.min(100, formation.mf * 20)}%`,
							}}
						>
							{renderRow("mf", team.mf)}
						</div>

						{/* DF */}
						<div
							className="mx-auto gap-1 sm:gap-2 grid w-full"
							style={{
								gridTemplateColumns: `repeat(${formation.df}, minmax(0, 1fr))`,
								maxWidth: `${Math.min(100, formation.df * 20)}%`,
							}}
						>
							{renderRow("df", team.df)}
						</div>

						{/* GK */}
						<div className="w-[20%] sm:w-1/6 mx-auto">{renderRow("gk", team.gk)}</div>
					</div>
				</div>

				{/* Info Column: Stats + Synergies */}
				<div className="space-y-4 sm:space-y-6">
					{/* Team Average Stats */}
					<div className="p-4 rounded-3xl bg-surface-container border border-outline/5 space-y-4">
						<h2 className="text-sm font-bold text-on-surface uppercase tracking-wider">
							Statistiques Moyennes (Lv 99)
						</h2>
						<div className="space-y-3">
							<StatBar label="Frappe (Kick)" value={averageStats.kick} />
							<StatBar label="Contrôle" value={averageStats.control} />
							<StatBar label="Technique" value={averageStats.technique} />
							<StatBar label="Physique" value={averageStats.physical} />
							<StatBar label="Pression (Defense)" value={averageStats.pressure} />
							<StatBar label="Agilité" value={averageStats.agility} />
							<StatBar label="Intelligence" value={averageStats.intelligence} />
						</div>

						{mvpPlayer && (
							<div className="pt-2 border-t border-outline/5">
								<p className="text-[11px] text-on-surface-variant">
									Meilleure Stat Single :{" "}
									<span className="font-bold text-primary">
										{getCharName(mvpPlayer)} ({maxSingleStat})
									</span>
								</p>
							</div>
						)}
					</div>

					{/* Synergies Panel */}
					<div className="p-4 rounded-3xl bg-surface-container border border-outline/5 space-y-4">
						<h2 className="text-sm font-bold text-on-surface uppercase tracking-wider">
							Synergies d'Éléments
						</h2>
						<div className="space-y-3">
							{synergies.list.length > 0 ? (
								<div className="flex flex-col gap-2">
									{synergies.list.map((syn) => (
										<div
											key={syn.element}
											className="flex items-center justify-between p-2 rounded-xl bg-surface-container-high border border-outline/5"
										>
											<div className="flex items-center gap-2">
												<CommonSpriteIcon name={ELEMENT_SPRITE[syn.element]} scale={0.25} />
												<span className="text-xs font-bold text-on-surface">
													{ELEMENTS.find((el) => el.value === syn.element)?.label || syn.element}
												</span>
											</div>
											<span className="text-xs font-bold text-primary">
												x{syn.count} (+{syn.boost}% boost)
											</span>
										</div>
									))}
								</div>
							) : (
								<p className="text-xs text-on-surface-variant/70 italic">
									Aucune synergie active (minimum 3 joueurs du même élément)
								</p>
							)}
						</div>
					</div>
				</div>
			</div>

			{/* Staff Section */}
			<div className="space-y-3">
				<h2 className="text-sm font-bold text-on-surface uppercase tracking-wider px-1">
					Staff Technique
				</h2>
				<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
					{team.coach && <StaffSlot person={team.coach} role="Coach" team={team} />}
					{team.managers.map((m) => (
						<StaffSlot key={m.id} person={m} role="Manager" team={team} />
					))}
				</div>
			</div>
		</div>
	);
}
