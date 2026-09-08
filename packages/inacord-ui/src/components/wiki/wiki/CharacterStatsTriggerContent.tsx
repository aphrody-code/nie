"use client";

import { BarChart3 } from "lucide-react";

export interface CharacterStatsTriggerContentProps {
  name: string;
}

/**
 * Platform-neutral visual content for a character-stat popover trigger.
 *
 * Hosts retain their own popover and button primitives: Azalee uses its
 * public-web component library, while the desktop host uses its local
 * Base UI adapter. Keeping only the visual payload here avoids nesting
 * incompatible button implementations while keeping labels consistent.
 */
export function CharacterStatsTriggerContent({
  name,
}: CharacterStatsTriggerContentProps) {
  return (
    <>
      <BarChart3 className="size-4" />
      <span className="sr-only">Stats de {name}</span>
    </>
  );
}
