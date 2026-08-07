// Espace de travail des mods sur disque — `tauri-plugin-fs`, TOUJOURS scopé à
// `BaseDirectory.AppData` (`mods/<modId>/…`, jamais le dossier du jeu, cf. capabilities
// `fs:scope` dans `tauri.conf.json`/`capabilities/default.json`). L'export vers un dossier
// choisi par l'utilisatrice passe par la portée temporaire accordée par le sélecteur natif
// (`@tauri-apps/plugin-dialog`) — pattern standard Tauri v2, aucune portée fs large requise.
import { BaseDirectory, copyFile, exists, mkdir, remove, stat, writeFile } from "@tauri-apps/plugin-fs";
import { open, confirm } from "@tauri-apps/plugin-dialog";
import { modsDb } from "./modsDb";
import { api } from "./api";
import { b64ToBytes } from "./bytes";

export type StageTarget = { kind: "vfs" | "disk"; path: string };

/** Nom de fichier sûr sous Windows (les chemins VFS utilisent `/`, on les aplatit). */
function sanitize(vfsPath: string): string {
  return vfsPath.replace(/[\\/:*?"<>|]/g, "_");
}

function modDir(modId: string): string {
  return `mods/${modId}`;
}

/**
 * Choisit un fichier de remplacement sur disque et le copie dans l'espace de travail du mod,
 * avec une sauvegarde de l'original (pour diff/restauration). N'écrit jamais dans le CPK ni
 * dans le dossier du jeu — uniquement dans `AppData/mods/<modId>/`.
 */
export async function stageReplacement(modId: string, target: StageTarget, gameDir?: string): Promise<boolean> {
  const picked = await open({ title: "Fichier de remplacement" });
  if (typeof picked !== "string") return false;

  await mkdir(modDir(modId), { baseDir: BaseDirectory.AppData, recursive: true });

  const safe = sanitize(target.path);
  const stagedRel = `${modDir(modId)}/${safe}`;
  await copyFile(picked, stagedRel, { toPathBaseDir: BaseDirectory.AppData });

  let originalRel: string | null = null;
  try {
    const b64 = target.kind === "vfs" ? await api.readB64(target.path, gameDir) : await api.readDiskFileB64(target.path);
    originalRel = `${modDir(modId)}/${safe}.original`;
    await writeFile(originalRel, b64ToBytes(b64), { baseDir: BaseDirectory.AppData });
  } catch {
    // Fichier trop volumineux pour l'aperçu (> plafond `vfs_read_b64`) : pas de sauvegarde de
    // l'original, la copie de remplacement reste tout de même enregistrée.
  }

  const info = await stat(stagedRel, { baseDir: BaseDirectory.AppData });
  await modsDb.addFile(modId, target.path, stagedRel, originalRel, info.size);
  return true;
}

export async function removeStagedFile(fileId: number, stagedFile: string, originalFile: string | null): Promise<void> {
  await modsDb.removeFile(fileId);
  await remove(stagedFile, { baseDir: BaseDirectory.AppData }).catch(() => {});
  if (originalFile) await remove(originalFile, { baseDir: BaseDirectory.AppData }).catch(() => {});
}

export async function deleteModWorkspace(modId: string, files: { staged_file: string; original_file: string | null }[]): Promise<void> {
  for (const f of files) {
    await remove(f.staged_file, { baseDir: BaseDirectory.AppData }).catch(() => {});
    if (f.original_file) await remove(f.original_file, { baseDir: BaseDirectory.AppData }).catch(() => {});
  }
  await remove(modDir(modId), { baseDir: BaseDirectory.AppData, recursive: true }).catch(() => {});
  await modsDb.deleteMod(modId);
}

/**
 * Exporte les fichiers d'un mod, en préservant l'arborescence VFS relative, vers un dossier
 * choisi. Par défaut un dossier NEUTRE (pas le jeu) : si `intoGameDir` est vrai, exporte
 * directement dans `<gameDir>/<vfs_path>` (overlay loose-file) — comportement du VRAI moteur
 * FACE à un fichier loose non confirmé par RE, et EAC est présent sur cette installation :
 * demande une confirmation explicite avant d'écrire quoi que ce soit dans le dossier du jeu.
 */
export async function exportMod(
  files: { vfs_path: string; staged_file: string }[],
  opts: { intoGameDir: boolean; gameDir?: string },
): Promise<string | null> {
  if (files.length === 0) return null;

  let destRoot: string;
  if (opts.intoGameDir) {
    const ok = await confirm(
      "Ceci copie les fichiers du mod DIRECTEMENT dans le dossier du jeu (overlay « loose file »).\n\n" +
        "⚠️ Le comportement réel de nie.exe face à un fichier loose à la place d'un fichier de CPK " +
        "n'est PAS confirmé par rétro-ingénierie, et Easy Anti-Cheat est présent sur cette installation " +
        "— une modification du dossier du jeu peut être détectée. Continuer ?",
      { title: "Écrire dans le dossier du jeu", kind: "warning" },
    );
    if (!ok) return null;
    destRoot = opts.gameDir ?? (await api.defaultGameDir());
  } else {
    const picked = await open({ title: "Dossier d'export du mod", directory: true });
    if (typeof picked !== "string") return null;
    destRoot = picked;
  }

  for (const f of files) {
    const dest = `${destRoot}/${f.vfs_path}`;
    const parent = dest.slice(0, dest.lastIndexOf("/"));
    await mkdir(parent, { recursive: true }).catch(() => {});
    await copyFile(f.staged_file, dest, { fromPathBaseDir: BaseDirectory.AppData });
  }
  return destRoot;
}

export async function stagedFileExists(path: string): Promise<boolean> {
  return exists(path, { baseDir: BaseDirectory.AppData });
}
