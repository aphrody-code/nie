"use client";

import { useState, type ReactNode } from "react";

import { Link } from "../../../compat/next";
import { cn } from "../../../lib/utils";
import { Icon } from "../../ui/Icon";

export interface TeamCardTeam {
  id: string;
  name: string;
  nameJa: string | null;
  emblemUrl: string | null;
  rosterCount: number;
  seasons: Record<string, number>;
  seriesKeys: string[];
}
export interface TeamCardImage {
  src: string;
  alt: string;
  className: string;
  onError: () => void;
}
export interface TeamCardProps {
  team: TeamCardTeam;
  className?: string;
  seriesLabel: (series: string) => string;
  seasonLabel: (season: string) => string;
  renderImage: (image: TeamCardImage) => ReactNode;
}

/** Shared team-card presentation. Hosts retain their localized label and image resolvers. */
export function TeamCard({
  team,
  className,
  seriesLabel,
  seasonLabel,
  renderImage,
}: TeamCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const hasEmblem = Boolean(team.emblemUrl) && !imageFailed;
  const topSeasons = Object.entries(team.seasons)
    .sort(([, left], [, right]) => right - left)
    .slice(0, 3);
  return (
    <Link
      href={`/equipe/${team.id}`}
      className={cn(
        "group relative block h-full overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low transition-all duration-200",
        "hover:-translate-y-0.5 hover:bg-surface-container hover:shadow-lg",
        className,
      )}
    >
      <div className="flex gap-4 p-4">
        <div className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-outline-variant/20 bg-surface-container-high">
          {hasEmblem && team.emblemUrl ? (
            renderImage({
              src: team.emblemUrl,
              alt: team.name,
              className: "size-12 object-contain",
              onError: () => setImageFailed(true),
            })
          ) : (
            <Icon
              name="shield"
              size={24}
              className="text-on-surface-variant/30"
            />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-sm font-bold leading-tight text-on-surface transition-colors group-hover:text-primary">
            {team.name}
          </h3>
          {team.nameJa && team.nameJa !== team.name ? (
            <p className="mt-0.5 truncate text-[11px] text-on-surface-variant/70">
              {team.nameJa}
            </p>
          ) : null}
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {team.rosterCount > 0 ? (
              <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                <Icon name="group" size={12} />
                {team.rosterCount}
              </span>
            ) : null}
            {team.seriesKeys.map((series) => (
              <span
                key={series}
                className="inline-flex items-center rounded bg-surface-container-highest/50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant"
                title={seriesLabel(series)}
              >
                {series === "aresOrion" ? "ARES" : series}
              </span>
            ))}
          </div>
          {topSeasons.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {topSeasons.map(([season]) => (
                <span
                  key={season}
                  className="inline-flex items-center rounded bg-tertiary/10 px-1.5 py-0.5 text-[10px] font-medium text-tertiary"
                  title={seasonLabel(season)}
                >
                  {season}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Link>
  );
}
