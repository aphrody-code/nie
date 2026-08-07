import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { ExplorerView, type ExplorerState } from "@/components/ExplorerView";
import { SearchView } from "@/components/SearchView";
import { ModsView } from "@/components/ModsView";
import { SaveView } from "@/components/SaveView";
import { SettingsView } from "@/components/SettingsView";
import { DetailPane } from "@/components/DetailPane";
import { CommandPalette } from "@/components/CommandPalette";
import { Icon } from "@/components/ui/Icon";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useApplyAppearance } from "@/lib/appearance";
import { recordVisit } from "@/lib/places";

export default function App() {
  const t = useT();
  useApplyAppearance();
  const [tab, setTab] = useState("explorer");
  const [explorer, setExplorer] = useState<ExplorerState>({ prefix: "data", selected: null });
  const [externalPath, setExternalPath] = useState<string | null>(null);

  // « Ouvrir avec » depuis l'explorateur Windows : argv du cold-start, ou forward-ouverture
  // (2ᵉ lancement → single-instance → événement `open-path`).
  useEffect(() => {
    api.takePendingOpen().then((p) => p && setExternalPath(p));
    const unlisten = listen<string>("open-path", (e) => setExternalPath(e.payload));
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Titre de fenêtre = chemin courant (comme l'explorateur Windows), jamais un nom de produit.
  useEffect(() => {
    const title = externalPath ?? (explorer.selected ?? explorer.prefix) ?? "data";
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [externalPath, explorer.selected, explorer.prefix]);

  return (
    <TooltipProvider>
      <div className="flex h-screen w-screen flex-col bg-background/60 text-foreground">
        <div
          data-tauri-drag-region
          onDoubleClick={() => getCurrentWindow().toggleMaximize()}
          className="flex h-12 shrink-0 items-center gap-4 border-b border-outline-variant/40 bg-surface-container/70 px-3 backdrop-blur"
        >
          <span
            className="select-none pl-1 text-lg text-primary"
            style={{ fontFamily: "BradBunR, var(--font-sans)" }}
            data-tauri-drag-region
          >
            {t("app.title")}
          </span>
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="bg-surface-container-high">
              <TabsTrigger value="explorer" className="type-label-large state-layer">
                {t("tab.explorer")}
              </TabsTrigger>
              <TabsTrigger value="search" className="type-label-large state-layer">
                {t("tab.search")}
              </TabsTrigger>
              <TabsTrigger value="mods" className="type-label-large state-layer">
                {t("tab.mods")}
              </TabsTrigger>
              <TabsTrigger value="save" className="type-label-large state-layer">
                {t("tab.save")}
              </TabsTrigger>
              <TabsTrigger value="settings" className="type-label-large state-layer">
                {t("tab.settings")}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex-1" data-tauri-drag-region />
          <span className="mr-1 flex items-center gap-1 rounded-full bg-surface-container-high px-2.5 py-1 type-label-small text-on-surface-variant">
            <Icon name="search" size={12} />
            Ctrl+K
          </span>
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
              <TabsContent value="mods" className="h-full">
                <ModsView
                  onOpenFile={(path) => {
                    setExplorer((s) => ({ ...s, selected: path }));
                    setTab("explorer");
                  }}
                />
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
