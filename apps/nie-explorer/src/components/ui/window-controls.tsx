// Boutons de fenêtre custom (réduire/agrandir-restaurer/fermer) — la fenêtre est SANS bordure
// depuis `decorations: false` (`src-tauri/tauri.conf.json`), portage du frameless look de
// spacedrive/spaceui (cf. `var/spacedrive/docs/public/SDGridView.webp` : traffic lights macOS
// intégrées à la barre d'outils, pas de chrome natif séparé). Windows n'a pas de convention
// "traffic lights" — alignement à droite, forme et comportement natifs Windows 11 (Discord/VS
// Code/Spotify frameless), pas une imitation macOS hors de propos sur cette plateforme.
import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

const win = getCurrentWindow();

export function WindowControls({ className }: { className?: string }) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlisten = win.onResized(() => {
      win.isMaximized().then(setMaximized).catch(() => {});
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-dull transition-colors hover:bg-app-hover hover:text-ink"
        title="Réduire"
        aria-label="Réduire"
        onClick={() => win.minimize()}
      >
        <Icon name="remove" size={16} />
      </button>
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-dull transition-colors hover:bg-app-hover hover:text-ink"
        title={maximized ? "Restaurer" : "Agrandir"}
        aria-label={maximized ? "Restaurer" : "Agrandir"}
        onClick={() => win.toggleMaximize()}
      >
        <Icon name={maximized ? "fullscreen_exit" : "crop_square"} size={14} />
      </button>
      <button
        type="button"
        className="flex h-8 w-8 items-center justify-center rounded-md text-ink-dull transition-colors hover:bg-status-error hover:text-white"
        title="Fermer"
        aria-label="Fermer"
        onClick={() => win.close()}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
