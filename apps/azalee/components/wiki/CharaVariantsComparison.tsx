"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Check, X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VariantComparisonResult } from "@rosegriffon/inagle";

interface CharaVariantsComparisonProps {
	comparisons: VariantComparisonResult[];
	baseName: string;
}

const STAT_LABELS: Record<string, string> = {
	kick: "Frappe",
	control: "Contrôle",
	technique: "Technique",
	physical: "Physique",
	pressure: "Pression",
	agility: "Agilité",
	intelligence: "Intelligence",
};

const CLASSIFICATION_STYLES: Record<string, { bg: string; text: string; border: string }> = {
	"Base Version": {
		bg: "bg-surface-container-high/40",
		text: "text-on-surface-variant",
		border: "border-outline-variant/30",
	},
	"Pure Upgrade": {
		bg: "bg-emerald-500/10",
		text: "text-emerald-400",
		border: "border-emerald-500/20",
	},
	"Element Shift": {
		bg: "bg-amber-500/10",
		text: "text-amber-400",
		border: "border-amber-500/20",
	},
	"Position Shift": {
		bg: "bg-blue-500/10",
		text: "text-blue-400",
		border: "border-blue-500/20",
	},
	"Tactical Variation": {
		bg: "bg-indigo-500/10",
		text: "text-indigo-400",
		border: "border-indigo-500/20",
	},
	"Hybrid Evolution": {
		bg: "bg-purple-500/10",
		text: "text-purple-400",
		border: "border-purple-500/20",
	},
};

export function CharaVariantsComparison({ comparisons, baseName }: CharaVariantsComparisonProps) {
	const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

	if (!comparisons || comparisons.length <= 1) {
		return null;
	}

	// Filter out the base version itself as we only show comparisons of variants against it
	const variantComparisons = comparisons.filter((c) => c.classification !== "Base Version");

	if (variantComparisons.length === 0) {
		return null;
	}

	const toggleExpand = (id: string) => {
		setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
	};

	return (
		<div className="bg-surface-container-low rounded-[20px] sm:rounded-[24px] border border-outline-variant/30 px-4 py-4 sm:px-6 sm:py-5 space-y-4">
			<div className="flex items-center gap-2">
				<Sparkles className="size-5 text-primary" />
				<h2 className="text-sm sm:text-base font-black uppercase tracking-wider text-on-surface">
					Analyse des Variantes
				</h2>
			</div>
			<p className="text-xs text-on-surface-variant leading-relaxed">
				Comparaison des versions alternatives par rapport à la version d'origine (la plus jeune) de{" "}
				<span className="font-bold text-on-surface">{baseName}</span>.
			</p>

			<div className="grid grid-cols-1 gap-3 sm:gap-4">
				{variantComparisons.map((c) => {
					const isExpanded = !!expandedIds[c.variantId];
					const style = CLASSIFICATION_STYLES[c.classification] || CLASSIFICATION_STYLES["Tactical Variation"];

					return (
						<div
							key={c.variantId}
							className={cn(
								"rounded-2xl border transition-all duration-300 overflow-hidden",
								isExpanded ? "bg-surface-container/50 border-primary/20 shadow-md" : "bg-surface-container-lowest/30 border-outline-variant/20 hover:border-outline-variant/40"
							)}
						>
							{/* Card Header */}
							<div
								onClick={() => toggleExpand(c.variantId)}
								className="flex flex-wrap items-center justify-between gap-3 p-3 sm:p-4 cursor-pointer select-none"
							>
								<div className="flex items-center gap-2.5 min-w-0">
									<div className={cn("px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border tracking-wider", style.bg, style.text, style.border)}>
										{c.classification}
									</div>
									<span className="text-xs font-bold text-on-surface truncate">
										Rarité : {c.rarity}
									</span>
									<span className="text-[10px] text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded">
										{c.position} | {c.element}
									</span>
								</div>

								<div className="flex items-center gap-2">
									<span className="text-xs font-medium text-on-surface-variant hidden sm:inline">
										{isExpanded ? "Masquer" : "Détails"}
									</span>
									{isExpanded ? (
										<ChevronUp className="size-4 text-on-surface-variant" />
									) : (
										<ChevronDown className="size-4 text-on-surface-variant" />
									)}
								</div>
							</div>

							{/* Summary Explanation */}
							<div className="px-3 pb-3 sm:px-4 sm:pb-4 border-b border-outline-variant/10">
								<p className="text-xs text-on-surface-variant/90 leading-relaxed italic bg-surface-container/30 p-2.5 rounded-xl border border-outline-variant/10">
									{c.explanation}
								</p>
							</div>

							{/* Expanded Section */}
							{isExpanded && (
								<div className="p-3 sm:p-4 bg-surface-container-lowest/40 space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
									{/* Stats comparison grid */}
									<div className="space-y-2">
										<h3 className="text-[10px] font-black uppercase tracking-wider text-on-surface-variant/80">
											Comparatif des statistiques (Niveau 99)
										</h3>
										<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
											{c.statChanges.map((stat) => {
												const hasDiff = stat.difference !== 0;
												const isPositive = stat.difference > 0;
												return (
													<div
														key={stat.stat}
														className="flex items-center justify-between p-2 rounded-xl bg-surface-container/20 border border-outline-variant/10 text-xs"
													>
														<span className="text-on-surface-variant">
															{STAT_LABELS[stat.stat] || stat.stat}
														</span>
														<div className="flex items-center gap-2 font-mono">
															<span className="text-on-surface-variant/60">{stat.baseValue}</span>
															<span className="text-on-surface-variant/40">➔</span>
															<span className="font-bold text-on-surface">{stat.variantValue}</span>
															{hasDiff && (
																<span
																	className={cn(
																		"text-[10px] font-bold px-1.5 py-0.5 rounded",
																		isPositive ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
																	)}
																>
																	{isPositive ? "+" : ""}
																	{stat.difference}
																</span>
															)}
														</div>
													</div>
												);
											})}
										</div>
									</div>

									{/* Moveset differences */}
									<div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
										{/* Added Skills */}
										<div className="space-y-1.5">
											<h4 className="text-[10px] font-black uppercase tracking-wider text-emerald-400/80 flex items-center gap-1">
												<Check className="size-3" /> Techniques Acquises
											</h4>
											{c.addedSkills.length > 0 ? (
												<ul className="space-y-1">
													{c.addedSkills.map((sk) => (
														<li
															key={sk}
															className="text-xs text-on-surface flex items-center gap-1.5"
														>
															<span className="size-1 rounded-full bg-emerald-400" />
															{sk}
														</li>
													))}
												</ul>
											) : (
												<p className="text-[11px] text-on-surface-variant/60 italic">
													Aucune nouvelle technique.
												</p>
											)}
										</div>

										{/* Removed Skills */}
										<div className="space-y-1.5">
											<h4 className="text-[10px] font-black uppercase tracking-wider text-on-surface-variant/60 flex items-center gap-1">
												<X className="size-3" /> Techniques Non Transférées
											</h4>
											{c.removedSkills.length > 0 ? (
												<ul className="space-y-1">
													{c.removedSkills.map((sk) => (
														<li
															key={sk}
															className="text-xs text-on-surface-variant/70 flex items-center gap-1.5"
														>
															<span className="size-1 rounded-full bg-outline/40" />
															{sk}
														</li>
													))}
												</ul>
											) : (
												<p className="text-[11px] text-on-surface-variant/60 italic">
													Toutes les techniques de base sont conservées.
												</p>
											)}
										</div>
									</div>
								</div>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
