/**
 * The Inacord workspace — its views, and nothing else.
 *
 * ## Why this file exists
 *
 * `desktop/App.tsx` was a second application: it drew its own sidebar, its own top bar, its own
 * command palette and its own toaster, kept its own current-view state and wrote its own address
 * bar. On the site it was mounted lazily behind `/inacord`, so the product had two shells — the
 * game screens could not reach a tool, and a tool could only reach a game screen through a full
 * page reload (`window.location.assign`).
 *
 * What is left here is the part that was never duplicated: the views themselves, the Explorer's
 * tabs, the editor state, and the three keyboard gestures that only make sense when the Explorer
 * is on screen. The shell above (`shell/UnifiedShell.tsx`) owns everything else, for every screen
 * of the product.
 *
 * ## What this component does NOT own
 *
 * The current view. It is a route (`/inacord/<viewId>`), read and written by the one navigation
 * state in `App.tsx` — which is what makes a workspace view addressable, shareable and reachable
 * from the game side without a reload.
 */
import { lazy, Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent } from "@niers/inacord-ui/components/ui/tabs";
import { ExplorerView } from "@/components/ExplorerView";
import { ExplorerTabsBar } from "@/components/ExplorerTabsBar";
import type { EditorViewState } from "@/components/editor/EditorView";
import { DetailPane } from "@/components/DetailPane";
import { useAppMenuShortcuts, type AppMenuActions } from "@/components/AppMenu";
import { useBridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { recordVisit } from "@/lib/places";
import { canGoBack, canGoForward, explorerTabs, useExplorerTabs } from "@/lib/explorerTabs";
import { setExternalPath, useExternalPath } from "@/lib/externalPath";
import { libellesVues } from "@/lib/vues";
import type { WorkspaceActions } from "../shell/workspace-actions";

/** Les vues hors parcours Explorer sont chargées à leur première ouverture. Cela laisse le
 * démarrage et les changements de dossier libres des bundles Monaco, vidéo, forge et catalogue. */
const DashboardView = lazy(() => import("@/components/DashboardView").then(({ DashboardView }) => ({ default: DashboardView })));
const EditorView = lazy(() => import("@/components/editor/EditorView").then(({ EditorView }) => ({ default: EditorView })));
const GameDataView = lazy(() => import("@/components/GameDataView").then(({ GameDataView }) => ({ default: GameDataView })));
const SearchView = lazy(() => import("@/components/SearchView").then(({ SearchView }) => ({ default: SearchView })));
const ModsView = lazy(() => import("@/components/ModsView").then(({ ModsView }) => ({ default: ModsView })));
const RawCpkView = lazy(() => import("@/components/RawCpkView").then(({ RawCpkView }) => ({ default: RawCpkView })));
const ReToolsView = lazy(() => import("@/components/ReToolsView").then(({ ReToolsView }) => ({ default: ReToolsView })));
const LuaView = lazy(() => import("@/components/LuaView").then(({ LuaView }) => ({ default: LuaView })));
const LiveModView = lazy(() => import("@/components/LiveModView").then(({ LiveModView }) => ({ default: LiveModView })));
const ViolaView = lazy(() => import("@/components/ViolaView").then(({ ViolaView }) => ({ default: ViolaView })));
const CinemaView = lazy(() => import("@/components/CinemaView").then(({ CinemaView }) => ({ default: CinemaView })));
const GalleryView = lazy(() => import("@/components/GalleryView").then(({ GalleryView }) => ({ default: GalleryView })));
const ToolsView = lazy(() => import("@/components/ToolsView").then(({ ToolsView }) => ({ default: ToolsView })));
const SaveView = lazy(() => import("@/components/SaveView").then(({ SaveView }) => ({ default: SaveView })));
const SettingsView = lazy(() => import("@/components/SettingsView").then(({ SettingsView }) => ({ default: SettingsView })));

function VueEnChargement() {
  return <div className="grid h-full place-items-center text-sm text-ink-faint">Ouverture de la vue…</div>;
}

export function Workspace({ view, actions }: { view: string; actions: WorkspaceActions }) {
  const t = useT();
  const externalPath = useExternalPath();
  // Onglets de l'Explorateur — état module-level persistant (`lib/explorerTabs.ts`), pas un
  // `useState` local : la navigation, l'historique et les préférences d'affichage appartiennent à
  // l'onglet et survivent au changement de vue comme au redémarrage de l'application.
  const tabsState = useExplorerTabs();
  const explorer = tabsState.tabs.find((x) => x.id === tabsState.activeId) ?? tabsState.tabs[0];
  const activeTabId = explorer.id;
  /** Mode Éditeur — dossier courant du navigateur de contenu + asset ouvert dans le viewport. */
  const [editor, setEditor] = useState<EditorViewState>({ prefix: "data/common/chr", selected: null });

  // Pont de contrôle MCP : `nie-mcp` peut piloter cette fenêtre (naviguer, ouvrir un asset,
  // changer d'onglet, notifier) — mêmes types de commandes des deux côtés, cf. `@niers/bridge`.
  // Opportuniste : sans serveur en écoute, rien ne se passe et l'application reste intacte.
  // Le protocole du pont ne connaît qu'UN couple `prefix`/`selected` : il décrit et pilote donc
  // l'onglet ACTIF, jamais les autres. Étendre `@niers/bridge` aux onglets serait un changement de
  // protocole des deux côtés, hors périmètre.
  useBridge({
    getState: () => ({ tab: view, prefix: explorer.prefix, selected: explorer.selected, externalPath }),
    navigate: (prefix, select) => {
      recordVisit(prefix);
      setExternalPath(null);
      explorerTabs.update(activeTabId, { prefix, selected: select ?? null });
      actions.openView("explorer");
    },
    open: (path) => {
      const slash = path.lastIndexOf("/");
      setExternalPath(null);
      explorerTabs.update(activeTabId, { prefix: slash > 0 ? path.slice(0, slash) : "data", selected: path });
      actions.openView("explorer");
    },
    setTab: (id) => actions.openView(id),
    toast: (message, kind) => {
      if (kind === "success") toast.success(message);
      else if (kind === "error") toast.error(message);
      else toast(message);
    },
  });

  // Barre de menu Fichier/Édition/Affichage : ses accélérateurs restent posés ici, là où les vues
  // qu'ils sélectionnent se rendent. `Ctrl+1…9` change de vue, donc de ROUTE, comme un clic.
  const menuActions: AppMenuActions = {
    onOpenExternalPath: setExternalPath,
    onSelectTab: (id) => actions.openView(id),
    // Le menu Affichage lit le même registre que la barre latérale.
    tabLabels: libellesVues(t),
  };
  useAppMenuShortcuts(menuActions);

  // Raccourcis d'onglets. Ctrl+1…9 sélectionnent déjà une VUE (`AppMenu`), Ctrl+D épingle et
  // Ctrl+K ouvre la palette : restent les gestes de navigateur, Ctrl+T / Ctrl+W / Ctrl+Tab.
  // Posés uniquement quand l'Explorateur est réellement à l'écran, sinon Ctrl+W fermerait un
  // onglet invisible depuis une autre vue.
  useEffect(() => {
    if (view !== "explorer" || externalPath) return;
    function onKeyDown(e: KeyboardEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      if (e.key === "Tab") {
        e.preventDefault();
        explorerTabs.cycle(e.shiftKey ? -1 : 1);
        return;
      }
      const el = e.target as HTMLElement | null;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      const key = e.key.toLowerCase();
      if (key === "t") {
        e.preventDefault();
        explorerTabs.open(explorer.prefix);
      } else if (key === "w") {
        e.preventDefault();
        explorerTabs.close(activeTabId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view, externalPath, activeTabId, explorer.prefix]);

  if (externalPath) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-app-line bg-app-box px-4 py-2 text-xs text-ink-dull">
          <span>{t("external.opened")}</span>
          <button
            type="button"
            className="text-xs font-medium text-accent hover:underline"
            onClick={() => setExternalPath(null)}
          >
            {t("external.close")}
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <DetailPane target={{ kind: "disk", path: externalPath }} />
        </div>
      </div>
    );
  }

  return (
    <Tabs value={view} className="h-full min-h-0">
      <Suspense fallback={<VueEnChargement />}>
        <TabsContent value="dashboard" className="h-full min-h-0">
          <DashboardView onSelectTab={(id) => actions.openView(id)} />
        </TabsContent>
        <TabsContent value="editor" className="h-full min-h-0">
          <EditorView
            state={editor}
            onStateChange={setEditor}
            onOpenInExplorer={actions.revealInExplorer}
          />
        </TabsContent>
        {/* `keepMounted` : le panneau de `@base-ui/react` DÉMONTE son contenu quand il
            n'est pas actif (`keepMounted` vaut `false` par défaut). Sans lui, quitter
            l'Explorateur détruirait les N instances d'onglet — listings, caches `.cpk` et
            sélections repartiraient de zéro à chaque aller-retour entre vues. */}
        <TabsContent value="explorer" className="h-full min-h-0" keepMounted>
          <div className="flex h-full min-h-0 flex-col">
            <ExplorerTabsBar
              tabs={tabsState.tabs}
              activeId={tabsState.activeId}
              onActivate={(id) => explorerTabs.activate(id)}
              onClose={(id) => explorerTabs.close(id)}
              onNew={() => explorerTabs.open(explorer.prefix)}
            />
            <div className="min-h-0 flex-1">
              {tabsState.tabs.map((tb) => (
                // `display:none` et NON l'attribut `hidden` : les classes `flex`/`h-full`
                // de Tailwind portées par le sous-arbre l'emportent sur le
                // `[hidden]{display:none}` du reset, et l'onglet inactif resterait visible.
                <div
                  key={tb.id}
                  className="h-full min-h-0"
                  style={tb.id === tabsState.activeId ? undefined : { display: "none" }}
                >
                  <ExplorerView
                    state={tb}
                    active={tb.id === tabsState.activeId}
                    onStateChange={(patch) => explorerTabs.update(tb.id, patch)}
                    onOpenInNewTab={(prefix) => {
                      recordVisit(prefix);
                      explorerTabs.open(prefix);
                    }}
                    onBack={() => explorerTabs.back(tb.id)}
                    onForward={() => explorerTabs.forward(tb.id)}
                    canGoBack={canGoBack(tb)}
                    canGoForward={canGoForward(tb)}
                  />
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
        <TabsContent value="cinema" className="h-full min-h-0">
          <CinemaView onOpenFile={actions.revealInExplorer} />
        </TabsContent>
        <TabsContent value="search" className="h-full min-h-0">
          <SearchView onOpenFile={actions.revealInExplorer} />
        </TabsContent>
        <TabsContent value="data" className="h-full min-h-0">
          <GameDataView onOpenFile={actions.revealInExplorer} />
        </TabsContent>
        <TabsContent value="gallery" className="h-full min-h-0">
          <GalleryView onOpenFile={actions.revealInExplorer} />
        </TabsContent>
        <TabsContent value="tools" className="h-full min-h-0">
          {/* « Ses fichiers » du Traducteur : le code interne part dans la Recherche de
              l'onglet actif — c'est le geste que le wiki ne peut pas offrir. */}
          <ToolsView onOpenSearch={actions.openSearch} />
        </TabsContent>
        <TabsContent value="mods" className="h-full min-h-0">
          <ModsView onOpenFile={actions.revealInExplorer} />
        </TabsContent>
        <TabsContent value="cpk" className="h-full min-h-0">
          <RawCpkView />
        </TabsContent>
        <TabsContent value="viola" className="h-full min-h-0">
          <ViolaView />
        </TabsContent>
        <TabsContent value="livemod" className="h-full min-h-0 overflow-auto">
          <LiveModView />
        </TabsContent>
        <TabsContent value="lua" className="h-full min-h-0">
          <LuaView />
        </TabsContent>
        <TabsContent value="re" className="h-full min-h-0">
          <ReToolsView />
        </TabsContent>
        <TabsContent value="save" className="h-full min-h-0 overflow-auto">
          <SaveView />
        </TabsContent>
        <TabsContent value="settings" className="h-full min-h-0 overflow-auto">
          <SettingsView />
        </TabsContent>
      </Suspense>
    </Tabs>
  );
}

export default Workspace;
