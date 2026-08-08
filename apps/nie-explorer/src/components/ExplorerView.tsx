import { useEffect, useMemo, useState } from "react";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { api, type FolderRole, type RawCpkEntry } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { humanSize } from "@/lib/bytes";
import { PINNED_PLACES, recordVisit, togglePin, useRecentPlaces, usePinnedPlaces } from "@/lib/places";
import { codeOf } from "@/lib/vfsIndexDb";
import { useResolvedNames } from "@/lib/nameResolve";
import { showVfsFileContextMenu, showVfsFolderContextMenu, showRawCpkFileContextMenu } from "@/lib/contextMenu";
import { registerFileOps } from "@/lib/editBus";
import { modsDb } from "@/lib/modsDb";
import { stageReplacementFromPath } from "@/lib/modWorkspace";
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

/** Ligne de fichier affichée — VFS normal, ou entrée d'un `.cpk` ouvert hors VFS (`entryIndex`
 * présent) quand la navigation est descendue dans `data/packs/*.cpk` (vue fusionnée, cf. demande
 * utilisatrice « il faut fusionner le vfs viewer et raw packs cpk viewer »). */
interface Row {
  path: string;
  name: string;
  size: number;
  entryIndex?: number;
}

/** Détecte si `prefix` est descendu à l'intérieur d'un `.cpk` (tout segment se terminant par
 * `.cpk`) — au-delà de ce segment, la navigation ne porte plus sur le VFS mais sur les entrées
 * RÉELLES du fichier `.cpk` physique, lues directement via `CpkReader` (cf. `open_raw_cpk`). */
function detectCpkBoundary(prefix: string): { cpkVfsPrefix: string; inner: string } | null {
  const segs = prefix.split("/").filter(Boolean);
  const idx = segs.findIndex((s) => s.toLowerCase().endsWith(".cpk"));
  if (idx === -1) return null;
  return { cpkVfsPrefix: segs.slice(0, idx + 1).join("/"), inner: segs.slice(idx + 1).join("/") };
}

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
  const [files, setFiles] = useState<Row[]>([]);
  const [role, setRole] = useState<FolderRole | null>(null);
  // Cache du `.cpk` brut actuellement ouvert (vue fusionnée VFS/CPK) — évite de relire tout le
  // fichier à chaque sous-dossier visité À L'INTÉRIEUR du même `.cpk` (`open_raw_cpk` relit le
  // fichier entier + reparse la table des matières à chaque appel côté Rust).
  const [cpkEntries, setCpkEntries] = useState<RawCpkEntry[]>([]);
  const [openedCpkPrefix, setOpenedCpkPrefix] = useState<string | null>(null);
  const cpkBoundary = useMemo(() => detectCpkBoundary(state.prefix), [state.prefix]);
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
  // Multi-sélection RÉELLE (Ctrl/Shift-clic, comme l'explorateur Windows) — cf. demande
  // utilisatrice « editer doit vraiment copier coller et tout select les fichiers dossiers pas
  // du texte » : les `PredefinedMenuItem` Copy/SelectAll de Tauri sont des commandes texte de
  // l'OS, sans effet sur une liste HTML custom. `state.selected` reste la cible d'aperçu
  // (`DetailPane`, le dernier élément touché) ; `multiSelected` porte le surlignage + les
  // opérations groupées (Ctrl+A/Ctrl+C, menu Édition natif).
  const [multiSelected, setMultiSelected] = useState<Set<string>>(new Set());
  // Ancre de la sélection par plage (Shift-clic) sur les DOSSIERS, séparée de `state.selected` :
  // contrairement aux fichiers, un clic simple sur un dossier NAVIGUE (`goto`) plutôt que de le
  // "sélectionner" pour l'aperçu — piggy-backer sur `state.selected` ferait croire à `DetailPane`
  // qu'un dossier est un fichier VFS ciblé (échec d'aperçu silencieux mais trompeur).
  const [folderAnchor, setFolderAnchor] = useState<string | null>(null);

  // Recherche VFS globale non disponible À L'INTÉRIEUR d'un `.cpk` ouvert (portée volontairement
  // limitée pour cette fusion — la recherche continue de fonctionner normalement partout ailleurs).
  const searching = query.trim().length > 0 && !cpkBoundary;

  useEffect(() => {
    setLoading(true);
    setError(null);

    if (cpkBoundary) {
      // Vue fusionnée : à l'intérieur d'un `.cpk`, on liste ses VRAIES entrées (pas le VFS) —
      // cf. demande utilisatrice « il faut fusionner le vfs viewer et raw packs cpk viewer ».
      (async () => {
        let entries = cpkEntries;
        if (openedCpkPrefix !== cpkBoundary.cpkVfsPrefix) {
          const gameDir = settings.gameDir || (await api.defaultGameDir());
          const absPath = `${gameDir.replace(/[\\/]+$/, "")}/${cpkBoundary.cpkVfsPrefix}`;
          entries = await api.rawCpkOpen(absPath);
          setCpkEntries(entries);
          setOpenedCpkPrefix(cpkBoundary.cpkVfsPrefix);
        }
        const inner = cpkBoundary.inner;
        const dirSet = new Set<string>();
        const fileRows: Row[] = [];
        for (const e of entries) {
          let rest: string;
          if (inner === "") rest = e.path;
          else if (e.path === inner) continue;
          else if (e.path.startsWith(`${inner}/`)) rest = e.path.slice(inner.length + 1);
          else continue;
          const slash = rest.indexOf("/");
          if (slash === -1) {
            fileRows.push({ path: `${state.prefix}/${rest}`, name: rest, size: e.size, entryIndex: e.index });
          } else {
            dirSet.add(rest.slice(0, slash));
          }
        }
        setDirs([...dirSet].sort((a, b) => a.localeCompare(b)));
        setFiles(fileRows);
        setRole(null);
      })()
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
      return;
    }

    if (state.prefix === "data/packs") {
      // `data/packs` : le VFS n'expose JAMAIS les conteneurs `.cpk` eux-mêmes comme entrées
      // navigables (seuls les chemins internes du jeu le sont) — pont vers les VRAIS fichiers
      // physiques, chacun cliquable comme un dossier pour descendre dedans (cf. `cpkBoundary`
      // ci-dessus). Cf. demande utilisatrice « data\packs n'est pas préchargé ».
      api
        .listPacksDir(settings.gameDir)
        .then((packs) => {
          setDirs(packs.map((p) => p.name));
          setFiles([]);
          setRole(null);
        })
        .catch((e) => setError(String(e)))
        .finally(() => setLoading(false));
      return;
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.prefix, query, ext, settings.gameDir, cpkBoundary, openedCpkPrefix]);

  const sortedDirs = useMemo(() => [...dirs].sort((a, b) => a.localeCompare(b)), [dirs]);
  // Chemins pleins des dossiers, dans l'ordre affiché — sert à la fois à Ctrl+A (`doSelectAll`)
  // et à la sélection par plage Shift-clic sur les dossiers (même mécanique que `sortedFiles`).
  const dirPaths = useMemo(() => (searching ? [] : sortedDirs.map((d) => (state.prefix ? `${state.prefix}/${d}` : d))), [searching, sortedDirs, state.prefix]);
  const sortedFiles = useMemo(() => {
    const arr = [...files];
    arr.sort((a, b) => (sortKey === "size" ? b.size - a.size : a.name.localeCompare(b.name)));
    return arr;
  }, [files, sortKey]);

  // Nom réel (perso/technique/objet) lié à chaque fichier, résolu par lot via le miroir wiki
  // local — cf. demande utilisatrice « affiche le nom... lié à un fichier au lieu de juste l'id ».
  const fileCodes = useMemo(() => sortedFiles.map((f) => codeOf(f.name)), [sortedFiles]);
  const resolved = useResolvedNames(settings.wikiDb, fileCodes);

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
    setMultiSelected(new Set());
    setFolderAnchor(null);
    onStateChange({ prefix, selected: null });
  }

  /** Ctrl+A — sélectionne TOUT le dossier/résultat courant (dossiers + fichiers), comme
   * l'explorateur Windows, pas juste le texte visible. */
  function doSelectAll() {
    const filePaths = sortedFiles.map((f) => f.path);
    const all = [...dirPaths, ...filePaths];
    if (all.length === 0) return;
    setMultiSelected(new Set(all));
    toast.success(`${all.length.toLocaleString("fr-FR")} élément(s) sélectionné(s)`);
  }

  /** Ctrl+C — copie les chemins de la sélection (multi ou simple) dans le presse-papiers. */
  function doCopySelection() {
    const paths = multiSelected.size > 0 ? [...multiSelected] : state.selected ? [state.selected] : [];
    if (paths.length === 0) {
      toast.error("Rien à copier — sélectionnez d'abord un fichier ou un dossier");
      return;
    }
    writeText(paths.join("\n")).then(() => toast.success(`${paths.length} chemin(s) copié(s)`));
  }

  /** Ctrl+V — VRAI collage (cf. demande utilisatrice « editer doit vraiment copier coller »),
   * pas un simple message : le VFS est en lecture seule (aucun encodeur CPK), donc "coller" veut
   * dire "proposer le fichier du presse-papiers comme remplacement" — le même mécanisme que
   * « Ajouter à un mod… », juste sans repasser par le sélecteur natif puisqu'on a déjà un chemin.
   * Le presse-papiers Tauri ne porte que du TEXTE (pas de CF_HDROP de fichiers Windows) : on
   * n'accepte donc que le cas où il contient un chemin de fichier réel existant sur disque — ex.
   * un chemin copié depuis l'Explorateur Windows, ou depuis notre propre Ctrl+C (`doCopySelection`,
   * qui écrit déjà des chemins en texte). Cible = le fichier VFS actuellement sélectionné ; mod =
   * le plus récent (`listMods()` trie déjà par priorité/date), créé à la volée s'il n'y en a aucun.
   */
  async function doPaste() {
    if (!state.selected) {
      toast.error("Sélectionnez d'abord un fichier VFS à remplacer");
      return;
    }
    const clip = (await readText().catch(() => null))?.trim();
    if (!clip || clip.includes("\n") || !(await api.diskFileExists(clip).catch(() => false))) {
      toast.message("Rien à coller.", {
        description: "Le presse-papiers doit contenir le chemin d'UN fichier existant sur disque (copié depuis l'Explorateur Windows, par ex.).",
      });
      return;
    }
    try {
      const mods = await modsDb.listMods();
      const modId = mods[0]?.id ?? (await modsDb.createMod("Presse-papiers", "Créé automatiquement par Ctrl+V"));
      const modName = mods[0]?.name ?? "Presse-papiers";
      const ok = await stageReplacementFromPath(modId, { kind: "vfs", path: state.selected }, clip, settings.gameDir);
      if (ok) toast.success(`Collé dans le mod « ${modName} »`, { description: state.selected });
    } catch (e) {
      toast.error(String(e));
    }
  }

  useEffect(() => {
    registerFileOps({ selectAll: doSelectAll, copySelection: doCopySelection, paste: doPaste });
    return () => registerFileOps(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiSelected, state.selected, sortedDirs, sortedFiles, state.prefix, searching]);

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

  // Ctrl+A/Ctrl+C : gérés par l'accélérateur RÉEL du menu natif « Édition » (`App.tsx`, via
  // `editBus`), pas ici — un accélérateur de menu natif est global (fonctionne même si la liste
  // n'a pas le focus DOM), donc un doublon local ferait potentiellement doubler l'action.
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

  // Résout le type de cible depuis la ligne réellement sélectionnée : `entryIndex` présent =
  // entrée d'un `.cpk` brut (vue fusionnée), sinon un chemin VFS normal.
  const selectedRow = sortedFiles.find((f) => f.path === state.selected) ?? null;
  const target: DetailTarget | null = !state.selected
    ? null
    : selectedRow?.entryIndex !== undefined
      ? { kind: "raw_cpk", path: state.selected, entryIndex: selectedRow.entryIndex }
      : { kind: "vfs", path: state.selected };

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
              sortedDirs.map((d) => {
                const path = state.prefix ? `${state.prefix}/${d}` : d;
                const isMultiSelected = multiSelected.has(path);
                return (
                  <button
                    key={d}
                    className={`state-layer flex w-full items-center gap-2 px-3 py-2 text-left type-body-medium ${
                      isMultiSelected ? "bg-primary-container/40 text-on-surface" : "text-on-surface"
                    }`}
                    onDoubleClick={() => goto(path)}
                    onClick={(e) => {
                      if (e.ctrlKey || e.metaKey) {
                        setMultiSelected((prev) => {
                          const next = new Set(prev);
                          if (next.has(path)) next.delete(path);
                          else next.add(path);
                          return next;
                        });
                        setFolderAnchor(path);
                      } else if (e.shiftKey && folderAnchor) {
                        // Sélection par plage (comme les fichiers ci-dessous), ancrée sur le dernier
                        // dossier Ctrl/Shift-cliqué de CETTE liste (`folderAnchor`) — si l'ancre ne
                        // s'y trouve plus (ex. après navigation), on retombe sur une sélection simple.
                        const idxA = dirPaths.indexOf(folderAnchor);
                        const idxB = dirPaths.indexOf(path);
                        if (idxA !== -1 && idxB !== -1) {
                          const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
                          setMultiSelected(new Set(dirPaths.slice(lo, hi + 1)));
                        } else {
                          setMultiSelected(new Set([path]));
                        }
                        setFolderAnchor(path);
                      } else {
                        goto(path);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      showVfsFolderContextMenu({ path, onOpen: () => goto(path) });
                    }}
                  >
                    <Icon name="folder" size={16} className="shrink-0 text-primary" />
                    <span className="truncate">{d}</span>
                  </button>
                );
              })}
            {sortedFiles.map((f) => {
              const name = resolved.get(codeOf(f.name));
              const isMultiSelected = multiSelected.has(f.path);
              return (
                <button
                  key={f.path}
                  className={`state-layer flex w-full items-center justify-between gap-2 px-3 py-2 text-left type-body-medium ${
                    state.selected === f.path
                      ? "bg-secondary-container text-on-secondary-container"
                      : isMultiSelected
                        ? "bg-primary-container/40 text-on-surface"
                        : "text-on-surface"
                  }`}
                  onClick={(e) => {
                    if (e.ctrlKey || e.metaKey) {
                      setMultiSelected((prev) => {
                        const next = new Set(prev);
                        if (next.has(f.path)) next.delete(f.path);
                        else next.add(f.path);
                        return next;
                      });
                      onStateChange({ ...state, selected: f.path });
                    } else if (e.shiftKey && state.selected) {
                      const idxA = sortedFiles.findIndex((x) => x.path === state.selected);
                      const idxB = sortedFiles.findIndex((x) => x.path === f.path);
                      if (idxA !== -1 && idxB !== -1) {
                        const [lo, hi] = idxA < idxB ? [idxA, idxB] : [idxB, idxA];
                        setMultiSelected(new Set(sortedFiles.slice(lo, hi + 1).map((x) => x.path)));
                      }
                      onStateChange({ ...state, selected: f.path });
                    } else {
                      setMultiSelected(new Set());
                      onStateChange({ ...state, selected: f.path });
                    }
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    if (f.entryIndex !== undefined) {
                      showRawCpkFileContextMenu({
                        path: f.path,
                        name: f.name,
                        size: f.size,
                        entryIndex: f.entryIndex,
                        onOpen: () => onStateChange({ ...state, selected: f.path }),
                      });
                    } else {
                      showVfsFileContextMenu({
                        path: f.path,
                        name: f.name,
                        size: f.size,
                        gameDir: settings.gameDir,
                        blenderExe: settings.blenderExe,
                        onOpen: () => onStateChange({ ...state, selected: f.path }),
                      });
                    }
                  }}
                  title={f.path}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon name="description" size={16} className="shrink-0 text-on-surface-variant" />
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{name?.name ?? (searching ? f.path : f.name)}</span>
                      {name && (
                        <span className="truncate type-label-small text-on-surface-variant">
                          {searching ? f.path : f.name}
                          {name.extra ? ` · ${name.extra}` : ""}
                        </span>
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 type-label-small text-on-surface-variant">{humanSize(f.size)}</span>
                </button>
              );
            })}
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
