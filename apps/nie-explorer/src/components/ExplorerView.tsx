import { useEffect, useMemo, useState } from "react";
import { api, type FolderRole, type VfsEntry } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { humanSize } from "@/lib/bytes";
import { PINNED_PLACES, recordVisit, togglePin, useRecentPlaces, usePinnedPlaces } from "@/lib/places";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@/components/ui/Icon";
import { useT } from "@/lib/i18n";
import { DetailPane, type DetailTarget } from "@/components/DetailPane";

export interface ExplorerState {
  prefix: string;
  selected: string | null;
  /** Amorce la recherche (ex. palette de commandes Ctrl+K) — consommée une fois au montage. */
  query?: string;
}

type SortKey = "name" | "size";

/** Barre latérale « emplacements » — épingles fixes (cosmic-files) + récents par fréquence (yazi). */
function PlacesSidebar({ current, onGoto }: { current: string; onGoto: (prefix: string) => void }) {
  const t = useT();
  const recents = useRecentPlaces();
  const pins = usePinnedPlaces();

  return (
    <ScrollArea className="min-h-0 rounded-xl bg-surface-container-low elevation-1">
      <div className="flex flex-col gap-3 p-2">
        <div>
          <p className="px-2 pb-1 type-label-small text-on-surface-variant">{t("explorer.places")}</p>
          <div className="flex flex-col">
            {PINNED_PLACES.map((p) => (
              <button
                key={p.prefix}
                className={`state-layer flex items-center gap-2 rounded-lg px-2 py-1.5 text-left type-body-small ${
                  current === p.prefix ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"
                }`}
                onClick={() => onGoto(p.prefix)}
                title={p.prefix || "/"}
              >
                <Icon name={p.icon} size={15} className="shrink-0 text-on-surface-variant" />
                <span className="truncate">{p.label}</span>
              </button>
            ))}
          </div>
        </div>

        {pins.length > 0 && (
          <div>
            <p className="px-2 pb-1 type-label-small text-on-surface-variant">★</p>
            <div className="flex flex-col">
              {pins.map((prefix) => (
                <button
                  key={prefix}
                  className={`state-layer flex items-center gap-2 rounded-lg px-2 py-1.5 text-left type-body-small ${
                    current === prefix ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"
                  }`}
                  onClick={() => onGoto(prefix)}
                  title={prefix}
                >
                  <Icon name="stars" size={15} className="shrink-0 text-primary" />
                  <span className="truncate">{prefix.split("/").pop()}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {recents.length > 0 && (
          <div>
            <p className="px-2 pb-1 type-label-small text-on-surface-variant">{t("explorer.recents")}</p>
            <div className="flex flex-col">
              {recents.map((r) => (
                <button
                  key={r.prefix}
                  className={`state-layer flex items-center gap-2 rounded-lg px-2 py-1.5 text-left type-body-small ${
                    current === r.prefix ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"
                  }`}
                  onClick={() => onGoto(r.prefix)}
                  title={r.prefix}
                >
                  <Icon name="schedule" size={15} className="shrink-0 text-on-surface-variant" />
                  <span className="truncate">{r.prefix.split("/").pop()}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </ScrollArea>
  );
}

export function ExplorerView({
  state,
  onStateChange,
}: {
  state: ExplorerState;
  onStateChange: (s: ExplorerState) => void;
}) {
  const settings = useSettings();
  const t = useT();
  const [dirs, setDirs] = useState<string[]>([]);
  const [files, setFiles] = useState<VfsEntry[]>([]);
  const [role, setRole] = useState<FolderRole | null>(null);
  const [query, setQuery] = useState(state.query ?? "");

  // Requête poussée depuis l'extérieur (palette de commandes Ctrl+K) — l'onglet Explorateur
  // reste monté en permanence (Tabs ne démonte pas son contenu), donc un simple état initial
  // ne suffit pas : il faut resynchroniser à chaque nouvelle valeur de `state.query`.
  useEffect(() => {
    if (state.query !== undefined) setQuery(state.query);
  }, [state.query]);
  const [ext, setExt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const pins = usePinnedPlaces();

  const searching = query.trim().length > 0;

  useEffect(() => {
    setLoading(true);
    setError(null);
    const req = searching
      ? api.find(query.trim(), ext.trim() || undefined, 500, settings.gameDir).then((hits) => {
          setDirs([]);
          setFiles(hits);
          setRole(null);
        })
      : api.ls(state.prefix, settings.gameDir).then((r) => {
          setDirs(r.dirs);
          setFiles(r.files);
          setRole(r.role);
        });
    req.catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, [state.prefix, query, ext, settings.gameDir]);

  const sortedDirs = useMemo(() => [...dirs].sort((a, b) => a.localeCompare(b)), [dirs]);
  const sortedFiles = useMemo(() => {
    const arr = [...files];
    arr.sort((a, b) => (sortKey === "size" ? b.size - a.size : a.name.localeCompare(b.name)));
    return arr;
  }, [files, sortKey]);

  // Liste plate dossiers+fichiers pour la navigation clavier (haut/bas/entrée/retour, à la yazi).
  const flatEntries = useMemo(
    () => [
      ...sortedDirs.map((d) => ({ kind: "dir" as const, path: state.prefix ? `${state.prefix}/${d}` : d })),
      ...sortedFiles.map((f) => ({ kind: "file" as const, path: f.path })),
    ],
    [sortedDirs, sortedFiles, state.prefix],
  );

  const segments = state.prefix ? state.prefix.split("/") : [];

  function goto(prefix: string) {
    recordVisit(prefix);
    onStateChange({ prefix, selected: null });
  }

  // Ctrl+D « Add to sidebar » — raccourci réel de cosmic-files (confirmé sur capture du menu
  // File), adapté ici pour épingler le dossier COURANT (pas une sélection multi-fichiers).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        togglePin(state.prefix);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [state.prefix]);

  function onListKeyDown(e: React.KeyboardEvent) {
    if (searching || flatEntries.length === 0) return;
    const idx = flatEntries.findIndex((en) => en.path === state.selected);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown" ? Math.min(idx + 1, flatEntries.length - 1) : Math.max(idx - 1, 0);
      const entry = flatEntries[Math.max(next, 0)];
      if (entry.kind === "file") onStateChange({ ...state, selected: entry.path });
    } else if (e.key === "Enter" && idx >= 0) {
      const entry = flatEntries[idx];
      if (entry.kind === "dir") goto(entry.path);
    } else if (e.key === "Backspace") {
      goto(segments.slice(0, -1).join("/"));
    }
  }

  const target: DetailTarget | null = state.selected ? { kind: "vfs", path: state.selected } : null;

  return (
    <div className="grid h-full grid-cols-[180px_minmax(300px,1fr)_1.4fr] gap-3 p-3">
      <PlacesSidebar current={state.prefix} onGoto={goto} />

      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center gap-1 rounded-full bg-surface-container-high px-1 py-1">
          <Button
            size="icon"
            variant="ghost"
            title={t("explorer.root")}
            className="state-layer rounded-full text-on-surface-variant"
            onClick={() => goto("")}
          >
            <Icon name="home" size={16} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={t("explorer.parent")}
            className="state-layer rounded-full text-on-surface-variant"
            disabled={segments.length === 0}
            onClick={() => goto(segments.slice(0, -1).join("/"))}
          >
            <Icon name="arrow_back" size={16} />
          </Button>
          <nav className="flex min-w-0 flex-wrap items-center gap-0.5 type-body-small pr-2">
            {segments.map((seg, i) => (
              <span key={i} className="flex items-center gap-0.5">
                <button
                  className="state-layer rounded-md px-1.5 py-0.5 text-on-surface-variant hover:text-on-surface"
                  onClick={() => goto(segments.slice(0, i + 1).join("/"))}
                >
                  {seg}
                </button>
                <span className="text-outline">/</span>
              </span>
            ))}
          </nav>
          <div className="flex-1" />
          <Button
            size="icon"
            variant="ghost"
            title="Épingler à la barre latérale (Ctrl+D)"
            className={`state-layer rounded-full ${pins.includes(state.prefix) ? "text-primary" : "text-on-surface-variant"}`}
            onClick={() => togglePin(state.prefix)}
          >
            <Icon name="stars" size={16} />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title={sortKey === "name" ? t("explorer.sort_size") : t("explorer.sort_name")}
            className="state-layer rounded-full text-on-surface-variant"
            onClick={() => setSortKey((k) => (k === "name" ? "size" : "name"))}
          >
            <Icon name={sortKey === "name" ? "sort_by_alpha" : "table_rows"} size={16} />
          </Button>
        </div>

        <div className="flex gap-2">
          <Input
            placeholder={t("explorer.search_placeholder")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Input
            placeholder={t("explorer.ext_placeholder")}
            className="w-20"
            value={ext}
            onChange={(e) => setExt(e.target.value)}
          />
        </div>

        {error && <p className="type-body-small text-error">{error}</p>}

        {!searching && role && (
          <div className="rounded-xl bg-tertiary-container p-3 text-on-tertiary-container elevation-1">
            <p className="type-body-small leading-relaxed">{role.role}</p>
            <Badge variant="outline" className="mt-1.5 border-on-tertiary-container/30 text-on-tertiary-container">
              {role.status}
            </Badge>
          </div>
        )}

        <ScrollArea
          className="min-h-0 flex-1 rounded-xl bg-surface-container-low elevation-1"
          tabIndex={0}
          onKeyDown={onListKeyDown}
        >
          <div className="divide-y divide-outline-variant/30 py-1">
            {!searching &&
              sortedDirs.map((d) => (
                <button
                  key={d}
                  className="state-layer flex w-full items-center gap-2 px-3 py-2 text-left type-body-medium text-on-surface"
                  onDoubleClick={() => goto(state.prefix ? `${state.prefix}/${d}` : d)}
                  onClick={() => goto(state.prefix ? `${state.prefix}/${d}` : d)}
                >
                  <Icon name="folder" size={16} className="shrink-0 text-primary" />
                  <span className="truncate">{d}</span>
                </button>
              ))}
            {sortedFiles.map((f) => (
              <button
                key={f.path}
                className={`state-layer flex w-full items-center justify-between gap-2 px-3 py-2 text-left type-body-medium ${
                  state.selected === f.path
                    ? "bg-secondary-container text-on-secondary-container"
                    : "text-on-surface"
                }`}
                onClick={() => onStateChange({ ...state, selected: f.path })}
                title={f.path}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon name="description" size={16} className="shrink-0 text-on-surface-variant" />
                  <span className="truncate">{searching ? f.path : f.name}</span>
                </span>
                <span className="shrink-0 type-label-small text-on-surface-variant">{humanSize(f.size)}</span>
              </button>
            ))}
            {!loading && dirs.length === 0 && files.length === 0 && (
              <p className="p-4 type-body-small text-on-surface-variant">{t("explorer.empty")}</p>
            )}
          </div>
        </ScrollArea>
        <p className="type-label-small text-on-surface-variant">
          {loading
            ? t("explorer.loading")
            : searching
              ? t("explorer.results", { n: files.length })
              : t("explorer.count", { dirs: dirs.length, files: files.length })}
        </p>
      </div>

      <div className="min-h-0 overflow-hidden rounded-xl bg-surface-container-low elevation-1">
        <DetailPane target={target} />
      </div>
    </div>
  );
}
