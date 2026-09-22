// Modèle d'équipe du **constructeur** et du **générateur aléatoire** — logique pure, aucun import
// Tauri.
//
// ## Ce module n'invente rien : il rebranche
//
// Les règles de jeu (83 formations réelles aux coordonnées `f32` décodées par `nie-data`, facteur
// de poste, synergies d'élément, code de partage) vivent déjà dans `@nie/game/game`,
// écrit explicitement pour servir « le CLI, le wiki web et une éventuelle GUI Tauri ». Les
// réécrire ici en ferait une seconde vérité qui dériverait au premier ajustement. On les IMPORTE.
//
// Conséquence directe et voulue : **le code de partage est le même des deux côtés**. Une
// composition faite dans l'explorateur se colle dans l'URL du wiki, et réciproquement — c'est ce
// qui remplace la sauvegarde côté serveur, que l'application de bureau n'a pas (aucun compte,
// aucune session : cf. `teamsDb.ts` pour la persistance locale).
//
// ## Ce qui change par rapport au web
//
// * **le visage vient du VFS**, pas d'un CDN : `data/dx11/menu/200_icon/10_icon_chr/face/
//   <code>_l.g4tx` (5 685 fichiers, suffixe `_l` sans exception — relevé le 2026-09-02). Le champ
//   `imageUrl` de `TeamMember` reste donc VIDE côté bureau : il désigne une URL distante, et il
//   n'y a pas d'URL. La vignette se décode via `thumbs.ts`, comme partout ailleurs dans l'app.
// * **le filtre « style de jeu » du générateur web est mort** : il lit
//   `sheetData.playstyle`, qui vaut `NULL` sur 6 166 lignes sur 6 166 du miroir. La garde
//   `minCount` du wiki le neutralise en silence — l'utilisatrice croit filtrer. Il n'est pas
//   porté ; le style de jeu reste affiché sur l'encadrement, où il est réellement renseigné.

import { FORMATIONS, type Formation } from "@nie/game/game/formations";
import type { TeamMember } from "@nie/game/game/team-types";

import type { RosterRow } from "./wikiContracts";

export { FORMATIONS };
export type { Formation, TeamMember };

/** Nombre de remplaçants, d'entraîneurs et de coordinateurs — mêmes créneaux que le wiki. */
export const NB_RESERVES = 5;
export const NB_SUPPORTS = 3;

/** A selectable character as returned by the native wiki mirror contract. */
export interface Joueur {
  /** `chara_param_id` — la clé qui ouvre `api.gameDataCalculateStats`. */
  id: string;
  slug?: string | null;
  baseSlug?: string | null;
  charaId?: string | null;
  nom: string;
  /** Poste FR du miroir (`Attaquant`, `Milieu`, `Défenseur`, `Gardien`, `Entraîneur`). */
  poste: string;
  /** Élément FR du miroir (`Feu`, `Vent`, `Forêt`, `Montagne`, `Néant`, `Aucun`). */
  element: string;
  rarete: string;
  /** Code de rareté attendu par le moteur de croissance, `null` si le miroir ne l'a pas. */
  codeRarete: number | null;
  serie: string | null;
  genre: string | null;
  /** Code interne (`c01000010`) — sert à retrouver les fichiers du personnage dans le VFS. */
  code: string | null;
  /** Stats Lv99 du miroir, base du recalcul par niveau du constructeur. */
  stats: {
    kick: number;
    control: number;
    technique: number;
    pressure: number;
    physical: number;
    agility: number;
    intelligence: number;
  };
}

/**
 * Convertit une ligne du miroir en joueur — **la seule** traduction `RosterRow` → `Joueur` de
 * l'application : le comparateur, le générateur et le constructeur en partagent le résultat.
 */
export function versJoueur(l: RosterRow): Joueur {
  return {
    id: String(l.id),
    slug: l.slug,
    baseSlug: l.base_slug,
    charaId: l.chara_id,
    nom: l.name_fr || l.name_en || l.name_ja || String(l.id),
    poste: l.position ?? "",
    element: l.element ?? "",
    rarete: l.rarity_label ?? "Normal",
    codeRarete: l.rarity_code,
    serie: l.series,
    genre: l.gender,
    code: l.internal_code,
    stats: {
      kick: l.stat_frappe ?? 0,
      control: l.stat_controle ?? 0,
      technique: l.stat_technique ?? 0,
      pressure: l.stat_pression ?? 0,
      physical: l.stat_physique ?? 0,
      agility: l.stat_agilite ?? 0,
      intelligence: l.stat_intelligence ?? 0,
    },
  };
}

/**
 * Convertit un personnage décodé du **jeu** (`api.gameDataCharas`) en joueur — le roster de repli
 * des outils quand aucun miroir wiki n'est configuré.
 *
 * Ce que cette source a de plus que le miroir : elle est TOUJOURS disponible (le jeu est monté,
 * sinon l'application n'affiche rien), et ses stats sortent des tables de croissance embarquées
 * plutôt que d'une colonne recopiée. Ce qu'elle a de moins, et qui est dit tel quel : le rang de
 * rareté d'un exemplaire n'existe pas dans `chara_param` — les stats sont celles du **niveau 99
 * au rang UR**, base de comparaison commune (cf. `CharaDto::stats` côté Rust). `codeRarete` reste
 * donc `null` : aucun libellé de rareté n'est inventé.
 */
export function versJoueurDepuisJeu(c: {
  chara_param_id: string;
  name: string;
  main_position: string;
  element: string;
  series: string | null;
  internal_code: string;
  gender: number | null;
  stats: { kc: number | null; cr: number | null; tc: number | null; pr: number | null; ps: number | null; ag: number | null; it: number | null };
}): Joueur {
  return {
    id: c.chara_param_id,
    nom: c.name,
    poste: c.main_position,
    element: c.element,
    rarete: "Lv99 UR",
    codeRarete: null,
    serie: c.series,
    genre: c.gender === 2 ? "F" : c.gender === 1 ? "M" : null,
    code: c.internal_code || null,
    stats: {
      kick: c.stats.kc ?? 0,
      control: c.stats.cr ?? 0,
      technique: c.stats.tc ?? 0,
      // Core/inagle: Pr is Physical; Ps is Pressure (the abbreviations are not French).
      pressure: c.stats.ps ?? 0,
      physical: c.stats.pr ?? 0,
      agility: c.stats.ag ?? 0,
      intelligence: c.stats.it ?? 0,
    },
  };
}

/** Postes FR du miroir → codes courts attendus par `@nie/game/game`. */
const CODE_POSTE: Record<string, string> = {
  Gardien: "GK",
  Défenseur: "DF",
  Defenseur: "DF",
  Milieu: "MF",
  Attaquant: "FW",
  GK: "GK",
  DF: "DF",
  MF: "MF",
  FW: "FW",
};

/** Éléments FR du miroir → clés canoniques anglaises des règles partagées. */
const CODE_ELEMENT: Record<string, string> = {
  Feu: "Fire",
  Vent: "Wind",
  Forêt: "Forest",
  Foret: "Forest",
  Montagne: "Mountain",
  Néant: "Void",
  Neant: "Void",
  Aucun: "Void",
  Fire: "Fire",
  Wind: "Wind",
  Forest: "Forest",
  Mountain: "Mountain",
  Void: "Void",
};

/** Libellés FR des postes, pour l'affichage. */
export const LIBELLE_POSTE: Record<string, string> = {
  GK: "GAR",
  DF: "DEF",
  MF: "MIL",
  FW: "ATT",
};

/** Code court du poste d'un joueur (`MF` par défaut, comme le wiki). */
export function codePoste(poste: string): string {
  return CODE_POSTE[poste] ?? "MF";
}

/** Clé canonique de l'élément d'un joueur (`Void` par défaut). */
export function codeElement(element: string): string {
  return CODE_ELEMENT[element] ?? "Void";
}

/** Chemin VFS de l'icône de visage d'un personnage, `null` sans code interne. */
export function cheminVisage(code: string | null): string | null {
  return code ? `data/dx11/menu/200_icon/10_icon_chr/face/${code}_l.g4tx` : null;
}

/**
 * Convertit un joueur du roster en membre d'équipe, au format des règles partagées.
 *
 * `imageUrl` est laissé vide À DESSEIN : le champ désigne une URL distante dans le modèle du
 * wiki, et l'explorateur n'en a aucune — l'image se décode du VFS via [`cheminVisage`]. Y mettre
 * un chemin VFS le ferait passer pour une URL auprès de tout code qui l'attend comme telle.
 */
export function versMembre(j: Joueur, creneau: string): TeamMember {
  return {
    slot: creneau,
    charaId: j.id,
    name: j.nom,
    position: codePoste(j.poste),
    element: codeElement(j.element),
    rarity: j.rarete,
    imageUrl: "",
    slug: j.id,
    stats: j.stats,
    internalCode: j.code ?? undefined,
  };
}

/** Ordre de rareté pour l'auto-remplissage — mêmes valeurs que le wiki, plus « Émérite ». */
const SCORE_RARETE: Record<string, number> = {
  BASARA: 6,
  Héros: 5,
  Émérite: 4,
  Expérimenté: 3,
  Normal: 1,
};

/**
 * Trie une COPIE de `source`.
 *
 * `toSorted` serait plus direct mais demande la bibliothèque ES2023, que le `tsconfig` de
 * l'application ne cible pas (ES2022). Un unique point de tri dans tout le module, plutôt que
 * l'exception répétée à chaque appel.
 */
function trier<T>(source: readonly T[], comparateur: (a: T, b: T) => number): T[] {
  const copie = [...source];
  // oxlint-disable-next-line unicorn/no-array-sort
  copie.sort(comparateur);
  return copie;
}

/** Critères de filtrage du générateur aléatoire. */
export interface FiltresGenerateur {
  element: string | null;
  genre: string | null;
  rarete: string | null;
  serie: string | null;
}

/** Thin host contracts; filtering and selection are owned by nie-core::azalee::team_generator. */
export interface TeamGeneratorRuntime {
  team_generator_filter(rosterJson: string, filtersJson: string, minimum: number): string;
  team_generator_generate(rosterJson: string, positionsJson: string, filtersJson: string, locksJson: string, seed: number): string;
}

type GeneratorFilterKey = "element" | "gender" | "rarity" | "series";
interface GeneratorAssignment { slot: string; rosterIndex: number | null; locked: boolean; }
const FILTER_LABELS: Record<GeneratorFilterKey, string> = {
  element: "élément", gender: "genre", rarity: "rareté", series: "série",
};
let generatorRuntime: TeamGeneratorRuntime | undefined;

export function configureTeamGeneratorRuntime(runtime: TeamGeneratorRuntime): void {
  generatorRuntime = runtime;
}

function generator(): TeamGeneratorRuntime {
  if (!generatorRuntime) throw new Error("Team generator runtime is not initialized");
  return generatorRuntime;
}

/** DTO projection only; original records remain in the host and are addressed by index. */
function generatorRoster(roster: readonly Joueur[]): string {
  return JSON.stringify(roster.map(player => ({
    id: player.id, position: codePoste(player.poste), element: player.element,
    gender: player.genre, rarity: player.rarete, series: player.serie,
  })));
}

function generatorFilters(filters: FiltresGenerateur): string {
  return JSON.stringify({ element: filters.element, gender: filters.genre, rarity: filters.rarete, series: filters.serie });
}

/** Preserve the legacy result shape while delegating all filter decisions to Rust. */
export function filtrerVivier(
  vivier: readonly Joueur[], filtres: FiltresGenerateur, minimum: number,
): { retenus: Joueur[]; ignores: string[] } {
  if (!Number.isInteger(minimum) || minimum < 0 || minimum > 0xffff_ffff) throw new RangeError("Invalid roster minimum");
  const result = JSON.parse(generator().team_generator_filter(generatorRoster(vivier), generatorFilters(filtres), minimum)) as { indices: number[]; ignored: GeneratorFilterKey[] };
  return { retenus: result.indices.map(index => vivier[index]), ignores: result.ignored.map(key => FILTER_LABELS[key]) };
}

/** Seeded Rust selection; omitted seeds use host entropy, never a second JavaScript PRNG. */
export function genererEquipe(
  vivier: readonly Joueur[], formation: Formation, filtres: FiltresGenerateur,
  verrous: Readonly<Record<string, TeamMember>> = {},
  seed = crypto.getRandomValues(new Uint32Array(1))[0]!,
): Record<string, TeamMember> {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw new RangeError("Invalid team seed");
  const assignments = JSON.parse(generator().team_generator_generate(
    generatorRoster(vivier), JSON.stringify(formation.positions), generatorFilters(filtres),
    JSON.stringify(Object.entries(verrous).map(([slot, member]) => [slot, member.charaId])), seed,
  )) as GeneratorAssignment[];
  return Object.fromEntries(assignments.map(assignment => {
    if (assignment.locked) {
      const member = verrous[assignment.slot];
      if (!member) throw new Error("Rust generator returned an unknown locked slot");
      return [assignment.slot, member];
    }
    const player = assignment.rosterIndex === null ? undefined : vivier[assignment.rosterIndex];
    if (!player) throw new Error("Rust generator returned an invalid roster index");
    return [assignment.slot, versMembre(player, assignment.slot)];
  }));
}

/**
 * Auto-remplit les créneaux vides : terrain d'abord (poste respecté), puis remplaçants.
 * Les meilleures raretés passent en premier — même barème que le wiki.
 */
export function autoRemplir(
  vivier: readonly Joueur[],
  formation: Formation,
  actuels: Readonly<Record<string, TeamMember>>,
): Record<string, TeamMember> {
  const suivant: Record<string, TeamMember> = { ...actuels };
  const utilises = new Set(Object.values(actuels).map((m) => m.charaId));
  const disponibles = trier(
    vivier.filter((j) => !utilises.has(j.id)),
    (x, y) => (SCORE_RARETE[y.rarete] ?? 0) - (SCORE_RARETE[x.rarete] ?? 0),
  );

  for (const p of formation.positions) {
    const creneau = `field-${p.index}`;
    if (suivant[creneau]) continue;
    const match = disponibles.find((j) => codePoste(j.poste) === p.role && !utilises.has(j.id));
    if (match) {
      suivant[creneau] = versMembre(match, creneau);
      utilises.add(match.id);
    }
  }
  for (let i = 0; i < NB_RESERVES; i++) {
    const creneau = `reserve-${i}`;
    if (suivant[creneau]) continue;
    const match = disponibles.find((j) => !utilises.has(j.id));
    if (match) {
      suivant[creneau] = versMembre(match, creneau);
      utilises.add(match.id);
    }
  }
  return suivant;
}

/** Séries présentes dans un vivier, les canoniques d'abord puis le reste par fréquence. */
export function seriesDisponibles(vivier: readonly Joueur[]): string[] {
  const ORDRE = [
    "Victory Road",
    "Galaxy",
    "Orion",
    "Ares",
    "Chrono Stone",
    "Inazuma Eleven GO",
    "Inazuma Eleven 3",
    "Inazuma Eleven 2",
    "Inazuma Eleven",
  ];
  const comptes = new Map<string, number>();
  for (const j of vivier) {
    if (j.serie) comptes.set(j.serie, (comptes.get(j.serie) ?? 0) + 1);
  }
  const connues = ORDRE.filter((s) => comptes.has(s));
  const reste = trier(
    [...comptes.keys()].filter((s) => !ORDRE.includes(s)),
    (x, y) => (comptes.get(y) ?? 0) - (comptes.get(x) ?? 0),
  );
  return [...connues, ...reste];
}
