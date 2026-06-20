/**
 * Configuration résolue depuis l'environnement.
 *
 * Toutes les sources sont locales au VPS. Les valeurs par défaut correspondent
 * à l'installation décrite dans CLAUDE.md / docs du repo niers.
 */

function env(name: string, fallback: string): string {
  const v = process.env[name];
  return v !== undefined && v.length > 0 ? v : fallback;
}

export const config = {
  /** URL Redis. La base 3 (index VFS CPK) est sélectionnée explicitement au chargement. */
  redisUrl: env("NIERS_REDIS", "redis://127.0.0.1:6379"),
  /** Numéro de base Redis hébergeant le HASH `iev:file:index`. */
  redisDb: 3,
  /** Clé HASH chemin-logique -> nom de .cpk (250 800 entrées). */
  redisIndexKey: "iev:file:index",

  /** Base de connaissance RE (SQLite, lecture seule). */
  sqlitePath: env("NIERS_SQLITE", "/home/ubuntu/niers/var/niers.sqlite"),

  /** Service de décodage d'assets `nie-model-serve`. */
  modelServeUrl: env("MODEL_SERVE_URL", "http://127.0.0.1:8790").replace(/\/+$/, ""),

  /** Racine du repo niers pour `repo_read`. */
  repoRoot: env("NIERS_REPO", "/home/ubuntu/niers"),

  /** Binaire RE canonique = vue `.pdata` (cf. CLAUDE.md). C'est celui dont parle `coverage`. */
  primaryBinaryId: 2,
} as const;

export type Config = typeof config;
