"use client";

import type { GameCharacterStats } from "@/lib/wikiTypes";
// Cf. la note d'AuraCard : jamais la bibliothèque UI web du wiki ici — `process.env` → page blanche.
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@niers/inacord-ui/components/ui/popover";
import { CharacterStatsContent } from "@niers/inacord-ui/components/wiki/wiki/CharacterStatsContent";
import { CharacterStatsTriggerContent } from "@niers/inacord-ui/components/wiki/wiki/CharacterStatsTriggerContent";

interface CharacterStatsPopoverProps {
  stats: GameCharacterStats;
  name: string;
}

export function CharacterStatsPopover({
  stats,
  name,
}: CharacterStatsPopoverProps) {
  if (!stats) {
    return null;
  }

  return (
    <Popover>
      {/* Le `PopoverTrigger` local (base-ui) REND déjà un `<button>` : il n'a pas de prop
       * `asChild` (c'est l'API Radix du web), et l'y emboîter produirait un bouton dans un
       * bouton. Les classes du bouton fantôme sont donc portées directement ici. */}
      <PopoverTrigger className="inline-flex size-11 items-center justify-center rounded-md text-on-surface-variant transition-colors hover:bg-app-hover hover:text-primary sm:size-8">
        <CharacterStatsTriggerContent name={name} />
      </PopoverTrigger>
      <PopoverContent
        className="w-[calc(100vw-2rem)] max-w-sm sm:w-80 p-4 bg-surface-container-high border-outline-variant"
        align="center"
      >
        <CharacterStatsContent stats={stats} />
      </PopoverContent>
    </Popover>
  );
}
