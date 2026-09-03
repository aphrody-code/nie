// Base RE `var/niers.sqlite` (statique, HORS LIGNE) — mesure du 2026-08-30 : **117 494
// fonctions** dont 49 426 nommées et 102 053 classées par sous-système, 1 745 classes RTTI
// (adresse de vtable réelle) et ~250 000 xrefs, produites par `nie-re` (bornes `.pdata`,
// récupération des feuilles, RTTI, tables funcLua, références de chaînes, propagation de
// labels ; cf. `crates/forge/nie-re` et `docs/RE.md`). Interrogée EXACTEMENT
// comme le miroir wiki (`wikiDb.ts`) : `tauri-plugin-sql` directement depuis le frontend — même
// raison qu'eux (rusqlite de `nie-re`/`nie-index` entre en conflit de lien natif avec le
// `sqlx-sqlite` du plugin dans CE binaire, cf. `src-tauri/Cargo.toml`).
//
// Ce module reste HORS LIGNE (base déjà calculée) — la lecture mémoire live du process en cours
// est câblée séparément (`api.reTrace*`, cf. `src-tauri/src/re_trace.rs` + onglet « Live » de
// `ReToolsView`), décision utilisatrice tranchée (lecture seule, jamais de patch EAC/écriture
// sur un process vivant).
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
  binIdPromise = null;
  return dbPromise;
}

let binIdPromise: Promise<number | null> | null = null;

/** Id du binaire **`#pdata`** — la vérité terrain, et le seul à citer.
 *
 * La base indexe deux espaces : l'index Ghidra d'origine (`binary_id` 1), dont 3,7 % seulement
 * des adresses coïncident avec un début de fonction réel, et le recouvrement reconstruit sur les
 * bornes `.pdata` (`…#pdata`). Sans ce filtre, une recherche mélange les deux et affiche des
 * adresses désalignées comme si elles étaient des fonctions — cf. `docs/RE.md`,
 * « L'index Ghidra est désaligné ».
 *
 * `null` si la base n'a pas d'entrée `#pdata` : les requêtes retombent alors sur la base entière
 * plutôt que de ne rien rendre. */
async function pdataBinaryId(path: string): Promise<number | null> {
  if (binIdPromise) return binIdPromise;
  binIdPromise = (async () => {
    try {
      const db = await connect(path);
      const rows = await db.select<{ id: number }[]>(
        `SELECT id FROM binary WHERE path LIKE '%#pdata' ORDER BY id LIMIT 1`,
      );
      return rows.length > 0 ? rows[0].id : null;
    } catch {
      return null;
    }
  })();
  return binIdPromise;
}

/** Clause de restriction au binaire `#pdata`, vide si la base n'en a pas. */
function binClause(binId: number | null, prefix: string): string {
  return binId === null ? "" : `${prefix} binary_id = ${binId}`;
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
    const bin = await pdataBinaryId(path);
    const q = query.trim();
    const cols =
      "id, vaddr, size, name, name_source, confidence, subsystem, role, pagerank, n_calls_in, n_calls_out";
    if (!q) {
      return db.select<FunctionRow[]>(
        `SELECT ${cols} FROM function ${binClause(bin, "WHERE")} ORDER BY pagerank DESC LIMIT $1`,
        [limit],
      );
    }
    // Adresse hex (0x140012340) ou décimale directe, sinon recherche par nom/sous-système.
    const asAddr = /^(0x[0-9a-f]+|\d+)$/i.test(q) ? Number(q) : null;
    if (asAddr !== null) {
      return db.select<FunctionRow[]>(
        `SELECT ${cols} FROM function WHERE vaddr = $1 ${binClause(bin, "AND")} LIMIT $2`,
        [asAddr, limit],
      );
    }
    return db.select<FunctionRow[]>(
      `SELECT ${cols} FROM function
       WHERE (name LIKE $1 OR subsystem LIKE $1 OR role LIKE $1) ${binClause(bin, "AND")}
       ORDER BY pagerank DESC LIMIT $2`,
      [`%${q}%`, limit],
    );
  },

  /** Classes RTTI — le filtre `#pdata` est ici une déduplication, pas un choix de vérité.
   *
   * `rebuild` recopie les 1 745 classes sur les deux binaires : sans restriction, chaque classe
   * apparaissait **deux fois** (c'est l'origine du « ~3 150 classes » que l'en-tête de ce fichier
   * annonçait). Les deux copies portent le même nom ; celle de `#pdata` est retenue pour rester
   * cohérente avec les fonctions affichées à côté. */
  async searchRttiClasses(path: string, query: string, limit = 200): Promise<RttiClassRow[]> {
    const db = await connect(path);
    const bin = await pdataBinaryId(path);
    const cols = "id, name, namespace, vtable_vaddr";
    const q = query.trim();
    if (!q) {
      return db.select<RttiClassRow[]>(
        `SELECT ${cols} FROM rtti_class ${binClause(bin, "WHERE")} ORDER BY name LIMIT $1`,
        [limit],
      );
    }
    return db.select<RttiClassRow[]>(
      `SELECT ${cols} FROM rtti_class
       WHERE (name LIKE $1 OR namespace LIKE $1) ${binClause(bin, "AND")}
       ORDER BY name LIMIT $2`,
      [`%${q}%`, limit],
    );
  },

  /** Fonctions appelantes (xref `to_addr = vaddr`) et appelées (`from_addr = vaddr`). */
  async xrefsFor(path: string, vaddr: number, limit = 100): Promise<{ callers: XrefRow[]; callees: XrefRow[] }> {
    const db = await connect(path);
    const bin = await pdataBinaryId(path);
    const [callers, callees] = await Promise.all([
      db.select<XrefRow[]>(
        `SELECT from_addr, to_addr, kind FROM xref WHERE to_addr = $1 ${binClause(bin, "AND")} LIMIT $2`,
        [vaddr, limit],
      ),
      db.select<XrefRow[]>(
        `SELECT from_addr, to_addr, kind FROM xref WHERE from_addr = $1 ${binClause(bin, "AND")} LIMIT $2`,
        [vaddr, limit],
      ),
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
   * `'pdb'`, cf. `docs/PLAN.md` E2) — même discipline de provenance que le reste du projet
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

  /**
   * Volumétrie de la base RE, pour le tableau de bord.
   *
   * Le binaire de référence n'est PAS choisi par son identifiant : deux `binary` coexistent
   * (`1` = index Ghidra désaligné et figé, `2` = `#pdata`, la vérité terrain), et laquelle porte
   * les données dépend de la machine. On retient donc celle qui porte le plus de fonctions, et on
   * affiche son empreinte — c'est ce qui permet de VOIR qu'une base est ancrée sur un autre build
   * que le `nie.exe` local, cas déjà rencontré sur le VPS.
   */
  async stats(path: string): Promise<ReStats> {
    const db = await connect(path);
    const [binaire] = await db.select<{ id: number; chemin: string; sha256: string; taille: number; fonctions: number }[]>(
      `SELECT b.id, b.path AS chemin, b.sha256, b.size AS taille, count(f.id) AS fonctions
         FROM binary b LEFT JOIN function f ON f.binary_id = b.id
        GROUP BY b.id ORDER BY fonctions DESC LIMIT 1`,
    );
    if (!binaire) return { fonctions: 0, nommees: 0, racines: 0, classes: 0, sha256: null, binaire: null };
    const [n] = await db.select<{ nommees: number }[]>(
      `SELECT count(*) AS nommees FROM function WHERE binary_id = $1 AND name IS NOT NULL`,
      [binaire.id],
    );
    const [r] = await db.select<{ racines: number }[]>(`SELECT count(*) AS racines FROM pdata_func WHERE binary_id = $1`, [binaire.id]);
    const [c] = await db.select<{ classes: number }[]>(`SELECT count(*) AS classes FROM rtti_class WHERE binary_id = $1`, [binaire.id]);
    return {
      fonctions: binaire.fonctions,
      nommees: n?.nommees ?? 0,
      racines: r?.racines ?? 0,
      classes: c?.classes ?? 0,
      sha256: binaire.sha256,
      binaire: binaire.chemin,
    };
  },
};

/** Volumétrie de `niers.sqlite` — cf. [`reDb.stats`]. */
export interface ReStats {
  fonctions: number;
  nommees: number;
  /** Racines `.pdata` : les bornes de fonction que le binaire déclare lui-même. */
  racines: number;
  classes: number;
  /** Empreinte du binaire indexé — à confronter à celle du `nie.exe` de la machine. */
  sha256: string | null;
  binaire: string | null;
}
