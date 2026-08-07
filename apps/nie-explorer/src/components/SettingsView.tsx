import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, type VfsStats } from "@/lib/api";
import { vfsIndexDb, type VfsIndexMeta } from "@/lib/vfsIndexDb";
import { getSettings, setSettings, useSettings } from "@/lib/settings";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function Field({
  label,
  hint,
  value,
  placeholder,
  onChange,
  onBrowse,
}: {
  label: string;
  hint: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  onBrowse: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="flex gap-2">
        <Input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        <Button variant="outline" onClick={onBrowse}>
          Parcourir…
        </Button>
      </div>
    </div>
  );
}

export function SettingsView() {
  const settings = useSettings();
  const [autoGameDir, setAutoGameDir] = useState("");
  const [gameDirOk, setGameDirOk] = useState<boolean | null>(null);
  const [stats, setStats] = useState<VfsStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [indexMeta, setIndexMeta] = useState<VfsIndexMeta | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<{ done: number; total: number } | null>(null);

  function refreshIndexMeta() {
    vfsIndexDb.meta().then(setIndexMeta).catch(() => setIndexMeta(null));
  }

  useEffect(() => {
    api.defaultGameDir().then(setAutoGameDir);
    refreshIndexMeta();
  }, []);

  async function reindex() {
    setReindexing(true);
    setReindexProgress(null);
    try {
      const meta = await vfsIndexDb.reindex(settings.gameDir, (done, total) => setReindexProgress({ done, total }));
      setIndexMeta(meta);
      toast.success(`Index VFS reconstruit : ${meta.total.toLocaleString("fr-FR")} fichiers`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setReindexing(false);
      setReindexProgress(null);
    }
  }

  useEffect(() => {
    const dir = settings.gameDir || autoGameDir;
    if (!dir) return;
    api.checkGameDir(dir).then(setGameDirOk);
    api
      .stats(settings.gameDir)
      .then((s) => {
        setStats(s);
        setStatsError(null);
      })
      .catch((e) => setStatsError(String(e)));
  }, [settings.gameDir, autoGameDir]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 p-4">
      <Card>
        <CardHeader>
          <CardTitle>Répertoire du jeu</CardTitle>
          <CardDescription>
            Doit contenir <code>data/cpk_list.cfg.bin</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field
            label="Chemin"
            hint="Vide = auto-détection (NIE_GAME_DIR, sinon dossier fusionné avec le jeu)."
            value={settings.gameDir}
            placeholder={autoGameDir}
            onChange={(v) => setSettings({ gameDir: v })}
            onBrowse={async () => {
              const dir = await open({ directory: true });
              if (typeof dir === "string") setSettings({ gameDir: dir });
            }}
          />
          {gameDirOk !== null && (
            <Badge variant={gameDirOk ? "default" : "destructive"}>
              {gameDirOk ? "✓ cpk_list.cfg.bin trouvé" : "✗ cpk_list.cfg.bin introuvable à cet emplacement"}
            </Badge>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Miroir wiki (recherche chara/waza)</CardTitle>
          <CardDescription>
            Fichier <code>supabase-*.sqlite</code> (miroir <code>nie-wiki</code>).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field
            label="Base SQLite"
            hint="Vide = résolution automatique (NIE_WIKI_DB / SQLITE_DB_PATH)."
            value={settings.wikiDb}
            placeholder="(auto-détecté)"
            onChange={(v) => setSettings({ wikiDb: v })}
            onBrowse={async () => {
              const f = await open({ filters: [{ name: "SQLite", extensions: ["sqlite", "db"] }] });
              if (typeof f === "string") setSettings({ wikiDb: f });
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Blender (tools/niers)</CardTitle>
          <CardDescription>Pour « Ouvrir dans Blender » sur les modèles G4MD/G4MG/G4SK/G4MT.</CardDescription>
        </CardHeader>
        <CardContent>
          <Field
            label="blender.exe"
            hint="Vide = auto-détection (Blender Foundation\Blender 5.2\4.2\4.1\4.0)."
            value={settings.blenderExe}
            placeholder={String.raw`C:\Program Files\Blender Foundation\Blender 5.2\blender.exe`}
            onChange={(v) => setSettings({ blenderExe: v })}
            onBrowse={async () => {
              const f = await open({ filters: [{ name: "Blender", extensions: ["exe"] }] });
              if (typeof f === "string") setSettings({ blenderExe: f });
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Résolveur distant azalee</CardTitle>
          <CardDescription>
            GraphQL <code>/api/graphql</code> (sans authentification) + REST <code>/api/cpk</code> /{" "}
            <code>/api/save/resolve-roster</code> — contrat réel confirmé depuis les sources du service.
            Utilisé en <strong>bonus</strong> de l'index local (personnages/techniques/roster de save) ;
            les fichiers du jeu restent toujours résolus en local d'abord. Vide = azalee.rosegriffon.fr.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label>URL de base</Label>
            <Input
              value={settings.azaleeUrl}
              placeholder="https://azalee.rosegriffon.fr"
              onChange={(e) => setSettings({ azaleeUrl: e.target.value })}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Index VFS (précision)</CardTitle>
          <CardDescription>
            Matérialise les ~255 800 fichiers du VFS dans une table SQL indexée (<code>vfs_files</code>) pour une
            résolution EXACTE par code interne — remplace le <code>.contains()</code> substring en mémoire (faux
            positifs possibles) par <code>code = ? OR code LIKE ?_%</code>. Utilisé par « Fichiers VFS liés »
            (Recherche) dès qu'il existe.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {indexMeta ? (
            <div className="flex flex-wrap gap-2 text-sm">
              <Badge variant="secondary">{indexMeta.total.toLocaleString("fr-FR")} fichiers indexés</Badge>
              <Badge variant="outline">{new Date(indexMeta.reindexed_at).toLocaleString("fr-FR")}</Badge>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Pas encore construit — repli sur la recherche en mémoire.</p>
          )}
          <Button size="sm" onClick={reindex} disabled={reindexing}>
            {reindexing
              ? reindexProgress
                ? `Réindexation… ${reindexProgress.done.toLocaleString("fr-FR")}/${reindexProgress.total.toLocaleString("fr-FR")}`
                : "Scan du VFS…"
              : "Réindexer"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Statistiques VFS</CardTitle>
        </CardHeader>
        <CardContent>
          {statsError && <p className="text-sm text-destructive">{statsError}</p>}
          {stats && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 text-sm">
                <Badge variant="secondary">{stats.total.toLocaleString("fr-FR")} fichiers</Badge>
                <Badge variant="secondary">{stats.cpk_count} CPK</Badge>
                <Badge variant="secondary">{stats.extra_count} extra</Badge>
                <Badge variant="secondary">{stats.loose_count} loose</Badge>
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {stats.top_ext.slice(0, 15).map(([e, c]) => (
                    <tr key={e} className="border-t">
                      <td className="py-1 pr-2 font-mono">.{e}</td>
                      <td className="py-1 text-right text-muted-foreground">{c.toLocaleString("fr-FR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Button variant="ghost" size="sm" className="self-start" onClick={() => setSettings(getSettings())}>
        Rafraîchir
      </Button>
    </div>
  );
}
