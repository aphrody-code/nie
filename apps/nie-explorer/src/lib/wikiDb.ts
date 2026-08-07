// Recherche chara/waza sur le miroir wiki (`supabase-*.sqlite`, table `inagle_characters` /
// `inagle_skills`) — via `tauri-plugin-sql` directement (pas de commande Rust : `nie-wiki`
// dépend de `rusqlite`, qui entre en conflit de lien natif avec le `sqlx-sqlite` du plugin
// dans CE binaire, cf. `src-tauri/Cargo.toml`). Les requêtes SQL ci-dessous sont copiées
// TELLES QUELLES depuis `crates/nie-wiki/src/query.rs` (`search_characters`/`search_skills`)
// — même vérité SQL, juste un moteur d'exécution différent.
import Database from "@tauri-apps/plugin-sql";

export interface CharaRow {
  id: string;
  chara_id: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  element: string | null;
  position: string | null;
  rarity_label: string | null;
  internal_code: string | null;
  slug: string | null;
  base_slug: string | null;
}

export interface WazaRow {
  id: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  category: string | null;
  element: string | null;
  power_max: number | null;
  power_min: number | null;
  tp_cost: number | null;
  description_fr: string | null;
  description_en: string | null;
  internal_code: string | null;
  is_hyper: number | null;
}

/** `sanitizeFilter` — identique à `nie_wiki::query::sanitize_filter` : retire `%,().*\` (pas `_`). */
function sanitizeFilter(input: string): string {
  return input.replace(/[%,().*\\]/g, "");
}

/** URI sqlite pour un chemin de fichier arbitraire (sqlx veut des `/`, pas des `\`). */
function toSqliteUri(path: string): string {
  return `sqlite:${path.replace(/\\/g, "/")}`;
}

const connections = new Map<string, Promise<Database>>();

function connect(dbPath: string): Promise<Database> {
  const uri = toSqliteUri(dbPath);
  let p = connections.get(uri);
  if (!p) {
    p = Database.load(uri);
    connections.set(uri, p);
  }
  return p;
}

export const wikiDb = {
  async searchChara(dbPath: string, query: string): Promise<CharaRow[]> {
    const db = await connect(dbPath);
    const q = sanitizeFilter(query);
    const likePat = `%${q}%`;
    return db.select<CharaRow[]>(
      `SELECT id, chara_id, name_fr, name_en, name_ja, element, position,
              rarity_label, internal_code, slug, base_slug
       FROM inagle_characters
       WHERE id = $1
          OR chara_id = $1
          OR internal_code = $1
          OR slug = $1
          OR base_slug = $1
          OR name_fr LIKE $2
          OR name_en LIKE $2
          OR name_ja LIKE $2
       ORDER BY zukan_order ASC NULLS LAST, id ASC
       LIMIT 50`,
      [q, likePat],
    );
  },

  async searchWaza(dbPath: string, query: string): Promise<WazaRow[]> {
    const db = await connect(dbPath);
    const q = sanitizeFilter(query);
    const likePat = `%${q}%`;
    return db.select<WazaRow[]>(
      `SELECT id, name_fr, name_en, name_ja,
              category, element,
              power_max, power_min, tp_cost,
              description_fr, description_en,
              internal_code, is_hyper
       FROM inagle_skills
       WHERE id = $1
          OR internal_code = $1
          OR name_fr LIKE $2
          OR name_en LIKE $2
          OR name_ja LIKE $2
       ORDER BY name_fr ASC
       LIMIT 20`,
      [q, likePat],
    );
  },
};
