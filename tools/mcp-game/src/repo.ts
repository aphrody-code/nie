/**
 * Lecture sécurisée d'un fichier source/docs du repo niers.
 *
 * Anti-traversal strict : on n'autorise QUE des sous-chemins de NIERS_REPO, et on
 * interdit les répertoires non publics ou volumineux (refs/, data/, var/, .git/,
 * target/, node_modules/). Résolution des symlinks pour éviter toute évasion.
 */

import { resolve, relative, sep, isAbsolute } from "node:path";
import { realpath } from "node:fs/promises";
import { config } from "./config.ts";
import { ToolError } from "./security.ts";

/** Répertoires de premier niveau interdits à la lecture libre. */
const BLOCKED_TOP = new Set(["refs", "data", "var", ".git", "target", "node_modules"]);

const DEFAULT_MAX_BYTES = 256 * 1024;
const HARD_CAP_BYTES = 8 * 1024 * 1024;

export interface RepoReadResult {
  path: string;
  abs_path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  content?: string;
  note?: string;
}

export async function repoRead(args: { path: string; maxBytes?: number }): Promise<RepoReadResult> {
  const rel = args.path.trim();
  if (rel.length === 0) throw new ToolError("repo_read : chemin vide");
  if (rel.includes("\0")) throw new ToolError("repo_read : chemin invalide");

  const repoReal = await realpath(resolve(config.repoRoot));

  // Résolution lexicale (gère `..`) relative à la racine du repo.
  const requested = isAbsolute(rel) ? resolve(rel) : resolve(repoReal, rel);
  if (requested !== repoReal && !requested.startsWith(repoReal + sep)) {
    throw new ToolError(`repo_read : chemin hors du repo (${config.repoRoot})`);
  }

  const relPart = relative(repoReal, requested);
  const top = relPart.split(sep)[0];
  if (top !== undefined && BLOCKED_TOP.has(top)) {
    throw new ToolError(`repo_read : répertoire interdit '${top}/' (refs/data/var/.git/target/node_modules)`);
  }

  // Résolution des symlinks puis re-vérification du confinement.
  let realPath: string;
  try {
    realPath = await realpath(requested);
  } catch {
    throw new ToolError(`repo_read : fichier introuvable (${rel})`);
  }
  if (realPath !== repoReal && !realPath.startsWith(repoReal + sep)) {
    throw new ToolError("repo_read : le lien symbolique sort du repo");
  }

  const file = Bun.file(realPath);
  if (!(await file.exists())) throw new ToolError(`repo_read : fichier introuvable (${rel})`);
  const size = file.size;
  if (size > HARD_CAP_BYTES) {
    return {
      path: relPart,
      abs_path: realPath,
      size,
      truncated: true,
      binary: false,
      note: `fichier de ${size} octets > plafond ${HARD_CAP_BYTES} — non lu`,
    };
  }

  const maxBytes = clampBytes(args.maxBytes);
  const slice = size > maxBytes ? file.slice(0, maxBytes) : file;
  const bytes = new Uint8Array(await slice.arrayBuffer());

  // Détection binaire grossière : présence d'octets nuls dans l'échantillon.
  let binary = false;
  for (let i = 0; i < Math.min(bytes.length, 8192); i++) {
    if (bytes[i] === 0) {
      binary = true;
      break;
    }
  }
  if (binary) {
    return {
      path: relPart,
      abs_path: realPath,
      size,
      truncated: size > maxBytes,
      binary: true,
      note: "fichier binaire — contenu non renvoyé (utiliser asset_get/raw pour les assets)",
    };
  }

  return {
    path: relPart,
    abs_path: realPath,
    size,
    truncated: size > maxBytes,
    binary: false,
    content: new TextDecoder().decode(bytes),
  };
}

function clampBytes(v: number | undefined): number {
  if (v === undefined || !Number.isFinite(v) || v <= 0) return DEFAULT_MAX_BYTES;
  return Math.min(Math.floor(v), HARD_CAP_BYTES);
}
