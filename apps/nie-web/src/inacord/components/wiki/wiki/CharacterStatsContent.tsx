"use client";

import { cn } from "../../../lib/utils";

/** The seven game statistics rendered by the shared character summary. */
export interface CharacterStats {
  agility: number;
  control: number;
  intelligence: number;
  kick: number;
  physical: number;
  pressure: number;
  technique: number;
}

export interface CharacterStatsContentProps {
  stats: CharacterStats;
  maxStat?: number;
}

const STAT_LABELS = {
  agility: { color: "bg-cyan-500", label: "Vitesse" },
  control: { color: "bg-blue-500", label: "Maîtrise" },
  intelligence: { color: "bg-indigo-500", label: "Intelligence" },
  kick: { color: "bg-red-500", label: "Frappe" },
  physical: { color: "bg-orange-500", label: "Physique" },
  pressure: { color: "bg-purple-500", label: "Défense" },
  technique: { color: "bg-green-500", label: "Technique" },
} as const;

const STAT_KEYS: readonly (keyof CharacterStats)[] = [
  "agility",
  "control",
  "intelligence",
  "kick",
  "physical",
  "pressure",
  "technique",
];

/** Shared stat-bar presentation used inside host-owned popover implementations. */
export function CharacterStatsContent({
  stats,
  maxStat = 250,
}: CharacterStatsContentProps) {
  return (
    <div className="space-y-4">
      <h4 className="font-medium text-on-surface flex items-center justify-between">
        <span>Stats (Niv. 50)</span>
        <span className="text-xs font-normal text-on-surface-variant">
          Max estimé
        </span>
      </h4>

      <div className="space-y-3">
        {STAT_KEYS.map((key) => {
          const config = STAT_LABELS[key];
          const value = stats[key];
          const percentage = Math.min((value / maxStat) * 100, 100);

          return (
            <div key={key} className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">{config.label}</span>
                <span className="font-medium text-on-surface font-mono">
                  {value}
                </span>
              </div>
              <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    config.color,
                  )}
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-outline-variant/30 flex justify-between items-center text-xs text-on-surface-variant">
        <span>Total</span>
        <span className="font-medium text-on-surface font-mono text-sm">
          {STAT_KEYS.reduce((total, key) => total + stats[key], 0)}
        </span>
      </div>
    </div>
  );
}
