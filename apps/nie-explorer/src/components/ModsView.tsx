import { useEffect, useState } from "react";
import { toast } from "sonner";
import { modsDb, type ModFileRow, type ModRow } from "@/lib/modsDb";
import { deleteModWorkspace, exportMod, removeStagedFile, stageReplacement } from "@/lib/modWorkspace";
import { useSettings } from "@/lib/settings";
import { humanSize } from "@/lib/bytes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function ModsView({ onOpenFile }: { onOpenFile: (path: string) => void }) {
  const settings = useSettings();
  const [mods, setMods] = useState<ModRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [files, setFiles] = useState<ModFileRow[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [vfsPathToStage, setVfsPathToStage] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setMods(await modsDb.listMods());
  }

  useEffect(() => {
    refresh();
  }, []);

  useEffect(() => {
    if (selected) modsDb.listFiles(selected).then(setFiles);
    else setFiles([]);
  }, [selected]);

  async function createMod() {
    if (!newName.trim()) return;
    const id = await modsDb.createMod(newName.trim(), newDesc.trim());
    setNewName("");
    setNewDesc("");
    setNewOpen(false);
    await refresh();
    setSelected(id);
  }

  async function toggle(mod: ModRow) {
    await modsDb.setEnabled(mod.id, !mod.enabled);
    await refresh();
  }

  async function del(mod: ModRow) {
    setBusy(true);
    try {
      const list = await modsDb.listFiles(mod.id);
      await deleteModWorkspace(mod.id, list);
      if (selected === mod.id) setSelected(null);
      await refresh();
      toast.success(`Mod « ${mod.name} » supprimé`);
    } finally {
      setBusy(false);
    }
  }

  async function stage() {
    if (!selected || !vfsPathToStage.trim()) return;
    setBusy(true);
    try {
      const ok = await stageReplacement(selected, { kind: "vfs", path: vfsPathToStage.trim() }, settings.gameDir);
      if (ok) {
        setVfsPathToStage("");
        setFiles(await modsDb.listFiles(selected));
        await refresh();
        toast.success("Fichier de remplacement ajouté");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function unstage(f: ModFileRow) {
    await removeStagedFile(f.id, f.staged_file, f.original_file);
    if (selected) setFiles(await modsDb.listFiles(selected));
    await refresh();
  }

  async function doExport(intoGameDir: boolean) {
    if (!selected) return;
    setBusy(true);
    try {
      const dest = await exportMod(files, { intoGameDir, gameDir: settings.gameDir });
      if (dest) toast.success(`Exporté → ${dest}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  const current = mods.find((m) => m.id === selected) ?? null;

  return (
    <div className="grid h-full grid-cols-[320px_1fr] gap-3 p-3">
      <div className="flex min-h-0 flex-col gap-2">
        <Dialog open={newOpen} onOpenChange={setNewOpen}>
          <DialogTrigger render={<Button size="sm">+ Nouveau mod</Button>} />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Nouveau mod</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Nom</Label>
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={newDesc} onChange={(e) => setNewDesc(e.target.value)} />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={createMod} disabled={!newName.trim()}>
                Créer
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <ScrollArea className="min-h-0 flex-1 rounded-md border">
          <div className="divide-y">
            {mods.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelected(m.id)}
                className={`flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent ${
                  selected === m.id ? "bg-accent" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{m.name}</span>
                  <span className="text-xs text-muted-foreground">{m.file_count} fichier(s)</span>
                </span>
                <Switch checked={!!m.enabled} onCheckedChange={() => toggle(m)} onClick={(e) => e.stopPropagation()} />
              </button>
            ))}
            {mods.length === 0 && <p className="p-3 text-sm text-muted-foreground">Aucun mod pour l'instant.</p>}
          </div>
        </ScrollArea>
      </div>

      <div className="min-h-0">
        {!current ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Sélectionnez ou créez un mod.
          </div>
        ) : (
          <div className="flex h-full flex-col gap-3">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  <span>{current.name}</span>
                  <Button size="sm" variant="destructive" onClick={() => del(current)} disabled={busy}>
                    Supprimer le mod
                  </Button>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {current.description && <p className="text-sm text-muted-foreground">{current.description}</p>}
                <div className="flex gap-2">
                  <Input
                    placeholder="Chemin VFS à remplacer (ex. data/dx11/chr/.../c01000100.g4tx)"
                    value={vfsPathToStage}
                    onChange={(e) => setVfsPathToStage(e.target.value)}
                  />
                  <Button size="sm" onClick={stage} disabled={busy || !vfsPathToStage.trim()}>
                    Choisir le remplacement…
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Astuce : dans l'Explorateur, ouvrez le fichier visé puis « Extraire vers… » pour obtenir une base à
                  éditer avant de la sélectionner ici.
                </p>
              </CardContent>
            </Card>

            <ScrollArea className="min-h-0 flex-1 rounded-md border">
              <div className="divide-y">
                {files.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <button className="min-w-0 truncate text-left hover:underline" onClick={() => onOpenFile(f.vfs_path)} title={f.vfs_path}>
                      {f.vfs_path}
                    </button>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                      {f.staged_size != null && humanSize(f.staged_size)}
                      <Button size="sm" variant="ghost" onClick={() => unstage(f)}>
                        ✕
                      </Button>
                    </span>
                  </div>
                ))}
                {files.length === 0 && <p className="p-3 text-sm text-muted-foreground">Aucun fichier remplacé.</p>}
              </div>
            </ScrollArea>

            <Alert>
              <AlertTitle>Export</AlertTitle>
              <AlertDescription>
                Aucun encodeur CPK n'existe dans <code>nie-formats</code> : l'export copie toujours des fichiers
                externes, jamais une modification en place des packs du jeu.
              </AlertDescription>
            </Alert>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => doExport(false)} disabled={busy || files.length === 0}>
                Exporter vers un dossier…
              </Button>
              <Button variant="outline" onClick={() => doExport(true)} disabled={busy || files.length === 0}>
                ⚠️ Exporter dans le dossier du jeu (overlay loose-file, non confirmé)
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
