import { useState } from "react";
import { api, type VfsEntry } from "@/lib/api";
import { vfsIndexDb } from "@/lib/vfsIndexDb";
import { wikiDb } from "@/lib/wikiDb";
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { Input } from "@niers/inacord-ui/components/ui/input";
import { Button } from "@niers/inacord-ui/components/ui/button";
import { Badge } from "@niers/inacord-ui/components/ui/badge";
import { ScrollArea } from "@niers/inacord-ui/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@niers/inacord-ui/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@niers/inacord-ui/components/ui/alert";
import { humanSize } from "@/lib/bytes";

type Kind = "chara" | "waza";

/** Display shape returned by the Rust wiki mirror query. */
interface Row {
  source: "local";
  id: string;
  internal_code: string | null;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  element: string | null;
  position: string | null;
  category: string | null;
  is_hyper: boolean;
}

export function SearchView({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const settings = useSettings();
  const [kind, setKind] = useState<Kind>("chara");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const [related, setRelated] = useState<Record<string, VfsEntry[]>>({});
  const [notices, setNotices] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function run() {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setNotices([]);
    setResults([]);
    setRelated({});
    const rows: Row[] = [];
    const notes: string[] = [];

    // The Rust-owned local mirror is the only IEVR source.
    if (settings.wikiDb.trim()) {
      try {
        if (kind === "chara") {
          const r = await wikiDb.searchCharacter(settings.wikiDb, q);
          for (const c of r) {
            rows.push({
              source: "local",
              id: c.id,
              internal_code: c.internal_code,
              name_fr: c.name_fr,
              name_en: c.name_en,
              name_ja: c.name_ja,
              element: c.element,
              position: c.position,
              category: null,
              is_hyper: false,
            });
          }
        } else {
          const r = await wikiDb.searchSkill(settings.wikiDb, q);
          for (const s of r) {
            rows.push({
              source: "local",
              id: s.id,
              internal_code: s.internal_code,
              name_fr: s.name_fr,
              name_en: s.name_en,
              name_ja: s.name_ja,
              element: s.element,
              position: null,
              category: s.category,
              is_hyper: !!s.is_hyper,
            });
          }
        }
      } catch (e) {
        notes.push(`miroir local : ${e}`);
      }
    }

    setResults(rows);
    setNotices(notes);
    setLoading(false);
  }

  async function loadRelated(code: string) {
    if (related[code]) return;
    // Index SQL précis (`code = ? OR code LIKE ?_%`) si construit (Paramètres → Réindexer) —
    // sinon repli sur le `.contains()` substring en mémoire (moins précis mais sans prérequis).
    try {
      const meta = await vfsIndexDb.meta();
      if (meta && meta.total > 0) {
        const rows = await vfsIndexDb.related(code, 60);
        setRelated((r) => ({ ...r, [code]: rows.map((row) => ({ path: row.path, name: row.name, size: row.size, cpk: row.cpk })) }));
        return;
      }
    } catch {
      // index absent/corrompu → repli silencieux sur la recherche substring ci-dessous
    }
    try {
      const hits = await api.related(code, 60, settings.gameDir);
      setRelated((r) => ({ ...r, [code]: hits }));
    } catch {
      setRelated((r) => ({ ...r, [code]: [] }));
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={kind} onValueChange={(v) => setKind(v as Kind)}>
          <TabsList>
            <TabsTrigger value="chara">Personnage</TabsTrigger>
            <TabsTrigger value="waza">Technique (waza)</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          className="max-w-sm flex-1"
          placeholder="Nom (FR/EN/JA), ID ou code interne…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
        />
        <Button onClick={run} disabled={loading}>
          Chercher
        </Button>
      </div>

      {notices.map((n) => (
        <Alert key={n} variant="destructive">
          <AlertTitle>Source indisponible</AlertTitle>
          <AlertDescription>{n}</AlertDescription>
        </Alert>
      ))}

      <ScrollArea className="min-h-0 flex-1 rounded-2xl border border-app-line bg-app-dark-box">
        <div className="flex flex-col gap-2 p-2">
          {results.map((r, i) => {
            const code = r.internal_code ?? "";
            return (
              <div
                key={`${r.source}-${r.id}-${i}`}
                className="rounded-lg border border-app-line bg-app-box p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="type-title-small text-on-surface">{r.name_fr ?? r.name_en ?? r.name_ja ?? "?"}</span>
                  {r.name_en && <span className="type-body-small text-on-surface-variant">{r.name_en}</span>}
                  <Badge variant="secondary">local Rust mirror</Badge>
                  {r.is_hyper && <Badge>hyper</Badge>}
                  {r.element && <Badge variant="outline">{r.element}</Badge>}
                  {r.position && <Badge variant="outline">{r.position}</Badge>}
                  {r.category && <Badge variant="outline">{r.category}</Badge>}
                </div>
                <p className="mt-1 type-body-small text-on-surface-variant">
                  ID {r.id} {code && <>· code {code}</>}
                </p>
                {code && (
                  <div className="mt-2">
                    <Button size="sm" variant="outline" onClick={() => loadRelated(code)}>
                      Fichiers VFS liés
                    </Button>
                    {related[code] && (
                      <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto rounded-lg border border-app-line bg-surface-container-low p-1 font-mono text-[11px]">
                        {related[code].length === 0 && <li className="text-on-surface-variant">aucun fichier trouvé</li>}
                        {related[code].map((f) => (
                          <li key={f.path}>
                            <button
                              className="state-layer w-full truncate rounded px-1 text-left text-on-surface hover:underline"
                              onClick={() => onOpenFile(f.path)}
                            >
                              {f.path} <span className="text-on-surface-variant">({humanSize(f.size)})</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {!loading && results.length === 0 && notices.length === 0 && (
            <p className="p-3 type-body-medium text-on-surface-variant">Aucun résultat pour l'instant.</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
