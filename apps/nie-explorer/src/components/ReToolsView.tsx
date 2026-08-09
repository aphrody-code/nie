// Outils RE (reverse engineering) — cf. demande utilisatrice « niers est un outil de mod ET de
// re, garde ça en tête ». Deux sources : la base `var/niers.sqlite` (statique, HORS LIGNE, 248 Mo
// — ~113 000 fonctions labellisées + ~3 150 classes RTTI + ~507 000 xrefs, produites par `nie-re`
// en analysant un dump mémoire déjà capturé et le binaire désassemblé) et l'onglet **Live**
// (`nie-trace`, lecture SEULE de la mémoire vivante de `nie.exe`/`nie_eacpatched.exe` — décision
// utilisatrice tranchée, cf. `ROADMAP.md` §4.3/§5 et `src-tauri/src/re_trace.rs`).
import { useEffect, useState } from "react";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { useSettings } from "@/lib/settings";
import { reDb, defaultReDbPath, toStaticHex, type FunctionRow, type RttiClassRow, type XrefRow } from "@/lib/reDb";
import { api, type ReTraceDumpStats, type ReTraceProcess, type ReTraceRegion } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

type SubTab = "functions" | "classes" | "live";

/** Onglet « Live » — lecture directe de la mémoire du process en cours (lecture seule, jamais
 * d'écriture). Détection du process → liste des plages du module principal → lecture ponctuelle
 * d'octets à une adresse, ou dump complet des plages lisibles vers `AppData/re-dumps/`. */
function ReLiveView() {
  const [proc, setProc] = useState<ReTraceProcess | null | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [regions, setRegions] = useState<ReTraceRegion[]>([]);
  const [regionsError, setRegionsError] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [len, setLen] = useState("64");
  const [readResult, setReadResult] = useState<string | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [dumping, setDumping] = useState(false);
  const [dumpResult, setDumpResult] = useState<ReTraceDumpStats | null>(null);

  async function refresh() {
    setChecking(true);
    setRegions([]);
    setRegionsError(null);
    setDumpResult(null);
    try {
      const p = await api.reTraceFindProcess();
      setProc(p);
    } catch (e) {
      toast.error(String(e));
      setProc(null);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function loadRegions() {
    if (!proc) return;
    try {
      setRegions(await api.reTraceModuleRegions(proc.pid));
      setRegionsError(null);
    } catch (e) {
      setRegionsError(String(e));
    }
  }

  async function readBytes() {
    if (!proc || !addr.trim()) return;
    setReadError(null);
    setReadResult(null);
    try {
      const b64 = await api.reTraceReadBytesB64(proc.pid, addr.trim(), Number(len) || 64);
      const bin = atob(b64);
      let hex = "";
      for (let i = 0; i < bin.length; i++) hex += bin.charCodeAt(i).toString(16).padStart(2, "0") + (i % 16 === 15 ? "\n" : " ");
      setReadResult(hex.trim());
    } catch (e) {
      setReadError(String(e));
    }
  }

  async function dumpModule() {
    if (!proc) return;
    setDumping(true);
    try {
      setDumpResult(await api.reTraceDumpModule(proc.pid));
      toast.success("Dump terminé");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setDumping(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-auto p-3">
      <Alert>
        <AlertTitle>Lecture seule</AlertTitle>
        <AlertDescription>
          Cet onglet lit la mémoire vivante du process — aucune écriture. RE single-player offline d'un jeu possédé (accord RG-L5-VR-2026-001).
        </AlertDescription>
      </Alert>

      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={checking}>
          {checking ? "Recherche…" : "Rafraîchir"}
        </Button>
        {proc === undefined ? (
          <span className="type-body-small text-on-surface-variant">…</span>
        ) : proc === null ? (
          <span className="type-body-small text-on-surface-variant">Process introuvable — le jeu n'est pas lancé.</span>
        ) : (
          <span className="type-body-small text-on-surface">
            <Badge variant="outline">{proc.process_name}</Badge> pid {proc.pid}
            {proc.module_base && <span className="text-on-surface-variant"> · base {proc.module_base}</span>}
          </span>
        )}
      </div>

      {proc && (
        <>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void loadRegions()}>
              Lister les plages du module
            </Button>
            <Button size="sm" variant="outline" onClick={() => void dumpModule()} disabled={dumping}>
              {dumping ? "Dump…" : "Dumper les plages lisibles"}
            </Button>
          </div>
          {regionsError && <p className="type-body-small text-error">{regionsError}</p>}
          {dumpResult && (
            <p className="type-body-small text-on-surface-variant">
              {dumpResult.regions} plage(s), {dumpResult.bytes.toLocaleString("fr-FR")} o → {dumpResult.out_dir}
            </p>
          )}
          {regions.length > 0 && (
            <ScrollArea className="max-h-40 rounded-xl bg-surface-container-low elevation-1">
              <div className="divide-y divide-outline-variant/30">
                {regions.map((r, i) => (
                  <button
                    key={i}
                    className="state-layer flex w-full items-center gap-2 px-3 py-1 text-left font-mono type-label-small text-on-surface"
                    onClick={() => setAddr(r.start)}
                    title="Utiliser comme adresse de lecture"
                  >
                    <span>
                      {r.start} – {r.end}
                    </span>
                    <span className="text-on-surface-variant">
                      {r.perms} · {r.size.toLocaleString("fr-FR")} o
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          )}

          <div className="flex items-center gap-2">
            <Input placeholder="adresse 0x…" value={addr} onChange={(e) => setAddr(e.target.value)} className="w-48 font-mono" />
            <Input placeholder="octets" value={len} onChange={(e) => setLen(e.target.value)} className="w-24" />
            <Button size="sm" variant="outline" onClick={() => void readBytes()}>
              Lire
            </Button>
          </div>
          {readError && <p className="type-body-small text-error">{readError}</p>}
          {readResult && (
            <ScrollArea className="max-h-60 rounded-xl border border-outline-variant/40 bg-surface-container p-3">
              <pre className="whitespace-pre-wrap font-mono type-label-small text-on-surface">{readResult}</pre>
            </ScrollArea>
          )}
        </>
      )}
    </div>
  );
}

function XrefList({ title, rows, side }: { title: string; rows: XrefRow[]; side: "from_addr" | "to_addr" }) {
  return (
    <div>
      <p className="pb-1 type-label-small text-on-surface-variant">
        {title} ({rows.length})
      </p>
      <div className="flex flex-col gap-0.5">
        {rows.map((x, i) => (
          <span key={i} className="truncate font-mono type-label-small text-on-surface">
            {toStaticHex(x[side])} <span className="text-on-surface-variant">({x.kind})</span>
          </span>
        ))}
        {rows.length === 0 && <span className="type-label-small text-on-surface-variant">aucun</span>}
      </div>
    </div>
  );
}

export function ReToolsView() {
  const settings = useSettings();
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<SubTab>("functions");
  const [query, setQuery] = useState("");
  const [functions, setFunctions] = useState<FunctionRow[]>([]);
  const [classes, setClasses] = useState<RttiClassRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedFn, setSelectedFn] = useState<FunctionRow | null>(null);
  const [xrefs, setXrefs] = useState<{ callers: XrefRow[]; callees: XrefRow[] } | null>(null);

  // Édition des labels (§5 roadmap « l'onglet RE est 100 % lecture seule ») — id de la ligne en
  // cours de renommage (fonction OU classe, les deux listes n'ont jamais le même `id` affiché en
  // même temps puisque `subTab` bascule l'affichage) + valeur en cours de saisie.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");

  function startEdit(id: number, current: string) {
    setEditingId(id);
    setEditingValue(current);
  }

  async function commitEdit(kind: SubTab, id: number) {
    if (!dbPath) return;
    try {
      if (kind === "functions") {
        await reDb.renameFunction(dbPath, id, editingValue);
        setFunctions((prev) => prev.map((f) => (f.id === id ? { ...f, name: editingValue.trim() || null, name_source: "user-edit" } : f)));
        setSelectedFn((prev) => (prev?.id === id ? { ...prev, name: editingValue.trim() || null, name_source: "user-edit" } : prev));
      } else {
        await reDb.renameRttiClass(dbPath, id, editingValue);
        setClasses((prev) => prev.map((c) => (c.id === id ? { ...c, name: editingValue.trim() } : c)));
      }
      toast.success("Nom enregistré dans niers.sqlite");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setEditingId(null);
    }
  }

  useEffect(() => {
    defaultReDbPath(settings.gameDir)
      .then((p) => {
        setDbPath(p);
        setDbError(p ? null : "var/niers.sqlite introuvable sous la racine du jeu — base RE non générée sur ce poste.");
      })
      .catch((e) => setDbError(String(e)));
  }, [settings.gameDir]);

  useEffect(() => {
    if (!dbPath) return;
    setLoading(true);
    setError(null);
    const req = subTab === "functions" ? reDb.searchFunctions(dbPath, query).then(setFunctions) : reDb.searchRttiClasses(dbPath, query).then(setClasses);
    req.catch((e) => setError(String(e))).finally(() => setLoading(false));
  }, [dbPath, subTab, query]);

  async function selectFn(f: FunctionRow) {
    setSelectedFn(f);
    setXrefs(null);
    if (!dbPath) return;
    try {
      setXrefs(await reDb.xrefsFor(dbPath, f.vaddr));
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function copyAddr(vaddr: number) {
    await writeText(toStaticHex(vaddr));
    toast.success("Adresse copiée");
  }

  const tabsHeader = (
    <Tabs value={subTab} onValueChange={(v) => setSubTab(v as SubTab)}>
      <TabsList>
        <TabsTrigger value="functions">Fonctions</TabsTrigger>
        <TabsTrigger value="classes">Classes RTTI</TabsTrigger>
        <TabsTrigger value="live">Live</TabsTrigger>
      </TabsList>
    </Tabs>
  );

  if (subTab === "live") {
    return (
      <div className="flex h-full flex-col gap-2 p-3">
        {tabsHeader}
        <div className="min-h-0 flex-1">
          <ReLiveView />
        </div>
      </div>
    );
  }

  if (dbError) {
    return (
      <div className="p-4">
        <Alert>
          <AlertTitle>Base RE indisponible</AlertTitle>
          <AlertDescription>{dbError}</AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grid h-full grid-cols-[minmax(320px,1fr)_1fr] gap-3 p-3">
      <div className="flex min-h-0 flex-col gap-2">
        <div className="flex items-center gap-2">
          {tabsHeader}
          <Input
            placeholder={subTab === "functions" ? "Nom, sous-système, rôle, ou adresse 0x…" : "Nom de classe, namespace…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1"
          />
        </div>
        <p className="type-label-small text-on-surface-variant">
          {loading ? "chargement…" : subTab === "functions" ? `${functions.length.toLocaleString("fr-FR")} fonction(s)` : `${classes.length.toLocaleString("fr-FR")} classe(s)`}
        </p>
        {error && <p className="type-body-small text-error">{error}</p>}

        <ScrollArea className="min-h-0 flex-1 rounded-xl bg-surface-container-low elevation-1">
          <div className="divide-y divide-outline-variant/30">
            {subTab === "functions"
              ? functions.map((f) => (
                  <button
                    key={f.id}
                    className={`state-layer flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left type-body-medium ${
                      selectedFn?.id === f.id ? "bg-secondary-container text-on-secondary-container" : "text-on-surface"
                    }`}
                    onClick={() => selectFn(f)}
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="truncate font-mono">{f.name ?? `FUN_${f.vaddr.toString(16)}`}</span>
                      {f.subsystem && (
                        <Badge variant="outline" className="shrink-0">
                          {f.subsystem}
                        </Badge>
                      )}
                    </span>
                    <span className="type-label-small text-on-surface-variant">
                      {toStaticHex(f.vaddr)} · conf {(f.confidence * 100).toFixed(0)}% · {f.n_calls_in} in / {f.n_calls_out} out
                    </span>
                  </button>
                ))
              : classes.map((c) => (
                  <div key={c.id} className="flex flex-col gap-0.5 px-3 py-2 type-body-medium text-on-surface">
                    {editingId === c.id ? (
                      <span className="flex items-center gap-1">
                        <Input
                          autoFocus
                          className="h-7 flex-1 font-mono"
                          value={editingValue}
                          onChange={(e) => setEditingValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void commitEdit("classes", c.id);
                            if (e.key === "Escape") setEditingId(null);
                          }}
                        />
                        <Button size="sm" variant="ghost" onClick={() => commitEdit("classes", c.id)}>
                          ✓
                        </Button>
                      </span>
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="truncate font-mono">{c.name}</span>
                        {c.namespace && (
                          <Badge variant="outline" className="shrink-0">
                            {c.namespace}
                          </Badge>
                        )}
                        <button
                          className="ml-auto shrink-0 type-label-small text-on-surface-variant hover:underline"
                          onClick={() => startEdit(c.id, c.name)}
                          title="Renommer cette classe"
                        >
                          ✏️
                        </button>
                      </span>
                    )}
                    {c.vtable_vaddr != null && (
                      <button
                        className="w-fit type-label-small text-on-surface-variant hover:underline"
                        onClick={() => copyAddr(c.vtable_vaddr as number)}
                        title="Copier l'adresse de la vtable"
                      >
                        vtable {toStaticHex(c.vtable_vaddr)}
                      </button>
                    )}
                  </div>
                ))}
            {!loading && (subTab === "functions" ? functions.length === 0 : classes.length === 0) && (
              <p className="p-4 type-body-small text-on-surface-variant">Aucun résultat.</p>
            )}
          </div>
        </ScrollArea>
      </div>

      <div className="min-h-0 overflow-hidden rounded-xl bg-surface-container-low elevation-1">
        {!selectedFn ? (
          <div className="flex h-full items-center justify-center type-body-medium text-on-surface-variant">
            Sélectionnez une fonction pour voir ses xrefs.
          </div>
        ) : (
          <div className="flex h-full flex-col gap-3 p-4">
            <div>
              {editingId === selectedFn.id ? (
                <span className="flex items-center gap-1">
                  <Input
                    autoFocus
                    className="h-8 flex-1 font-mono"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void commitEdit("functions", selectedFn.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                  />
                  <Button size="sm" variant="ghost" onClick={() => commitEdit("functions", selectedFn.id)}>
                    ✓
                  </Button>
                </span>
              ) : (
                <h3 className="flex items-center gap-2 truncate type-title-small text-on-surface">
                  {selectedFn.name ?? `FUN_${selectedFn.vaddr.toString(16)}`}
                  <button
                    className="shrink-0 type-label-small text-on-surface-variant hover:underline"
                    onClick={() => startEdit(selectedFn.id, selectedFn.name ?? "")}
                    title="Renommer cette fonction"
                  >
                    ✏️
                  </button>
                </h3>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <button className="font-mono type-body-small text-on-surface-variant hover:underline" onClick={() => copyAddr(selectedFn.vaddr)}>
                  {toStaticHex(selectedFn.vaddr)}
                </button>
                {selectedFn.subsystem && <Badge variant="outline">{selectedFn.subsystem}</Badge>}
                {selectedFn.role && <Badge variant="outline">{selectedFn.role}</Badge>}
                {selectedFn.name_source && (
                  <Badge variant="secondary" title="Origine du nom (heuristique, RE manuel, propagation…)">
                    {selectedFn.name_source}
                  </Badge>
                )}
              </div>
              <p className="mt-1 type-body-small text-on-surface-variant">
                taille {selectedFn.size} octets · confiance {(selectedFn.confidence * 100).toFixed(0)}% · pagerank {selectedFn.pagerank.toFixed(4)}
              </p>
            </div>
            <ScrollArea className="min-h-0 flex-1 rounded-xl border border-outline-variant/40 bg-surface-container p-3">
              <div className="flex flex-col gap-4">
                {xrefs ? (
                  <>
                    <XrefList title="Appelants (callers)" rows={xrefs.callers} side="from_addr" />
                    <XrefList title="Appelés (callees)" rows={xrefs.callees} side="to_addr" />
                  </>
                ) : (
                  <p className="type-body-small text-on-surface-variant">chargement des xrefs…</p>
                )}
              </div>
            </ScrollArea>
            <Button size="sm" variant="outline" onClick={() => copyAddr(selectedFn.vaddr)}>
              Copier l'adresse statique
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
