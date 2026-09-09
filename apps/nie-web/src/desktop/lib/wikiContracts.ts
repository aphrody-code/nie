/** DTO contracts returned by the native Rust `nie-wiki` desktop boundary. */

import type { EntreeNoms } from "@/lib/traduction";

/** One localized name row from the native mirror index. */
export interface NameRow {
  type?: EntreeNoms["type"];
  id: string;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  internal_code: string | null;
}

/** One roster row returned by the Rust mirror query. */
export interface RosterRow {
  id: string;
  chara_id: string | null;
  name_fr: string | null;
  name_en: string | null;
  name_ja: string | null;
  internal_code: string | null;
  element: string | null;
  position: string | null;
  sub_position: string | null;
  rarity_label: string | null;
  rarity_code: number | null;
  series: string | null;
  gender: string | null;
  team_id: string | null;
  zukan_order: number | null;
  stat_frappe: number | null;
  stat_controle: number | null;
  stat_technique: number | null;
  stat_pression: number | null;
  stat_physique: number | null;
  stat_agilite: number | null;
  stat_intelligence: number | null;
}

/** One coach/manager/coordinator row returned by the native mirror query. */
export interface StaffRow {
  id: number;
  name_localised: string | null;
  name_romaji: string | null;
  name_kanji: string | null;
  role: string | null;
  playstyle: string | null;
  element: string | null;
  buff: string | null;
  requirements: string | null;
}

/** One character skill row returned by the native mirror join. */
export interface TechniqueRow {
  id: string;
  name_fr: string | null;
  name_en: string | null;
  category: string | null;
  element: string | null;
  power_max: number | null;
  tp_cost: number | null;
  is_hyper: number | null;
}
