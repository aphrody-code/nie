/**
 * @niers/catalog — SQLite-backed index du VFS IEVR.
 *
 * CatalogDb encapsule un bun:sqlite Database et expose :
 *   - index(entries)       — bulk-insert en transaction préparée (WAL)
 *   - byExt(ext)           — filtre SQL sur la colonne ext
 *   - search(globPattern)  — Bun.Glob.match sur les chemins via iterate()
 *   - stats()              — COUNT(*) GROUP BY ext, trié par fréquence desc
 *
 * indexVfs(dataDir, dbPath?) — ouvre le VFS `nie`, liste les 250k entrées
 * et les insère ; retourne { db, count, elapsedMs }.
 *
 * Identifiant rapide : Bun.hash(internal_path) (wyhash 64-bit) stocké comme
 * INTEGER SQLite via Number().
 */

import { Database } from "bun:sqlite";
import { vfsOpen } from "nie";

// ─── types publics ────────────────────────────────────────────────────────────

/** Ligne de la table assets. */
export interface AssetRow {
  /** Bun.hash(internal_path) converti en number. */
  id: number;
  /** Chemin interne VFS, ex. "data/dx11/menu/foo.g4tx". */
  internal_path: string;
  /** Nom du CPK source, ex. "menu.cpk". */
  cpk: string;
  /** Taille en octets dans le CPK. */
  size: number;
  /** Extension sans point, en minuscules ("g4tx", "cfg", …) ou "" si absente. */
  ext: string;
}

/** Résultat de stats() : nombre d'assets par extension. */
export interface ExtStat {
  /** Extension sans point. */
  ext: string;
  /** Nombre d'assets dans cet extension. */
  count: number;
}

/** Résultat de indexVfs(). */
export interface IndexResult {
  /** Instance CatalogDb peuplée — l'appelant en possède la durée de vie. */
  db: CatalogDb;
  /** Nombre de lignes insérées. */
  count: number;
  /** Temps de bout en bout en millisecondes (Bun.nanoseconds). */
  elapsedMs: number;
}

// ─── utilitaire interne ───────────────────────────────────────────────────────

/** Extrait l'extension d'un chemin : "foo.g4tx" → "g4tx", "bar" → "". */
function extOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return dot === -1 ? "" : path.slice(dot + 1).toLowerCase();
}

// ─── CatalogDb ────────────────────────────────────────────────────────────────

/**
 * Catalogue SQLite des assets du VFS.
 *
 * @example
 * using db = new CatalogDb();
 * db.index(entries);
 * const pngs = db.byExt("png");
 */
export class CatalogDb {
  readonly #db: Database;

  /**
   * Ouvre (ou crée) la base de données.
   *
   * @param dbPath - Chemin fichier ou ":memory:" (défaut).
   */
  constructor(dbPath: string = ":memory:") {
    this.#db = new Database(dbPath, { create: true });
    this.#init();
  }

  #init(): void {
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous  = NORMAL;
      CREATE TABLE IF NOT EXISTS assets (
        id            INTEGER NOT NULL,
        internal_path TEXT    NOT NULL,
        cpk           TEXT    NOT NULL,
        size          INTEGER NOT NULL,
        ext           TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_assets_ext
        ON assets(ext);
    `);
  }

  /**
   * Insère des entrées VFS en une seule transaction préparée.
   *
   * Chaque entrée doit avoir { path, cpk, size }.
   * L'id est calculé via Bun.hash (wyhash) sur internal_path.
   *
   * @returns Nombre de lignes insérées.
   */
  index(
    entries: ReadonlyArray<{ path: string; cpk: string; size: number }>,
  ): number {
    const ins = this.#db.prepare<
      undefined,
      [number, string, string, number, string]
    >(
      "INSERT INTO assets (id, internal_path, cpk, size, ext) VALUES (?,?,?,?,?)",
    );

    const tx = this.#db.transaction(
      (rows: ReadonlyArray<{ path: string; cpk: string; size: number }>) => {
        for (const row of rows) {
          ins.run(
            Number(Bun.hash(row.path)),
            row.path,
            row.cpk,
            row.size,
            extOf(row.path),
          );
        }
      },
    );

    tx(entries);
    return entries.length;
  }

  /**
   * Retourne tous les assets dont l'extension correspond à `ext`.
   *
   * @param ext - Extension sans point ("g4tx") ; un point initial est ignoré.
   */
  byExt(ext: string): AssetRow[] {
    const normalized = ext.toLowerCase().replace(/^\./, "");
    return this.#db
      .query<AssetRow, [string]>("SELECT * FROM assets WHERE ext = ?")
      .all(normalized);
  }

  /**
   * Retourne les assets dont internal_path correspond au glob Bun.
   *
   * Utilise `.iterate()` pour ne pas charger l'intégralité du résultat
   * en mémoire avant de filtrer.
   *
   * @param pattern - Pattern glob Bun.Glob (ex. "**\/*.g4tx").
   */
  search(pattern: string): AssetRow[] {
    const glob = new Bun.Glob(pattern);
    const result: AssetRow[] = [];
    for (const row of this.#db
      .query<AssetRow, []>("SELECT * FROM assets")
      .iterate()) {
      if (glob.match(row.internal_path)) result.push(row);
    }
    return result;
  }

  /**
   * Retourne le nombre d'assets par extension, trié par fréquence décroissante.
   */
  stats(): ExtStat[] {
    return this.#db
      .query<ExtStat, []>(
        `SELECT ext, COUNT(*) as count
           FROM assets
          GROUP BY ext
          ORDER BY count DESC`,
      )
      .all();
  }

  /** Ferme la base de données. Idempotent. */
  close(): void {
    this.#db.close();
  }

  /** Protocole ECMAScript Explicit Resource Management (`using`). */
  [Symbol.dispose](): void {
    this.close();
  }
}

// ─── indexVfs ─────────────────────────────────────────────────────────────────

/**
 * Monte le VFS IEVR, liste toutes les entrées et les insère dans un CatalogDb.
 *
 * Mesure le temps bout-en-bout via Bun.nanoseconds().
 * Le VFS est libéré dès que la liste est obtenue (bloc `using`).
 * L'appelant est responsable de fermer le CatalogDb retourné.
 *
 * @param dataDir - Répertoire contenant `cpk_list.cfg.bin`
 *                  (ex. "/home/user/niers/data").
 * @param dbPath  - Chemin SQLite ou ":memory:" (défaut).
 * @throws Si le VFS ne peut pas s'ouvrir.
 */
export async function indexVfs(
  dataDir: string,
  dbPath: string = ":memory:",
): Promise<IndexResult> {
  const t0 = Bun.nanoseconds();

  // Ouvrir le VFS, lister, puis libérer immédiatement (le listing est en mémoire JS).
  let entries: Array<{ path: string; cpk: string; size: number }>;
  {
    using vfs = vfsOpen(dataDir);
    if (vfs === null) {
      throw new Error(
        `indexVfs: impossible d'ouvrir le VFS depuis "${dataDir}" (cpk_list.cfg.bin absent ?)`,
      );
    }
    entries = vfs.list();
  }

  const db = new CatalogDb(dbPath);
  const count = db.index(entries);

  const elapsedMs = (Bun.nanoseconds() - t0) / 1_000_000;
  return { db, count, elapsedMs };
}
