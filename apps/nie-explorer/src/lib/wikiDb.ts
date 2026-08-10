// Recherche chara/waza sur le miroir wiki (`supabase-*.sqlite`, table `inagle_characters` /
// `inagle_skills`) — via `tauri-plugin-sql` directement (pas de commande Rust : `nie-wiki`
// dépend de `rusqlite`, qui entre en conflit de lien natif avec le `sqlx-sqlite` du plugin
// dans CE binaire, cf. `src-tauri/Cargo.toml`). Les requêtes SQL ci-dessous sont copiées
// TELLES QUELLES depuis `crates/tools/nie-wiki/src/query.rs` (`search_characters`/`search_skills`)
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

/** Nom résolu depuis un `code` (basename sans extension, cf. `vfsIndexDb.codeOf`) — utilisé par
 * l'Explorateur/le détail de fichier pour afficher « Mark Evans » plutôt que « c01000100 ». */
export interface ResolvedName {
  kind: "chara" | "skill" | "item";
  name: string;
  /** Élément/poste (perso) ou catégorie (technique/objet), pour contexte, si connu. */
  extra: string | null;
}

/** Découpe `arr` en tranches d'au plus `size` éléments (paramètres SQLite bornés ~999). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export const wikiDb = {
  /**
   * Résout un lot de `code`s (basenames VFS sans extension) vers leur personnage/technique/objet
   * en UNE poignée de requêtes `IN (...)` — plutôt qu'une requête par fichier affiché (un dossier
   * de personnages peut lister des milliers d'entrées), sur le même principe que l'index
   * `vfs_files` : précision + un seul aller-retour au lieu de N.
   */
  async resolveManyByCode(dbPath: string, codes: string[]): Promise<Map<string, ResolvedName>> {
    const unique = [...new Set(codes)].filter(Boolean);
    if (unique.length === 0) return new Map();
    const db = await connect(dbPath);
    const out = new Map<string, ResolvedName>();

    for (const batch of chunk(unique, 400)) {
      const placeholders = batch.map((_, i) => `$${i + 1}`).join(",");

      const chars = await db.select<{ internal_code: string; name_fr: string | null; name_en: string | null; element: string | null; position: string | null }[]>(
        `SELECT internal_code, name_fr, name_en, element, position FROM inagle_characters WHERE internal_code IN (${placeholders})`,
        batch,
      );
      for (const c of chars) {
        if (out.has(c.internal_code)) continue;
        const extra = [c.element, c.position].filter(Boolean).join(" · ");
        out.set(c.internal_code, { kind: "chara", name: c.name_fr ?? c.name_en ?? c.internal_code, extra: extra || null });
      }

      const skills = await db.select<{ internal_code: string; name_fr: string | null; name_en: string | null; category: string | null }[]>(
        `SELECT internal_code, name_fr, name_en, category FROM inagle_skills WHERE internal_code IN (${placeholders})`,
        batch,
      );
      for (const s of skills) {
        if (out.has(s.internal_code)) continue;
        out.set(s.internal_code, { kind: "skill", name: s.name_fr ?? s.name_en ?? s.internal_code, extra: s.category });
      }

      const items = await db.select<{ internal_code: string; name_fr: string | null; name_en: string | null; category: string | null }[]>(
        `SELECT internal_code, name_fr, name_en, category FROM inagle_items WHERE internal_code IN (${placeholders})`,
        batch,
      );
      for (const it of items) {
        if (out.has(it.internal_code)) continue;
        out.set(it.internal_code, { kind: "item", name: it.name_fr ?? it.name_en ?? it.internal_code, extra: it.category });
      }
    }

    return out;
  },

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
