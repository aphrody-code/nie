// Menu contextuel natif (clic droit) — API Tauri v2 NATIVE (`@tauri-apps/api/menu`, déjà
// embarquée dans `@tauri-apps/api`), PAS `tauri-plugin-context-menu` (demandé initialement) :
// ce plugin est explicitement documenté « Tauri v1 Plugin Context Menu », en mode maintenance,
// et son propre README recommande l'API native v2 pour tout projet v2 (« Tauri v2 has been
// released and it supports creating native context menu without plugins »). `Menu.popup()`
// rend un VRAI menu popup Win32 (`TrackPopupMenu` sous le capot), pas un `<div>` HTML — mais
// tout échec silencieux ici (permission manquante, etc.) ressemblerait justement à un menu
// « web slop » qui ne répond pas : chaque action ET l'appel `popup()` lui-même sont donc
// protégés par un `try/catch` qui remonte l'erreur en toast plutôt que de l'avaler.
import { Menu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { tempDir, join } from "@tauri-apps/api/path";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { openPath } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { humanSize } from "@/lib/bytes";
import { clearRecents, forgetRecent, isPinned, togglePin } from "@/lib/places";

const BLENDER_EXTS = new Set(["g4md", "g4mg", "g4sk", "g4mt"]);

async function popupOrReport(menu: Menu): Promise<void> {
  try {
    await menu.popup();
  } catch (e) {
    toast.error(`Menu contextuel indisponible : ${e}`);
  }
}

/**
 * « Ouvrir avec l'application par défaut » — un fichier VFS/CPK n'est PAS un fichier réel (à
 * l'intérieur d'un CPK) : on l'extrait d'abord vers un cache temporaire (même dossier RÉUTILISÉ
 * par nom, pas un `Math.random()` à chaque clic — un second « Ouvrir avec » sur le même fichier
 * retombe sur la même copie déjà extraite), puis on demande à Windows de l'ouvrir avec son
 * association par défaut (`tauri-plugin-opener`, déjà déclaré dans `Cargo.toml`/enregistré dans
 * `run()` mais jamais utilisé côté frontend avant — recherche 2026-08-08 « lis vraiment le code
 * de cosmic… les interactions os et le filesystem », `Action::OpenWith`/`mime_app.rs` amont).
 * `extract` écrit RÉELLEMENT le fichier à `dest` (même contrat que `api.extractTo`/
 * `api.rawCpkExtractTo`, qui créent déjà le dossier parent côté Rust).
 */
async function openWithDefaultApp(name: string, extract: (dest: string) => Promise<number>): Promise<void> {
  try {
    const dest = await join(await tempDir(), "nie-explorer-open-with", name);
    await extract(dest);
    await openPath(dest);
  } catch (e) {
    toast.error(`Impossible d'ouvrir : ${e}`);
  }
}

/**
 * Sous-menu « Exporter au format » d'un fichier VFS — un élément par conversion RÉELLEMENT
 * possible pour ce fichier (`api.exportFormats`, dérivé du nom côté Rust : aucun accès disque).
 *
 * L'entrée « Extraire vers… » qui existait déjà correspond au format `raw` ; elle reste en place
 * (c'est le geste courant), et ce sous-menu n'énumère donc que les CONVERSIONS.
 */
async function exportSubmenuItems(path: string, gameDir?: string) {
  let formats;
  try {
    formats = (await api.exportFormats(path)).filter((f) => !f.brut);
  } catch {
    return [];
  }
  if (formats.length === 0) return [];
  return [
    await PredefinedMenuItem.new({ item: "Separator" }),
    {
      text: "Exporter au format",
      items: formats.map((f) => ({
        text: `${f.ext.toUpperCase()} — ${f.label}`,
        action: async () => {
          const dest = await save({ defaultPath: await api.exportDefaultName(path, f.id) });
          if (!dest) return;
          try {
            const written = await api.exportAs(path, dest, f.id, gameDir);
            toast.success(`${humanSize(written)} écrits → ${dest}`);
          } catch (e) {
            toast.error(String(e));
          }
        },
      })),
    },
  ];
}

/**
 * Menu « Exporter au format » d'une SÉLECTION, suivi du choix du dossier de destination puis de
 * l'export en lot (`api.exportMany`).
 *
 * Les formats proposés sont ceux applicables à **tous** les fichiers sélectionnés : proposer PNG
 * pour un lot qui mélange textures et sons donnerait un résultat à moitié converti sans le dire.
 * Le brut reste toujours proposé — c'est le seul qui vaut pour n'importe quel mélange.
 *
 * L'export ne s'arrête pas au premier échec : le bilan rapporte les fichiers non exportés avec
 * leur raison.
 */
export async function showExportSelectionMenu(paths: string[], gameDir?: string): Promise<void> {
  if (paths.length === 0) {
    toast.error("Rien à exporter — sélectionnez d'abord des fichiers");
    return;
  }
  let communs;
  try {
    const listes = await Promise.all(paths.map((p) => api.exportFormats(p)));
    const [premier, ...reste] = listes;
    communs = premier.filter((f) => reste.every((l) => l.some((g) => g.id === f.id)));
  } catch (e) {
    toast.error(String(e));
    return;
  }

  const lancer = async (format: string) => {
    const destDir = await open({ directory: true, title: "Dossier d'export" });
    if (!destDir || typeof destDir !== "string") return;
    try {
      const bilan = await api.exportMany(paths, destDir, format, gameDir);
      if (bilan.echecs.length === 0) {
        toast.success(`${bilan.ecrits} fichier(s) exporté(s) (${humanSize(bilan.octets)}) → ${destDir}`);
      } else {
        toast.warning(`${bilan.ecrits} exporté(s), ${bilan.echecs.length} échec(s)`, {
          description: bilan.echecs
            .slice(0, 5)
            .map(([p, raison]) => `${p.split("/").pop()} : ${raison}`)
            .join("\n"),
        });
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  const menu = await Menu.new({
    items: communs.map((f) => ({
      text: f.brut ? `Brut — ${f.label}` : `${f.ext.toUpperCase()} — ${f.label}`,
      action: () => void lancer(f.id),
    })),
  });
  await popupOrReport(menu);
}

export interface FileContextMenuOptions {
  path: string;
  name: string;
  size: number;
  gameDir?: string;
  blenderExe?: string;
  /** Sélectionne le fichier (même effet qu'un clic gauche) — appelé par « Ouvrir ». */
  onOpen?: () => void;
  /** Ajoute l'entrée « Ajouter à un mod… » si au moins un mod existe (cf. `ModsView`). */
  onStageIntoMod?: () => void;
}

/**
 * Menu contextuel natif d'un fichier VFS — mêmes actions que les boutons de `DetailPane`
 * (Ouvrir/Extraire/Copier le chemin/Ouvrir dans Blender/Ajouter à un mod) plus Copier le nom et
 * Propriétés, regroupées par séparateurs comme le vrai menu de l'explorateur Windows (à ceci
 * près qu'un VFS est en lecture seule : pas de Couper/Supprimer/Renommer qui n'auraient pas de
 * sens ici — un vrai clic droit Explorer sur un fichier en lecture seule les grise déjà).
 */
export async function showVfsFileContextMenu(opts: FileContextMenuOptions): Promise<void> {
  const ext = opts.name.split(".").pop()?.toLowerCase() ?? "";

  const menu = await Menu.new({
    items: [
      {
        text: "Ouvrir",
        action: () => opts.onOpen?.(),
      },
      {
        text: "Extraire vers…",
        action: async () => {
          const dest = await save({ defaultPath: opts.name });
          if (!dest) return;
          try {
            const written = await api.extractTo(opts.path, dest, opts.gameDir);
            toast.success(`${humanSize(written)} écrits → ${dest}`);
          } catch (e) {
            toast.error(String(e));
          }
        },
      },
      {
        text: "Ouvrir avec l'application par défaut…",
        action: () => openWithDefaultApp(opts.name, (dest) => api.extractTo(opts.path, dest, opts.gameDir)),
      },
      ...(await exportSubmenuItems(opts.path, opts.gameDir)),
      await PredefinedMenuItem.new({ item: "Separator" }),
      {
        text: "Copier le chemin",
        action: async () => {
          await writeText(opts.path);
          toast.success("Chemin copié");
        },
      },
      {
        text: "Copier le nom",
        action: async () => {
          await writeText(opts.name);
          toast.success("Nom copié");
        },
      },
      ...(BLENDER_EXTS.has(ext) || opts.onStageIntoMod
        ? [
            await PredefinedMenuItem.new({ item: "Separator" }),
            ...(BLENDER_EXTS.has(ext)
              ? [
                  {
                    text: "🧊 Ouvrir dans Blender",
                    action: async () => {
                      try {
                        const msg = await api.openInBlender(opts.path, opts.blenderExe, opts.gameDir);
                        toast.success(msg);
                      } catch (e) {
                        toast.error(String(e));
                      }
                    },
                  },
                ]
              : []),
            ...(opts.onStageIntoMod ? [{ text: "Ajouter à un mod…", action: () => opts.onStageIntoMod?.() }] : []),
          ]
        : []),
      await PredefinedMenuItem.new({ item: "Separator" }),
      {
        text: "Propriétés",
        action: () => {
          toast.message(opts.name, {
            description: `${opts.path}\n${humanSize(opts.size)}`,
          });
        },
      },
    ],
  });
  await popupOrReport(menu);
}

export interface RawCpkFileContextMenuOptions {
  path: string;
  name: string;
  size: number;
  entryIndex: number;
  onOpen?: () => void;
}

/** Menu contextuel natif d'une entrée d'un `.cpk` ouvert hors VFS (navigation fusionnée
 * `data/packs/*.cpk`, cf. `ExplorerView`) — sous-ensemble du menu VFS : pas de Blender/mod
 * (chemins réels différents, hors du VFS du jeu monté). */
export async function showRawCpkFileContextMenu(opts: RawCpkFileContextMenuOptions): Promise<void> {
  const menu = await Menu.new({
    items: [
      { text: "Ouvrir", action: () => opts.onOpen?.() },
      {
        text: "Extraire vers…",
        action: async () => {
          const dest = await save({ defaultPath: opts.name });
          if (!dest) return;
          try {
            const written = await api.rawCpkExtractTo(opts.entryIndex, dest);
            toast.success(`${humanSize(written)} écrits → ${dest}`);
          } catch (e) {
            toast.error(String(e));
          }
        },
      },
      {
        text: "Ouvrir avec l'application par défaut…",
        action: () => openWithDefaultApp(opts.name, (dest) => api.rawCpkExtractTo(opts.entryIndex, dest)),
      },
      await PredefinedMenuItem.new({ item: "Separator" }),
      { text: "Copier le chemin", action: async () => { await writeText(opts.path); toast.success("Chemin copié"); } },
      { text: "Copier le nom", action: async () => { await writeText(opts.name); toast.success("Nom copié"); } },
      await PredefinedMenuItem.new({ item: "Separator" }),
      {
        text: "Propriétés",
        action: () => toast.message(opts.name, { description: `${opts.path}\n${humanSize(opts.size)}` }),
      },
    ],
  });
  await popupOrReport(menu);
}

/** Menu contextuel natif d'un dossier VFS — Ouvrir/Épingler (Ctrl+D)/Copier le chemin, comme le
 * menu Explorer sur un dossier en lecture seule (Cosmic-Files/Yazi ont le même sous-ensemble
 * pour une source montée en lecture seule). */
export interface FolderContextMenuOptions {
  path: string;
  onOpen?: () => void;
  /** Ouvre le dossier dans un NOUVEL onglet de l'Explorateur (équivalent du clic milieu). */
  onOpenInNewTab?: () => void;
}

export async function showVfsFolderContextMenu(opts: FolderContextMenuOptions): Promise<void> {
  const pinned = isPinned(opts.path);
  const menu = await Menu.new({
    items: [
      { text: "Ouvrir", action: () => opts.onOpen?.() },
      ...(opts.onOpenInNewTab
        ? [{ text: "Ouvrir dans un nouvel onglet", action: () => opts.onOpenInNewTab?.() }]
        : []),
      await PredefinedMenuItem.new({ item: "Separator" }),
      { text: pinned ? "★ Désépingler" : "☆ Épingler à la barre latérale", action: () => togglePin(opts.path) },
      { text: "Copier le chemin", action: async () => { await writeText(opts.path); toast.success("Chemin copié"); } },
    ],
  });
  await popupOrReport(menu);
}

export interface PlaceContextMenuOptions {
  /** Préfixe VFS de l'emplacement. */
  prefix: string;
  /** Nature de l'entrée — conditionne les actions proposées. */
  kind: "builtin" | "pinned" | "recent";
  onOpen?: () => void;
  /** Ouvre l'emplacement dans un NOUVEL onglet de l'Explorateur (équivalent du clic milieu). */
  onOpenInNewTab?: () => void;
}

/**
 * Menu contextuel d'une ENTRÉE de la barre latérale — équivalent de `nav_context_menu` de
 * cosmic-files, noté comme écart non fermé dans la roadmap (§2.8) : jusqu'ici, un clic droit sur
 * une place épinglée ou récente ne faisait rien du tout, il fallait retrouver le dossier pour le
 * désépingler (et un récent ne pouvait pas être retiré du tout, cf. `forgetRecent`).
 *
 * Les entrées curées (`PINNED_PLACES`) ne proposent ni désépinglage ni oubli : elles ne sont pas
 * des préférences utilisatrice, elles font partie de l'app.
 */
export async function showPlaceContextMenu(opts: PlaceContextMenuOptions): Promise<void> {
  const pinned = isPinned(opts.prefix);
  const menu = await Menu.new({
    items: [
      { text: "Ouvrir", action: () => opts.onOpen?.() },
      ...(opts.onOpenInNewTab
        ? [{ text: "Ouvrir dans un nouvel onglet", action: () => opts.onOpenInNewTab?.() }]
        : []),
      await PredefinedMenuItem.new({ item: "Separator" }),
      ...(opts.kind !== "builtin"
        ? [
            {
              text: pinned ? "★ Désépingler" : "☆ Épingler à la barre latérale",
              action: () => togglePin(opts.prefix),
            },
          ]
        : []),
      ...(opts.kind === "recent"
        ? [
            { text: "Retirer des récents", action: () => forgetRecent(opts.prefix) },
            { text: "Vider les récents", action: () => clearRecents() },
          ]
        : []),
      {
        text: "Copier le chemin",
        action: async () => {
          await writeText(opts.prefix);
          toast.success("Chemin copié");
        },
      },
    ],
  });
  await popupOrReport(menu);
}
