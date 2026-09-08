"use client";

import type { GameCharacterStats } from "@rosegriffon/inagle";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@rosegriffon/ui";
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
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-11 sm:size-8 text-on-surface-variant hover:text-primary"
        >
          <CharacterStatsTriggerContent name={name} />
        </Button>
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
