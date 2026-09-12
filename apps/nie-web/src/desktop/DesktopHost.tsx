/**
 * The native host — the same application, with the resources the Tauri backend serves.
 *
 * ## What it owns, and why only this
 *
 * Everything below it is the ONE application (`src/App.tsx`): same routes, same shell, same
 * screens. What is genuinely native lives here, and nowhere else:
 *
 *  - the resource source, built on the Rust command surface instead of HTTP;
 *  - the startup work a window does once — the mods database, the interrupted-jobs reconciliation,
 *    the wiki mirror, the VFS preload and its SQL index;
 *  - the Windows 11 title-bar chrome, which follows the resolved theme.
 *
 * These used to sit inside the workspace component, which is why they only ran when someone opened
 * `/inacord`, and ran again as a second application on top of the site.
 */
import { useSettings } from "@niers/inacord-ui/lib/settings";
import { getSettings, setSettings } from "@niers/inacord-ui/lib/settings";
import { ThemeProvider, useTheme } from "next-themes";
import { useEffect, useMemo } from "react";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { App } from "../App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { api } from "./lib/api";
import { setExternalPath } from "./lib/externalPath";
import { jobsDb } from "./lib/jobsDb";
import { modsDb } from "./lib/modsDb";
import { creerDesktopSource } from "./lib/desktop-source";
import { vfsIndexDb } from "./lib/vfsIndexDb";
import "../app.css";

/**
 * Amorçage au chargement de l'application — tout ce qui coûte cher au premier usage est fait ICI,
 * une fois, plutôt qu'au hasard du premier clic utilisatrice.
 */
function useNativeBootstrap(): void {
  // Resynchronise le chrome natif Windows 11 (Mica, barre de titre/légende) sur le thème
  // clair/sombre RÉSOLU (`resolvedTheme` tient compte de "system", pas juste `theme`).
  // Best-effort silencieux (no-op hors Windows 11 côté backend).
  const { resolvedTheme } = useTheme();
  useEffect(() => {
    if (resolvedTheme) api.setTitlebarTheme(resolvedTheme === "dark").catch(() => {});
  }, [resolvedTheme]);

  // « Ouvrir avec » depuis l'explorateur du système : argv du cold-start, ou forward-ouverture
  // (2ᵉ lancement → single-instance → événement `open-path`). Native by construction — a page has
  // no argv and no second launch, and `listen()` throws synchronously without the Tauri runtime.
  useEffect(() => {
    api.takePendingOpen().then((p) => p && setExternalPath(p)).catch(() => {});
    const unlisten = listen<string>("open-path", (e) => setExternalPath(e.payload));
    return () => {
      unlisten.then((f) => f()).catch(() => {});
    };
  }, []);

  useEffect(() => {
    //  1. `mods.db` (tauri-plugin-sql) : `Database.load` applique les migrations et CRÉE le
    //     fichier s'il est absent (premier lancement).
    modsDb.listMods().catch(() => {});
    // Journal des opérations : tout job resté « en cours » appartient à une session précédente —
    // aucun process ne le poursuit, il est donc marqué « interrompu ». Sans ça, le gestionnaire
    // afficherait éternellement une opération fantôme.
    jobsDb
      .reconcileOnStartup()
      .then((n) => {
        if (n > 0) toast.warning(`${n} opération(s) interrompue(s) lors de la session précédente`);
      })
      .catch(() => {});
    const settings = getSettings();
    //  2. Miroir wiki : résolu maintenant s'il est déjà là (dépôt, ou base installée par un
    //     lancement précédent), sinon à l'arrivée de `bases-pretes` — au tout premier lancement,
    //     la décompression des bases livrées avec l'appli (~140 Mo) n'est pas encore finie ici.
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

    //  3. VFS : précollecté côté Rust (~255 800 entrées) pour que la première navigation dans
    //     l'Explorateur retrouve un cache déjà chaud.
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
        // `.contains()` approximatif de `vfs_related`.
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
      arretBases.then((f) => f()).catch(() => {});
    };
  }, []);
}

/**
 * La source est mémorisée SUR LA RACINE DU JEU, et pas une fois pour toutes : l'utilisateur peut
 * la changer depuis les réglages en cours de session. Figée au premier rendu, elle continuerait
 * d'interroger l'ancien dossier — l'interface montrerait les fichiers d'un jeu que l'utilisateur
 * croit avoir quitté, sans la moindre erreur pour le signaler.
 */
function NativeApp() {
  const { gameDir } = useSettings();
  const source = useMemo(() => creerDesktopSource(gameDir), [gameDir]);
  useNativeBootstrap();
  return <App source={source} />;
}

export default function DesktopHost() {
  return (
    <ErrorBoundary zone="Application">
      <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
        <NativeApp />
      </ThemeProvider>
    </ErrorBoundary>
  );
}
