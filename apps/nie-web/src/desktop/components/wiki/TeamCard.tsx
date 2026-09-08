"use client";

import { Image } from "@niers/inacord-ui/components/ui/image";
import {
  TeamCard as SharedTeamCard,
  type TeamCardProps as SharedTeamCardProps,
} from "@niers/inacord-ui/components/wiki/wiki/TeamCard";
import {
  SEASON_LABELS,
  SERIES_LABELS,
  type TeamListItem,
} from "@/lib/wikiTypes";

interface TeamCardProps extends Omit<
  SharedTeamCardProps,
  "team" | "seriesLabel" | "seasonLabel" | "renderImage"
> {
  team: TeamListItem;
}

/** Desktop adapter: it supplies local labels and VFS-aware image loading. */
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
