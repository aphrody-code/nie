// Base RE `var/niers.sqlite` (248 Mo, statique, HORS LIGNE) — ~113 000 fonctions labellisées
// (nom, sous-système, confiance, pagerank, call-graph) + ~3 150 classes RTTI (adresse de
// vtable réelle) + ~507 000 xrefs, produites par `nie-re` (désassemblage/récupération RTTI/
// propagation de labels sur le binaire `nie.exe`, cf. `crates/nie-re`). Interrogée EXACTEMENT
// comme le miroir wiki (`wikiDb.ts`) : `tauri-plugin-sql` directement depuis le frontend — même
// raison qu'eux (rusqlite de `nie-re`/`nie-index` entre en conflit de lien natif avec le
// `sqlx-sqlite` du plugin dans CE binaire, cf. `src-tauri/Cargo.toml`).
//
// AUCUNE lecture mémoire live, AUCUNE attache process : uniquement cette base déjà calculée à
// partir d'un dump/désassemblage hors ligne. Cf. décision utilisatrice sur `nie-trace` (pas
// d'attache live/patch EAC câblée dans l'app).
import Database from "@tauri-apps/plugin-sql";
import { api } from "@/lib/api";

export interface FunctionRow {
  id: number;
  vaddr: number;
  size: number;
  name: string | null;
  name_source: string | null;
  confidence: number;
  subsystem: string | null;
  role: string | null;
  pagerank: number;
  n_calls_in: number;
  n_calls_out: number;
}

export interface RttiClassRow {
  id: number;
  name: string;
  namespace: string | null;
  vtable_vaddr: number | null;
}

export interface XrefRow {
  from_addr: number;
  to_addr: number;
  kind: string;
}

/** Adresse statique affichable (`nie.exe` chargé à `0x140000000`, cf. `CLAUDE.md`). */
export function toStaticHex(vaddr: number): string {
  return `0x${vaddr.toString(16).toUpperCase().padStart(9, "0")}`;
}

function toSqliteUri(path: string): string {
  return `sqlite:${path.replace(/\\/g, "/")}`;
}

let dbPromise: Promise<Database> | null = null;
let dbPath: string | null = null;

function connect(path: string): Promise<Database> {
  if (dbPromise && dbPath === path) return dbPromise;
  dbPath = path;
  dbPromise = Database.load(toSqliteUri(path));
  return dbPromise;
}

/** `<jeu>/var/niers.sqlite` — même convention d'auto-détection que le miroir wiki
 * (`var/wiki-mirror/`) : un seul dépôt, les deux vivent sous `<racine>/var/`. Résolu côté Rust
 * (`default_re_db`) : la portée `fs:scope` de l'app ne couvre que `$APPDATA`. */
export async function defaultReDbPath(gameDir: string): Promise<string | null> {
  return api.defaultReDb(gameDir);
}

export const reDb = {
  async searchFunctions(path: string, query: string, limit = 200): Promise<FunctionRow[]> {
    const db = await connect(path);
    const q = query.trim();
    if (!q) {
      return db.select<FunctionRow[]>(
        `SELECT id, vaddr, size, name, name_source, confidence, subsystem, role, pagerank, n_calls_in, n_calls_out
         FROM function ORDER BY pagerank DESC LIMIT $1`,
        [limit],
      );
    }
    // Adresse hex (0x140012340) ou décimale directe, sinon recherche par nom/sous-système.
    const asAddr = /^(0x[0-9a-f]+|\d+)$/i.test(q) ? Number(q) : null;
    if (asAddr !== null) {
      return db.select<FunctionRow[]>(
        `SELECT id, vaddr, size, name, name_source, confidence, subsystem, role, pagerank, n_calls_in, n_calls_out
         FROM function WHERE vaddr = $1 LIMIT $2`,
        [asAddr, limit],
      );
    }
    return db.select<FunctionRow[]>(
      `SELECT id, vaddr, size, name, name_source, confidence, subsystem, role, pagerank, n_calls_in, n_calls_out
       FROM function WHERE name LIKE $1 OR subsystem LIKE $1 OR role LIKE $1
       ORDER BY pagerank DESC LIMIT $2`,
      [`%${q}%`, limit],
    );
  },

  async searchRttiClasses(path: string, query: string, limit = 200): Promise<RttiClassRow[]> {
    const db = await connect(path);
    const q = query.trim();
    if (!q) {
      return db.select<RttiClassRow[]>(`SELECT id, name, namespace, vtable_vaddr FROM rtti_class ORDER BY name LIMIT $1`, [limit]);
    }
    return db.select<RttiClassRow[]>(
      `SELECT id, name, namespace, vtable_vaddr FROM rtti_class WHERE name LIKE $1 OR namespace LIKE $1 ORDER BY name LIMIT $2`,
      [`%${q}%`, limit],
    );
  },

  /** Fonctions appelantes (xref `to_addr = vaddr`) et appelées (`from_addr = vaddr`). */
  async xrefsFor(path: string, vaddr: number, limit = 100): Promise<{ callers: XrefRow[]; callees: XrefRow[] }> {
    const db = await connect(path);
    const [callers, callees] = await Promise.all([
      db.select<XrefRow[]>(`SELECT from_addr, to_addr, kind FROM xref WHERE to_addr = $1 LIMIT $2`, [vaddr, limit]),
      db.select<XrefRow[]>(`SELECT from_addr, to_addr, kind FROM xref WHERE from_addr = $1 LIMIT $2`, [vaddr, limit]),
    ]);
    return { callers, callees };
  },

  async meta(path: string): Promise<Record<string, string>> {
    const db = await connect(path);
    const rows = await db.select<{ key: string; value: string }[]>(`SELECT key, value FROM meta`);
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },

  /**
   * Renomme une fonction (§5 roadmap « édition des labels ») — écrit DIRECTEMENT dans
   * `niers.sqlite` via `tauri-plugin-sql` (même mécanisme de lecture que `searchFunctions`, la
   * base n'est PAS ouverte en lecture seule). `name_source` passe à `'user-edit'` : distingue un
   * nom entré manuellement dans l'app des sources RE existantes (`'vtable-struct'`/`'ghidra'`/
   * `'pdb'`, cf. `docs/ROADMAP-100.md` E2) — même discipline de provenance que le reste du projet
   * (jamais un nom sans savoir d'où il vient).
   */
  async renameFunction(path: string, id: number, name: string): Promise<void> {
    const db = await connect(path);
    await db.execute(`UPDATE function SET name = $1, name_source = 'user-edit' WHERE id = $2`, [name.trim() || null, id]);
  },

  /** Renomme une classe RTTI (§5 roadmap) — même mécanisme que [`renameFunction`]. */
  async renameRttiClass(path: string, id: number, name: string): Promise<void> {
    const db = await connect(path);
    await db.execute(`UPDATE rtti_class SET name = $1 WHERE id = $2`, [name.trim(), id]);
  },
};
