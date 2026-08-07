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
import { api } from "@/lib/api";

export default function App() {
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
          className="flex h-11 shrink-0 items-center gap-3 border-b bg-background/40 px-3 backdrop-blur"
        >
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="explorer">Explorateur</TabsTrigger>
              <TabsTrigger value="search">Recherche</TabsTrigger>
              <TabsTrigger value="mods">Mods</TabsTrigger>
              <TabsTrigger value="save">Sauvegardes</TabsTrigger>
              <TabsTrigger value="settings">Paramètres</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex-1" data-tauri-drag-region />
        </div>

        <main className="min-h-0 flex-1">
          {externalPath ? (
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-between border-b px-4 py-2 text-sm">
                <span>Fichier ouvert depuis l'explorateur Windows</span>
                <button className="text-xs text-muted-foreground hover:underline" onClick={() => setExternalPath(null)}>
                  ✕ fermer
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
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
