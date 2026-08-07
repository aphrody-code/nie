import { useEffect, useState } from "react";
import { api, type FolderRole, type VfsEntry } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { humanSize } from "@/lib/bytes";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DetailPane, type DetailTarget } from "@/components/DetailPane";

export interface ExplorerState {
  prefix: string;
  selected: string | null;
}

export function ExplorerView({
  state,
  onStateChange,
}: {
  state: ExplorerState;
  onStateChange: (s: ExplorerState) => void;
}) {
  const settings = useSettings();
  const [dirs, setDirs] = useState<string[]>([]);
  const [files, setFiles] = useState<VfsEntry[]>([]);
  const [role, setRole] = useState<FolderRole | null>(null);
  const [query, setQuery] = useState("");
  const [ext, setExt] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const segments = state.prefix ? state.prefix.split("/") : [];

  function goto(prefix: string) {
    onStateChange({ prefix, selected: null });
  }

  const target: DetailTarget | null = state.selected ? { kind: "vfs", path: state.selected } : null;

  return (
    <div className="grid h-full grid-cols-[minmax(280px,1fr)_1.4fr] gap-3 p-3">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" title="Racine" onClick={() => goto("")}>
            🏠
          </Button>
          <Button
            size="icon"
            variant="ghost"
            title="Dossier parent"
            disabled={segments.length === 0}
            onClick={() => goto(segments.slice(0, -1).join("/"))}
          >
            ⬆️
          </Button>
          <nav className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs">
            {segments.map((seg, i) => (
              <span key={i} className="flex items-center gap-0.5">
                <button className="rounded px-1 py-0.5 hover:bg-accent" onClick={() => goto(segments.slice(0, i + 1).join("/"))}>
                  {seg}
                </button>
                <span className="text-muted-foreground">/</span>
              </span>
            ))}
          </nav>
        </div>

        <div className="flex gap-2">
          <Input placeholder="Rechercher (sous-chaîne)…" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Input placeholder="ext" className="w-20" value={ext} onChange={(e) => setExt(e.target.value)} />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        {!searching && role && (
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            <p>{role.role}</p>
            <Badge variant="outline" className="mt-1">
              {role.status}
            </Badge>
          </div>
        )}

        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          <div className="divide-y">
            {!searching &&
              dirs.map((d) => (
                <button
                  key={d}
                  className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent"
                  onDoubleClick={() => goto(state.prefix ? `${state.prefix}/${d}` : d)}
                  onClick={() => goto(state.prefix ? `${state.prefix}/${d}` : d)}
                >
                  <span>📁</span>
                  <span className="truncate">{d}</span>
                </button>
              ))}
            {files.map((f) => (
              <button
                key={f.path}
                className={`flex w-full items-center justify-between gap-2 px-2 py-1.5 text-left text-sm hover:bg-accent ${
                  state.selected === f.path ? "bg-accent" : ""
                }`}
                onClick={() => onStateChange({ ...state, selected: f.path })}
                title={f.path}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span>📄</span>
                  <span className="truncate">{searching ? f.path : f.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{humanSize(f.size)}</span>
              </button>
            ))}
            {!loading && dirs.length === 0 && files.length === 0 && (
              <p className="p-3 text-sm text-muted-foreground">Aucune entrée.</p>
            )}
          </div>
        </ScrollArea>
        <p className="text-xs text-muted-foreground">
          {loading ? "chargement…" : searching ? `${files.length} résultat(s)` : `${dirs.length} dossier(s), ${files.length} fichier(s)`}
        </p>
      </div>

      <div className="min-h-0 rounded-md border">
        <DetailPane target={target} />
      </div>
    </div>
  );
}
