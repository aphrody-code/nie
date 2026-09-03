// Le vocabulaire commun de la médiathèque — ce que `CinemaView`, la fiche de détail et le héros
// se partagent.
//
// Ces types vivaient dans `CinemaView.tsx`. Ils en sortent parce que trois composants les
// emploient désormais, et qu'un import depuis la vue vers ses propres enfants aurait fait un
// cycle. Rien de neuf n'est décidé ici : c'est le même catalogue unifié qu'avant, décrit une
// seule fois.
import { clePourProfil, PROFIL_PRINCIPAL } from "./profils";
import type { EpisodeAnime } from "./animeDb";
import type { FilmDto } from "./bindings";

/** Clé de la saison qui porte les cinématiques du jeu. */
export const CLE_VICTORY_ROAD = "victory-road";

/** Clé de la vue « toutes les saisons ». */
export const CLE_TOUT = "__tout__";

/**
 * Un élément du catalogue, quelle que soit sa source. C'est ce type qui permet à la recherche, à
 * la reprise de lecture et aux rangées de traiter un épisode et une cinématique de la même façon ;
 * seule la LECTURE les distingue.
 *
 * Nommé `ElementCinema` et non `Element` : ce dernier est le type DOM global, et le masquer dans
 * un fichier TSX rend illisibles les vraies erreurs sur les nœuds du document.
 */
export interface ElementCinema {
  /** Identité stable : chemin VFS pour le jeu, identifiant YouTube pour la série. */
  cle: string;
  titre: string;
  sousTitre: string | null;
  source: "anime" | "jeu";
  /** Clé de la saison d'appartenance. */
  saison: string;
  /** Vignette distante (série) — le jeu, lui, capture son affiche à la volée. */
  vignette: string | null;
  film?: FilmDto;
  episode?: EpisodeAnime;
}

/** Une saison du catalogue — une rangée dans la vue d'ensemble, une grille quand elle est ouverte. */
export interface SaisonCinema {
  cle: string;
  titre: string;
  source: "anime" | "jeu";
  elements: ElementCinema[];
}

// ── Positions de reprise ──────────────────────────────────────────────────────

/** Clé de persistance des positions de lecture, avant cloisonnement par profil. */
const CLE_REPRISE = "nie-explorer:cinema:reprise";

/** Un film au-delà de ce nombre de secondes vues est considéré comme « en cours ». */
export const REPRISE_MIN = 5;

export type Reprises = Record<string, { position: number; duree: number }>;

export function lireReprises(profilId: string = PROFIL_PRINCIPAL): Reprises {
  try {
    return JSON.parse(localStorage.getItem(clePourProfil(CLE_REPRISE, profilId)) ?? "{}") as Reprises;
  } catch {
    return {};
  }
}

export function ecrireReprises(r: Reprises, profilId: string = PROFIL_PRINCIPAL): void {
  try {
    localStorage.setItem(clePourProfil(CLE_REPRISE, profilId), JSON.stringify(r));
  } catch {
    // Quota plein : la reprise est un confort, pas une donnée à défendre.
  }
}

// ── Affiches capturées ────────────────────────────────────────────────────────

/**
 * Affiches déjà capturées, par chemin — un cache de session, jamais persisté.
 *
 * Partagé entre les cartes, le héros et la fiche de détail : une image capturée au survol d'une
 * carte sert de fond au héros sans re-démultiplexer un conteneur de 300 Mo.
 */
export const affiches = new Map<string, string>();

/** Fraction de la durée à laquelle on capture l'affiche : le tout début est souvent noir. */
export const INSTANT_AFFICHE = 0.12;

/** `312761536` → `298 Mo`. */
export function formaterOctets(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  if (n < 1024 * 1024 * 1024) return `${Math.round(n / (1024 * 1024))} Mo`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

/**
 * Vignette YouTube en haute définition d'un épisode.
 *
 * La base porte l'URL `hqdefault` (480×360), assez pour une carte de 224 px mais floue en fond de
 * héros ou d'en-tête de fiche, qui font toute la largeur. `maxresdefault` existe pour la quasi-
 * totalité des vidéos de la chaîne ; quand elle manque, YouTube répond une image de remplacement
 * et l'appelant retombe sur `vignette` par `onError`.
 */
export function vignetteHd(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
}
