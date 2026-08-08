import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { open } from "@tauri-apps/plugin-dialog";
import { check as checkUpdate, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { api, type VfsStats } from "@/lib/api";
import { vfsIndexDb, type VfsIndexMeta } from "@/lib/vfsIndexDb";
import { getSettings, setSettings, useSettings, type Locale } from "@/lib/settings";
import { useT, LOCALE_LABELS } from "@/lib/i18n";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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
      <p className="type-body-small text-on-surface-variant">{hint}</p>
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
  const t = useT();
  const { theme, setTheme } = useTheme();
  const [autoGameDir, setAutoGameDir] = useState("");
  const [gameDirOk, setGameDirOk] = useState<boolean | null>(null);
  const [stats, setStats] = useState<VfsStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [indexMeta, setIndexMeta] = useState<VfsIndexMeta | null>(null);
  const [reindexing, setReindexing] = useState(false);
  const [reindexProgress, setReindexProgress] = useState<{ done: number; total: number } | null>(null);
  const [installingBlenderAddon, setInstallingBlenderAddon] = useState(false);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null);
  const [installingUpdate, setInstallingUpdate] = useState(false);

  async function checkForUpdate() {
    setCheckingUpdate(true);
    try {
      const update = await checkUpdate();
      if (update?.available) {
        setPendingUpdate(update);
        toast.success(`Mise à jour ${update.version} disponible`);
      } else {
        setPendingUpdate(null);
        toast.success("niers est à jour");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCheckingUpdate(false);
    }
  }

  async function installUpdate() {
    if (!pendingUpdate) return;
    setInstallingUpdate(true);
    try {
      await pendingUpdate.downloadAndInstall();
      await relaunch();
    } catch (e) {
      toast.error(String(e));
      setInstallingUpdate(false);
    }
  }

  async function installBlenderAddon() {
    setInstallingBlenderAddon(true);
    try {
      const msg = await api.installNiersBlenderAddon(settings.blenderExe, settings.gameDir);
      toast.success(msg);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setInstallingBlenderAddon(false);
    }
  }

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
      <Card className="elevation-1">
        <CardHeader>
          <CardTitle>{t("settings.appearance")}</CardTitle>
          <CardDescription>Langue, thème, taille de police et zoom de l'interface.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>{t("settings.language")}</Label>
              <Select value={settings.locale} onValueChange={(v) => setSettings({ locale: v as Locale })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(LOCALE_LABELS) as Locale[]).map((l) => (
                    <SelectItem key={l} value={l}>
                      {LOCALE_LABELS[l]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>{t("settings.theme")}</Label>
              <Select value={theme ?? "dark"} onValueChange={(v) => v && setTheme(v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">{t("settings.theme.light")}</SelectItem>
                  <SelectItem value="dark">{t("settings.theme.dark")}</SelectItem>
                  <SelectItem value="system">{t("settings.theme.system")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("settings.font_scale")}</Label>
              <span className="type-label-small text-on-surface-variant">
                {Math.round(settings.fontScale * 100)}%
              </span>
            </div>
            <Slider
              value={[settings.fontScale]}
              min={0.8}
              max={1.4}
              step={0.05}
              onValueChange={(v) => setSettings({ fontScale: Array.isArray(v) ? v[0] : v })}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>{t("settings.ui_zoom")}</Label>
              <span className="type-label-small text-on-surface-variant">
                {Math.round(settings.uiZoom * 100)}%
              </span>
            </div>
            <Slider
              value={[settings.uiZoom]}
              min={0.7}
              max={1.5}
              step={0.05}
              onValueChange={(v) => setSettings({ uiZoom: Array.isArray(v) ? v[0] : v })}
            />
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setSettings({ fontScale: 1, uiZoom: 1 })}
          >
            {t("settings.reset")}
          </Button>
        </CardContent>
      </Card>

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
            hint="Vide = auto-détection (NIE_GAME_DIR, dossier courant, puis VRAIE détection Steam — registre + bibliothèques + appmanifest_2799860.acf)."
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
            hint="Vide = résolution automatique (NIE_WIKI_DB / SQLITE_DB_PATH, sinon le supabase-*.sqlite le plus récent sous <jeu>/var/wiki-mirror) — utilisée pour afficher les noms réels (perso/technique/objet) dans l'Explorateur."
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
          <CardDescription>
            Pour « Ouvrir dans Blender » sur les modèles G4MD/G4MG/G4SK/G4MT. L'extension
            (<code>tools/niers</code>) est incluse dans ce dépôt ; clonée automatiquement si absente
            en dernier recours (installation distribuée pointée sur un simple jeu Steam).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
          <div className="space-y-1.5">
            <Button size="sm" variant="outline" onClick={installBlenderAddon} disabled={installingBlenderAddon}>
              {installingBlenderAddon ? "Installation…" : "🧩 Installer l'extension Blender niers"}
            </Button>
            <p className="type-body-small text-on-surface-variant">
              Installe/active <strong>vraiment</strong> l'extension dans le dossier d'addons de Blender
              (Préférences → Add-ons) — persiste au-delà d'un seul lancement, et lie sa préférence
              « Raw Data Root » au vrai dossier <code>data/</code> du jeu : un Blender ouvert
              indépendamment de nie-explorer retrouve alors squelettes partagés et pièces de personnage
              sans configuration manuelle.
            </p>
          </div>
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
          <CardTitle>Mises à jour</CardTitle>
          <CardDescription>
            Vérifie/télécharge/installe les nouvelles versions de niers. Endpoints (dans l'ordre) :{" "}
            <code>azalee.rosegriffon.fr/tools/niers</code> (page dédiée niers) puis, en repli, la
            dernière release GitHub (<code>latest.json</code>). Binaires signés (minisign), version
            actuelle : <Badge variant="secondary">v0.4.0</Badge>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button size="sm" onClick={checkForUpdate} disabled={checkingUpdate || installingUpdate}>
            {checkingUpdate ? "Vérification…" : "Vérifier les mises à jour"}
          </Button>
          {pendingUpdate && (
            <div className="space-y-1.5">
              <p className="type-body-medium text-on-surface">
                Version <strong>{pendingUpdate.version}</strong> disponible
                {pendingUpdate.date ? ` (${pendingUpdate.date})` : ""}.
              </p>
              {pendingUpdate.body && (
                <p className="type-body-small text-on-surface-variant whitespace-pre-wrap">{pendingUpdate.body}</p>
              )}
              <Button size="sm" variant="outline" onClick={installUpdate} disabled={installingUpdate}>
                {installingUpdate ? "Installation…" : "Télécharger et installer"}
              </Button>
            </div>
          )}
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
            <div className="flex flex-wrap gap-2 type-body-medium">
              <Badge variant="secondary">{indexMeta.total.toLocaleString("fr-FR")} fichiers indexés</Badge>
              <Badge variant="outline">{new Date(indexMeta.reindexed_at).toLocaleString("fr-FR")}</Badge>
            </div>
          ) : (
            <p className="type-body-medium text-on-surface-variant">Pas encore construit — repli sur la recherche en mémoire.</p>
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
          {statsError && <p className="type-body-medium text-error">{statsError}</p>}
          {stats && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2 type-body-medium">
                <Badge variant="secondary">{stats.total.toLocaleString("fr-FR")} fichiers</Badge>
                <Badge variant="secondary">{stats.cpk_count} CPK</Badge>
                <Badge variant="secondary">{stats.extra_count} extra</Badge>
                <Badge variant="secondary">{stats.loose_count} loose</Badge>
              </div>
              <table className="w-full type-body-small">
                <tbody>
                  {stats.top_ext.slice(0, 15).map(([e, c]) => (
                    <tr key={e} className="border-t border-outline-variant/30">
                      <td className="py-1 pr-2 font-mono text-on-surface">.{e}</td>
                      <td className="py-1 text-right text-on-surface-variant">{c.toLocaleString("fr-FR")}</td>
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
