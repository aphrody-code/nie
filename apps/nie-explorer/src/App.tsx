import { useEffect, useMemo, useState } from "react";
import { useTheme } from "next-themes";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { toast } from "sonner";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ExplorerView } from "@/components/ExplorerView";
import { ExplorerTabsBar } from "@/components/ExplorerTabsBar";
import { EditorView, type EditorViewState } from "@/components/editor/EditorView";
import { GameDataView } from "@/components/GameDataView";
import { SearchView } from "@/components/SearchView";
import { ModsView } from "@/components/ModsView";
import { RawCpkView } from "@/components/RawCpkView";
import { ReToolsView } from "@/components/ReToolsView";
import { LuaView } from "@/components/LuaView";
import { LiveModView } from "@/components/LiveModView";
import { ViolaView } from "@/components/ViolaView";
import { CinemaView } from "@/components/CinemaView";
import { GalleryView } from "@/components/GalleryView";
import { ToolsView } from "@/components/ToolsView";
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
import { canGoBack, canGoForward, explorerTabs, useExplorerTabs } from "@/lib/explorerTabs";
import { showPlaceContextMenu } from "@/lib/contextMenu";
import { getSettings, setSettings } from "@/lib/settings";
import { modsDb } from "@/lib/modsDb";
import { jobsDb } from "@/lib/jobsDb";
import { vfsIndexDb } from "@/lib/vfsIndexDb";

/** Largeur de la barre latérale — même valeur que `ShellLayout.tsx` de spacedrive (220 px, dont
 * 8 px de marge flottante de chaque côté), lue par `TopBar` pour se décaler d'autant. */
const SIDEBAR_WIDTH = 200;

export default function App() {
  const t = useT();
  useApplyAppearance();
  const [tab, setTab] = useState("explorer");
  // Onglets de l'Explorateur — état module-level persistant (`lib/explorerTabs.ts`), pas un
  // `useState` local : la navigation, l'historique et les préférences d'affichage appartiennent à
  // l'onglet et survivent au changement de vue comme au redémarrage de l'application.
  const tabsState = useExplorerTabs();
  const explorer = tabsState.tabs.find((x) => x.id === tabsState.activeId) ?? tabsState.tabs[0];
  const activeTabId = explorer.id;
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
    explorerTabs.update(activeTabId, { prefix, selected: null });
    setTab("explorer");
  }

  /** Ouvre un emplacement dans un NOUVEL onglet (clic milieu ou « Ouvrir dans un nouvel onglet »)
   * — le contexte de travail courant reste intact, c'est tout l'intérêt du geste. */
  function gotoPlaceInNewTab(prefix: string) {
    recordVisit(prefix);
    setExternalPath(null);
    explorerTabs.open(prefix);
    setTab("explorer");
  }

  /** Sélectionne un fichier dans l'onglet ACTIF depuis une autre vue (Recherche, Données, Mods,
   * Éditeur) et bascule sur l'Explorateur. */
  /** Ouvre l'Explorateur SUR le fichier : son dossier, puis lui sélectionné dedans.
   *
   * Ne poser que `selected` ne révélait rien — l'onglet restait sur son dossier courant, où le
   * fichier désigné n'est pas listé. Depuis la Recherche ou les Données, « ouvrir un fichier »
   * basculait donc de vue sans jamais montrer le fichier. Le préfixe est le dossier parent ;
   * un chemin sans `/` désigne la racine du VFS, qui est la chaîne vide. */
  function revealInExplorer(path: string) {
    const coupe = path.lastIndexOf("/");
    const dossier = coupe === -1 ? "" : path.slice(0, coupe);
    recordVisit(dossier);
    explorerTabs.update(activeTabId, { prefix: dossier, selected: path });
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
          { id: "cinema", label: "Cinéma", icon: "movie" },
        ],
      },
      {
        label: "Données",
        items: [
          { id: "data", label: t("tab.data"), icon: "database" },
          { id: "gallery", label: "Galerie", icon: "photo_library" },
          { id: "cpk", label: t("tab.cpk"), icon: "deployed_code" },
          { id: "save", label: t("tab.save"), icon: "save" },
        ],
      },
      {
        label: "Outils",
        items: [
          { id: "tools", label: "Outils wiki", icon: "handyman" },
          { id: "mods", label: t("tab.mods"), icon: "extension" },
          { id: "re", label: t("tab.re"), icon: "memory" },
          { id: "viola", label: "Viola", icon: "deployed_code" },
          { id: "livemod", label: "Live mod", icon: "bolt" },
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
          onAuxClick: (e: React.MouseEvent) => {
            if (e.button !== 1) return;
            e.preventDefault();
            gotoPlaceInNewTab(p.prefix);
          },
          onContextMenu: (e: React.MouseEvent) => {
            e.preventDefault();
            showPlaceContextMenu({
              prefix: p.prefix,
              kind: "builtin",
              onOpen: () => gotoPlace(p.prefix),
              onOpenInNewTab: () => gotoPlaceInNewTab(p.prefix),
            });
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
                onAuxClick: (e: React.MouseEvent) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  gotoPlaceInNewTab(prefix);
                },
                onContextMenu: (e: React.MouseEvent) => {
                  e.preventDefault();
                  showPlaceContextMenu({
                    prefix,
                    kind: "pinned",
                    onOpen: () => gotoPlace(prefix),
                    onOpenInNewTab: () => gotoPlaceInNewTab(prefix),
                  });
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
                onAuxClick: (e: React.MouseEvent) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  gotoPlaceInNewTab(r.prefix);
                },
                onContextMenu: (e: React.MouseEvent) => {
                  e.preventDefault();
                  showPlaceContextMenu({
                    prefix: r.prefix,
                    kind: "recent",
                    onOpen: () => gotoPlace(r.prefix),
                    onOpenInNewTab: () => gotoPlaceInNewTab(r.prefix),
                  });
                },
              })),
            },
          ]
        : []),
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, tab, externalPath, explorer.prefix, activeTabId, pins, recents]);

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
  // Le protocole du pont ne connaît qu'UN couple `prefix`/`selected` : il décrit et pilote donc
  // l'onglet ACTIF, jamais les autres. Étendre `@niers/bridge` aux onglets serait un changement de
  // protocole des deux côtés, hors périmètre.
  useBridge({
    getState: () => ({ tab, prefix: explorer.prefix, selected: explorer.selected, externalPath }),
    navigate: (prefix, select) => {
      recordVisit(prefix);
      setExternalPath(null);
      explorerTabs.update(activeTabId, { prefix, selected: select ?? null });
      setTab("explorer");
    },
    open: (path) => {
      const slash = path.lastIndexOf("/");
      setExternalPath(null);
      explorerTabs.update(activeTabId, { prefix: slash > 0 ? path.slice(0, slash) : "data", selected: path });
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
    // Miroir wiki : résolu maintenant s'il est déjà là (dépôt, ou base installée par un
    // lancement précédent), sinon à l'arrivée de `bases-pretes` — au tout premier lancement, la
    // décompression des bases livrées avec l'appli (~140 Mo) n'est pas encore finie ici.
    function resoudreWikiDb() {
      if (getSettings().wikiDb.trim()) return;
      api
        .defaultWikiDb(getSettings().gameDir)
        .then((db) => db && setSettings({ wikiDb: db }))
        .catch(() => {});
    }
    resoudreWikiDb();
    const arretBases = listen<string[]>("bases-pretes", () => {
      resoudreWikiDb();
      toast.success("Données embarquées prêtes (wiki + base RE)");
    });

    api
      .preloadVfs(settings.gameDir)
      .then((s) => {
        toast.success(
          `VFS chargé : ${s.total.toLocaleString("fr-FR")} fichiers (${
            s.montage === "dump" ? "dump extrait" : "packs CPK"
          })`,
        );
        // Index SQL du VFS : construit une fois, en tâche de fond, si `vfs_files` est vide ou
        // ne décrit plus le montage courant (jeu mis à jour, bascule packs↔dump). Sans lui, la
        // recherche par code et la résolution de noms retombent silencieusement sur le
        // `.contains()` approximatif de `vfs_related` — un index absent ne se voyait nulle part
        // dans l'UI, et il l'était sur ce poste (`vfs_files` = 0 ligne).
        vfsIndexDb
          .meta()
          .then((meta) => {
            if (meta && meta.total === s.total) return;
            return vfsIndexDb
              .reindex(settings.gameDir)
              .then((m) => toast.success(`Index VFS construit : ${m.total.toLocaleString("fr-FR")} fichiers`));
          })
          .catch((e) => toast.warning(`Index VFS non construit : ${e}`));
      })
      .catch(() =>
        // Sans le jeu, l'application reste utile : wiki, base RE, outils. Le message le dit,
        // plutôt que d'annoncer un échec qui laisserait croire que rien ne marche.
        toast.info("Jeu non détecté — wiki et base RE disponibles ; indiquez le dossier du jeu dans les Paramètres pour explorer les fichiers"),
      );
    return () => {
      arretBases.then((f) => f());
    };
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
        gallery: "Galerie",
        tools: "Outils wiki",
        mods: t("tab.mods"),
        cpk: t("tab.cpk"),
        re: t("tab.re"),
        viola: "Viola",
        lua: "Lua",
        save: t("tab.save"),
        settings: t("tab.settings"),
      },
    }),
    [t],
  );
  useAppMenuShortcuts(menuActions);

  // Raccourcis d'onglets. Ctrl+1…9 sélectionnent déjà une VUE (`AppMenu`), Ctrl+D épingle et
  // Ctrl+K ouvre la palette : restent les gestes de navigateur, Ctrl+T / Ctrl+W / Ctrl+Tab.
  // Posés uniquement quand l'Explorateur est réellement à l'écran, sinon Ctrl+W fermerait un
  // onglet invisible depuis une autre vue.
  useEffect(() => {
    if (tab !== "explorer" || externalPath) return;
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
  }, [tab, externalPath, activeTabId, explorer.prefix]);

  // Titre de fenêtre = même valeur que la barre supérieure (chemin courant comme l'explorateur
  // Windows, jamais un nom de produit).
  useEffect(() => {
    // `getCurrentWindow()` jette de façon SYNCHRONE hors runtime Tauri : le `.catch()` ne
    // l'attrape pas, et l'exception casse l'effet de rendu. Hors fenêtre native, il n'y a
    // simplement pas de titre à poser.
    try {
      getCurrentWindow().setTitle(topBarTitle).catch(() => {});
    } catch {
      /* pas de fenêtre Tauri */
    }
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
                    onOpenInExplorer={revealInExplorer}
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
                  <CinemaView onOpenFile={revealInExplorer} />
                </TabsContent>
                <TabsContent value="search" className="h-full min-h-0">
                  <SearchView onOpenFile={revealInExplorer} />
                </TabsContent>
                <TabsContent value="data" className="h-full min-h-0">
                  <GameDataView onOpenFile={revealInExplorer} />
                </TabsContent>
                <TabsContent value="gallery" className="h-full min-h-0">
                  <GalleryView onOpenFile={revealInExplorer} />
                </TabsContent>
                <TabsContent value="tools" className="h-full min-h-0">
                  {/* « Ses fichiers » du Traducteur : le code interne part dans la Recherche de
                      l'onglet actif — c'est le geste que le wiki ne peut pas offrir. */}
                  <ToolsView
                    onOpenSearch={(q) => {
                      explorerTabs.update(activeTabId, { query: q });
                      setTab("explorer");
                    }}
                  />
                </TabsContent>
                <TabsContent value="mods" className="h-full min-h-0">
                  <ModsView onOpenFile={revealInExplorer} />
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
              </Tabs>
            )}
          </div>
        </div>
      </div>
      <WindowResizeHandles />
      <CommandPalette
        onGoto={(prefix) => {
          recordVisit(prefix);
          explorerTabs.update(activeTabId, { prefix, selected: null });
          setTab("explorer");
        }}
        onSearch={(q) => {
          explorerTabs.update(activeTabId, { query: q });
          setTab("explorer");
        }}
      />
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
