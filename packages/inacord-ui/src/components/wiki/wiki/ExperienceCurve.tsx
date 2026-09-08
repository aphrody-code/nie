"use client";

import { useId, useMemo } from "react";

/** A normalized experience row supplied by a host data adapter. */
export interface ExperienceCurvePoint {
  level: number;
  /** Experience required for the level → level + 1 transition. */
  needExp: number;
  /** Experience accumulated from the first level to this level. */
  cumulative: number;
}

export type ExperienceCurveMode = "cumulative" | "palier";

export interface ExperienceCurveProps {
  points: readonly ExperienceCurvePoint[];
  mode: ExperienceCurveMode;
  niveau: number;
  onNiveauChange?: (niveau: number) => void;
  /** Hosts can retain their locale-aware numeric formatter. */
  formatValue?: (value: number) => string;
}

const VIEW_W = 320;
const VIEW_H = 150;

function defaultFormatValue(value: number): string {
  return Number.isFinite(value)
    ? Math.trunc(value).toLocaleString("fr-FR")
    : "0";
}

/**
 * Host-neutral interactive SVG presentation of an experience curve.
 * Data loading, locale selection, and page-level level state remain host-owned.
 */
export function ExperienceCurve({
  points,
  mode,
  niveau,
  onNiveauChange,
  formatValue = defaultFormatValue,
}: ExperienceCurveProps) {
  const titleId = useId();

  const geometrie = useMemo(() => {
    if (points.length < 2) {
      return null;
    }
    const valeurs = points.map((point) =>
      mode === "cumulative" ? point.cumulative : point.needExp,
    );
    const max = Math.max(...valeurs);
    const min = Math.min(...valeurs);
    const amplitude = Math.max(1, max - min);
    const x = (index: number) => (index / (points.length - 1)) * VIEW_W;
    const y = (value: number) => VIEW_H - ((value - min) / amplitude) * VIEW_H;

    const ligne = valeurs
      .map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`)
      .join(" ");
    const aire = `0,${VIEW_H} ${ligne} ${VIEW_W},${VIEW_H}`;

    return { aire, ligne, max, min, valeurs, x, y };
  }, [points, mode]);

  if (!geometrie) {
    return (
      <div className="flex h-40 items-center justify-center text-sm text-on-surface-variant">
        Aucune donnée d'expérience à tracer.
      </div>
    );
  }

  const index = Math.max(
    0,
    points.findIndex((point) => point.level === niveau),
  );
  const valeurCourante = geometrie.valeurs[index] ?? 0;
  const cx = geometrie.x(index);
  const cy = geometrie.y(valeurCourante);
  const premier = points[0]!;
  const dernier = points[points.length - 1]!;

  function pointerVersNiveau(event: React.PointerEvent<SVGSVGElement>) {
    if (!onNiveauChange) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) {
      return;
    }
    const ratio = Math.min(
      1,
      Math.max(0, (event.clientX - rect.left) / rect.width),
    );
    const cible = points[Math.round(ratio * (points.length - 1))];
    if (cible && cible.level !== niveau) {
      onNiveauChange(cible.level);
    }
  }

  return (
    <figure className="m-0 space-y-2">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-40 w-full sm:h-56"
        preserveAspectRatio="none"
        role="img"
        aria-labelledby={titleId}
        onPointerDown={pointerVersNiveau}
        onPointerMove={(event) => {
          if (event.buttons === 1) {
            pointerVersNiveau(event);
          }
        }}
      >
        <title id={titleId}>
          {mode === "cumulative"
            ? `Expérience cumulée du niveau ${premier.level} au niveau ${dernier.level} : de ${formatValue(geometrie.min)} à ${formatValue(geometrie.max)} points.`
            : `Expérience par palier du niveau ${premier.level} au niveau ${dernier.level} : de ${formatValue(geometrie.min)} à ${formatValue(geometrie.max)} points.`}
        </title>
        <polygon points={geometrie.aire} className="fill-primary/10" />
        <polyline
          points={geometrie.ligne}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
          className="text-primary"
        />
        <line
          x1={cx}
          y1={0}
          x2={cx}
          y2={VIEW_H}
          stroke="currentColor"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          className="text-on-surface-variant/40"
        />
        <circle cx={cx} cy={cy} r={4} className="fill-primary" />
      </svg>
      <figcaption className="flex items-baseline justify-between gap-3 text-xs text-on-surface-variant">
        <span>Niveau {premier.level}</span>
        <span className="text-center font-medium text-on-surface">
          Niveau {niveau} · {formatValue(valeurCourante)} EXP
        </span>
        <span>Niveau {dernier.level}</span>
      </figcaption>
    </figure>
  );
}
