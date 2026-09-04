/**
 * Accès au code du dépôt niers — **façade** sur `nie_explore::depot` (via `nie`/FFI).
 *
 * Ce module ne contient plus de logique : il traduit les arguments d'outil MCP en appel natif
 * et renomme les champs pour la forme anglaise que le reste du serveur expose déjà
 * (`vfs_list` rend `{path, cpk, size}`).
 *
 * Il portait auparavant sa propre lecture confinée en TypeScript. Elle a été retirée : le
 * confinement, les plafonds et les exclusions vivent désormais en un seul endroit, partagé avec
 * `niers find`/`niers grep` et les commandes Tauri de l'app desktop. Deux implémentations d'une
 * règle de sécurité, c'est une de trop — celle qu'on oublie de corriger.
 */

import {
  depotChercher,
  depotLire,
  depotLister,
  depotTrouver,
  ErreurDepot,
  type OptionsParcours,
} from "nie";
import { config } from "./config.ts";
import { ToolError } from "./security.ts";

/** Un fichier du dépôt, dans la forme exposée par le serveur MCP. */
export interface RepoReadResult {
  path: string;
  abs_path: string;
  size: number;
  truncated: boolean;
  binary: boolean;
  content?: string;
  note?: string;
}

/** Une entrée de dossier, dans la forme exposée par le serveur MCP. */
export interface RepoEntry {
  path: string;
  name: string;
  is_dir: boolean;
  size: number;
}

/** Une ligne trouvée par `repo_grep`. */
export interface RepoMatch {
  path: string;
  line: number;
  text: string;
}

/** Options de parcours communes à `repo_find` et `repo_grep`. */
export interface RepoWalkArgs {
  dir?: string | undefined;
  globs?: string[] | undefined;
  exts?: string[] | undefined;
  hidden?: boolean | undefined;
  noIgnore?: boolean | undefined;
  depth?: number | undefined;
  limit?: number | undefined;
  caseSensitive?: boolean | undefined;
}

/**
 * Convertit une erreur native en `ToolError` : le client MCP doit voir un message métier
 * (« dossier interdit », « chemin hors du dépôt »), pas une trace.
 */
function traduire<T>(operation: () => T): T {
  try {
    return operation();
  } catch (e) {
    if (e instanceof ErreurDepot) throw new ToolError(e.message);
    throw e;
  }
}

/** Traduit les options d'outil MCP vers celles du moteur natif. */
function options(a: RepoWalkArgs): OptionsParcours {
  return {
    sous_dossier: a.dir ?? "",
    globs: a.globs ?? [],
    extensions: a.exts ?? [],
    caches: a.hidden ?? false,
    sans_ignore: a.noIgnore ?? false,
    ...(a.depth === undefined ? {} : { profondeur: a.depth }),
    limite: a.limit ?? 200,
    sensible_casse: a.caseSensitive ?? false,
  };
}

/** Lit un fichier texte du dépôt. */
export function repoRead(args: { path: string; maxBytes?: number | undefined }): RepoReadResult {
  const f = traduire(() => depotLire(config.repoRoot, args.path, args.maxBytes));
  return {
    path: f.chemin,
    abs_path: f.chemin_absolu,
    size: f.taille,
    truncated: f.tronque,
    binary: f.binaire,
    ...(f.contenu === undefined ? {} : { content: f.contenu }),
    ...(f.note === undefined ? {} : { note: f.note }),
  };
}

/** Liste les entrées immédiates d'un dossier du dépôt. */
export function repoList(args: { path?: string | undefined }): RepoEntry[] {
  const entrees = traduire(() => depotLister(config.repoRoot, args.path ?? ""));
  return entrees.map((e) => ({ path: e.chemin, name: e.nom, is_dir: e.dossier, size: e.taille }));
}

/** Cherche des fichiers par sous-chaîne de chemin. */
export function repoFind(args: { pattern?: string | undefined } & RepoWalkArgs): string[] {
  return traduire(() => depotTrouver(config.repoRoot, args.pattern ?? "", options(args)));
}

/** Cherche une expression régulière dans le contenu des fichiers. */
export function repoGrep(args: { pattern: string } & RepoWalkArgs): RepoMatch[] {
  const hits = traduire(() => depotChercher(config.repoRoot, args.pattern, options(args)));
  return hits.map((h) => ({ path: h.chemin, line: h.ligne, text: h.texte }));
}
