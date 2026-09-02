"use client";

import { useDroppable } from "@dnd-kit/core";
import { Icon } from "@/components/ui/Icon";
import { SafeImage } from "@/components/ui/SafeImage";
import { BENCH_SLOTS, ROLE_COLORS, ROLE_LABELS } from "@rosegriffon/azalee/game/formations";
import type { Formation, PositionCoord } from "@rosegriffon/azalee/game/formations";
import type { TeamMember } from "@rosegriffon/azalee/game/team-types";
import { cn } from "@/lib/utils";
import { getCharacterImageUrl } from "@rosegriffon/azalee/images";
import { PlayerSlot } from "./PlayerSlot";
import { getPositionMatchFactor } from "@rosegriffon/azalee/game/team-rules";
import type { ElementLink } from "@rosegriffon/azalee/game/team-rules";

const ELEMENT_COLORS: Record<string, string> = {
	// Les mêmes teintes que partout ailleurs, lues sur les tokens du design
	// system : ici en `var()` parce que ces valeurs partent dans des attributs
	// SVG et des styles en ligne, où une classe Tailwind ne s'applique pas.
	// L'ancienne table donnait un vent VERT et une forêt VIOLETTE — ni l'un ni
	// l'autre ne sont les couleurs du jeu.
	Fire: "var(--color-element-feu)",
	Forest: "var(--color-element-foret)",
	Mountain: "var(--color-element-montagne)",
	Wind: "var(--color-element-vent)",
};

/* ── Realistic Pitch SVG ──────────────────────────────────── */

function PitchSVG() {
	return (
		<svg
			className="absolute inset-0 w-full h-full"
			viewBox="0 0 750 1320"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<defs>
				<pattern id="mow" patternUnits="userSpaceOnUse" width="750" height="110">
					<rect width="750" height="55" fill="rgba(255,255,255,0.03)" />
					<rect y="55" width="750" height="55" fill="rgba(0,0,0,0.03)" />
				</pattern>
				<radialGradient id="vignette" cx="50%" cy="50%" r="70%">
					<stop offset="0%" stopColor="transparent" />
					<stop offset="100%" stopColor="rgba(0,0,0,0.3)" />
				</radialGradient>
			</defs>

			<rect width="750" height="1320" fill="url(#mow)" />
			<rect
				x="35"
				y="35"
				width="680"
				height="1250"
				rx="4"
				stroke="white"
				strokeWidth="2.5"
				strokeOpacity="0.35"
			/>
			<line x1="35" y1="660" x2="715" y2="660" stroke="white" strokeWidth="2" strokeOpacity="0.3" />
			<circle cx="375" cy="660" r="110" stroke="white" strokeWidth="2" strokeOpacity="0.3" />
			<circle cx="375" cy="660" r="5" fill="white" fillOpacity="0.4" />

			{/* Top penalty area */}
			<rect
				x="150"
				y="35"
				width="450"
				height="200"
				stroke="white"
				strokeWidth="2"
				strokeOpacity="0.3"
			/>
			<rect
				x="240"
				y="35"
				width="270"
				height="75"
				stroke="white"
				strokeWidth="2"
				strokeOpacity="0.25"
			/>
			<circle cx="375" cy="167" r="4" fill="white" fillOpacity="0.35" />
			<path
				d="M 280 235 A 110 110 0 0 0 470 235"
				stroke="white"
				strokeWidth="1.5"
				strokeOpacity="0.2"
				fill="none"
			/>
			<rect
				x="270"
				y="8"
				width="210"
				height="28"
				rx="3"
				stroke="white"
				strokeWidth="1.5"
				strokeOpacity="0.15"
				strokeDasharray="6 4"
			/>
			<path
				d="M 35 55 A 20 20 0 0 0 55 35"
				stroke="white"
				strokeWidth="1.5"
				strokeOpacity="0.2"
				fill="none"
			/>
			<path
				d="M 695 35 A 20 20 0 0 0 715 55"
				stroke="white"
				strokeWidth="1.5"
				strokeOpacity="0.2"
				fill="none"
			/>

			{/* Bottom penalty area */}
			<rect
				x="150"
				y="1085"
				width="450"
				height="200"
				stroke="white"
				strokeWidth="2"
				strokeOpacity="0.3"
			/>
			<rect
				x="240"
				y="1210"
				width="270"
				height="75"
				stroke="white"
				strokeWidth="2"
				strokeOpacity="0.25"
			/>
			<circle cx="375" cy="1153" r="4" fill="white" fillOpacity="0.35" />
			<path
				d="M 280 1085 A 110 110 0 0 1 470 1085"
				stroke="white"
				strokeWidth="1.5"
				strokeOpacity="0.2"
				fill="none"
			/>
			<rect
				x="270"
				y="1284"
				width="210"
				height="28"
				rx="3"
				stroke="white"
				strokeWidth="1.5"
				strokeOpacity="0.15"
				strokeDasharray="6 4"
			/>
			<path
				d="M 35 1265 A 20 20 0 0 1 55 1285"
				stroke="white"
				strokeWidth="1.5"
				strokeOpacity="0.2"
				fill="none"
			/>
			<path
				d="M 695 1285 A 20 20 0 0 1 715 1265"
				stroke="white"
				strokeWidth="1.5"
				strokeOpacity="0.2"
				fill="none"
			/>

			{/* Vignette */}
			<rect width="750" height="1320" fill="url(#vignette)" />
		</svg>
	);
}

/* ── Droppable Position Slot ──────────────────────────────── */

function DroppableSlot({
	slotId,
	coord,
	member,
	onRemove,
	onSlotTap,
	isTargeted,
	onMemberClick,
	isSelected,
	formation,
}: {
	slotId: string;
	coord: PositionCoord;
	member: TeamMember | undefined;
	onRemove: (slot: string) => void;
	onSlotTap?: (slotId: string) => void;
	isTargeted?: boolean;
	onMemberClick?: (slotId: string) => void;
	isSelected?: boolean;
	formation: Formation;
}) {
	const { isOver, setNodeRef } = useDroppable({
		data: { role: coord.role, slotId, type: "field-position" },
		id: slotId,
	});

	const roleColor = ROLE_COLORS[coord.role] || ROLE_COLORS.MF;
	const roleLabel = ROLE_LABELS[coord.role] || coord.role;

	const scaledTop = coord.top;
	const scaledLeft = coord.left;

	const { status } = getPositionMatchFactor(member?.position || "", slotId, formation);

	return (
		<div
			ref={setNodeRef}
			className={cn(
				"absolute w-[19%] aspect-[3/4] rounded-xl transition-all duration-200",
				"flex flex-col items-center justify-center",
				isOver && "z-30 scale-110",
				!isOver && member && "z-10"
			)}
			style={{ left: `${scaledLeft}%`, top: `${scaledTop}%` }}
		>
			{/* Drop glow */}
			{isOver && (
				<div
					className="absolute -inset-1 rounded-xl animate-pulse"
					style={{
						background: `radial-gradient(ellipse, ${roleColor}40 0%, transparent 70%)`,
						boxShadow: `0 0 20px ${roleColor}60`,
					}}
				/>
			)}

			{/* Empty slot pulse ring */}
			{!member && !isOver && (
				<div
					className="absolute inset-0 rounded-xl border-2 border-dashed animate-[pulse_3s_ease-in-out_infinite]"
					style={{ borderColor: `${roleColor}40` }}
				/>
			)}

			{member ? (
				<div
					className={cn(
						"absolute inset-0 rounded-xl overflow-hidden",
						isSelected && "ring-2 ring-primary ring-offset-1 ring-offset-transparent"
					)}
					onClick={(e) => {
						e.stopPropagation();
						onMemberClick?.(slotId);
					}}
				>
					<div className="absolute -bottom-1 left-[10%] right-[10%] h-2 rounded-full bg-black/30 blur-sm" />
					<PlayerSlot member={member} onRemove={() => onRemove(slotId)} />
					{isSelected && (
						<div className="absolute inset-0 bg-primary/10 pointer-events-none rounded-xl" />
					)}
					{/* Position Mismatch Badge */}
					{status !== "match" && status !== "none" && (
						<div
							className={cn(
								"absolute top-1 left-1 z-20 flex items-center justify-center size-4 sm:size-5 rounded-full border border-black/35 shadow-md",
								status === "adjacent" ? "bg-amber-500 text-black" : "bg-red-500 text-white"
							)}
							title={status === "adjacent" ? "Malus de position : -15% de stats" : "Malus de position : -35% de stats"}
						>
							<Icon name={status === "adjacent" ? "warning" : "error"} size={10} className="sm:size-3" />
						</div>
					)}
				</div>
			) : (
				<div
					onClick={() => onSlotTap?.(slotId)}
					role="button"
					tabIndex={0}
					aria-label={`Emplacement ${roleLabel} vide — cliquez pour placer un joueur`}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onSlotTap?.(slotId);
						}
					}}
					className={cn(
						"flex flex-col items-center gap-0.5 rounded-xl w-full h-full justify-center cursor-pointer",
						isOver ? "bg-white/15" : "bg-black/20 hover:bg-black/30 active:bg-white/10",
						isTargeted && "ring-2 ring-primary bg-primary/20 animate-pulse"
					)}
				>
					<span
						className="text-[8px] sm:text-[10px] font-black px-1.5 py-0.5 rounded-md"
						style={{ backgroundColor: roleColor, color: "white" }}
					>
						{roleLabel}
					</span>
					<Icon name="add" size={14} className="text-white/40" />
				</div>
			)}
		</div>
	);
}

/* ── Staff Slot (Coach / Coordinateur) — fond du terrain ──── */

function StaffSlot({
	slotId,
	label,
	icon,
	member,
	onRemove,
	color,
	onSlotTap,
	isTargeted,
	onMemberClick,
	isSelected,
}: {
	slotId: string;
	label: string;
	icon: string;
	member: TeamMember | undefined;
	onRemove: (slot: string) => void;
	color: string;
	onSlotTap?: (slotId: string) => void;
	isTargeted?: boolean;
	onMemberClick?: (slotId: string) => void;
	isSelected?: boolean;
}) {
	const { isOver, setNodeRef } = useDroppable({
		data: { slotId, type: "bench-position" },
		id: slotId,
	});

	return (
		<div
			ref={setNodeRef}
			className={cn(
				"relative flex flex-col items-center rounded-xl transition-all duration-150 overflow-hidden",
				isOver && "ring-2 ring-primary scale-105",
				isSelected && "ring-2 ring-primary"
			)}
		>
			{member ? (
				<div
					className="w-full aspect-square rounded-xl overflow-hidden cursor-pointer"
					onClick={(e) => {
						e.stopPropagation();
						onMemberClick?.(slotId);
					}}
				>
					<div className="relative w-full h-full">
						<SafeImage
							src={member.imageUrl}
							zukanHash={member.zukanHash}
							fallbackSrc={member.internalCode ? getCharacterImageUrl(member.internalCode) : undefined}
							alt={member.name}
							fill
							sizes="60px"
							className="object-cover"
							unoptimized
						/>
						<div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent" />
						<span className="absolute bottom-0 inset-x-0 px-0.5 pb-0.5 text-white font-bold text-xs sm:text-[8px] truncate text-center drop-shadow-lg">
							{member.name}
						</span>
						<button
							onClick={(e) => {
								e.stopPropagation();
								onRemove(slotId);
							}}
							onPointerDown={(e) => e.stopPropagation()}
							className="no-export absolute top-0 right-0 p-0.5 bg-red-600/90 rounded-bl-lg z-10 opacity-70 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
							aria-label={`Retirer ${member.name}`}
						>
							<Icon name="close" size={10} className="text-white" />
						</button>
					</div>
				</div>
			) : (
				<div
					onClick={() => onSlotTap?.(slotId)}
					role="button"
					tabIndex={0}
					aria-label={`Emplacement ${label} vide — cliquez pour placer`}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onSlotTap?.(slotId);
						}
					}}
					className={cn(
						"w-full aspect-square rounded-xl flex flex-col items-center justify-center gap-0.5 cursor-pointer",
						"bg-black/30 hover:bg-black/40 active:bg-white/10 border border-dashed",
						isTargeted && "ring-2 ring-primary bg-primary/20 animate-pulse"
					)}
					style={{ borderColor: `${color}50` }}
				>
					<span style={{ color }} className="opacity-60">
						<Icon name={icon} size={14} />
					</span>
					<span className="text-xs sm:text-[8px] font-bold opacity-50" style={{ color }}>
						{label}
					</span>
				</div>
			)}
		</div>
	);
}

/* ── Bench Droppable Slot (Remplaçants — compact) ──────────── */

function BenchSlot({
	slotId,
	label,
	member,
	onRemove,
	color,
	onSlotTap,
	isTargeted,
	onMemberClick,
	isSelected,
}: {
	slotId: string;
	label: string;
	member: TeamMember | undefined;
	onRemove: (slot: string) => void;
	color: string;
	onSlotTap?: (slotId: string) => void;
	isTargeted?: boolean;
	onMemberClick?: (slotId: string) => void;
	isSelected?: boolean;
}) {
	const { isOver, setNodeRef } = useDroppable({
		data: { slotId, type: "bench-position" },
		id: slotId,
	});

	return (
		<div
			ref={setNodeRef}
			className={cn(
				"aspect-square rounded-xl transition-all duration-150 flex flex-col items-center justify-center overflow-hidden",
				isOver && "ring-2 ring-primary scale-105 bg-primary/20",
				!isOver && member && "elevation-1",
				!isOver &&
					!member &&
					"border border-dashed border-outline-variant/30 bg-surface-container-high/50"
			)}
		>
			{member ? (
				<div
					className={cn("w-full h-full", isSelected && "ring-2 ring-primary rounded-xl")}
					onClick={(e) => {
						e.stopPropagation();
						onMemberClick?.(slotId);
					}}
				>
					<PlayerSlot member={member} onRemove={() => onRemove(slotId)} compact />
				</div>
			) : (
				<div
					onClick={() => onSlotTap?.(slotId)}
					role="button"
					tabIndex={0}
					aria-label={`Emplacement ${label} vide — cliquez pour placer un joueur`}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							onSlotTap?.(slotId);
						}
					}}
					className={cn(
						"flex flex-col items-center gap-0.5 cursor-pointer w-full h-full justify-center",
						isTargeted && "ring-2 ring-primary bg-primary/20 animate-pulse rounded-xl"
					)}
				>
					<span className="opacity-30" style={{ color }}>
						<Icon name="add" size={12} />
					</span>
					<span className="text-xs sm:text-[8px] font-bold opacity-30" style={{ color }}>
						{label}
					</span>
				</div>
			)}
		</div>
	);
}

/* ── Main ─────────────────────────────────────────────────── */

interface FormationFieldProps {
	formation: Formation;
	members: Record<string, TeamMember>;
	onRemoveMember: (slot: string) => void;
	fieldRef: React.RefObject<HTMLDivElement | null>;
	teamName?: string;
	onSlotTap?: (slotId: string) => void;
	selectedCharaId?: string | null;
	onMemberClick?: (slotId: string) => void;
	selectedMemberSlot?: string | null;
	links?: ElementLink[];
	activeSlotId?: string | null;
}

export function FormationField({
	formation,
	members,
	onRemoveMember,
	fieldRef,
	teamName,
	onSlotTap,
	selectedCharaId,
	onMemberClick,
	selectedMemberSlot,
	links = [],
	activeSlotId,
}: FormationFieldProps) {
	const reserveCount = Object.keys(members).filter((k) => k.startsWith("reserve-")).length;

	// Staff data for bottom-of-pitch slots
	const staffSlots = [
		{ color: "rgb(217,119,6)", icon: "sports", label: "COACH", slotId: "manager-0" },
		{ color: "rgb(59,130,246)", icon: "support_agent", label: "COORD", slotId: "support-0" },
		{ color: "rgb(59,130,246)", icon: "support_agent", label: "COORD", slotId: "support-1" },
		{ color: "rgb(59,130,246)", icon: "support_agent", label: "COORD", slotId: "support-2" },
	];

	return (
		<div ref={fieldRef} className="relative w-full select-none">
			{/* Pitch — full field with players + staff */}
			<div
				className="relative w-full sm:rounded-2xl overflow-hidden"
				style={{ aspectRatio: "75/132" }}
			>
				<div className="absolute inset-0 bg-linear-to-b from-emerald-900 via-emerald-700 to-emerald-900" />
				<PitchSVG />

				{/* Glowing element synergy links layer */}
				{links.length > 0 && (
					<svg className="absolute inset-0 w-full h-full pointer-events-none z-5">
						<defs>
							{Object.entries(ELEMENT_COLORS).map(([el, color]) => (
								<linearGradient id={`glow-${el}`} key={el} x1="0%" y1="0%" x2="100%" y2="100%">
									<stop offset="0%" stopColor={color} stopOpacity="0.8" />
									<stop offset="50%" stopColor="#ffffff" stopOpacity="0.9" />
									<stop offset="100%" stopColor={color} stopOpacity="0.8" />
								</linearGradient>
							))}
						</defs>
						{links.map((link, idx) => (
							<g key={idx}>
								{/* Blur glow line */}
								<line
									x1={`${link.coordA.left + 9.5}%`}
									y1={`${link.coordA.top + 7.2}%`}
									x2={`${link.coordB.left + 9.5}%`}
									y2={`${link.coordB.top + 7.2}%`}
									stroke={ELEMENT_COLORS[link.element]}
									strokeWidth="6"
									opacity="0.3"
									strokeLinecap="round"
									className="blur-xs"
								/>
								{/* Direct connection line */}
								<line
									x1={`${link.coordA.left + 9.5}%`}
									y1={`${link.coordA.top + 7.2}%`}
									x2={`${link.coordB.left + 9.5}%`}
									y2={`${link.coordB.top + 7.2}%`}
									stroke={`url(#glow-${link.element})`}
									strokeWidth="3"
									strokeDasharray="8 6"
									strokeLinecap="round"
									opacity="0.95"
									style={{
										animation: "dash 25s linear infinite"
									}}
								/>
							</g>
						))}
					</svg>
				)}

				{/* Field players (11 positions) */}
				{formation.positions.map((coord) => {
					const slotId = `field-${coord.index}`;
					const isSlotSelected = selectedMemberSlot === slotId || activeSlotId === slotId;
					return (
						<DroppableSlot
							key={slotId}
							slotId={slotId}
							coord={coord}
							member={members[slotId]}
							onRemove={onRemoveMember}
							onSlotTap={onSlotTap}
							isTargeted={(Boolean(selectedCharaId) && !members[slotId]) || activeSlotId === slotId}
							onMemberClick={onMemberClick}
							isSelected={isSlotSelected}
							formation={formation}
						/>
					);
				})}

				{/* Staff row — bottom of pitch (opponent half, sideline zone) */}
				<div className="absolute bottom-[16%] inset-x-[4%] flex items-center justify-center gap-[3%]">
					{staffSlots.map((staff) => {
						const isSlotSelected = selectedMemberSlot === staff.slotId || activeSlotId === staff.slotId;
						return (
							<div key={staff.slotId} className="w-[15%]">
								<StaffSlot
									slotId={staff.slotId}
									label={staff.label}
									icon={staff.icon}
									member={members[staff.slotId]}
									onRemove={onRemoveMember}
									color={staff.color}
									onSlotTap={onSlotTap}
									isTargeted={(Boolean(selectedCharaId) && !members[staff.slotId]) || activeSlotId === staff.slotId}
									onMemberClick={onMemberClick}
									isSelected={isSlotSelected}
								/>
							</div>
						);
					})}
				</div>

				{/* Staff label */}
				<div className="absolute bottom-[12%] inset-x-0 flex justify-center">
					<span className="text-[8px] sm:text-[10px] font-bold text-white/30 uppercase tracking-widest">
						Staff technique
					</span>
				</div>

				{/* Export banner */}
				<div className="absolute bottom-[1%] inset-x-[5%] flex items-center justify-between px-3 py-1.5 rounded-lg bg-black/50 backdrop-blur-sm">
					<span className="text-white font-bold text-[9px] sm:text-xs truncate">
						{teamName || "Mon Équipe"}
					</span>
					<span className="text-white/60 text-[8px] sm:text-[10px] font-medium shrink-0 ml-2">
						{formation.name}
					</span>
				</div>
			</div>

			{/* Bench — compact reserves only */}
			<div className="mt-2 sm:mt-3 px-4 sm:px-0">
				<div className="rounded-xl bg-surface-container p-2.5 sm:p-3 elevation-1">
					<div className="flex items-center justify-between mb-2">
						<div className="flex items-center gap-1.5">
							<Icon name="swap_horiz" size={14} className="text-emerald-500" />
							<span className="text-[10px] sm:text-xs font-bold text-on-surface">Remplaçants</span>
						</div>
						<span className="text-[9px] font-bold text-on-surface-variant">
							{reserveCount}/{BENCH_SLOTS.reserves}
						</span>
					</div>
					<div className="grid grid-cols-4 sm:grid-cols-5 gap-1.5">
						{Array.from({ length: BENCH_SLOTS.reserves }, (_, i) => {
							const slotId = `reserve-${i}`;
							const isSlotSelected = selectedMemberSlot === slotId || activeSlotId === slotId;
							return (
								<BenchSlot
									key={slotId}
									slotId={slotId}
									label="RES"
									member={members[slotId]}
									onRemove={onRemoveMember}
									color="rgb(16,185,129)"
									onSlotTap={onSlotTap}
									isTargeted={(Boolean(selectedCharaId) && !members[slotId]) || activeSlotId === slotId}
									onMemberClick={onMemberClick}
									isSelected={isSlotSelected}
								/>
							);
						})}
					</div>
				</div>
			</div>
		</div>
	);
}
