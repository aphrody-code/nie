// Palette de commandes (Ctrl/Cmd+K) — saut instantané vers un emplacement, à la `zoxide`/yazi
// (frecency) ou au « Aller à » de cosmic-files, sans quitter le clavier.
import { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Icon } from "@/components/ui/Icon";
import { Shortcut } from "@/components/ui/shortcut";
import { PINNED_PLACES, useRecentPlaces } from "@/lib/places";
import { useT } from "@/lib/i18n";

export function CommandPalette({
  onGoto,
  onSearch,
}: {
  onGoto: (prefix: string) => void;
  onSearch: (query: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const recents = useRecentPlaces();

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  function pick(action: () => void) {
    action();
    setOpen(false);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="niers" description="Aller à…">
      <CommandInput placeholder="Aller à… (dossier, ou Entrée pour chercher dans le VFS)" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>
          {query.trim() ? (
            <button
              className="flex w-full items-center gap-2 px-2 py-1.5 type-body-small text-on-surface-variant"
              onClick={() => pick(() => onSearch(query.trim()))}
            >
              <Icon name="search" size={14} />
              Chercher « {query.trim()} » dans le VFS
            </button>
          ) : (
            "Aucun résultat."
          )}
        </CommandEmpty>
        <CommandGroup heading={t("explorer.places")}>
          {PINNED_PLACES.map((p) => (
            <CommandItem key={p.prefix} value={`${p.label} ${p.prefix}`} onSelect={() => pick(() => onGoto(p.prefix))}>
              <Icon name={p.icon} size={15} className="text-on-surface-variant" />
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
        {recents.length > 0 && (
          <CommandGroup heading={t("explorer.recents")}>
            {recents.map((r) => (
              <CommandItem key={r.prefix} value={r.prefix} onSelect={() => pick(() => onGoto(r.prefix))}>
                <Icon name="schedule" size={15} className="text-on-surface-variant" />
                {r.prefix}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
      </CommandList>
      {/* Pied de palette avec rappel de raccourcis — `Shortcut` porté de
       * `spaceui/primitives/Shortcut.tsx` (spacedrive), cf. components/ui/shortcut.tsx. */}
      <div className="flex items-center justify-end gap-3 border-t border-outline-variant/30 px-3 py-1.5 type-label-small text-on-surface-variant">
        <span className="flex items-center gap-1">
          <Shortcut chars="↵" /> ouvrir
        </span>
        <span className="flex items-center gap-1">
          <Shortcut chars="Échap" /> fermer
        </span>
      </div>
    </CommandDialog>
  );
}
