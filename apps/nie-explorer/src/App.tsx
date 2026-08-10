import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ExplorerView, type ExplorerState } from "@/components/ExplorerView";
import { EditorView, type EditorViewState } from "@/components/editor/EditorView";
import { GameDataView } from "@/components/GameDataView";
import { SearchView } from "@/components/SearchView";
import { ModsView } from "@/components/ModsView";
import { RawCpkView } from "@/components/RawCpkView";
import { ReToolsView } from "@/components/ReToolsView";
import { LuaView } from "@/components/LuaView";
import { SaveView } from "@/components/SaveView";
import { SettingsView } from "@/components/SettingsView";
import { DetailPane } from "@/components/DetailPane";
import { CommandPalette } from "@/components/CommandPalette";
import { Sidebar, type SidebarSection } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { WindowResizeHandles } from "@/components/ui/window-resize-handles";
import { useAppMenuShortcuts, type AppMenuActions } from "@/components/AppMenu";
import { api } from "@/lib/api";
import { useBridge } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { useApplyAppearance } from "@/lib/appearance";
import { PINNED_PLACES, recordVisit, usePinnedPlaces, useRecentPlaces } from "@/lib/places";
import { showPlaceContextMenu } from "@/lib/contextMenu";
import { getSettings, setSettings } from "@/lib/settings";
import { modsDb } from "@/lib/modsDb";
import { jobsDb } from "@/lib/jobsDb";

/** Largeur de la barre latérale — même valeur que `ShellLayout.tsx` de spacedrive (220 px, dont
 * 8 px de marge flottante de chaque côté), lue par `TopBar` pour se décaler d'autant. */
const SIDEBAR_WIDTH = 200;

export default function App() {
  const t = useT();
  useApplyAppearance();
  const [tab, setTab] = useState("explorer");
  const [explorer, setExplorer] = useState<ExplorerState>({ prefix: "data", selected: null });
  const [externalPath, setExternalPath] = useState<string | null>(null);
  /** Mode Éditeur — dossier courant du navigateur de contenu + asset ouvert dans le viewport. */
  const [editor, setEditor] = useState<EditorViewState>({ prefix: "data/common/chr", selected: null });

  const pins = usePinnedPlaces();
  const recents = useRecentPlaces();

  /** Navigue vers un emplacement VFS depuis la barre latérale (bascule aussi sur l'Explorateur —
   * cliquer un dossier depuis n'importe quelle vue doit l'ouvrir, comme dans spacedrive). */
  function gotoPlace(prefix: string) {
    recordVisit(prefix);
    setExternalPath(null);
    setExplorer({ prefix, selected: null });
    setTab("explorer");
  }

  // Groupes de la barre latérale — équivalent des `SpaceGroup` de spacedrive (items regroupés par
  // nature, titres de groupe en petites capitales). Les emplacements y sont intégrés comme
  // `LocationsGroup`/`TagsGroup` de l'amont, au lieu d'une seconde barre latérale interne à
  // l'Explorateur (doublon supprimé).
  const sections: SidebarSection[] = useMemo(() => {
    const inExplorer = tab === "explorer" && !externalPath;
    return [
      {
        label: null,
        items: [
          { id: "editor", label: "Éditeur", icon: "view_in_ar" },
          { id: "explorer", label: t("tab.explorer"), icon: "folder_open" },
          { id: "search", label: t("tab.search"), icon: "search" },
        ],
      },
      {
        label: "Données",
        items: [
          { id: "data", label: t("tab.data"), icon: "database" },
          { id: "cpk", label: t("tab.cpk"), icon: "deployed_code" },
          { id: "save", label: t("tab.save"), icon: "save" },
        ],
      },
      {
        label: "Outils",
        items: [
          { id: "mods", label: t("tab.mods"), icon: "extension" },
          { id: "re", label: t("tab.re"), icon: "memory" },
          { id: "lua", label: "Lua", icon: "edit_note" },
        ],
      },
      {
        label: t("explorer.places"),
        items: PINNED_PLACES.map((p) => ({
          id: `place:${p.prefix}`,
          label: p.label,
          icon: p.icon,
          title: p.prefix || "/",
          active: inExplorer && explorer.prefix === p.prefix,
          onClick: () => gotoPlace(p.prefix),
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            showPlaceContextMenu({ prefix: p.prefix, kind: "builtin", onOpen: () => gotoPlace(p.prefix) });
          },
        })),
      },
      ...(pins.length > 0
        ? [
            {
              label: "★ Épinglés",
              items: pins.map((prefix) => ({
                id: `pin:${prefix}`,
                label: prefix.split("/").pop() || prefix,
                icon: "stars",
                iconClassName: "text-accent",
                title: prefix,
                active: inExplorer && explorer.prefix === prefix,
                onClick: () => gotoPlace(prefix),
                onContextMenu: (e: React.MouseEvent) => {
                  e.preventDefault();
                  showPlaceContextMenu({ prefix, kind: "pinned", onOpen: () => gotoPlace(prefix) });
                },
              })),
            },
          ]
        : []),
      ...(recents.length > 0
        ? [
            {
              label: t("explorer.recents"),
              items: recents.map((r) => ({
                id: `recent:${r.prefix}`,
                label: r.prefix.split("/").pop() || r.prefix,
                icon: "schedule",
                title: r.prefix,
                active: inExplorer && explorer.prefix === r.prefix,
                onClick: () => gotoPlace(r.prefix),
                onContextMenu: (e: React.MouseEvent) => {
                  e.preventDefault();
                  showPlaceContextMenu({ prefix: r.prefix, kind: "recent", onOpen: () => gotoPlace(r.prefix) });
                },
              })),
            },
          ]
        : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tab, externalPath, explorer.prefix, pins, recents]);

  /** Titre affiché dans la barre supérieure — chemin courant dans l'Explorateur (comme
   * l'explorateur Windows), nom de la vue partout ailleurs. */
  const topBarTitle = useMemo(() => {
    if (externalPath) return externalPath;
    if (tab === "explorer") return explorer.selected ?? explorer.prefix ?? "data";
    if (tab === "settings") return t("tab.settings");
    for (const s of sections) {
      const found = s.items.find((i) => i.id === tab);
      if (found) return found.label;
    }
    return t("app.title");
  }, [externalPath, tab, explorer.selected, explorer.prefix, sections, t]);

  // Pont de contrôle MCP : `nie-mcp` peut piloter cette fenêtre (naviguer, ouvrir un asset,
  // changer d'onglet, notifier) — mêmes types de commandes des deux côtés, cf. `@niers/bridge`.
  // Opportuniste : sans serveur en écoute, rien ne se passe et l'application reste intacte.
  useBridge({
    getState: () => ({ tab, prefix: explorer.prefix, selected: explorer.selected, externalPath }),
    navigate: (prefix, select) => {
      recordVisit(prefix);
      setExternalPath(null);
      setExplorer({ prefix, selected: select ?? null });
      setTab("explorer");
    },
    open: (path) => {
      const slash = path.lastIndexOf("/");
      setExternalPath(null);
      setExplorer({ prefix: slash > 0 ? path.slice(0, slash) : "data", selected: path });
      setTab("explorer");
    },
    setTab: (id) => setTab(id),
    toast: (message, kind) => {
      if (kind === "success") toast.success(message);
      else if (kind === "error") toast.error(message);
      else toast(message);
    },
  });

  // Resynchronise le chrome natif Windows 11 (Mica, barre de titre/légende) sur le thème
  // clair/sombre RÉSOLU (`resolvedTheme` tient compte de "system", pas juste `theme`).
  // Best-effort silencieux (no-op hors Windows 11 côté backend).
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme) api.setTitlebarTheme(resolvedTheme === "dark").catch(() => {});
  }, [resolvedTheme]);

  // « Ouvrir avec » depuis l'explorateur Windows : argv du cold-start, ou forward-ouverture
  // (2ᵉ lancement → single-instance → événement `open-path`).
  useEffect(() => {
    api.takePendingOpen().then((p) => p && setExternalPath(p));
    const unlisten = listen<string>("open-path", (e) => setExternalPath(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Amorçage au chargement de l'appli — tout ce qui coûte cher au premier usage doit être fait
  // ICI, une fois, plutôt qu'au hasard du premier clic utilisatrice :
  //  1. `mods.db` (tauri-plugin-sql) : `Database.load` applique les migrations et CRÉE le
  //     fichier s'il est absent (premier lancement).
  //  2. Miroir wiki (`supabase-*.sqlite`) : auto-détecté et rempli dans les réglages s'il n'a
  //     jamais été choisi manuellement.
  //  3. VFS : précollecté côté Rust (~255 800 entrées) pour que la première navigation dans
  //     l'Explorateur retrouve un cache déjà chaud.
  useEffect(() => {
    modsDb.listMods().catch(() => {});
    // Journal des opérations (§8 roadmap) : tout job resté « en cours » appartient à une session
    // précédente — aucun process ne le poursuit, il est donc marqué « interrompu ». Sans ça, le
    // gestionnaire afficherait éternellement une opération fantôme.
    jobsDb
      .reconcileOnStartup()
      .then((n) => {
        if (n > 0) toast.warning(`${n} opération(s) interrompue(s) lors de la session précédente`);
      })
      .catch(() => {});
    const settings = getSettings();
    if (!settings.wikiDb.trim()) {
      api
        .defaultWikiDb(settings.gameDir)
        .then((db) => db && setSettings({ wikiDb: db }))
        .catch(() => {});
    }
    api
      .preloadVfs(settings.gameDir)
      .then((s) => toast.success(`VFS chargé : ${s.total.toLocaleString("fr-FR")} fichiers`))
      .catch((e) => toast.error(`Échec du chargement du VFS : ${e}`));
  }, []);

  // Barre de menu Fichier/Édition/Affichage : rendue DANS la barre supérieure custom, plus
  // attachée à la fenêtre. `menu.setAsWindowMenu()` (ce qui était fait ici) demande à Windows de
  // dessiner une barre de menu NATIVE, ce qui suppose une frame native — la fenêtre retrouvait
  // donc sa bordure, sa légende et ses boutons système malgré `decorations: false`. Les menus
  // déroulés restent de vrais popups Win32 (`Menu.popup()`), cf. `components/AppMenu.tsx`.
  const menuActions: AppMenuActions = useMemo(
    () => ({
      onOpenExternalPath: setExternalPath,
      onSelectTab: (id) => {
        setExternalPath(null);
        setTab(id);
      },
      tabLabels: {
        editor: "Éditeur",
        explorer: t("tab.explorer"),
        search: t("tab.search"),
        data: t("tab.data"),
        mods: t("tab.mods"),
        cpk: t("tab.cpk"),
        re: t("tab.re"),
        lua: "Lua",
        save: t("tab.save"),
        settings: t("tab.settings"),
      },
    }),
    [t],
  );
  useAppMenuShortcuts(menuActions);

  // Titre de fenêtre = même valeur que la barre supérieure (chemin courant comme l'explorateur
  // Windows, jamais un nom de produit).
  useEffect(() => {
    getCurrentWindow().setTitle(topBarTitle).catch(() => {});
  }, [topBarTitle]);

  return (
    <TooltipProvider>
      {/* Shell — portage de `ShellLayout.tsx` (spacedrive) : fond `bg-app`, coins arrondis
          `radius-window` (10 px, cf. `apply_rounded_corners` côté Rust pour que Windows arrondisse
          AUSSI la fenêtre elle-même), `select-none` global, barre supérieure en absolu au-dessus
          d'un contenu décalé de `pt-12`. */}
      <div className="relative flex h-screen w-screen select-none flex-col overflow-hidden rounded-window bg-app text-ink">
        <TopBar
          sidebarWidth={SIDEBAR_WIDTH}
          title={topBarTitle}
          onOpenPalette={() =>
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))
          }
        />

        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            sections={sections}
            current={tab}
            onSelect={(id) => {
              setExternalPath(null);
              setTab(id);
            }}
            onOpenSettings={() => {
              setExternalPath(null);
              setTab("settings");
            }}
          />

          <div className="relative z-[38] flex flex-1 flex-col overflow-hidden pt-12">
            {externalPath ? (
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
            ) : (
              <Tabs value={tab} className="h-full min-h-0">
                <TabsContent value="editor" className="h-full min-h-0">
                  <EditorView
                    state={editor}
                    onStateChange={setEditor}
                    onOpenInExplorer={(path) => {
                      setExplorer((s) => ({ ...s, selected: path }));
                      setTab("explorer");
                    }}
                  />
                </TabsContent>
                <TabsContent value="explorer" className="h-full min-h-0">
                  <ExplorerView state={explorer} onStateChange={setExplorer} />
                </TabsContent>
                <TabsContent value="search" className="h-full min-h-0">
                  <SearchView
                    onOpenFile={(path) => {
                      setExplorer((s) => ({ ...s, selected: path }));
                      setTab("explorer");
                    }}
                  />
                </TabsContent>
                <TabsContent value="data" className="h-full min-h-0">
                  <GameDataView
                  onOpenFile={(path) => {
                    setExplorer((s) => ({ ...s, selected: path }));
                    setTab("explorer");
                  }}
                />
                </TabsContent>
                <TabsContent value="mods" className="h-full min-h-0">
                  <ModsView
                    onOpenFile={(path) => {
                      setExplorer((s) => ({ ...s, selected: path }));
                      setTab("explorer");
                    }}
                  />
                </TabsContent>
                <TabsContent value="cpk" className="h-full min-h-0">
                  <RawCpkView />
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
              </Tabs>
            )}
          </div>
        </div>
      </div>
      <WindowResizeHandles />
      <CommandPalette
        onGoto={(prefix) => {
          recordVisit(prefix);
          setExplorer({ prefix, selected: null });
          setTab("explorer");
        }}
        onSearch={(q) => {
          setExplorer((s) => ({ ...s, query: q }));
          setTab("explorer");
        }}
      />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
