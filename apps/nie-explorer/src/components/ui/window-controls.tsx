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
        className="state-layer flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface"
        title="Réduire"
        onClick={() => win.minimize()}
      >
        <Icon name="remove" size={16} />
      </button>
      <button
        className="state-layer flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface"
        title={maximized ? "Restaurer" : "Agrandir"}
        onClick={() => win.toggleMaximize()}
      >
        <Icon name={maximized ? "fullscreen_exit" : "crop_square"} size={14} />
      </button>
      <button
        className="state-layer flex h-8 w-8 items-center justify-center rounded-lg text-on-surface-variant hover:bg-error hover:text-on-error"
        title="Fermer"
        onClick={() => win.close()}
      >
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
