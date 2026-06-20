/**
 * Validation des chemins (anti-traversal) et garde SELECT-only pour la KB.
 */

/** Erreur métier renvoyée proprement au client MCP (jamais un crash du serveur). */
export class ToolError extends Error {
  override name = "ToolError";
}

/** Vrai si la chaîne contient un octet de contrôle (0x00-0x1F ou 0x7F). */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

/**
 * Valide un chemin logique VFS (de la forme `data/dx11/...`).
 * Les chemins viennent normalement de l'index (donc sûrs) mais on valide quand même :
 * pas de `..`, pas de chemin absolu, pas d'antislash ni d'octet de contrôle.
 */
export function assertSafeVfsPath(path: string): string {
  const p = path.trim();
  if (p.length === 0) throw new ToolError("chemin VFS vide");
  if (hasControlChar(p)) throw new ToolError("chemin VFS invalide (caractère de contrôle)");
  if (p.includes("\\")) throw new ToolError("chemin VFS invalide (antislash interdit, utiliser '/')");
  if (p.startsWith("/")) throw new ToolError("chemin VFS invalide (doit être relatif)");
  for (const seg of p.split("/")) {
    if (seg === "..") throw new ToolError("chemin VFS invalide (traversal '..' interdit)");
  }
  return p;
}

/** Encode un chemin VFS pour une URL en préservant les `/`. */
export function encodeVfsPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

const FORBIDDEN_SQL = [
  "insert", "update", "delete", "drop", "alter", "create", "replace",
  "attach", "detach", "pragma", "vacuum", "reindex", "truncate", "begin",
  "commit", "rollback", "savepoint", "grant", "revoke",
];

/**
 * N'autorise qu'une seule requête SELECT (ou CTE `WITH ... SELECT`).
 * Rejette les instructions multiples et tout mot-clé de mutation/DDL/transaction.
 * (La base est de toute façon ouverte en lecture seule, c'est une double sécurité.)
 */
export function assertSelectOnly(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "");
  if (trimmed.length === 0) throw new ToolError("requête SQL vide");
  if (trimmed.includes(";")) throw new ToolError("instructions multiples interdites (un seul SELECT)");
  if (hasControlChar(trimmed.replace(/[\r\n\t]/g, " "))) {
    throw new ToolError("requête SQL invalide (caractère de contrôle)");
  }
  const lower = trimmed.toLowerCase();
  if (!/^(select|with)\b/.test(lower)) {
    throw new ToolError("seules les requêtes SELECT (ou WITH ... SELECT) sont autorisées");
  }
  for (const kw of FORBIDDEN_SQL) {
    if (new RegExp(`\\b${kw}\\b`).test(lower)) {
      throw new ToolError(`mot-clé interdit dans une requête lecture seule : ${kw}`);
    }
  }
  return trimmed;
}
