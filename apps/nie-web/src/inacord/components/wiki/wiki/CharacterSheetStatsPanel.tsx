"use client";

import { TrendingUp } from "lucide-react";

import { StatHeptagon } from "./StatHeptagon";

/** The seven game statistics rendered on a character sheet. */
export interface CharacterSheetStats {
	kick: number;
	control: number;
	technique: number;
	pressure: number;
	physical: number;
	agility: number;
	intelligence: number;
}

export interface CharacterSheetStatsLabels {
	heading: string;
	total: string;
	level: string;
	levelShort: string;
	levelMarks: readonly [string, string, string];
	stats: readonly [string, string, string, string, string, string, string];
}

export interface CharacterSheetStatsPanelProps {
	stats: CharacterSheetStats;
	currentStats: CharacterSheetStats;
	statsAtLevelOne?: CharacterSheetStats;
	level: number;
	onLevelChange: (level: number) => void;
	labels: CharacterSheetStatsLabels;
}

/**
 * Shared character-sheet statistics presentation. Hosts own localized labels
 * and character data; this component owns neither routing nor asset lookup.
 */
export function CharacterSheetStatsPanel({
	stats,
	currentStats,
	statsAtLevelOne,
	level,
	onLevelChange,
	labels,
}: CharacterSheetStatsPanelProps) {
	const totalStats =
		currentStats.kick +
		currentStats.control +
		currentStats.technique +
		currentStats.pressure +
		currentStats.physical +
		currentStats.agility +
		currentStats.intelligence;
	const rows: Array<[string, number, number | undefined, number]> = [
		[labels.stats[0], currentStats.kick, statsAtLevelOne?.kick, stats.kick],
		[labels.stats[1], currentStats.control, statsAtLevelOne?.control, stats.control],
		[labels.stats[2], currentStats.technique, statsAtLevelOne?.technique, stats.technique],
		[labels.stats[3], currentStats.pressure, statsAtLevelOne?.pressure, stats.pressure],
		[labels.stats[4], currentStats.physical, statsAtLevelOne?.physical, stats.physical],
		[labels.stats[5], currentStats.agility, statsAtLevelOne?.agility, stats.agility],
		[labels.stats[6], currentStats.intelligence, statsAtLevelOne?.intelligence, stats.intelligence],
	];

	return (
		<section className="bg-surface-container-lowest rounded-[24px] sm:rounded-[32px] border border-outline-variant/30 overflow-hidden shadow-sm">
			<div className="bg-surface-container-low px-4 sm:px-8 py-3 sm:py-4 border-b border-outline-variant/20 flex items-center justify-between">
				<div className="flex items-center gap-1.5 sm:gap-2">
					<TrendingUp size={20} className="sm:size-6 text-primary" aria-hidden="true" />
					<h2 className="text-xs sm:text-sm font-black uppercase tracking-widest text-on-surface">{labels.heading}</h2>
				</div>
				<div className="flex items-center gap-1.5">
					<span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/60">{labels.total}</span>
					<span className="text-base sm:text-lg font-black text-primary tabular-nums">{totalStats}</span>
				</div>
			</div>
			<div className="p-4 sm:p-6 flex flex-col items-center w-full">
				<StatHeptagon stats={currentStats} size={280} showLabels />
				{statsAtLevelOne ? (
					<div className="w-full max-w-xs px-2 mt-4 mb-6 space-y-2">
						<div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-on-surface-variant">
							<span>{labels.level}</span>
							<span className="text-sm font-black text-primary bg-primary/10 px-2.5 py-0.5 rounded-md">{labels.levelShort} {level}</span>
						</div>
						<input type="range" min="1" max="99" value={level} onChange={(event) => onLevelChange(Number(event.target.value))} className="w-full h-1.5 bg-surface-container-highest rounded-lg appearance-none cursor-pointer accent-primary focus:outline-hidden" />
						<div className="flex justify-between text-[10px] text-on-surface-variant/50 font-bold">
							{labels.levelMarks.map((mark) => <span key={mark}>{mark}</span>)}
						</div>
					</div>
				) : null}
				<div className="w-full max-w-xs space-y-3 mt-2">
					{rows.map(([label, current, levelOne, levelNinetyNine]) => {
						const percentage = Math.min(100, Math.max(0, (current / 999) * 100));
						return <div key={label} className="space-y-1">
							<div className="flex justify-between text-xs"><span className="font-bold text-on-surface-variant">{label}</span><div className="flex items-center gap-1.5"><span className="font-black text-primary text-sm tabular-nums">{current}</span>{levelOne !== undefined ? <span className="text-[10px] text-on-surface-variant/40 tabular-nums">({levelOne} → {levelNinetyNine})</span> : null}</div></div>
							<div className="h-1.5 w-full bg-surface-container-high rounded-full overflow-hidden"><div className="h-full bg-linear-to-r from-amber-500 to-primary rounded-full transition-all duration-150" style={{ width: `${percentage}%` }} /></div>
						</div>;
					})}
				</div>
			</div>
		</section>
	);
}
