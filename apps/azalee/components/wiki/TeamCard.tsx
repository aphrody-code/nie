"use client";

import Image from "next/image";
import {
  TeamCard as SharedTeamCard,
  type TeamCardProps as SharedTeamCardProps,
} from "@niers/inacord-ui/components/wiki/wiki/TeamCard";
import {
  SEASON_LABELS,
  SERIES_LABELS,
  type TeamListItem,
} from "@rosegriffon/azalee/wiki/teams-shared";

interface TeamCardProps extends Omit<
  SharedTeamCardProps,
  "team" | "seriesLabel" | "seasonLabel" | "renderImage"
> {
  team: TeamListItem;
}

/** Azalée adapter: it supplies data-service labels and Next image loading. */
export function TeamCard({ team, ...props }: TeamCardProps) {
  return (
    <SharedTeamCard
      {...props}
      team={team}
      seriesLabel={(series) => SERIES_LABELS[series] ?? series}
      seasonLabel={(season) => SEASON_LABELS[season] ?? season}
      renderImage={({ src, alt, className, onError }) => (
        <Image
          src={src}
          alt={alt}
          width={48}
          height={48}
          className={className}
          unoptimized
          onError={onError}
        />
      )}
    />
  );
}
