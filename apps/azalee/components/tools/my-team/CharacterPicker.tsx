"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { useCallback, useMemo, useRef, useState } from "react";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { Icon } from "@/components/ui/Icon";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { SafeImage } from "@/components/ui/SafeImage";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { cn } from "@/lib/utils";
import { getCharacterImageUrl } from "@rosegriffon/azalee/images";

/* ── Types ────────────────────────────────────────────────── */

export interface PickerCharacterStats {
	kick: number;
	control: number;
	technique: number;
	pressure: number;
	physical: number;
	agility: number;
	intelligence: number;
}

export interface PickerCharacter {
	charaId: string;
	name: string;
	position: string;
	element: string;
	rarity: string;
	imageUrl: string;
	slug: string;
	series?: string;
	stats?: PickerCharacterStats;
	internalCode?: string;
	zukanHash?: string;
}

/* ── Constants ────────────────────────────────────────────── */

const ELEMENT_SPRITE: Record<string, SpriteCommonKey> = {
	Fire: "fire",
	Forest: "forest",
	Mountain: "mountain",
	Wind: "wind",
};

const PICKER_ROLE_COLORS: Record<string, string> = {
	DF: "rgb(59, 130, 246)",
	FW: "rgb(220, 38, 38)",
	GK: "rgb(217, 119, 6)",
	MF: "rgb(16, 185, 129)",
	COACH: "rgb(217, 119, 6)",
	COORD: "rgb(59, 130, 246)",
};

const PICKER_ROLE_LABELS: Record<string, string> = {
	DF: "DEF",
	FW: "ATT",
	GK: "GAR",
	MF: "MIL",
	COACH: "ENTR",
	COORD: "COORD",
};

const POSITIONS = [
	{ label: "ATT", value: "FW" },
	{ label: "MIL", value: "MF" },
	{ label: "DEF", value: "DF" },
	{ label: "GAR", value: "GK" },
	{ label: "ENTR", value: "COACH" },
	{ label: "COORD", value: "COORD" },
];

const ELEMENTS = [
	{ label: "Feu", value: "Fire" },
	{ label: "Vent", value: "Wind" },
	{ label: "Forêt", value: "Forest" },
	{ label: "Montagne", value: "Mountain" },
];

const RARITIES = [
	{ color: "#ec4899", label: "BASARA", value: "BASARA" },
	{ color: "#f59e0b", label: "Héros", value: "Héros" },
	{ color: "#8b5cf6", label: "Émérite", value: "Émérite" },
	{ color: "#3b82f6", label: "Expé.", value: "Expérimenté" },
	{ color: "#6b7280", label: "Normal", value: "Normal" },
];

const PAGE_SIZE = 60;

/* ── Draggable Character Card ─────────────────────────────── */

function DraggableCharaCard({
	char,
	isPlaced,
	isSelected,
	onTap,
}: {
	char: PickerCharacter;
	isPlaced: boolean;
	isSelected?: boolean;
	onTap?: (char: PickerCharacter) => void;
}) {
	const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
		data: {
			character: char,
			origin: "roster",
			type: "player",
		},
		disabled: isPlaced,
		id: `roster-${char.charaId}`,
	});

	const style = {
		opacity: isDragging ? 0.3 : isPlaced ? 0.4 : 1,
		transform: CSS.Translate.toString(transform),
	};

	const elSprite = char.element !== "Void" ? ELEMENT_SPRITE[char.element] : null;
	const roleColor = PICKER_ROLE_COLORS[char.position] || PICKER_ROLE_COLORS.MF;
	const roleLabel = PICKER_ROLE_LABELS[char.position] || char.position;

	return (
		<div
			ref={setNodeRef}
			style={style}
			{...listeners}
			{...attributes}
			role="listitem"
			aria-label={`${char.name} — ${PICKER_ROLE_LABELS[char.position] || char.position}, ${char.element}, ${char.rarity}${isPlaced ? " (déjà placé)" : ""}`}
			onClick={(e) => {
				if (!isPlaced && onTap) {
					e.preventDefault();
					e.stopPropagation();
					onTap(char);
				}
			}}
			className={cn(
				"relative w-full rounded-xl overflow-hidden bg-surface-container-highest transition-all",
				isPlaced
					? "cursor-not-allowed grayscale"
					: "cursor-pointer sm:cursor-grab sm:active:cursor-grabbing hover:ring-1 hover:ring-primary/50",
				isDragging && "z-50 ring-2 ring-primary",
				isSelected && "ring-2 ring-primary scale-95"
			)}
		>
			<div className="relative w-full aspect-square overflow-hidden">
				<SafeImage
					src={char.imageUrl}
					zukanHash={char.zukanHash}
					fallbackSrc={char.internalCode ? getCharacterImageUrl(char.internalCode) : undefined}
					alt={char.name}
					fill
					sizes="(max-width: 640px) 20vw, 80px"
					className="object-cover"
					unoptimized
				/>
				<div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent" />

				{/* Rarity */}
				<div className="absolute top-0.5 left-0.5">
					<RarityBadge rarity={char.rarity} size="xs" />
				</div>

				{/* Element + Position */}
				<div className="absolute bottom-5 left-0.5 flex items-center gap-0.5">
					{elSprite && <CommonSpriteIcon name={elSprite} scale={0.18} />}
					<span
						className="px-0.5 py-px rounded text-[6px] sm:text-[7px] font-black text-white leading-none"
						style={{ backgroundColor: roleColor }}
					>
						{roleLabel}
					</span>
				</div>

				{/* Name */}
				<p className="absolute bottom-0 inset-x-0 px-0.5 pb-0.5 text-white font-bold text-xs sm:text-[8px] truncate drop-shadow-lg text-center">
					{char.name}
				</p>

				{/* Placed indicator */}
				{isPlaced && (
					<div className="absolute inset-0 flex items-center justify-center bg-black/40">
						<Icon name="check_circle" size={20} className="text-primary" />
					</div>
				)}
				{/* Selected indicator (tap-to-place) */}
				{isSelected && !isPlaced && (
					<div className="absolute inset-0 flex items-center justify-center bg-primary/25 border-2 border-primary rounded-xl">
						<Icon name="touch_app" size={20} className="text-primary" />
					</div>
				)}
			</div>
		</div>
	);
}

/* ── Character Picker Panel ───────────────────────────────── */

interface CharacterPickerProps {
	characters: PickerCharacter[];
	placedIds: Set<string>;
	selectedCharaId?: string | null;
	onCharaTap?: (char: PickerCharacter) => void;
	activeSlotId?: string | null;
}

export function CharacterPicker({
	characters,
	placedIds,
	selectedCharaId,
	onCharaTap,
	activeSlotId,
}: CharacterPickerProps) {
	const [search, setSearch] = useState("");
	const [filterPosition, setFilterPosition] = useState<string | null>(null);
	const [filterElement, setFilterElement] = useState<string | null>(null);
	const [filterRarity, setFilterRarity] = useState<string | null>(null);
	const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
	const scrollRef = useRef<HTMLDivElement>(null);

	// Auto-filter when activeSlotId changes
	const [prevSlotId, setPrevSlotId] = useState<string | null>(null);
	if (activeSlotId !== prevSlotId) {
		setPrevSlotId(activeSlotId || null);
		if (activeSlotId) {
			if (activeSlotId.startsWith("manager-")) {
				setFilterPosition("COACH");
			} else if (activeSlotId.startsWith("support-")) {
				setFilterPosition("COORD");
			} else {
				// Clear filter if it was COACH or COORD
				setFilterPosition((prev) => (prev === "COACH" || prev === "COORD" ? null : prev));
			}
			setVisibleCount(PAGE_SIZE);
		}
	}

	const filtered = useMemo(() => {
		let list = characters;

		if (activeSlotId) {
			if (activeSlotId.startsWith("manager-")) {
				list = list.filter((c) => c.position === "COACH");
			} else if (activeSlotId.startsWith("support-")) {
				list = list.filter((c) => c.position === "COORD");
			} else {
				list = list.filter((c) => c.position !== "COACH" && c.position !== "COORD");
			}
		} else {
			// By default, hide coach and coordinator from general player list unless explicitly filtered
			if (filterPosition !== "COACH" && filterPosition !== "COORD") {
				list = list.filter((c) => c.position !== "COACH" && c.position !== "COORD");
			}
		}

		if (search) {
			const q = search.toLowerCase();
			list = list.filter((c) => c.name.toLowerCase().includes(q));
		}
		if (filterPosition) {
			list = list.filter((c) => c.position === filterPosition);
		}
		if (filterElement) {
			list = list.filter((c) => c.element === filterElement);
		}
		if (filterRarity) {
			list = list.filter((c) => c.rarity === filterRarity);
		}
		return list;
	}, [characters, search, filterPosition, filterElement, filterRarity, activeSlotId]);

	const visible = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);

	const handleScroll = useCallback(() => {
		const el = scrollRef.current;
		if (!el) {
			return;
		}
		if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
			setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, filtered.length));
		}
	}, [filtered.length]);

	const hasActiveFilters =
		Boolean(filterPosition) || Boolean(filterElement) || Boolean(filterRarity) || Boolean(search);

	return (
		<div className="flex flex-col h-full min-h-0">
			{/* Header — roster title */}
			<div className="flex items-center gap-2 px-3 pt-3 pb-1.5">
				<Icon name="groups" size={18} className="text-primary" />
				<h2 className="text-sm font-bold text-on-surface">Effectif</h2>
			</div>

			{/* Search */}
			<div className="px-3 pb-2">
				<div className="relative">
					<Icon
						name="search"
						size={18}
						className="absolute left-3.5 top-1/2 -translate-y-1/2 text-on-surface-variant pointer-events-none"
					/>
					<input
						type="search"
						value={search}
						onChange={(e) => {
							setSearch(e.target.value);
							setVisibleCount(PAGE_SIZE);
						}}
						placeholder="Rechercher un joueur..."
						aria-label="Rechercher par nom"
						className="w-full h-11 pl-11 pr-3 rounded-full bg-surface-container-high border border-transparent text-sm text-on-surface placeholder:text-on-surface-variant/50 focus:outline-hidden focus:border-primary/40 focus:ring-2 focus:ring-primary/30 transition-colors"
					/>
				</div>
			</div>

			{/* Filters */}
			<div className="px-3 pb-2 space-y-1.5">
				{/* Position */}
				<div className="flex flex-wrap gap-1.5" role="group" aria-label="Filtrer par position">
					{POSITIONS.map(({ value, label }) => (
						<button
							key={value}
							onClick={() => {
								setFilterPosition((prev) => (prev === value ? null : value));
								setVisibleCount(PAGE_SIZE);
							}}
							aria-pressed={filterPosition === value}
							aria-label={`Filtrer par position ${label}`}
							className={cn(
								"flex-1 min-w-[50px] h-9 min-h-11 sm:min-h-0 rounded-full text-[11px] font-bold transition-all active:scale-95",
								filterPosition === value
									? "text-white elevation-1"
									: "border border-outline-variant/40 text-on-surface-variant hover:bg-on-surface/[0.06]"
							)}
							style={
								filterPosition === value
									? { backgroundColor: PICKER_ROLE_COLORS[value] }
									: undefined
							}
						>
							{label}
						</button>
					))}
				</div>

				{/* Element + clear */}
				<div className="flex gap-1.5" role="group" aria-label="Filtrer par élément">
					{ELEMENTS.map(({ value, label }) => (
						<button
							key={value}
							onClick={() => {
								setFilterElement((prev) => (prev === value ? null : value));
								setVisibleCount(PAGE_SIZE);
							}}
							aria-pressed={filterElement === value}
							aria-label={`Filtrer par élément ${label}`}
							className={cn(
								"flex-1 inline-flex items-center justify-center gap-1 h-9 min-h-11 sm:min-h-0 rounded-full text-xs font-bold transition-all active:scale-95",
								filterElement === value
									? "bg-secondary-container text-on-secondary-container elevation-1 ring-1 ring-inset ring-on-secondary-container/10"
									: "border border-outline-variant/40 text-on-surface-variant hover:bg-on-surface/[0.06]"
							)}
						>
							<CommonSpriteIcon name={ELEMENT_SPRITE[value]} scale={0.15} />
							<span className="hidden xs:inline">{label}</span>
						</button>
					))}
					{hasActiveFilters && (
						<button
							onClick={() => {
								setSearch("");
								setFilterPosition(null);
								setFilterElement(null);
								setFilterRarity(null);
								setVisibleCount(PAGE_SIZE);
							}}
							className="inline-flex items-center justify-center size-11 sm:size-9 shrink-0 rounded-full text-primary hover:bg-primary/10 active:scale-90 transition-all"
							aria-label="Réinitialiser les filtres"
							title="Réinitialiser les filtres"
						>
							<Icon name="filter_alt_off" size={18} />
						</button>
					)}
				</div>

				{/* Rarity */}
				<div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
					{RARITIES.map(({ value, label, color }) => (
						<button
							key={value}
							onClick={() => {
								setFilterRarity((prev) => (prev === value ? null : value));
								setVisibleCount(PAGE_SIZE);
							}}
							className={cn(
								"h-8 min-h-11 sm:min-h-0 px-2.5 rounded-full text-[10px] font-bold transition-all shrink-0 active:scale-95",
								filterRarity === value
									? "text-white elevation-1"
									: "border border-outline-variant/40 text-on-surface-variant hover:bg-on-surface/[0.06]"
							)}
							style={filterRarity === value ? { backgroundColor: color } : undefined}
						>
							{label}
						</button>
					))}
				</div>
			</div>

			{/* Count */}
			<div className="px-3 pb-2 flex items-center justify-between text-[10px] font-bold">
				<span className="inline-flex items-center gap-1 text-on-surface-variant">
					<Icon name="group" size={13} />
					{filtered.length} disponible{filtered.length > 1 ? "s" : ""}
				</span>
				{placedIds.size > 0 && (
					<span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-container text-on-primary-container">
						<Icon name="check_circle" size={12} />
						{placedIds.size} placé{placedIds.size > 1 ? "s" : ""}
					</span>
				)}
			</div>

			{/* Character Grid */}
			<div
				ref={scrollRef}
				onScroll={handleScroll}
				className="flex-1 min-h-0 overflow-y-auto px-3 pb-3"
			>
				<div
					className="grid grid-cols-3 sm:grid-cols-3 lg:grid-cols-4 gap-2"
					role="list"
					aria-label="Liste des joueurs disponibles"
				>
					{visible.map((char) => (
						<DraggableCharaCard
							key={char.charaId}
							char={char}
							isPlaced={placedIds.has(char.charaId)}
							isSelected={selectedCharaId === char.charaId}
							onTap={onCharaTap}
						/>
					))}
				</div>
				{visibleCount < filtered.length && (
					<button
						onClick={() => setVisibleCount((prev) => prev + PAGE_SIZE)}
						className="w-full mt-3 inline-flex items-center justify-center gap-1.5 min-h-11 text-sm text-on-secondary-container font-bold rounded-full bg-secondary-container hover:elevation-1 active:scale-[0.98] transition-all"
					>
						<Icon name="expand_more" size={18} />
						Charger plus ({filtered.length - visibleCount})
					</button>
				)}
				{filtered.length === 0 && (
					<div className="flex flex-col items-center py-12 text-on-surface-variant">
						<Icon name="search_off" size={40} className="mb-3 opacity-30" />
						<p className="text-sm font-medium">Aucun résultat</p>
						<p className="text-xs opacity-60 mt-1">Essayez un autre filtre</p>
					</div>
				)}
			</div>
		</div>
	);
}

/* ── Export overlay version for DragOverlay ────────────────── */

export function CharacterPickerOverlay({ char }: { char: PickerCharacter }) {
	const roleColor = PICKER_ROLE_COLORS[char.position] || PICKER_ROLE_COLORS.MF;
	const roleLabel = PICKER_ROLE_LABELS[char.position] || char.position;

	return (
		<div className="size-16 sm:w-20 sm:h-20 rounded-lg overflow-hidden bg-neutral-900 shadow-2xl ring-2 ring-primary pointer-events-none">
			<div className="relative w-full h-full">
				<SafeImage
					src={char.imageUrl}
					zukanHash={char.zukanHash}
					fallbackSrc={char.internalCode ? getCharacterImageUrl(char.internalCode) : undefined}
					alt={char.name}
					fill
					sizes="80px"
					className="object-cover"
					unoptimized
				/>
				<div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent" />
				<span
					className="absolute top-0.5 left-0.5 text-[7px] font-black px-1 py-px rounded text-white"
					style={{ backgroundColor: roleColor }}
				>
					{roleLabel}
				</span>
				<p className="absolute bottom-0 inset-x-0 px-0.5 pb-0.5 text-white font-bold text-[7px] truncate text-center">
					{char.name}
				</p>
			</div>
		</div>
	);
}
