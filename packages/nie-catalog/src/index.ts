/**
 * @niers/catalog — point d'entrée public + CLI.
 *
 * Utilisé comme bibliothèque :
 *   import { CatalogDb, indexVfs } from "@niers/catalog";
 *
 * Utilisé en CLI :
 *   NIE_GAME_DIR=/home/aphrody/niers bun run packages/nie-catalog/src/index.ts [<db-path>]
 *
 * Sans argument, la base reste en ":memory:" et les stats sont affichées puis
 * le processus se termine.  En passant un chemin, la base est persistée sur
 * disque.
 */

export { CatalogDb, indexVfs } from "./catalog.ts";
export type { AssetRow, ExtStat, IndexResult } from "./catalog.ts";

// ─── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const gameDir = process.env["NIE_GAME_DIR"] ?? "/home/aphrody/niers";
  const dataDir = `${gameDir}/data`;
  const dbPath  = process.argv[2] ?? ":memory:";

  console.log(`[nie-catalog] Indexation du VFS IEVR depuis : ${dataDir}`);
  if (dbPath !== ":memory:") {
    console.log(`[nie-catalog] Base SQLite : ${dbPath}`);
  }

  // Import dynamique pour éviter d'exécuter le CLI lors des imports de lib.
  const { indexVfs: doIndex } = await import("./catalog.ts");

  const { db, count, elapsedMs } = await doIndex(dataDir, dbPath);

  console.log(
    `[nie-catalog] ${count.toLocaleString()} assets indexés en ${elapsedMs.toFixed(1)} ms`,
  );

  // ── stats globales (Bun.inspect.table) ──────────────────────────────────────
  const statsRows = db.stats();
  const TOP_N = 25;
  console.log(`\nTop ${TOP_N} extensions (sur ${statsRows.length} distinctes) :`);
  console.log(Bun.inspect.table(statsRows.slice(0, TOP_N)));

  // ── échantillon byExt("g4tx") ────────────────────────────────────────────────
  const g4txRows = db.byExt("g4tx");
  const SAMPLE = 8;
  console.log(`\nbypExt("g4tx") → ${g4txRows.length.toLocaleString()} fichiers (${SAMPLE} premiers) :`);
  console.log(
    Bun.inspect.table(
      g4txRows.slice(0, SAMPLE).map((r) => ({
        internal_path: r.internal_path,
        cpk:  r.cpk,
        size: r.size,
      })),
    ),
  );

  // ── exemple search glob ──────────────────────────────────────────────────────
  const globPat = "data/dx11/menu/**/*.g4tx";
  const t0search = Bun.nanoseconds();
  const searched = db.search(globPat);
  const searchMs = (Bun.nanoseconds() - t0search) / 1_000_000;
  console.log(
    `\nsearch("${globPat}") → ${searched.length.toLocaleString()} résultats en ${searchMs.toFixed(1)} ms`,
  );

  if (dbPath !== ":memory:") {
    console.log(`\nBase persistée : ${dbPath}`);
  }

  db.close();
}
