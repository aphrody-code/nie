"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useMemo } from "react";
import { getCharacterSkills } from "@/app/actions/teams";
import { CommonSpriteIcon } from "@/components/ui/CommonSpriteIcon";
import { Icon } from "@/components/ui/Icon";
import { RarityBadge } from "@/components/ui/rarity-badge";
import { SafeImage } from "@/components/ui/SafeImage";
import { MovesetList } from "@/components/wiki/MovesetList";
import type { MovesetSkill } from "@/components/wiki/MovesetList";
import { MiniStatHeptagon } from "@/components/wiki/StatHeptagon";
import type { SpriteCommonKey } from "@/config/sprites-common";
import { ROLE_COLORS, ROLE_LABELS } from "@rosegriffon/azalee/game/formations";
import type { Formation } from "@rosegriffon/azalee/game/formations";
import type { TeamMember } from "@rosegriffon/azalee/game/team-types";
import { getCharacterImageUrl } from "@rosegriffon/azalee/images";
import { getPositionMatchFactor, recalculateMemberStats } from "@rosegriffon/azalee/game/team-rules";

const ELEMENT_SPRITE: Record<string, SpriteCommonKey> = {
	Fire: "fire",
	Forest: "forest",
	Mountain: "mountain",
	Wind: "wind",
};
const ELEMENT_LABELS: Record<string, string> = {
	Fire: "Feu",
	Forest: "Forêt",
	Mountain: "Montagne",
	Wind: "Vent",
};

const STAT_LABELS: Record<string, string> = {
	agility: "Agilité",
	control: "Contrôle",
	intelligence: "Intelligence",
	kick: "Frappe",
	physical: "Physique",
	pressure: "Pression",
	technique: "Technique",
};

interface PlayerDetailPanelProps {
	member: TeamMember;
	onClose: () => void;
	onRemove: (slot: string) => void;
	level?: number;
	formation?: Formation | null;
}

export function PlayerDetailPanel({
	member,
	onClose,
	onRemove,
	level = 99,
	formation,
}: PlayerDetailPanelProps) {
	const [skills, setSkills] = useState<MovesetSkill[]>([]);
	const [loading, setLoading] = useState(true);
	const lastCharaId = useRef<string | null>(null);

	useEffect(() => {
		if (lastCharaId.current === member.charaId) {
			return;
		}
		lastCharaId.current = member.charaId;
		let cancelled = false;
		setLoading(true);
		getCharacterSkills(member.charaId).then((result) => {
			if (!cancelled) {
				setSkills(result);
				setLoading(false);
			}
		});
		return () => {
			cancelled = true;
		};
	}, [member.charaId]);

	const roleColor = ROLE_COLORS[member.position] || ROLE_COLORS.MF;
	const roleLabel = ROLE_LABELS[member.position] || member.position;
	const elSprite = ELEMENT_SPRITE[member.element];
	const elLabel = ELEMENT_LABELS[member.element] || member.element;
	const hasStats = member.stats && Object.values(member.stats).some((v) => v > 0);

	// Position match checking
	const posInfo = useMemo(() => {
		if (!formation) return { factor: 1.0, status: "none" as const };
		return getPositionMatchFactor(member.position, member.slot, formation);
	}, [member.position, member.slot, formation]);

	// Recalculated stats based on level and slot role
	const finalStats = useMemo(() => {
		if (!hasStats || !formation) return null;
		return recalculateMemberStats(member, level, member.slot, formation);
	}, [member, level, formation, hasStats]);

	const statTotal = finalStats ? finalStats.combatPower : 0;

	return (
		<div className="rounded-2xl bg-surface-container elevation-2 overflow-hidden animate-in slide-in-from-right-4 duration-200">
			{/* Header */}
			<div className="relative h-28 overflow-hidden">
				<div className="absolute inset-0 bg-linear-to-br from-surface-container-highest to-surface-container-high" />
				<SafeImage
					src={member.imageUrl}
					zukanHash={member.zukanHash}
					fallbackSrc={member.internalCode ? getCharacterImageUrl(member.internalCode) : undefined}
					alt={member.name}
					fill
					sizes="300px"
					className="object-cover opacity-40 blur-sm scale-110"
					unoptimized
				/>
				<div className="absolute inset-0 bg-linear-to-t from-surface-container via-transparent to-transparent" />

				{/* Close button */}
				<button
					onClick={onClose}
					className="absolute top-2 right-2 inline-flex items-center justify-center size-11 sm:size-9 rounded-full bg-surface-container/80 backdrop-blur-sm text-on-surface-variant hover:bg-surface-container-high active:scale-90 transition-all"
					aria-label="Fermer le détail"
					>
						<Icon name="close" size={18} />
				</button>

				{/* Character info overlay */}
				<div className="absolute bottom-2 left-3 right-3 flex items-end gap-3">
					<div className="relative size-16 rounded-xl overflow-hidden ring-2 ring-outline/20 shrink-0 elevation-2">
						<SafeImage
							src={member.imageUrl}
							zukanHash={member.zukanHash}
							fallbackSrc={
								member.internalCode ? getCharacterImageUrl(member.internalCode) : undefined
							}
							alt={member.name}
							fill
							sizes="64px"
							className="object-cover"
							unoptimized
						/>
					</div>
					<div className="flex-1 min-w-0 pb-0.5">
						<p className="font-bold text-on-surface text-sm truncate">{member.name}</p>
						<div className="flex items-center gap-1.5 mt-0.5 font-bold">
							<span
								className="text-[9px] font-black px-1.5 py-0.5 rounded text-white"
								style={{ backgroundColor: roleColor }}
							>
								{roleLabel}
							</span>
							{elSprite && (
								<span className="inline-flex items-center gap-0.5">
									<CommonSpriteIcon name={elSprite} scale={0.16} />
									<span className="text-[9px] text-on-surface-variant font-medium">{elLabel}</span>
								</span>
							)}
							<RarityBadge rarity={member.rarity} size="xs" />
						</div>
					</div>
				</div>
			</div>

			{/* Content */}
			<div className="p-3 space-y-3">
				{/* Warning banner for position malus */}
				{posInfo.status !== "match" && posInfo.status !== "none" && (
					<div className="p-2.5 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-xs flex items-center gap-2 font-medium">
						<Icon name="error" size={16} />
						<span>
							Malus de position ({posInfo.status === "adjacent" ? "-15%" : "-35%"} de stats). Placez
							ce joueur à un poste adapté pour restaurer ses capacités.
						</span>
					</div>
				)}

				{/* Stats */}
				{hasStats && finalStats && (
					<div>
						<div className="flex items-center justify-between mb-2">
							<p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
								Stats Recalculées (Niv. {level})
							</p>
							<span className="text-[10px] font-bold text-on-surface-variant">
								Total: {statTotal}
							</span>
						</div>
						<div className="flex items-start gap-3">
							<MiniStatHeptagon stats={finalStats} size={72} />
							<div className="flex-1 grid grid-cols-2 gap-x-3 gap-y-1">
								{Object.entries(finalStats).map(([key, value]) => {
									if (key === "combatPower") return null;
									return (
										<div key={key} className="flex items-center justify-between">
											<span className="text-[9px] text-on-surface-variant truncate">
												{STAT_LABELS[key] || key}
											</span>
											<span className="text-[10px] font-bold text-on-surface tabular-nums">
												{value}
											</span>
										</div>
									);
								})}
							</div>
						</div>
					</div>
				)}

				{/* Skills */}
				<div>
					{loading ? (
						<div className="flex items-center gap-2 py-4 justify-center text-on-surface-variant">
							<div className="size-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
							<span className="text-xs">Chargement des techniques...</span>
						</div>
					) : skills.length > 0 ? (
						<MovesetList skills={skills} maxSlots={skills.length} className="!max-w-none" />
					) : (
						<p className="text-xs text-on-surface-variant/50 text-center py-2">
							Aucune technique trouvée
						</p>
					)}
				</div>

				{/* Actions */}
				<div className="flex gap-2 pt-1">
					<Link
						href={`/chara/${member.slug}`}
						className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-11 rounded-full bg-primary text-on-primary text-sm font-bold hover:elevation-2 active:scale-[0.97] transition-all"
						aria-label={`Voir la fiche wiki de ${member.name}`}
					>
						<Icon name="open_in_new" size={16} />
						Fiche Wiki
					</Link>
					<button
						onClick={() => {
							onRemove(member.slot);
							onClose();
						}}
						className="inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-full bg-error-container text-on-error-container text-sm font-bold hover:elevation-2 active:scale-[0.97] transition-all"
						aria-label={`Retirer ${member.name} de l'équipe`}
					>
						<Icon name="person_remove" size={16} />
						Retirer
					</button>
				</div>
			</div>
		</div>
	);
}
