"use client";

import { CircleDot, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { getSkillElementIconUrl } from "@rosegriffon/azalee/images";
import { cn } from "@/lib/utils";

// Interface simplifiée pour l'affichage (compatible avec Wiki et MyTeam)
export interface MovesetSkill {
	id?: string;
	name: string;
	power?: number | string; // Peut être une plage "10-20"
	element?: string; // "fire", "wind", etc. ou URL d'image si nécessaire
	slotNumber?: number;
	isPassive?: boolean; // Pour différencier Passif vs Technique
	learnLevel?: number;
	evolutionLevel?: number; // BASARA: occurrence count (2=2e, 3=3e...)
	evolutionSuffix?: string; // "+1", "V2", "G3", "N2" selon growthType
	growthType?: number; // 0=Lente, 1=Normale(+), 2=V, 3=G, 7=Infinie(N)
	imageUrl?: string;
	videoUrl?: string;
	category?: string;
	tension?: number;
	href?: string; // Lien explicite (ex: /aura/esprits-guerriers/wks00020)
}

interface MovesetListProps {
	skills: MovesetSkill[];
	maxSlots?: number;
	className?: string;
}

export function MovesetList({ skills, maxSlots = 4, className }: MovesetListProps) {
	return (
		<div className={cn("flex flex-col gap-2 w-full max-w-sm mx-auto", className)}>
			{/* Header - Optionnel */}
			<div className="flex items-center gap-2 mb-1 px-1">
				<span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
					Techniques & Talents
				</span>
				<div className="h-px flex-1 bg-outline-variant" />
			</div>

			<div className="flex flex-col gap-2">
				{skills.map((skill, i) => {
					const elementIcon = skill.element ? getSkillElementIconUrl(skill.element) : null;
					const skillHref = skill.id ? `/skill/${skill.id}` : "#";

					return (
						<Link
							key={skill.id || i}
							href={skillHref}
							className={cn(
								"group relative h-12 bg-linear-to-r rounded-r-xl border-l-[6px] shadow-sm border border-outline-variant/30 flex items-center overflow-hidden transition-transform hover:translate-x-1",
								skill.isPassive
									? "from-purple-500/10 to-surface-container border-l-purple-500" // Passifs en violet
									: "from-surface-container-high to-surface-container border-l-lime-500" // Techniques en vert
							)}
						>
							{/* Slot Number */}
							<div className="absolute -left-1 sm:-left-3 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center">
								<span className="text-[10px] font-black text-white ml-2">{i + 1}</span>
							</div>

							{/* Icon */}
							<div className="w-10 h-full flex items-center justify-center bg-surface-dim">
								{elementIcon ? (
									<div className="size-5 relative">
										<Image
											src={elementIcon}
											alt={skill.element || ""}
											fill
											className="object-contain"
										/>
									</div>
								) : skill.isPassive ? (
									<Sparkles size={18} className="text-outline-variant" aria-hidden="true" />
								) : (
									<CircleDot size={18} className="text-outline-variant" aria-hidden="true" />
								)}
							</div>

							{/* Name & Level */}
							<div className="flex-1 px-3 flex flex-col justify-center min-w-0">
								<span
									className={cn(
										"text-sm font-bold leading-tight truncate transition-colors",
										skill.isPassive
											? "text-purple-600 dark:text-purple-400 group-hover:text-purple-500"
											: "text-on-surface group-hover:text-lime-600"
									)}
								>
									{skill.name}
									{skill.evolutionSuffix && (
										<span className="ml-1.5 text-[11px] font-black text-amber-400">
											{skill.evolutionSuffix}
										</span>
									)}
								</span>
								<div className="flex items-center gap-2">
									{skill.isPassive && (
										<span className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">
											Talent
										</span>
									)}
									{skill.learnLevel !== undefined && skill.learnLevel > 0 && (
										<span className="text-[9px] font-medium text-slate-400">
											Niv. {skill.learnLevel}
										</span>
									)}
								</div>
							</div>

							{/* Power & Tension */}
							{!skill.isPassive && (
								<div className="pr-3 flex flex-col items-end min-w-[50px] gap-0.5">
									{skill.power && (
										<span className="text-lg font-black leading-none drop-shadow-sm text-lime-600 dark:text-lime-400">
											{skill.power}
										</span>
									)}
									{skill.tension != null && (
										<span className="text-[9px] font-bold text-on-surface-variant/60 uppercase tracking-wider">
											{skill.tension} Tens.
										</span>
									)}
								</div>
							)}
						</Link>
					);
				})}

				{/* Empty Slots filler */}
				{[...Array(Math.max(0, maxSlots - skills.length))].map((_, i) => (
					<div
						key={`empty-${i}`}
						className="h-10 border-b border-outline-variant/20 flex items-center gap-4 px-4 opacity-30 select-none"
					>
						<span className="font-bold border border-outline size-5 flex items-center justify-center rounded text-xs text-outline">
							{skills.length + i + 1}
						</span>
						<div className="h-1 w-full bg-outline-variant/30 rounded-full" />
					</div>
				))}
			</div>
		</div>
	);
}
