import { useEffect, useMemo, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { b64ToBytes, bytesToB64, hexLines, humanSize } from "@/lib/bytes";
import { modsDb, type ModRow } from "@/lib/modsDb";
import { stageReplacement } from "@/lib/modWorkspace";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const BLENDER_EXTS = new Set(["g4md", "g4mg", "g4sk", "g4mt"]);

export interface DetailTarget {
  kind: "vfs" | "disk";
  path: string;
}

export function DetailPane({ target }: { target: DetailTarget | null }) {
  const settings = useSettings();
  const [lines, setLines] = useState<string[]>([]);
  const [pngUrl, setPngUrl] = useState<string | null>(null);
  const [rawBytes, setRawBytes] = useState<Uint8Array | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mods, setMods] = useState<ModRow[]>([]);
  const [modChoice, setModChoice] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [glbError, setGlbError] = useState<string | null>(null);
  const [glbLoading, setGlbLoading] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState(false);

  const ext = useMemo(() => (target ? target.path.split(".").pop()?.toLowerCase() ?? "" : ""), [target]);
  const name = useMemo(() => (target ? target.path.split(/[\\/]/).pop() ?? target.path : ""), [target]);

  useEffect(() => {
    setLines([]);
    setPngUrl(null);
    setRawBytes(null);
    setEditText("");
    setError(null);
    setVideoUrl(null);
    setVideoError(null);
    setGlbUrl(null);
    setGlbError(null);
    setAudioUrl(null);
    setAudioError(null);
    if (!target) return;

    const describe = target.kind === "vfs" ? api.describe(target.path, settings.gameDir) : api.describeDiskFile(target.path);
    describe.then(setLines).catch((e) => setError(String(e)));

    if (ext === "g4tx" && target.kind === "vfs") {
      api
        .texturePngB64(target.path, settings.gameDir)
        .then((b64) => setPngUrl(`data:image/png;base64,${b64}`))
        .catch(() => {});
    }
  }, [target, ext, settings.gameDir]);

  useEffect(() => {
    modsDb.listMods().then(setMods).catch(() => {});
    if (target) modsDb.addRecent(target.path, target.kind).catch(() => {});
  }, [target]);

  async function stageIntoMod() {
    if (!target || !modChoice) return;
    setBusy(true);
    try {
      const ok = await stageReplacement(modChoice, target, settings.gameDir);
      if (ok) toast.success("Ajouté au mod");
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function loadRaw() {
    if (!target) return;
    setBusy(true);
    try {
      const b64 = target.kind === "vfs" ? await api.readB64(target.path, settings.gameDir) : await api.readDiskFileB64(target.path);
      const bytes = b64ToBytes(b64);
      setRawBytes(bytes);
      setEditText(Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" "));
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function extract() {
    if (!target) return;
    const dest = await save({ defaultPath: name });
    if (!dest) return;
    setBusy(true);
    try {
      const written =
        target.kind === "vfs"
          ? await api.extractTo(target.path, dest, settings.gameDir)
          : await api.saveBytesB64(dest, bytesToB64(await api.readDiskFileB64(target.path).then(b64ToBytes)));
      toast.success(`${humanSize(written)} écrits → ${dest}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdited() {
    const hex = editText.replace(/[^0-9a-fA-F]/g, "");
    if (hex.length % 2 !== 0) {
      toast.error("Hex invalide (nombre impair de chiffres)");
      return;
    }
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    const dest = await save({ defaultPath: name });
    if (!dest) return;
    setBusy(true);
    try {
      const written = await api.saveBytesB64(dest, bytesToB64(bytes));
      toast.success(`Copie modifiée écrite (${humanSize(written)}) → ${dest}`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyPath() {
    if (!target) return;
    await writeText(target.path);
    toast.success("Chemin copié");
  }

  async function loadGlb() {
    if (!target || target.kind !== "vfs") return;
    setGlbLoading(true);
    setGlbError(null);
    try {
      const b64 = await api.glbPreviewPngB64(target.path, settings.gameDir);
      setGlbUrl(`data:image/png;base64,${b64}`);
    } catch (e) {
      setGlbError(String(e));
    } finally {
      setGlbLoading(false);
    }
  }

  async function loadAudio() {
    if (!target || target.kind !== "vfs") return;
    setAudioLoading(true);
    setAudioError(null);
    try {
      const b64 = await api.audioPreviewB64(target.path, settings.gameDir);
      setAudioUrl(`data:audio/wav;base64,${b64}`);
    } catch (e) {
      setAudioError(String(e));
    } finally {
      setAudioLoading(false);
    }
  }

  async function loadVideo() {
    if (!target || target.kind !== "vfs") return;
    setVideoLoading(true);
    setVideoError(null);
    try {
      const b64 = await api.videoPreviewB64(target.path, settings.gameDir);
      setVideoUrl(`data:video/mp4;base64,${b64}`);
    } catch (e) {
      setVideoError(String(e));
    } finally {
      setVideoLoading(false);
    }
  }

  async function openBlender() {
    if (!target || target.kind !== "vfs") return;
    setBusy(true);
    try {
      const msg = await api.openInBlender(target.path, settings.blenderExe, settings.gameDir);
      toast.success(msg);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!target) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Sélectionnez un fichier pour l'aperçu.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="truncate font-medium" title={target.path}>
            {name}
          </h3>
          {target.kind === "disk" && <Badge variant="secondary">fichier externe</Badge>}
        </div>
        <p className="truncate text-xs text-muted-foreground" title={target.path}>
          {target.path}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={extract} disabled={busy}>
          Extraire vers…
        </Button>
        <Button size="sm" variant="outline" onClick={copyPath}>
          Copier le chemin
        </Button>
        {target.kind === "vfs" && BLENDER_EXTS.has(ext) && (
          <Button size="sm" variant="outline" onClick={openBlender} disabled={busy}>
            🧊 Ouvrir dans Blender
          </Button>
        )}
        {target.kind === "vfs" && (ext === "g4md" || ext === "g4mg") && !glbUrl && (
          <Button size="sm" variant="outline" onClick={loadGlb} disabled={glbLoading}>
            {glbLoading ? "Rendu nie-render3d…" : "🧊 Aperçu 3D (natif)"}
          </Button>
        )}
        {target.kind === "vfs" && ext === "usm" && !videoUrl && (
          <Button size="sm" variant="outline" onClick={loadVideo} disabled={videoLoading}>
            {videoLoading ? "Remuxage ffmpeg…" : "▶️ Aperçu vidéo"}
          </Button>
        )}
        {target.kind === "vfs" && ["acb", "awb", "hca", "adx"].includes(ext) && !audioUrl && (
          <Button size="sm" variant="outline" onClick={loadAudio} disabled={audioLoading}>
            {audioLoading ? "Décodage HCA/ADX…" : "🔊 Aperçu audio"}
          </Button>
        )}
      </div>

      {glbError && <p className="text-sm text-destructive">{glbError}</p>}
      {glbUrl && (
        <div className="max-h-96 overflow-auto rounded-md border bg-muted/30 p-2">
          <img src={glbUrl} alt={`Rendu 3D de ${name}`} className="max-w-full" />
        </div>
      )}

      {audioError && <p className="text-sm text-destructive">{audioError}</p>}
      {audioUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <audio src={audioUrl} controls className="w-full" />
      )}

      {videoError && <p className="text-sm text-destructive">{videoError}</p>}
      {videoUrl && (
        // eslint-disable-next-line jsx-a11y/media-has-caption
        <video src={videoUrl} controls className="max-h-72 w-full rounded-md border bg-black" />
      )}

      {mods.length > 0 && (
        <div className="flex items-center gap-2">
          <select
            className="h-8 rounded-md border bg-background px-2 text-sm"
            value={modChoice}
            onChange={(e) => setModChoice(e.target.value)}
          >
            <option value="">Ajouter à un mod…</option>
            {mods.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={stageIntoMod} disabled={!modChoice || busy}>
            Choisir le remplacement…
          </Button>
        </div>
      )}

      <Separator />

      {error && <p className="text-sm text-destructive">{error}</p>}

      {pngUrl && (
        <div className="max-h-64 overflow-auto rounded-md border bg-muted/30 p-2">
          <img src={pngUrl} alt={name} className="max-w-full" />
        </div>
      )}

      <ScrollArea className="min-h-0 flex-1 rounded-md border bg-muted/20">
        <pre className="whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed">{lines.join("\n") || "…"}</pre>
      </ScrollArea>

      <Tabs defaultValue="hex" className="shrink-0">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="hex" onClick={loadRaw}>
              Hex (lecture)
            </TabsTrigger>
            <TabsTrigger value="edit" onClick={loadRaw}>
              Éditer (copie)
            </TabsTrigger>
          </TabsList>
          {busy && <span className="text-xs text-muted-foreground">chargement…</span>}
        </div>
        <TabsContent value="hex">
          <ScrollArea className="h-40 rounded-md border bg-muted/20">
            <pre className="p-2 font-mono text-[11px] leading-relaxed">
              {rawBytes ? hexLines(rawBytes).join("\n") : "(cliquez pour charger)"}
            </pre>
          </ScrollArea>
        </TabsContent>
        <TabsContent value="edit" className="space-y-2">
          <textarea
            className="h-40 w-full resize-none rounded-md border bg-background p-2 font-mono text-[11px] leading-relaxed outline-none"
            spellCheck={false}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            placeholder="(cliquez sur l'onglet pour charger les octets)"
          />
          <p className="text-xs text-muted-foreground">
            Édite une copie en mémoire — n'écrit jamais dans le CPK d'origine (aucun encodeur CPK
            dans <code>nie-formats</code>) : « Enregistrer » exporte toujours un fichier externe.
          </p>
          <Button size="sm" onClick={saveEdited} disabled={!editText}>
            Enregistrer la copie modifiée sous…
          </Button>
        </TabsContent>
      </Tabs>
    </div>
  );
}
