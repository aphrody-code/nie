// Navigateur de contenu — le bandeau bas d'un éditeur type Unreal : arborescence à gauche, grille
// de vignettes à droite, filtre par type d'asset.
//
// Il navigue le MÊME VFS que l'Explorateur (`api.ls`, ~255 800 fichiers) : ce n'est pas une
// seconde base d'assets, juste une présentation orientée « choisir quelque chose à ouvrir dans le
// viewport » plutôt que « inspecter un fichier ». Les vignettes de textures réutilisent
// `api.texturePngB64` (décodage déjà instantané) avec un cache module-level, exactement comme la
// vue grille de l'Explorateur.
import { useEffect, useMemo, useRef, useState } from "react";

import { Icon } from "@/components/ui/Icon";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { humanSize } from "@/lib/bytes";
import { showVfsFileContextMenu, showVfsFolderContextMenu } from "@/lib/contextMenu";
import { useSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

/** Familles d'assets — le filtre qu'un éditeur propose (Unreal : Static Mesh / Texture / Audio…). */
type AssetFilter = "all" | "models" | "textures" | "audio" | "configs";

const FILTER_LABELS: Record<AssetFilter, string> = {
  all: "Tout",
  models: "Modèles",
  textures: "Textures",
  audio: "Audio",
  configs: "Configs",
};

const MODEL_EXTS = new Set(["g4md", "g4mg", "g4pkm", "g4sk", "g4mt", "g4ma"]);
const TEXTURE_EXTS = new Set(["g4tx", "png", "dds"]);
const AUDIO_EXTS = new Set(["acb", "awb", "hca", "adx"]);

function extOf(name: string): string {
  return name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
}

function matchesFilter(name: string, filter: AssetFilter): boolean {
  if (filter === "all") return true;
  const ext = extOf(name);
  if (filter === "models") return MODEL_EXTS.has(ext);
  if (filter === "textures") return TEXTURE_EXTS.has(ext);
  if (filter === "audio") return AUDIO_EXTS.has(ext);
  return name.toLowerCase().endsWith(".cfg.bin");
}

function iconFor(name: string): string {
  const ext = extOf(name);
  if (MODEL_EXTS.has(ext)) return "view_in_ar";
  if (TEXTURE_EXTS.has(ext)) return "image";
  if (AUDIO_EXTS.has(ext)) return "volume_up";
  if (name.toLowerCase().endsWith(".cfg.bin")) return "database";
  if (ext === "usm") return "movie";
  return "description";
}

/** Cache de vignettes partagé entre remontages (même principe que la vue grille de l'Explorateur). */
const thumbCache = new Map<string, string | null>();

function Thumb({ path, name, gameDir }: { path: string; name: string; gameDir?: string }) {
  const [src, setSrc] = useState<string | null>(thumbCache.get(path) ?? null);
  const [visible, setVisible] = useState(thumbCache.has(path));
  const ref = useRef<HTMLDivElement | null>(null);
  const isTexture = TEXTURE_EXTS.has(extOf(name));

  useEffect(() => {
    if (visible || !isTexture || !ref.current) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "150px" },
    );
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [visible, isTexture]);

  useEffect(() => {
    if (!visible || !isTexture || thumbCache.has(path)) return;
    let cancelled = false;
    api
      .texturePngB64(path, gameDir)
      .then((b64) => {
        if (cancelled) return;
        const url = `data:image/png;base64,${b64}`;
        thumbCache.set(path, url);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) thumbCache.set(path, null);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, isTexture, path, gameDir]);

  return (
    <div ref={ref} className="flex h-14 w-full items-center justify-center overflow-hidden rounded bg-app-darker-box">
      {src ? (
        <img src={src} alt="" className="h-full w-full object-contain" />
      ) : (
        <Icon name={iconFor(name)} size={22} className="text-ink-faint" />
      )}
    </div>
  );
}

export interface ContentBrowserProps {
  prefix: string;
  onNavigate: (prefix: string) => void;
  selected: string | null;
  onSelect: (path: string) => void;
  className?: string;
}

export function ContentBrowser({ prefix, onNavigate, selected, onSelect, className }: ContentBrowserProps) {
  const settings = useSettings();
  const [dirs, setDirs] = useState<string[]>([]);
  const [files, setFiles] = useState<{ path: string; name: string; size: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AssetFilter>("all");
  const [query, setQuery] = useState("");
  const seq = useRef(0);

  useEffect(() => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    api
      .ls(prefix, settings.gameDir)
      .then((r) => {
        if (mine !== seq.current) return;
        setDirs(r.dirs);
        setFiles(r.files);
      })
      .catch((e) => mine === seq.current && setError(String(e)))
      .finally(() => mine === seq.current && setLoading(false));
  }, [prefix, settings.gameDir]);

  const segments = prefix ? prefix.split("/") : [];
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => matchesFilter(f.name, filter) && (!q || f.name.toLowerCase().includes(q)));
  }, [files, filter, query]);

  return (
    <div className={cn("flex min-h-0 flex-col bg-app-dark-box", className)}>
      {/* Barre d'outils du navigateur */}
      <div className="flex shrink-0 items-center gap-2 border-b border-app-line px-2 py-1.5">
        <button
          type="button"
          className="rounded p-1 text-ink-dull transition-colors hover:bg-app-hover hover:text-ink disabled:opacity-40"
          disabled={segments.length === 0}
          onClick={() => onNavigate(segments.slice(0, -1).join("/"))}
          title="Dossier parent"
          aria-label="Dossier parent"
        >
          <Icon name="arrow_back" size={14} />
        </button>
        <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-tiny">
          <button
            type="button"
            className="rounded px-1 py-0.5 text-ink-faint transition-colors hover:bg-app-hover hover:text-ink"
            onClick={() => onNavigate("")}
          >
            /
          </button>
          {segments.map((seg, i) => (
            <span key={i} className="flex shrink-0 items-center gap-0.5">
              <button
                type="button"
                className="rounded px-1 py-0.5 text-ink-dull transition-colors hover:bg-app-hover hover:text-ink"
                onClick={() => onNavigate(segments.slice(0, i + 1).join("/"))}
              >
                {seg}
              </button>
              <span className="text-ink-faint">/</span>
            </span>
          ))}
        </nav>
        <Input
          placeholder="Filtrer…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-6 w-40 shrink-0 text-xs"
        />
        <ToggleGroup
          value={[filter]}
          onValueChange={(v) => v[0] && setFilter(v[0] as AssetFilter)}
          className="shrink-0"
        >
          {(Object.keys(FILTER_LABELS) as AssetFilter[]).map((f) => (
            <ToggleGroupItem key={f} value={f} className="px-2 text-tiny">
              {FILTER_LABELS[f]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="shrink-0 text-tiny text-ink-faint">
          {loading ? "…" : `${shown.length}/${files.length}`}
        </span>
      </div>

      {error && <p className="px-2 py-1 text-tiny text-status-error">{error}</p>}

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
        {/* Dossiers d'abord, comme tout navigateur d'assets */}
        {dirs.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {dirs.map((d) => {
              const path = prefix ? `${prefix}/${d}` : d;
              return (
                <button
                  key={d}
                  type="button"
                  className="flex items-center gap-1.5 rounded border border-app-line bg-app-box px-2 py-1 text-tiny text-ink-dull transition-colors hover:bg-app-hover hover:text-ink"
                  onClick={() => onNavigate(path)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    showVfsFolderContextMenu({ path, onOpen: () => onNavigate(path) });
                  }}
                >
                  <Icon name="folder" size={13} className="text-accent" />
                  {d}
                </button>
              );
            })}
          </div>
        )}

        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(88px,1fr))" }}>
          {shown.map((f) => (
            <button
              key={f.path}
              type="button"
              className={cn(
                "flex flex-col gap-1 rounded-md border p-1.5 text-left transition-colors",
                selected === f.path
                  ? "border-accent bg-accent/15"
                  : "border-transparent hover:border-app-line hover:bg-app-hover",
              )}
              onClick={() => onSelect(f.path)}
              onContextMenu={(e) => {
                e.preventDefault();
                showVfsFileContextMenu({
                  path: f.path,
                  name: f.name,
                  size: f.size,
                  gameDir: settings.gameDir,
                  blenderExe: settings.blenderExe,
                  onOpen: () => onSelect(f.path),
                });
              }}
              title={`${f.path}\n${humanSize(f.size)}`}
            >
              <Thumb path={f.path} name={f.name} gameDir={settings.gameDir} />
              <span className="w-full truncate text-tiny text-ink-dull">{f.name}</span>
            </button>
          ))}
        </div>

        {!loading && shown.length === 0 && dirs.length === 0 && (
          <p className="p-3 text-tiny text-ink-faint">Dossier vide (ou tout filtré).</p>
        )}
      </div>
    </div>
  );
}
