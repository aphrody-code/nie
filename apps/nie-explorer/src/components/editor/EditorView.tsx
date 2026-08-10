// Mode ÉDITEUR — nie-explorer en logiciel type Unreal Engine.
//
// Disposition canonique d'un éditeur de moteur, chaque zone servie par ce que niers sait déjà
// faire :
//
//   ┌──────────────────────────── barre d'outils ────────────────────────────┐
//   │  viewport 3D temps réel (WebGL)              │  outliner (hiérarchie)  │
//   │  caméra libre, sélection au clic             │  détails (propriétés)   │
//   ├───────────────────────────────────────────────────────────────────────┤
//   │  navigateur de contenu (VFS, vignettes, filtres par type d'asset)      │
//   └───────────────────────────────────────────────────────────────────────┘
//
// Ce qui change par rapport à l'aperçu 3D existant : le backend ne renvoie plus une IMAGE d'un
// modèle (`vfs_glb_preview_png_b64`, caméra figée) mais le GLB assemblé lui-même
// (`vfs_glb_bytes_b64`) — le modèle vit dans un moteur temps réel côté frontend, avec une vraie
// caméra orbitale, un raycast de sélection, un mode wireframe et des statistiques de scène.
//
// Le panneau « Détails » est l'éditeur de propriétés déjà en place (`PropertyEditor`) : il relie
// l'objet sélectionné à ses fichiers, ses `.cfg.bin` éditables et les fonctions/adresses de
// `nie.exe` qui le manipulent. Sélectionner un modèle dans le navigateur de contenu ouvre donc à
// la fois sa géométrie dans le viewport et sa fiche complète à droite.
import { useEffect, useMemo, useState } from "react";

import { ContentBrowser } from "@/components/editor/ContentBrowser";
import { Viewport3D, type SceneNode, type ViewportStats } from "@/components/editor/Viewport3D";
import { PropertyEditor } from "@/components/PropertyEditor";
import { CircleButton } from "@/components/ui/circle-button";
import { Icon } from "@/components/ui/Icon";
import { SplitPane } from "@/components/ui/split-pane";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { codeOf } from "@/lib/vfsIndexDb";
import { cn } from "@/lib/utils";

/** Extensions qui ouvrent réellement quelque chose dans le viewport (cf. `assemble_glb_for_preview`
 * : un G4MD a besoin de son G4MG frère, un G4MG suffit comme point d'entrée). */
const VIEWPORT_EXTS = new Set(["g4md", "g4mg"]);

export interface EditorViewState {
  /** Dossier courant du navigateur de contenu. */
  prefix: string;
  /** Asset sélectionné (chemin VFS). */
  selected: string | null;
}

export function EditorView({
  state,
  onStateChange,
  onOpenInExplorer,
}: {
  state: EditorViewState;
  onStateChange: (s: EditorViewState) => void;
  /** Renvoie l'asset courant vers l'Explorateur (aperçu/extraction/mods). */
  onOpenInExplorer?: (path: string) => void;
}) {
  const settings = useSettings();
  const [glb, setGlb] = useState<string | null>(null);
  const [glbError, setGlbError] = useState<string | null>(null);
  const [glbLoading, setGlbLoading] = useState(false);
  const [nodes, setNodes] = useState<SceneNode[]>([]);
  const [stats, setStats] = useState<ViewportStats>({ meshes: 0, triangles: 0, vertices: 0, materials: 0 });
  const [selectedNode, setSelectedNode] = useState<number | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [rightTab, setRightTab] = useState<"outliner" | "details">("outliner");

  const selectedName = state.selected?.split("/").pop() ?? "";
  const selectedExt = selectedName.includes(".") ? selectedName.split(".").pop()!.toLowerCase() : "";
  const selectedCode = state.selected ? codeOf(selectedName) : "";
  const canRender = VIEWPORT_EXTS.has(selectedExt);

  // Charge le GLB de l'asset sélectionné. Les assets non-modèles (texture, son, config) ne vident
  // PAS le viewport : dans un éditeur, cliquer une texture ne doit pas faire disparaître le modèle
  // qu'on est en train de regarder.
  useEffect(() => {
    if (!state.selected || !canRender) return;
    let cancelled = false;
    setGlbLoading(true);
    setGlbError(null);
    api
      .glbBytesB64(state.selected, settings.gameDir)
      .then((b64) => !cancelled && setGlb(b64))
      .catch((e) => {
        if (cancelled) return;
        setGlbError(String(e));
        setGlb(null);
      })
      .finally(() => !cancelled && setGlbLoading(false));
    return () => {
      cancelled = true;
    };
  }, [state.selected, canRender, settings.gameDir]);

  // Un nouveau modèle = nouvelle scène : la sélection de noeud précédente n'a plus de sens.
  useEffect(() => {
    setSelectedNode(null);
  }, [glb]);

  const selectedNodeInfo = useMemo(() => nodes.find((n) => n.id === selectedNode) ?? null, [nodes, selectedNode]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Barre d'outils */}
      <div className="flex shrink-0 items-center gap-2 border-b border-app-line px-2 py-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink" title={state.selected ?? undefined}>
          {state.selected ? selectedName : "Aucun asset sélectionné"}
          {glbLoading && <span className="ml-2 text-tiny text-ink-faint">chargement…</span>}
          {glbError && <span className="ml-2 text-tiny text-status-error">{glbError}</span>}
        </span>

        <div className="flex shrink-0 items-center gap-1.5">
          <CircleButton
            icon="grid_view"
            size="sm"
            variant={showGrid ? "accent" : "default"}
            title="Afficher la grille"
            aria-label="Afficher la grille"
            onClick={() => setShowGrid((v) => !v)}
          />
          <CircleButton
            icon="deployed_code"
            size="sm"
            variant={wireframe ? "accent" : "default"}
            title="Mode fil de fer"
            aria-label="Mode fil de fer"
            onClick={() => setWireframe((v) => !v)}
          />
          <CircleButton
            icon="open_in_new"
            size="sm"
            title="Ouvrir dans l'Explorateur"
            aria-label="Ouvrir dans l'Explorateur"
            disabled={!state.selected}
            onClick={() => state.selected && onOpenInExplorer?.(state.selected)}
          />
        </div>

        {/* Statistiques de scène — ce qu'affiche le coin d'un viewport d'éditeur. */}
        <div className="flex shrink-0 gap-3 border-l border-app-line pl-3 font-mono text-tiny text-ink-faint">
          <span>{stats.meshes} mesh</span>
          <span>{stats.triangles.toLocaleString("fr-FR")} tris</span>
          <span>{stats.vertices.toLocaleString("fr-FR")} verts</span>
          <span>{stats.materials} mat</span>
        </div>
      </div>

      {/* Corps : (viewport | panneaux droits) au-dessus du navigateur de contenu */}
      <SplitPane
        axis="y"
        side="end"
        defaultSize={220}
        min={100}
        max={600}
        storageKey="editor-content-browser"
        className="min-h-0 flex-1"
        panel={
          <ContentBrowser
            prefix={state.prefix}
            onNavigate={(prefix) => onStateChange({ ...state, prefix })}
            selected={state.selected}
            onSelect={(path) => onStateChange({ ...state, selected: path })}
            className="h-full border-t border-app-line"
          />
        }
      >
        <SplitPane
          axis="x"
          side="end"
          defaultSize={320}
          min={240}
          max={640}
          storageKey="editor-inspector"
          className="h-full"
          panel={
            <div className="flex h-full min-h-0 flex-col border-l border-app-line bg-app-dark-box">
              <Tabs value={rightTab} onValueChange={(v) => v && setRightTab(v as "outliner" | "details")}>
                <TabsList variant="line" className="px-2 pt-1.5">
                  <TabsTrigger value="outliner" className="text-xs">
                    Hiérarchie
                  </TabsTrigger>
                  <TabsTrigger value="details" className="text-xs" disabled={!selectedCode}>
                    Détails
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {rightTab === "outliner" ? (
                <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5">
                  {nodes.length === 0 ? (
                    <p className="p-2 text-tiny text-ink-faint">
                      Aucune scène chargée. Sélectionnez un <code>.g4md</code> ou <code>.g4mg</code>.
                    </p>
                  ) : (
                    nodes.map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={() => setSelectedNode(n.id === selectedNode ? null : n.id)}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-tiny transition-colors",
                          n.id === selectedNode
                            ? "bg-accent text-white"
                            : "text-ink-dull hover:bg-app-hover hover:text-ink",
                        )}
                        style={{ paddingLeft: 4 + n.depth * 12 }}
                        title={`${n.type}${n.triangles ? ` · ${n.triangles} triangles` : ""}`}
                      >
                        <Icon name={n.triangles > 0 ? "view_in_ar" : "account_tree"} size={12} />
                        <span className="min-w-0 flex-1 truncate">{n.name}</span>
                        {n.triangles > 0 && (
                          <span className="shrink-0 font-mono opacity-60">{n.triangles}</span>
                        )}
                      </button>
                    ))
                  )}

                  {selectedNodeInfo && (
                    <div className="mt-2 rounded border border-app-line bg-app-box p-2 text-tiny text-ink-dull">
                      <p className="font-semibold text-ink">{selectedNodeInfo.name}</p>
                      <p>type : {selectedNodeInfo.type}</p>
                      {selectedNodeInfo.triangles > 0 && (
                        <p>{selectedNodeInfo.triangles.toLocaleString("fr-FR")} triangles</p>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                selectedCode && (
                  <PropertyEditor
                    code={selectedCode}
                    className="min-h-0 flex-1 p-2"
                    onOpenFile={(p) => onStateChange({ ...state, selected: p })}
                  />
                )
              )}
            </div>
          }
        >
          <Viewport3D
            glbB64={glb}
            selectedId={selectedNode}
            onSelect={setSelectedNode}
            onSceneLoaded={(n, s) => {
              setNodes(n);
              setStats(s);
            }}
            wireframe={wireframe}
            showGrid={showGrid}
            className="h-full w-full bg-app-darker-box"
          />
        </SplitPane>
      </SplitPane>
    </div>
  );
}
