/**
 * The Inacord workspace — the user-facing VFS explorer, and nothing else.
 *
 * ## Why this file exists
 *
 * `desktop/App.tsx` was a second application: it drew its own sidebar, its own top bar, its own
 * command palette and its own toaster, kept its own current-view state and wrote its own address
 * bar. On the site it was mounted lazily behind `/inacord`, so the product had two shells — the
 * game screens could not reach a tool, and a tool could only reach a game screen through a full
 * page reload (`window.location.assign`).
 *
 * The workspace owns only the Explorer's tabs and the keyboard gestures that make sense while
 * browsing the VFS. RE, wiki/data, modding, Lua, live memory and authoring remain headless
 * capabilities behind their API/CLI/MCP/script owners.
 *
 * ## What this component does NOT own
 *
 * The current view. It is a route (`/inacord/<viewId>`), read and written by the one navigation
 * state in `App.tsx` — which is what makes a workspace view addressable, shareable and reachable
 * from the game side without a reload.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent } from "@nie/inacord-ui/components/ui/tabs";
import { ExplorerView } from "@/components/ExplorerView";
import { ExplorerTabsBar } from "@/components/ExplorerTabsBar";
import { DetailPane } from "@/components/DetailPane";
import { useAppMenuShortcuts, type AppMenuActions } from "@/components/AppMenu";
import { useBridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { recordVisit } from "@/lib/places";
import { canGoBack, canGoForward, explorerTabs, useExplorerTabs } from "@/lib/explorerTabs";
import { setExternalPath, useExternalPath } from "@/lib/externalPath";
import { libellesVues } from "@/lib/vues";
import type { WorkspaceActions } from "../shell/workspace-actions";

export function Workspace({ view, actions, publicMode = false }: {
  view: string;
  actions: WorkspaceActions;
  publicMode?: boolean;
}) {
  const t = useT();
  const externalPath = useExternalPath();
  // Onglets de l'Explorateur — état module-level persistant (`lib/explorerTabs.ts`), pas un
  // `useState` local : la navigation, l'historique et les préférences d'affichage appartiennent à
  // l'onglet et survivent au changement de vue comme au redémarrage de l'application.
  const tabsState = useExplorerTabs();
  const explorer = tabsState.tabs.find((x) => x.id === tabsState.activeId) ?? tabsState.tabs[0];
  const activeTabId = explorer.id;
  // Pont de contrôle MCP : `nie-mcp` peut piloter cette fenêtre (naviguer, ouvrir un asset,
  // changer d'onglet, notifier) — mêmes types de commandes des deux côtés, cf. `@nie/bridge`.
  // Opportuniste : sans serveur en écoute, rien ne se passe et l'application reste intacte.
  // Le protocole du pont ne connaît qu'UN couple `prefix`/`selected` : il décrit et pilote donc
  // l'onglet ACTIF, jamais les autres. Étendre `@nie/bridge` aux onglets serait un changement de
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
  }, !publicMode);

  // Barre de menu Fichier/Édition/Affichage : ses accélérateurs restent posés ici, là où les vues
  // qu'ils sélectionnent se rendent. `Ctrl+1…9` change de vue, donc de ROUTE, comme un clic.
  const menuActions: AppMenuActions = {
    onOpenExternalPath: setExternalPath,
    onSelectTab: (id) => actions.openView(id),
    // Le menu Affichage lit le même registre que la barre latérale.
    tabLabels: libellesVues(t),
  };
  useAppMenuShortcuts(menuActions, !publicMode);

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
    <Tabs value="explorer" className="h-full min-h-0">
      {/* The desktop product has one visual surface. Other capabilities stay behind API/CLI/MCP. */}
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
              <div
                key={tb.id}
                className="h-full min-h-0"
                style={tb.id === tabsState.activeId ? undefined : { display: "none" }}
              >
                <ExplorerView
                  authoring={false}
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
    </Tabs>
  );
}

export default Workspace;
