"use client";

import { CircleDot, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

/** A technique or passive slot rendered on a character sheet. */
export interface MovesetSkill {
	id?: string;
	name: string;
	power?: number | string;
	element?: string;
	slotNumber?: number;
	isPassive?: boolean;
	learnLevel?: number;
	evolutionLevel?: number;
	evolutionSuffix?: string;
	growthType?: number;
	imageUrl?: string;
	videoUrl?: string;
	category?: string;
	tension?: number;
	href?: string;
}

export interface MovesetElementImage {
	src: string;
	alt: string;
	className: string;
}

export interface MovesetSkillLink {
	href: string;
	className: string;
	children: ReactNode;
}

export interface MovesetListProps {
	skills: MovesetSkill[];
	maxSlots?: number;
	className?: string;
	/** Resolves a technique route for the active host. */
	resolveSkillHref?: (skill: MovesetSkill) => string;
	/** Resolves element artwork from the host's CDN or VFS. */
	resolveElementIcon?: (element: string) => string | null | undefined;
	/** Hosts retain their navigation primitive (Next Link, SPA navigation, or an anchor). */
	renderSkillLink?: (link: MovesetSkillLink) => ReactNode;
	/** Hosts retain their image implementation (Next image or a VFS-aware image). */
	renderElementImage?: (image: MovesetElementImage) => ReactNode;
}

/**
 * Shared character moveset geometry. Routes, element resource lookup, and image
 * decoding remain host responsibilities so this surface works with Next, Tauri,
 * and the browser VFS without carrying a second data or navigation implementation.
 */
export function MovesetList({
	skills,
	maxSlots = 4,
	className,
	resolveSkillHref = (skill) => (skill.id ? `/skill/${skill.id}` : "#"),
	resolveElementIcon,
	renderSkillLink = ({ href, className: linkClassName, children }) => (
		<a href={href} className={linkClassName}>
			{children}
		</a>
	),
	renderElementImage,
}: MovesetListProps) {
	return (
		<div className={cn("flex flex-col gap-2 w-full max-w-sm mx-auto", className)}>
			<div className="flex items-center gap-2 mb-1 px-1">
				<span className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
					Techniques &amp; Talents
				</span>
				<div className="h-px flex-1 bg-outline-variant" />
			</div>

			<div className="flex flex-col gap-2">
				{skills.map((skill, index) => {
					const elementIcon = skill.element ? resolveElementIcon?.(skill.element) : null;
					const linkClassName = cn(
						"group relative h-12 bg-linear-to-r rounded-r-xl border-l-[6px] shadow-sm border border-outline-variant/30 flex items-center overflow-hidden transition-transform hover:translate-x-1",
						skill.isPassive
							? "from-purple-500/10 to-surface-container border-l-purple-500"
							: "from-surface-container-high to-surface-container border-l-lime-500"
					);

					return (
						<div key={skill.id || index}>
							{renderSkillLink({
								href: resolveSkillHref(skill),
								className: linkClassName,
								children: (
									<>
										<div className="absolute -left-1 sm:-left-3 top-1/2 -translate-y-1/2 size-6 flex items-center justify-center">
											<span className="text-[10px] font-black text-white ml-2">{index + 1}</span>
										</div>

										<div className="w-10 h-full flex items-center justify-center bg-surface-dim">
											{elementIcon && renderElementImage ? (
												<div className="size-5 relative">
													{renderElementImage({
														src: elementIcon,
														alt: skill.element || "",
														className: "object-contain",
													})}
												</div>
											) : skill.isPassive ? (
												<Sparkles size={18} className="text-outline-variant" aria-hidden="true" />
											) : (
												<CircleDot size={18} className="text-outline-variant" aria-hidden="true" />
											)}
										</div>

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
													<span className="text-[9px] font-bold text-purple-400 uppercase tracking-wider">Talent</span>
												)}
												{skill.learnLevel !== undefined && skill.learnLevel > 0 && (
													<span className="text-[9px] font-medium text-slate-400">Niv. {skill.learnLevel}</span>
												)}
											</div>
										</div>

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
									</>
								),
							})}
						</div>
					);
				})}

				{[...Array(Math.max(0, maxSlots - skills.length))].map((_, index) => (
					<div
						key={`empty-${index}`}
						className="h-10 border-b border-outline-variant/20 flex items-center gap-4 px-4 opacity-30 select-none"
					>
						<span className="font-bold border border-outline size-5 flex items-center justify-center rounded text-xs text-outline">
							{skills.length + index + 1}
						</span>
						<div className="h-1 w-full bg-outline-variant/30 rounded-full" />
					</div>
				))}
			</div>
		</div>
	);
}
