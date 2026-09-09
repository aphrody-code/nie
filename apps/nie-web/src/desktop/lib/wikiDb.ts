/** Native desktop adapter for the Rust `nie-wiki` owner. */
import { commands, type JsonValue } from "./bindings";
import { localizedName, type ResolvedName } from "@niers/inacord-ui/lib/resolved-names";
import type { GameLocale } from "@niers/inacord-ui/lib/settings";
export type { ResolvedName } from "@niers/inacord-ui/lib/resolved-names";
import { japaneseToRomaji } from "@niers/game/text";

import { dedoublonnerParNom, type EntreeNoms } from "@/lib/traduction";
import type { StaffRow, NameRow, RosterRow, TechniqueRow } from "./wikiContracts";

export interface CharacterRow {
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

export interface SkillRow {
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

async function native<T>(dbPath: string, operation: string, args: Record<string, JsonValue> = {}): Promise<T> {
  const result = await commands.wikiQuery(dbPath, operation, args);
  if (result.status === "error") throw new Error(result.error);
  return result.data as T;
}

function nativeNames(rows: Array<NameRow & { type: string }>): EntreeNoms[] {
  return dedoublonnerParNom(
    rows.map((row) => ({
      type: row.type as EntreeNoms["type"],
      id: String(row.id),
      nomFr: row.name_fr,
      nomEn: row.name_en,
      nomJa: row.name_ja,
      romaji: japaneseToRomaji(row.name_ja),
      code: row.internal_code,
    })),
  );
}

export const wikiDb = {
  async resolveManyByCode(dbPath: string, codes: string[], locale: GameLocale = "fr"): Promise<Map<string, ResolvedName>> {
    const rows = await native<Array<{
      id: string;
      code: string;
      name_fr: string | null;
      name_en: string | null;
      name_ja: string | null;
      element: string | null;
      position: string | null;
      category: string | null;
      kind: "chara" | "skill" | "item" | "team" | "keshin" | "soul";
    }>>(dbPath, "resolve_many_by_code", { codes });
    const out = new Map<string, ResolvedName>();
    for (const row of rows) {
      if (out.has(row.code)) continue;
      const kind = row.kind === "skill" ? "skill" : row.kind === "item" && row.category === "special_tactics" ? "tactic" : row.kind;
      out.set(row.code, {
        id: row.id,
        kind,
        name: localizedName(row, locale, row.code),
        extra: [row.element, row.position, row.category].filter(Boolean).join(" · ") || null,
      });
    }
    return out;
  },

  searchCharacter: (dbPath: string, query: string) => native<CharacterRow[]>(dbPath, "search_character", { query }),
  searchSkill: (dbPath: string, query: string) => native<SkillRow[]>(dbPath, "search_skill", { query }),

  async loadNameIndex(dbPath: string): Promise<EntreeNoms[]> {
    return nativeNames(await native<Array<NameRow & { type: string }>>(dbPath, "load_name_index"));
  },

  loadRoster: (dbPath: string) => native<RosterRow[]>(dbPath, "load_roster"),
  loadStaff: (dbPath: string) => native<StaffRow[]>(dbPath, "load_staff"),
  characterSkills: (dbPath: string, charaId: string) => native<TechniqueRow[]>(dbPath, "character_skills", { id: charaId }),
  stats: (dbPath: string) => native<MirrorStats>(dbPath, "mirror_stats"),
};

export interface MirrorStats {
  tables: number;
  personnages: number | null;
  techniques: number | null;
  objets: number | null;
  equipes: number | null;
  avatars: number | null;
}
