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
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { humanSize } from "@/lib/bytes";
import { isPinned, togglePin } from "@/lib/places";

const BLENDER_EXTS = new Set(["g4md", "g4mg", "g4sk", "g4mt"]);

async function popupOrReport(menu: Menu): Promise<void> {
  try {
    await menu.popup();
  } catch (e) {
    toast.error(`Menu contextuel indisponible : ${e}`);
  }
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
}

export async function showVfsFolderContextMenu(opts: FolderContextMenuOptions): Promise<void> {
  const pinned = isPinned(opts.path);
  const menu = await Menu.new({
    items: [
      { text: "Ouvrir", action: () => opts.onOpen?.() },
      await PredefinedMenuItem.new({ item: "Separator" }),
      { text: pinned ? "★ Désépingler" : "☆ Épingler à la barre latérale", action: () => togglePin(opts.path) },
      { text: "Copier le chemin", action: async () => { await writeText(opts.path); toast.success("Chemin copié"); } },
    ],
  });
  await popupOrReport(menu);
}
