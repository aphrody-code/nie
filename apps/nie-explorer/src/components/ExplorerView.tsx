import { useEffect, useMemo, useRef, useState } from "react";
import { writeText, readText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { api, type FolderRole, type RawCpkEntry } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { humanSize } from "@/lib/bytes";
import { recordVisit, togglePin, usePinnedPlaces } from "@/lib/places";
import { codeOf } from "@/lib/vfsIndexDb";
import { useResolvedNames } from "@/lib/nameResolve";
import { showVfsFileContextMenu, showVfsFolderContextMenu, showRawCpkFileContextMenu } from "@/lib/contextMenu";
import { registerFileOps } from "@/lib/editBus";
import { modsDb } from "@/lib/modsDb";
import { stageReplacement, stageReplacementFromPath } from "@/lib/modWorkspace";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Icon } from "@/components/ui/Icon";
import { CircleButton } from "@/components/ui/circle-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Slider } from "@/components/ui/slider";
import { useT } from "@/lib/i18n";
import { DetailPane, type DetailTarget } from "@/components/DetailPane";
import { PropertyEditor } from "@/components/PropertyEditor";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

/** Extensions dont on peut extraire une VRAIE vignette (texture décodée) — comparé en minuscules. */
const THUMBNAIL_EXTS = new Set(["g4tx"]);

/** Cache partagé entre remounts/re-render (survit à un changement de dossier, évite de
 * redécoder deux fois la même texture en revenant sur un dossier déjà visité) — cf. demande
 * utilisatrice « compare l'UI de nie-explorer et azalee cpk explorer et fusionne le meilleur des
 * deux » : la vue grille + vignettes est la différenciation la plus marquante d'azalee `/cpk`
 * (`CpkModelThumb`/vue grille M3) que nie-explorer n'avait pas — portée ici pour les `.g4tx`
 * (décodage déjà instantané, `vfs_texture_png_b64`) ; les vignettes 3D (`.g4md`, plus coûteuses —
 * assemblage GLB + rendu, cf. §2.3 ROADMAP) restent volontairement HORS PORTÉE de cette vignette
 * de dossier (ouvrir le fichier reste le chemin pour un aperçu 3D — pas de faux raccourci).
 */
const thumbnailCache = new Map<string, string | null>();

/** Vignette lazy (IntersectionObserver — ne décode que ce qui devient visible, pas tout le
 * dossier d'un coup) pour la vue grille. `null` en cache = décodage tenté et échoué (pas de
 * texture réelle dans ce `.g4tx`, ex. dummy) — on ne réessaie pas indéfiniment. */
function FileThumbnail({ path, ext, gameDir }: { path: string; ext: string; gameDir?: string }) {
  const [src, setSrc] = useState<string | null>(thumbnailCache.get(path) ?? null);
  const [visible, setVisible] = useState(thumbnailCache.has(path));
  const ref = useState(() => ({ current: null as HTMLDivElement | null }))[0];

  useEffect(() => {
    if (visible || !ref.current || !THUMBNAIL_EXTS.has(ext)) return;
    const el = ref.current;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          setVisible(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext, visible]);

  useEffect(() => {
    if (!visible || thumbnailCache.has(path) || !THUMBNAIL_EXTS.has(ext)) return;
    let cancelled = false;
    api
      .texturePngB64(path, gameDir)
      .then((b64) => {
        if (cancelled) return;
        const url = `data:image/png;base64,${b64}`;
        thumbnailCache.set(path, url);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) thumbnailCache.set(path, null);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, path, ext, gameDir]);

  if (!THUMBNAIL_EXTS.has(ext)) {
    return <Icon name="description" size={28} className="text-on-surface-variant" />;
  }
  return (
    <div
      ref={(el) => {
        ref.current = el;
      }}
      className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg bg-surface-container-highest"
    >
      {src ? (
        // biome-ignore lint: aperçu local, pas d'optimisation next/image (app Tauri, pas Next)
        <img src={src} alt="" className="h-full w-full object-contain" />
      ) : (
        <Icon name="image" size={24} className="text-on-surface-variant/50" />
      )}
    </div>
  );
}

// La barre latérale « emplacements » (épingles curées + épinglés utilisatrice + récents) vivait
// ICI, en plus de la rangée d'onglets globale : deux navigations concurrentes à l'écran. Elle est
// désormais servie par la barre latérale UNIQUE de l'app (`components/Sidebar.tsx`, alimentée par
// `App.tsx`), exactement comme `SpacesSidebar` de spacedrive qui porte à la fois les vues et les
// emplacements. `lib/places.ts` est inchangé — seul l'endroit du rendu a bougé.

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
  // Vue liste (défaut, dense — navigation clavier/multi-sélection) ou grille (vignettes, façon
  // azalee `/cpk` — cf. demande utilisatrice de fusion des deux UI). Choix par dossier NON
  // persisté (état local volontaire, comme `sortKey`) : la vue grille est un outil ponctuel
  // « je regarde un dossier de textures/persos », pas une préférence globale à retenir partout.
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  // Taille des vignettes en vue grille (px, réglable via le popover « Options d'affichage » —
  // pattern porté de spacedrive : un « View Options » à côté du sélecteur liste/grille, pas un
  // réglage caché dans les Paramètres généraux).
  const [gridSize, setGridSize] = useState(96);
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
  /** Onglet de l'inspecteur de droite — aperçu du fichier, ou éditeur de propriétés de l'entité. */
  const [inspectorTab, setInspectorTab] = useState<"preview" | "properties">("preview");
  /** Jeton de la dernière requête de listage/recherche lancée — cf. `fresh()` dans l'effet de
   * chargement (anti-race, §2.7 roadmap). `useRef` et pas `useState` : le changer ne doit PAS
   * provoquer de rendu, et sa valeur doit être lisible immédiatement dans le même tour. */
  const requestSeq = useRef(0);

  // Recherche VFS globale non disponible À L'INTÉRIEUR d'un `.cpk` ouvert (portée volontairement
  // limitée pour cette fusion — la recherche continue de fonctionner normalement partout ailleurs).
  const searching = query.trim().length > 0 && !cpkBoundary;

  useEffect(() => {
    setLoading(true);
    setError(null);
    // Garde anti-réponse-périmée (§2.7 roadmap : « recherche avec anti-race explicite », relevé
    // comme écart réel non fermé). Sans elle, une frappe rapide peut faire arriver la réponse de
    // "c010" APRÈS celle de "c0100" et réafficher la liste précédente : le champ affiche une
    // requête, la liste en montre une autre. Chaque exécution incrémente le jeton ; toute réponse
    // dont le jeton n'est plus le courant est jetée.
    const seq = ++requestSeq.current;
    const fresh = () => seq === requestSeq.current;

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
        if (!fresh()) return;
        setDirs([...dirSet].sort((a, b) => a.localeCompare(b)));
        setFiles(fileRows);
        setRole(null);
      })()
        .catch((e) => fresh() && setError(String(e)))
        .finally(() => fresh() && setLoading(false));
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
          if (!fresh()) return;
          setDirs(packs.map((p) => p.name));
          setFiles([]);
          setRole(null);
        })
        .catch((e) => fresh() && setError(String(e)))
        .finally(() => fresh() && setLoading(false));
      return;
    }

    const req = searching
      ? api.find(query.trim(), ext.trim() || undefined, 500, settings.gameDir).then((hits) => {
          if (!fresh()) return;
          setDirs([]);
          setFiles(hits);
          setRole(null);
        })
      : api.ls(state.prefix, settings.gameDir).then((r) => {
          if (!fresh()) return;
          setDirs(r.dirs);
          setFiles(r.files);
          setRole(r.role);
        });
    req.catch((e) => fresh() && setError(String(e))).finally(() => fresh() && setLoading(false));
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

  // Taille totale de la sélection courante (fichiers uniquement — un dossier VFS n'a pas de
  // taille propre) — affichée dans la barre de statut, cf. rendu plus bas.
  const selectedTotalSize = useMemo(
    () => sortedFiles.reduce((sum, f) => (multiSelected.has(f.path) ? sum + f.size : sum), 0),
    [sortedFiles, multiSelected],
  );
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

  /** Clic sur un dossier — extrait pour être partagé entre la vue liste et la vue grille (même
   * sémantique Ctrl/Shift-clic dans les deux, cf. `viewMode`). */
  function handleDirClick(path: string, e: React.MouseEvent) {
    if (e.ctrlKey || e.metaKey) {
      setMultiSelected((prev) => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setFolderAnchor(path);
    } else if (e.shiftKey && folderAnchor) {
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
  }

  /** Clic sur un fichier — extrait pour être partagé entre la vue liste et la vue grille. */
  function handleFileClick(f: Row, e: React.MouseEvent) {
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
  }

  /** « Ajouter à un mod… » du menu contextuel. `showVfsFileContextMenu` sait afficher cette entrée
   * depuis toujours (`onStageIntoMod`), mais l'Explorateur ne la lui passait JAMAIS : le menu
   * contextuel n'a donc jamais montré l'action, alors que c'est le geste principal de l'app. Le
   * mod est créé à la volée s'il n'en existe aucun (même règle que Ctrl+V, cf. `doPaste`). */
  async function stageIntoMod(path: string) {
    try {
      const mods = await modsDb.listMods();
      const modId = mods[0]?.id ?? (await modsDb.createMod("Mon mod", "Créé depuis le menu contextuel"));
      const modName = mods[0]?.name ?? "Mon mod";
      const ok = await stageReplacement(modId, { kind: "vfs", path }, settings.gameDir);
      if (ok) toast.success(`Ajouté au mod « ${modName} »`, { description: path });
    } catch (e) {
      toast.error(String(e));
    }
  }

  /** Menu contextuel d'un fichier — même dispatch VFS/CPK-brut que la vue liste. */
  function handleFileContextMenu(f: Row, e: React.MouseEvent) {
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
        onStageIntoMod: () => void stageIntoMod(f.path),
      });
    }
  }

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

  /** Ctrl+C — copie les chemins de la sélection (multi ou simple) dans le presse-papiers, en
   * TEXTE — délibérément PAS `api.clipboardWriteFileList` (CF_HDROP réel, cf. `doPaste`) : un
   * chemin VFS (`data/common/chr/...`) est VIRTUEL, à l'intérieur d'un CPK — aucun fichier
   * n'existe à cet emplacement sur le vrai disque, donc le poser en CF_HDROP tromperait
   * l'Explorateur Windows (il tenterait d'ouvrir un chemin qui n'existe nulle part) plutôt que de
   * l'aider. Le texte reste la représentation correcte ici. */
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
   *
   * Deux sources, la VRAIE (CF_HDROP) tentée en premier (recherche 2026-08-08 « lis vraiment le
   * code de cosmic… les interactions os et le filesystem ») : un Ctrl+C dans l'Explorateur
   * Windows écrit CF_HDROP (liste de fichiers native), PAS forcément de texte lisible — l'ancien
   * `readText()` seul pouvait donc rater un copier-coller pourtant parfaitement légitime depuis
   * l'Explorateur. `api.clipboardReadFileList()` (CF_HDROP réel, `clipboard-win`) est tenté
   * d'abord ; repli sur l'ancien texte-si-chemin-réel pour les autres sources (un chemin copié
   * comme texte depuis ailleurs, notre propre `doCopySelection` qui écrit des chemins VFS en
   * texte — PAS des fichiers réels, cf. son commentaire).
   */
  async function doPaste() {
    if (!state.selected) {
      toast.error("Sélectionnez d'abord un fichier VFS à remplacer");
      return;
    }
    let clip = (await api.clipboardReadFileList().catch(() => null))?.[0]?.trim();
    if (!clip || !(await api.diskFileExists(clip).catch(() => false))) {
      clip = (await readText().catch(() => null))?.trim();
      if (!clip || clip.includes("\n") || !(await api.diskFileExists(clip).catch(() => false))) {
        toast.message("Rien à coller.", {
          description: "Le presse-papiers doit contenir un fichier réel (copié depuis l'Explorateur Windows) ou le chemin d'UN fichier existant sur disque.",
        });
        return;
      }
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
  /** Code interne de l'entité à laquelle appartient le fichier sélectionné (`c01000010.g4tx` →
   * `c01000010`) — clé de l'éditeur de propriétés. Vide pour un dossier ou un nom sans code. */
  const selectedCode = state.selected ? codeOf(state.selected.split("/").pop() ?? "") : "";
  const target: DetailTarget | null = !state.selected
    ? null
    : selectedRow?.entryIndex !== undefined
      ? { kind: "raw_cpk", path: state.selected, entryIndex: selectedRow.entryIndex }
      : { kind: "vfs", path: state.selected };

  return (
    // Deux colonnes : contenu + inspecteur FLOTTANT de 280 px à droite (largeur et marge de
    // `ShellLayout.tsx` chez spacedrive — `w-[280px] min-w-[280px] … p-2`).
    <div className="flex h-full min-h-0">
      <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        {/* Barre d'outils — mise en forme de la `TopBar` de l'explorer spacedrive : boutons ronds
         * (`CircleButton`) sur fond transparent et fil d'Ariane en texte, plutôt qu'une pilule
         * pleine largeur. */}
        <div className="flex items-center gap-1.5">
          <CircleButton
            icon="home"
            size="sm"
            title={t("explorer.root")}
            aria-label={t("explorer.root")}
            onClick={() => goto("")}
          />
          <CircleButton
            icon="arrow_back"
            size="sm"
            title={t("explorer.parent")}
            aria-label={t("explorer.parent")}
            disabled={segments.length === 0}
            onClick={() => goto(segments.slice(0, -1).join("/"))}
          />
          <nav className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 text-xs">
            {segments.map((seg, i) => (
              <span key={i} className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="rounded-md px-1.5 py-0.5 text-ink-dull transition-colors hover:bg-app-hover hover:text-ink"
                  onClick={() => goto(segments.slice(0, i + 1).join("/"))}
                >
                  {seg}
                </button>
                <span className="text-ink-faint">/</span>
              </span>
            ))}
          </nav>
          <CircleButton
            icon="stars"
            size="sm"
            variant={pins.includes(state.prefix) ? "accent" : "default"}
            title="Épingler à la barre latérale (Ctrl+D)"
            aria-label="Épingler à la barre latérale"
            onClick={() => togglePin(state.prefix)}
          />
          <CircleButton
            icon={sortKey === "name" ? "sort_by_alpha" : "table_rows"}
            size="sm"
            title={sortKey === "name" ? t("explorer.sort_size") : t("explorer.sort_name")}
            aria-label={sortKey === "name" ? t("explorer.sort_size") : t("explorer.sort_name")}
            onClick={() => setSortKey((k) => (k === "name" ? "size" : "name"))}
          />
          <Popover>
            <PopoverTrigger
              render={
                <CircleButton
                  icon="tune"
                  size="sm"
                  title="Options d'affichage"
                  aria-label="Options d'affichage"
                />
              }
            />
            <PopoverContent className="w-56">
              <p className="px-1 pb-1 type-label-small text-on-surface-variant">Affichage</p>
              {/* Vue Liste/Grille — ToggleGroup porté de `spaceui/primitives/ToggleGroup.tsx`
               * (spacedrive), cf. components/ui/toggle-group.tsx. */}
              <ToggleGroup value={[viewMode]} onValueChange={(v) => v[0] && setViewMode(v[0] as "list" | "grid")} className="w-full">
                <ToggleGroupItem value="list" className="flex-1 justify-center">
                  <Icon name="view_list" size={14} />
                  Liste
                </ToggleGroupItem>
                <ToggleGroupItem value="grid" className="flex-1 justify-center">
                  <Icon name="grid_view" size={14} />
                  Grille
                </ToggleGroupItem>
              </ToggleGroup>
              {viewMode === "grid" && (
                <div className="px-1 pt-2">
                  <p className="pb-1 type-label-small text-on-surface-variant">Taille des vignettes</p>
                  <Slider
                    value={[gridSize]}
                    onValueChange={(v) => setGridSize((Array.isArray(v) ? v[0] : v) ?? gridSize)}
                    min={72}
                    max={192}
                    step={8}
                  />
                </div>
              )}
            </PopoverContent>
          </Popover>
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
          <div className="rounded-lg border border-app-line bg-app-box p-3 text-ink-dull">
            <p className="text-xs leading-relaxed">{role.role}</p>
            <Badge variant="outline" className="mt-1.5">
              {role.status}
            </Badge>
          </div>
        )}

        <ScrollArea
          className="min-h-0 flex-1 rounded-2xl border border-app-line bg-app-dark-box"
          tabIndex={0}
          onKeyDown={onListKeyDown}
        >
          <div
            className={viewMode === "grid" ? "grid gap-2 p-2" : "divide-y divide-app-line py-1"}
            style={viewMode === "grid" ? { gridTemplateColumns: `repeat(auto-fill,minmax(${gridSize}px,1fr))` } : undefined}
          >
            {!searching &&
              sortedDirs.map((d) => {
                const path = state.prefix ? `${state.prefix}/${d}` : d;
                const isMultiSelected = multiSelected.has(path);
                if (viewMode === "grid") {
                  return (
                    <button
                      key={d}
                      className={`state-layer flex flex-col items-center gap-1 rounded-xl p-2 text-center ${
                        isMultiSelected ? "bg-primary-container/40" : ""
                      }`}
                      onClick={(e) => handleDirClick(path, e)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        showVfsFolderContextMenu({ path, onOpen: () => goto(path) });
                      }}
                      title={d}
                    >
                      <Icon name="folder" size={40} className="shrink-0 text-primary" />
                      <span className="w-full truncate type-label-small text-on-surface">{d}</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={d}
                    className={`state-layer flex w-full items-center gap-2 px-3 py-2 text-left type-body-medium ${
                      isMultiSelected ? "bg-primary-container/40 text-on-surface" : "text-on-surface"
                    }`}
                    onClick={(e) => handleDirClick(path, e)}
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
            {viewMode === "grid" &&
              sortedFiles.map((f) => {
                const ext = f.name.includes(".") ? f.name.split(".").pop()!.toLowerCase() : "";
                const isMultiSelected = multiSelected.has(f.path);
                return (
                  <button
                    key={f.path}
                    className={`state-layer flex flex-col items-center gap-1 rounded-xl p-2 text-center ${
                      state.selected === f.path
                        ? "bg-secondary-container"
                        : isMultiSelected
                          ? "bg-primary-container/40"
                          : ""
                    }`}
                    onClick={(e) => handleFileClick(f, e)}
                    onContextMenu={(e) => handleFileContextMenu(f, e)}
                    title={f.path}
                  >
                    <div className="h-16 w-16 shrink-0">
                      <FileThumbnail path={f.path} ext={ext} gameDir={settings.gameDir} />
                    </div>
                    <span className="w-full truncate type-label-small text-on-surface">
                      {resolved.get(codeOf(f.name))?.name ?? f.name}
                    </span>
                  </button>
                );
              })}
            {viewMode === "list" &&
              sortedFiles.map((f) => {
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
                  onClick={(e) => handleFileClick(f, e)}
                  onContextMenu={(e) => handleFileContextMenu(f, e)}
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
        {/* Barre de statut — pattern porté de l'Explorer spacedrive (compteur à gauche, résumé de
         * la sélection courante à droite dès qu'elle est non vide). */}
        <div className="flex items-center justify-between gap-2 type-label-small text-on-surface-variant">
          <span>
            {loading
              ? t("explorer.loading")
              : searching
                ? t("explorer.results", { n: files.length })
                : t("explorer.count", { dirs: dirs.length, files: files.length })}
          </span>
          {multiSelected.size > 0 && (
            <span>
              {multiSelected.size.toLocaleString("fr-FR")} sélectionné(s)
              {selectedTotalSize > 0 && ` · ${humanSize(selectedTotalSize)}`}
            </span>
          )}
        </div>
      </div>

      {/* Inspecteur : aperçu du fichier, ET éditeur de propriétés de l'ENTITÉ à laquelle il
       * appartient (modèle/texture/config du même code interne, données éditables, fonctions et
       * adresses de `nie.exe` qui le manipulent). Sélectionner la texture d'un joueur ouvre donc
       * la fiche du joueur, pas seulement un aperçu d'image. */}
      <div className="flex h-full w-[320px] min-w-[320px] flex-col gap-2 p-2 pl-0">
        <Tabs value={inspectorTab} onValueChange={(v) => v && setInspectorTab(v as "preview" | "properties")}>
          <TabsList variant="line">
            <TabsTrigger value="preview" className="text-xs">
              Aperçu
            </TabsTrigger>
            <TabsTrigger value="properties" className="text-xs" disabled={!selectedCode}>
              Propriétés
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-app-line bg-app-box/60">
          {inspectorTab === "properties" && selectedCode ? (
            <PropertyEditor
              code={selectedCode}
              className="h-full p-3"
              onOpenFile={(p) => onStateChange({ ...state, selected: p })}
            />
          ) : (
            <DetailPane target={target} />
          )}
        </div>
      </div>
    </div>
  );
}
