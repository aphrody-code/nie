"use client";

import { useMemo } from "react";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { Icon } from "@/components/ui/Icon";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { ROLE_COLORS, ROLE_LABELS } from "@rosegriffon/azalee/game/formations";
import type { Formation } from "@rosegriffon/azalee/game/formations";
import type { TeamMember } from "@rosegriffon/azalee/game/team-types";
import { cn } from "@/lib/utils";
import { recalculateMemberStats, calculateElementSynergies } from "@rosegriffon/azalee/game/team-rules";

const ELEMENT_SPRITE: Record<string, SpriteCommonKey> = {
	Fire: "fire",
	Forest: "forest",
	Mountain: "mountain",
	Wind: "wind",
};
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
const ELEMENT_LABELS: Record<string, string> = {
	Fire: "Feu",
	Forest: "Forêt",
	Mountain: "Montagne",
	Wind: "Vent",
};

const RARITY_ORDER = ["BASARA", "Héros", "Émérite", "Expérimenté", "Normal"];
const RARITY_COLORS: Record<string, string> = {
	BASARA: "#ec4899",
	Expérimenté: "#3b82f6",
	Héros: "#f59e0b",
	Normal: "#6b7280",
	Émérite: "#8b5cf6",
};

interface TeamStatsProps {
	members: Record<string, TeamMember>;
	formation: Formation;
	level?: number;
}

export function TeamStats({ members, formation, level = 99 }: TeamStatsProps) {
	const memberList = useMemo(() => Object.values(members), [members]);
	const fieldMembers = useMemo(() => memberList.filter(m => m.slot.startsWith("field-")), [memberList]);
	const totalSlots = 20;
	const filledSlots = memberList.length;
	const percent = Math.round((filledSlots / totalSlots) * 100);

	// Get synergies
	const { dominantElement, hasHarmony, links } = useMemo(() => {
		return calculateElementSynergies(members, formation);
	}, [members, formation]);

	// Recalculate stats for all field members
	const statsAvg = useMemo(() => {
		if (fieldMembers.length === 0) return null;
		const totals = { kick: 0, control: 0, technique: 0, pressure: 0, physical: 0, agility: 0, intelligence: 0, combatPower: 0 };
		for (const m of fieldMembers) {
			const res = recalculateMemberStats(m, level, m.slot, formation, dominantElement, hasHarmony);
			totals.kick += res.kick;
			totals.control += res.control;
			totals.technique += res.technique;
			totals.pressure += res.pressure;
			totals.physical += res.physical;
			totals.agility += res.agility;
			totals.intelligence += res.intelligence;
			totals.combatPower += res.combatPower;
		}
		const count = fieldMembers.length;
		return {
			kick: Math.round(totals.kick / count),
			control: Math.round(totals.control / count),
			technique: Math.round(totals.technique / count),
			pressure: Math.round(totals.pressure / count),
			physical: Math.round(totals.physical / count),
			agility: Math.round(totals.agility / count),
			intelligence: Math.round(totals.intelligence / count),
			combatPower: Math.round(totals.combatPower),
		};
	}, [fieldMembers, level, formation, dominantElement, hasHarmony]);

	const elements = useMemo(() => {
		const c: Record<string, number> = { Fire: 0, Forest: 0, Mountain: 0, Wind: 0 };
		for (const m of memberList) {
			if (c[m.element] !== undefined) c[m.element]++;
		}
		return c;
	}, [memberList]);
	const maxElement = Math.max(...Object.values(elements), 1);

	const positionCoverage = useMemo(() => {
		const expected: Record<string, number> = { DF: 0, FW: 0, GK: 0, MF: 0 };
		for (const p of formation.positions) {
			expected[p.role]++;
		}
		const filled: Record<string, number> = { DF: 0, FW: 0, GK: 0, MF: 0 };
		for (const m of memberList) {
			if (m.slot.startsWith("field-") && filled[m.position] !== undefined) {
				filled[m.position]++;
			}
		}
		return Object.entries(expected).map(([role, total]) => ({
			filled: filled[role] || 0,
			role,
			total,
		}));
	}, [memberList, formation.positions]);

	const rarities = useMemo(() => {
		const c: Record<string, number> = {};
		for (const m of memberList) {
			c[m.rarity] = (c[m.rarity] || 0) + 1;
		}
		return RARITY_ORDER.filter((r) => c[r]).map((r) => ({ count: c[r], rarity: r }));
	}, [memberList]);

	const balance = useMemo(() => {
		const fw = memberList.filter((m) => m.position === "FW").length;
		const df = memberList.filter((m) => m.position === "DF").length;
		if (fw > df + 1) {
			return { label: "Offensif", icon: "trending_up", color: "text-red-500" };
		}
		if (df > fw + 1) {
			return { label: "Défensif", icon: "shield", color: "text-blue-500" };
		}
		return { color: "text-emerald-500", icon: "balance", label: "Équilibré" };
	}, [memberList]);

	const circumference = 2 * Math.PI * 36;
	const strokeDashoffset = circumference - (percent / 100) * circumference;

	if (filledSlots === 0) {
		return (
			<div className="rounded-2xl bg-surface-container p-6 sm:p-8 elevation-1 text-center">
				<Icon name="analytics" size={40} className="text-on-surface-variant/20 mx-auto mb-3" />
				<p className="text-sm font-medium text-on-surface-variant">
					Placez des joueurs pour voir les statistiques
				</p>
			</div>
		);
	}

	return (
		<div className="rounded-2xl bg-surface-container p-4 sm:p-5 elevation-1 space-y-5">
			{/* Top row: ring + balance + rarities */}
			<div className="flex items-center gap-4">
				{/* Completion ring */}
				<div className="relative size-20 shrink-0">
					<svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
						<circle
							cx="40"
							cy="40"
							r="36"
							stroke="currentColor"
							strokeWidth="5"
							fill="none"
							className="text-on-surface/5"
						/>
						<circle
							cx="40"
							cy="40"
							r="36"
							stroke="currentColor"
							strokeWidth="5"
							fill="none"
							className="text-primary"
							strokeLinecap="round"
							strokeDasharray={circumference}
							strokeDashoffset={strokeDashoffset}
							style={{ transition: "stroke-dashoffset 0.5s ease" }}
						/>
					</svg>
					<div className="absolute inset-0 flex flex-col items-center justify-center">
						<span className="text-xl font-black text-on-surface">{filledSlots}</span>
						<span className="text-[9px] text-on-surface-variant font-medium">/ {totalSlots}</span>
					</div>
				</div>
				<div className="flex-1 min-w-0 space-y-2.5">
					<div className="flex flex-wrap gap-1.5">
						<div
							className={cn(
								"inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-container-high",
								balance.color
							)}
						>
							<Icon name={balance.icon} size={16} />
							<span className="text-xs font-bold">{balance.label}</span>
						</div>

						{statsAvg && (
							<div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-container text-on-primary-container">
								<Icon name="bolt" size={16} />
								<span className="text-xs font-bold">CP: {statsAvg.combatPower}</span>
							</div>
						)}
					</div>

					{rarities.length > 0 && (
						<div className="flex flex-wrap gap-1">
							{rarities.map(({ rarity, count }) => (
								<span
									key={rarity}
									className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-white"
									style={{ backgroundColor: RARITY_COLORS[rarity] || "#6b7280" }}
								>
									{count}x {rarity}
								</span>
							))}
						</div>
					)}
				</div>
			</div>

			{/* Average team stats bars */}
			{statsAvg && (
				<div className="border-t border-b border-outline-variant/20 py-3.5 space-y-2">
					<p className="text-xs font-bold text-on-surface-variant">Statistiques Moyennes (Niv. {level})</p>
					<div className="grid grid-cols-2 gap-x-4 gap-y-2">
						{[
							{ label: "Frappe", val: statsAvg.kick, color: "bg-red-500" },
							{ label: "Contrôle", val: statsAvg.control, color: "bg-blue-500" },
							{ label: "Technique", val: statsAvg.technique, color: "bg-yellow-500" },
							{ label: "Pression", val: statsAvg.pressure, color: "bg-amber-500" },
							{ label: "Physique", val: statsAvg.physical, color: "bg-purple-500" },
							{ label: "Agilité", val: statsAvg.agility, color: "bg-teal-500" },
						].map((st, i) => (
							<div key={i} className="space-y-1">
								<div className="flex justify-between text-[10px] font-bold text-on-surface-variant">
									<span>{st.label}</span>
									<span>{st.val}</span>
								</div>
								<div className="h-1.5 w-full bg-on-surface/5 rounded-full overflow-hidden">
									<div
										className={cn("h-full rounded-full", st.color)}
										style={{ width: `${Math.min(100, (st.val / 160) * 100)}%` }}
									/>
								</div>
							</div>
						))}
					</div>
				</div>
			)}

			{/* Synergies display */}
			<div className="space-y-2.5">
				<p className="text-xs font-bold text-on-surface-variant">Synergies Actives</p>
				<div className="grid grid-cols-2 gap-2 text-xs">
					<div className={cn(
						"p-2.5 rounded-xl border flex flex-col justify-between h-16 transition-all",
						dominantElement 
							? "border-primary/25 bg-primary/5 text-primary" 
							: "border-outline-variant/30 bg-surface-container-high/40 opacity-60"
					)}>
						<span className="font-bold flex items-center gap-1">
							<Icon name="stars" size={14} /> Dominance
						</span>
						<span className="text-[10px] text-on-surface-variant">
							{dominantElement ? `${ELEMENT_LABELS[dominantElement]} (+5% techniques)` : "Inactif (min. 4)"}
						</span>
					</div>

					<div className={cn(
						"p-2.5 rounded-xl border flex flex-col justify-between h-16 transition-all",
						hasHarmony 
							? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" 
							: "border-outline-variant/30 bg-surface-container-high/40 opacity-60"
					)}>
						<span className="font-bold flex items-center gap-1">
							<Icon name="blur_on" size={14} /> Harmonie
						</span>
						<span className="text-[10px] text-on-surface-variant">
							{hasHarmony ? "Active (+3% toutes stats)" : "Inactif (4 éléments requis)"}
						</span>
					</div>
				</div>

				{links.length > 0 && (
					<div className="p-2.5 rounded-xl border border-primary/10 bg-surface-container-high flex items-center gap-2 text-xs">
						<Icon name="share" size={16} className="text-primary animate-pulse" />
						<div className="flex-1 min-w-0">
							<p className="font-bold text-on-surface">{links.length} liens élémentaires</p>
							<p className="text-[10px] text-on-surface-variant">
								Glows dash-lines connectent vos joueurs.
							</p>
						</div>
					</div>
				)}
			</div>

			{/* Elements */}
			<div>
				<p className="text-xs font-bold text-on-surface-variant mb-2">Éléments</p>
				<div className="space-y-1.5">
					{Object.entries(ELEMENT_LABELS).map(([key, label]) => {
						const count = elements[key] || 0;
						const pct = (count / maxElement) * 100;
						return (
							<div key={key} className="flex items-center gap-2.5">
								<CommonSpriteIcon name={ELEMENT_SPRITE[key]} scale={0.2} />
								<span className="text-xs w-16 text-on-surface-variant">{label}</span>
								<div className="flex-1 h-3 rounded-full bg-on-surface/5 overflow-hidden">
									<div
										className="h-full rounded-full transition-all duration-500 ease-out"
										style={{ backgroundColor: ELEMENT_COLORS[key], width: `${pct}%` }}
									/>
								</div>
								<span className="text-xs font-bold text-on-surface w-5 text-right">{count}</span>
							</div>
						);
					})}
				</div>
			</div>

			{/* Position coverage */}
			<div>
				<p className="text-xs font-bold text-on-surface-variant mb-2">Couverture</p>
				<div className="grid grid-cols-4 gap-2">
					{positionCoverage.map(({ role, total, filled }) => (
						<div key={role} className="text-center p-2 rounded-xl bg-surface-container-high">
							<div className="text-xl font-black" style={{ color: ROLE_COLORS[role] }}>
								{filled}
								<span className="text-xs text-on-surface-variant font-medium">/{total}</span>
							</div>
							<span className="text-[10px] font-bold text-on-surface-variant">
								{ROLE_LABELS[role]}
							</span>
						</div>
					))}
				</div>
			</div>
		</div>
	);
}
