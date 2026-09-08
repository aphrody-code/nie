"use client";

/**
 * Courbe d'expérience — graphe SVG de la table `inagle_exp_table`.
 *
 * Deux lectures de la MÊME donnée, sélectionnables par l'appelant :
 * - `cumulative` : EXP totale pour atteindre chaque niveau depuis le niveau 1 ;
 * - `palier` : EXP du seul passage `niveau → niveau + 1` (la colonne `need_exp` brute).
 *
 * Aucune couleur en dur : le tracé hérite de `currentColor` via les classes de
 * tokens (`text-primary`, `text-on-surface-variant`), exactement comme la courbe
 * du calculateur de stats (`components/wiki/StatCalculator.tsx`).
 *
 * Accessibilité : le SVG est `role="img"` avec un `aria-label` décrivant les
 * bornes réelles ; la donnée chiffrée complète reste disponible dans le tableau
 * de la page, le graphe n'est donc jamais le seul porteur d'information.
 */

import type { ExpCurvePoint } from "@/lib/wiki/exp-table-shared";
import { formatExp } from "@/lib/wiki/exp-table-shared";
import {
  ExperienceCurve,
  type ExperienceCurveMode,
} from "@niers/inacord-ui/components/wiki/wiki/ExperienceCurve";

/** Repère lu sur la courbe : cumul depuis le niveau 1, ou coût du palier seul. */
export type CourbeMode = ExperienceCurveMode;

export interface CourbeExperienceProps {
  /** Points de la courbe (un par niveau), issus de `buildExpCurve`. */
  points: ExpCurvePoint[];
  /** Grandeur tracée. */
  mode: CourbeMode;
  /** Niveau mis en évidence (marqueur vertical + point). */
  niveau: number;
  /** Appelé quand l'utilisateur clique ou glisse sur le graphe. */
  onNiveauChange?: (niveau: number) => void;
}

export function CourbeExperience({
  points,
  mode,
  niveau,
  onNiveauChange,
}: CourbeExperienceProps) {
  return (
    <ExperienceCurve
      points={points}
      mode={mode}
      niveau={niveau}
      onNiveauChange={onNiveauChange}
      formatValue={formatExp}
    />
  );
}
