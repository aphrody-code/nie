import { useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, type RemoteRosterEntry, type SaveBlobInfo, type SaveSummary } from "@/lib/api";
import { useSettings } from "@/lib/settings";
import { b64ToBytes, hexLines, humanSize } from "@/lib/bytes";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

function formatPlaytime(secs: number | null): string {
  if (secs == null) return "?";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h${m.toString().padStart(2, "0")}`;
}

export function SaveView() {
  const settings = useSettings();
  const [summary, setSummary] = useState<SaveSummary | null>(null);
  const [blobs, setBlobs] = useState<SaveBlobInfo[]>([]);
  const [blobHex, setBlobHex] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [roster, setRoster] = useState<RemoteRosterEntry[] | null>(null);
  const [rosterLoading, setRosterLoading] = useState(false);

  async function pickAndOpen() {
    const path = await open({ title: "Fichier de sauvegarde Lives" });
    if (typeof path !== "string") return;
    setBusy(true);
    setError(null);
    try {
      const s = await api.saveOpen(path);
      setSummary(s);
      setBlobs(await api.saveListBlobs());
      setBlobHex(null);
      setRoster(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function viewBlob(index: number) {
    try {
      const b64 = await api.saveBlobHexB64(index);
      setBlobHex(hexLines(b64ToBytes(b64), 128).join("\n"));
    } catch (e) {
      toast.error(String(e));
    }
  }

  async function resolveRoster() {
    if (!summary) return;
    setRosterLoading(true);
    try {
      const ids = summary.roster.owned.map((r) => r.id);
      const res = await api.remoteResolveRoster(settings.azaleeUrl, ids);
      setRoster(res.resolved);
      toast.success(`${res.matched}/${res.total} personnages résolus (azalee)`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setRosterLoading(false);
    }
  }

  async function exportRoundTrip() {
    const dest = await save({ defaultPath: summary?.slot_name });
    if (!dest) return;
    try {
      const n = await api.saveExport(dest);
      toast.success(`${humanSize(n)} écrits → ${dest}`);
    } catch (e) {
      toast.error(String(e));
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Alert>
        <AlertTitle>Déchiffrement local uniquement</AlertTitle>
        <AlertDescription>
          Lecture/ré-encryptage via <code>nie-save</code> (round-trip octet-identique si rien n'est
          modifié). L'édition d'octets individuels (comme <code>niers save edit</code> en CLI)
          n'est pas encore câblée ici — export en lecture/backup pour l'instant.
        </AlertDescription>
      </Alert>

      <Button onClick={pickAndOpen} disabled={busy} className="self-start">
        Ouvrir une sauvegarde…
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}

      {summary && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{summary.slot_name}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs text-muted-foreground">Joueur</div>
                <div>{summary.player_name || "?"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Niveau</div>
                <div>{summary.level_str || "?"}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Temps de jeu</div>
                <div>{formatPlaytime(summary.playtime_secs)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Slots</div>
                <div>
                  {summary.used_slots ?? "?"} / {summary.max_slots ?? "?"}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Roster</div>
                <div className="flex items-center gap-2">
                  {Array.isArray(summary.roster?.owned) ? summary.roster.owned.length : "?"} personnage(s)
                  <Button size="sm" variant="link" className="h-auto p-0" onClick={resolveRoster} disabled={rosterLoading}>
                    {rosterLoading ? "résolution…" : "résoudre les noms (azalee)"}
                  </Button>
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">ID unique</div>
                <div className="truncate font-mono text-xs">{summary.unique_id || "?"}</div>
              </div>
            </CardContent>
          </Card>

          {roster && (
            <Card>
              <CardHeader>
                <CardTitle>Roster résolu (bonus — azalee, wiki distant)</CardTitle>
              </CardHeader>
              <CardContent>
                <ScrollArea className="h-56 rounded-md border">
                  <div className="divide-y">
                    {roster.map((r) => (
                      <div key={r.id} className="flex items-center justify-between px-3 py-1.5 text-sm">
                        <span>{r.name ?? <span className="text-muted-foreground">{r.id} (inconnu)</span>}</span>
                        <span className="flex gap-1">
                          {r.element && <Badge variant="outline">{r.element}</Badge>}
                          {r.position && <Badge variant="outline">{r.position}</Badge>}
                        </span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Blobs internes</span>
                <Button size="sm" variant="outline" onClick={exportRoundTrip}>
                  Exporter (round-trip)…
                </Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {blobs.map((b, i) => (
                  <Button key={b.filename} size="sm" variant="secondary" onClick={() => viewBlob(i)}>
                    {b.filename} <Badge variant="outline" className="ml-1">{humanSize(b.size)}</Badge>
                  </Button>
                ))}
              </div>
              {blobHex && (
                <ScrollArea className="h-56 rounded-md border bg-muted/20">
                  <pre className="p-2 font-mono text-[11px] leading-relaxed">{blobHex}</pre>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
