import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Menu, Submenu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ExplorerView, type ExplorerState } from "@/components/ExplorerView";
import { GameDataView } from "@/components/GameDataView";
import { SearchView } from "@/components/SearchView";
import { ModsView } from "@/components/ModsView";
import { RawCpkView } from "@/components/RawCpkView";
import { ReToolsView } from "@/components/ReToolsView";
import { SaveView } from "@/components/SaveView";
import { SettingsView } from "@/components/SettingsView";
import { DetailPane } from "@/components/DetailPane";
import { CommandPalette } from "@/components/CommandPalette";
import { Icon } from "@/components/ui/Icon";
import { WindowControls } from "@/components/ui/window-controls";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useApplyAppearance } from "@/lib/appearance";
import { recordVisit } from "@/lib/places";
import { getSettings, setSettings } from "@/lib/settings";
import { modsDb } from "@/lib/modsDb";
import { copySelectionActive, selectAllActive, pasteActive } from "@/lib/editBus";

export default function App() {
  const t = useT();
  useApplyAppearance();
  const [tab, setTab] = useState("explorer");
  const [explorer, setExplorer] = useState<ExplorerState>({ prefix: "data", selected: null });
  const [externalPath, setExternalPath] = useState<string | null>(null);

  // Resynchronise le chrome natif Windows 11 (Mica, barre de titre/légende) sur le thème
  // clair/sombre RÉSOLU (`resolvedTheme` tient compte de "system", pas juste `theme`) — corrige
  // le fait que le chrome natif restait figé en sombre (posé une seule fois au lancement côté
  // Rust) même si l'utilisatrice bascule en clair dans Paramètres. Best-effort silencieux (no-op
  // hors Windows 11 côté backend).
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
  //     fichier s'il est absent (premier lancement) — déclenché explicitement plutôt que laissé
  //     au hasard du premier onglet visité (Mods/Recherche/Réindexation).
  //  2. Miroir wiki (`supabase-*.sqlite`) : auto-détecté (`var/wiki-mirror/` à côté du jeu, ou
  //     `NIE_WIKI_DB`/`SQLITE_DB_PATH`) et rempli dans les réglages s'il n'a jamais été choisi
  //     manuellement — sans ça, le champ restait vide sur toute machine hors dev WSL.
  //  3. VFS : précollecté côté Rust (~255 800 entrées) pour que la première navigation dans
  //     l'Explorateur retrouve un cache déjà chaud (cf. `preload_vfs` + cache dans `VfsState`).
  useEffect(() => {
    modsDb.listMods().catch(() => {});
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

  // Barre de menu native — File/Édition/Affichage comme VS Code (demande utilisateur « la top
  // bar native fichier, editer, etc comme vs code, ouvrir un fichier ouvrir un dossier »). API
  // Tauri v2 NATIVE (`@tauri-apps/api/menu`, déjà utilisée pour le menu contextuel clic droit,
  // cf. `src/lib/contextMenu.ts`) — `setAsWindowMenu()` l'attache comme VRAIE barre de menu
  // Windows sous la barre de titre, pas une imitation HTML.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fileMenu = await Submenu.new({
        text: "Fichier",
        items: [
          {
            text: "Ouvrir un fichier…",
            action: async () => {
              const picked = await open({ title: "Ouvrir un fichier" });
              if (typeof picked === "string") setExternalPath(picked);
            },
          },
          {
            text: "Ouvrir le dossier du jeu…",
            action: async () => {
              const picked = await open({ title: "Dossier du jeu", directory: true });
              if (typeof picked === "string") {
                setSettings({ gameDir: picked });
                toast.success(`Dossier du jeu : ${picked}`);
              }
            },
          },
          {
            text: "Ouvrir un CPK…",
            action: () => setTab("cpk"),
          },
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ text: "Quitter", item: "Quit" }),
        ],
      });

      // « Copier »/« Tout sélectionner »/« Coller » ne sont PAS les `PredefinedMenuItem` Copy/
      // SelectAll/Paste de l'OS — ces commandes texte natives n'agissent que sur un champ de
      // saisie FOCUSÉ, jamais sur la liste de fichiers HTML custom de l'Explorateur (c'est pour
      // ça qu'elles ne faisaient rien). Ici, de VRAIS `MenuItem` délèguent à la vue active via
      // `editBus` (cf. `src/lib/editBus.ts`) — mêmes actions que Ctrl+A/Ctrl+C dans l'Explorateur.
      const editMenu = await Submenu.new({
        text: "Édition",
        items: [
          { text: "Copier le chemin", accelerator: "CmdOrCtrl+C", action: () => copySelectionActive() },
          { text: "Tout sélectionner", accelerator: "CmdOrCtrl+A", action: () => selectAllActive() },
          await PredefinedMenuItem.new({ item: "Separator" }),
          { text: "Coller…", accelerator: "CmdOrCtrl+V", action: () => pasteActive() },
        ],
      });

      // Accélérateurs RÉELS (`accelerator`), pas juste du texte d'indice — fonctionnent au
      // clavier globalement, pas seulement au clic sur le menu (Ctrl+=/Ctrl+-/Ctrl+0 pour le
      // zoom = même convention que Chrome/VS Code).
      const viewMenu = await Submenu.new({
        text: "Affichage",
        items: [
          { text: t("tab.explorer"), accelerator: "CmdOrCtrl+1", action: () => setTab("explorer") },
          { text: t("tab.search"), accelerator: "CmdOrCtrl+2", action: () => setTab("search") },
          { text: t("tab.data"), accelerator: "CmdOrCtrl+3", action: () => setTab("data") },
          { text: t("tab.mods"), accelerator: "CmdOrCtrl+4", action: () => setTab("mods") },
          { text: t("tab.cpk"), accelerator: "CmdOrCtrl+5", action: () => setTab("cpk") },
          { text: t("tab.re"), accelerator: "CmdOrCtrl+6", action: () => setTab("re") },
          { text: t("tab.save"), accelerator: "CmdOrCtrl+7", action: () => setTab("save") },
          { text: t("tab.settings"), accelerator: "CmdOrCtrl+8", action: () => setTab("settings") },
          await PredefinedMenuItem.new({ item: "Separator" }),
          {
            text: "Zoom avant",
            accelerator: "CmdOrCtrl+Equal",
            action: () => setSettings({ uiZoom: Math.min(1.5, getSettings().uiZoom + 0.1) }),
          },
          {
            text: "Zoom arrière",
            accelerator: "CmdOrCtrl+Minus",
            action: () => setSettings({ uiZoom: Math.max(0.7, getSettings().uiZoom - 0.1) }),
          },
          { text: "Réinitialiser le zoom", accelerator: "CmdOrCtrl+0", action: () => setSettings({ uiZoom: 1 }) },
        ],
      });

      const menu = await Menu.new({ items: [fileMenu, editMenu, viewMenu] });
      if (!cancelled) await menu.setAsWindowMenu();
    })().catch((e) => {
      // Remonté en toast (PAS avalé silencieusement) : un échec silencieux ici ressemblerait
      // justement à une barre de menu « pas vraiment branchée à l'OS ».
      toast.error(`Barre de menu native indisponible : ${e}`);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Titre de fenêtre = chemin courant (comme l'explorateur Windows), jamais un nom de produit.
  useEffect(() => {
    const title = externalPath ?? (explorer.selected ?? explorer.prefix) ?? "data";
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [externalPath, explorer.selected, explorer.prefix]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col bg-background/60 text-foreground">
        {/* Fenêtre SANS bordure (`decorations: false`, cf. `tauri.conf.json`) — chrome custom
            porté du frameless look de spacedrive/spaceui (barre unique intégrant navigation +
            contrôles de fenêtre, cf. `var/spacedrive/docs/public/SDGridView.webp`). Toute la
            zone vide de la barre est une VRAIE zone de déplacement (`data-tauri-drag-region`,
            double-clic = agrandir/restaurer, natif Tauri) — les éléments interactifs (onglets,
            recherche, contrôles de fenêtre) l'excluent implicitement en étant des `<button>`
            cliqués normalement. Bordure TOUJOURS sombre pour marquer la limite avec le fond. */}
        <div
          data-tauri-drag-region
          className="flex h-12 shrink-0 items-center gap-4 border-b border-chrome-border bg-surface-container/70 px-3 backdrop-blur"
        >
          {/* Icône aphrody à la place du wordmark texte (demande utilisateur) — `alt`/`title`
              gardent le nom accessible au survol/pour les lecteurs d'écran. */}
          <img
            src="/brand/aphrody-icon.png"
            alt={t("app.title")}
            title={t("app.title")}
            className="size-8 shrink-0 select-none rounded-lg"
            draggable={false}
          />
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="bg-surface-container-high">
              {/* Material Symbols au lieu du texte (demande utilisateur) — `title`/`aria-label`
                  conservent l'intitulé complet au survol/pour les lecteurs d'écran, même motif
                  que les boutons icône déjà présents dans l'Explorateur. */}
              <TabsTrigger value="explorer" className="state-layer" title={t("tab.explorer")} aria-label={t("tab.explorer")}>
                <Icon name="folder_open" size={18} />
              </TabsTrigger>
              <TabsTrigger value="search" className="state-layer" title={t("tab.search")} aria-label={t("tab.search")}>
                <Icon name="search" size={18} />
              </TabsTrigger>
              <TabsTrigger value="data" className="state-layer" title={t("tab.data")} aria-label={t("tab.data")}>
                <Icon name="database" size={18} />
              </TabsTrigger>
              <TabsTrigger value="mods" className="state-layer" title={t("tab.mods")} aria-label={t("tab.mods")}>
                <Icon name="extension" size={18} />
              </TabsTrigger>
              <TabsTrigger value="cpk" className="state-layer" title={t("tab.cpk")} aria-label={t("tab.cpk")}>
                <Icon name="deployed_code" size={18} />
              </TabsTrigger>
              <TabsTrigger value="re" className="state-layer" title={t("tab.re")} aria-label={t("tab.re")}>
                <Icon name="memory" size={18} />
              </TabsTrigger>
              <TabsTrigger value="save" className="state-layer" title={t("tab.save")} aria-label={t("tab.save")}>
                <Icon name="save" size={18} />
              </TabsTrigger>
              <TabsTrigger value="settings" className="state-layer" title={t("tab.settings")} aria-label={t("tab.settings")}>
                <Icon name="settings" size={18} />
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex-1" />
          {/* Pill de recherche centrée cliquable — même langage visuel que la barre « Search… »
              de spacedrive (capture ci-dessus), ouvre la VRAIE palette de commandes (même
              raccourci que Ctrl+K, déclenché via un `KeyboardEvent` synthétique — pas de nouvel
              état partagé pour un simple bouton). */}
          <button
            className="state-layer mr-1 flex items-center gap-1.5 rounded-full bg-surface-container-high px-3 py-1.5 type-label-small text-on-surface-variant hover:text-on-surface"
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
          >
            <Icon name="search" size={13} />
            <span>Rechercher…</span>
            <kbd className="ml-1 rounded border border-outline-variant/60 px-1 text-[10px] opacity-70">Ctrl+K</kbd>
          </button>
          <WindowControls />
        </div>

        <main className="min-h-0 flex-1 bg-background">
          {externalPath ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b border-outline-variant/40 bg-secondary-container/40 px-4 py-2 type-body-small text-on-secondary-container">
                <span>{t("external.opened")}</span>
                <button
                  className="type-label-medium text-on-secondary-container/80 hover:text-on-secondary-container hover:underline"
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
            <Tabs value={tab} className="h-full">
              <TabsContent value="explorer" className="h-full">
                <ExplorerView state={explorer} onStateChange={setExplorer} />
              </TabsContent>
              <TabsContent value="search" className="h-full">
                <SearchView
                  onOpenFile={(path) => {
                    setExplorer((s) => ({ ...s, selected: path }));
                    setTab("explorer");
                  }}
                />
              </TabsContent>
              <TabsContent value="data" className="h-full">
                <GameDataView />
              </TabsContent>
              <TabsContent value="mods" className="h-full">
                <ModsView
                  onOpenFile={(path) => {
                    setExplorer((s) => ({ ...s, selected: path }));
                    setTab("explorer");
                  }}
                />
              </TabsContent>
              <TabsContent value="cpk" className="h-full">
                <RawCpkView />
              </TabsContent>
              <TabsContent value="re" className="h-full">
                <ReToolsView />
              </TabsContent>
              <TabsContent value="save" className="h-full overflow-auto">
                <SaveView />
              </TabsContent>
              <TabsContent value="settings" className="h-full overflow-auto">
                <SettingsView />
              </TabsContent>
            </Tabs>
          )}
        </main>
      </div>
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
