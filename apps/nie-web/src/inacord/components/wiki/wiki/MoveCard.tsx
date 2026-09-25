"use client";

import { Store } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { SpriteCommonKey } from "../../../config/sprites-common";
import { Link } from "../../../compat/next";
import { cn } from "../../../lib/utils";
import { CommonSpriteIcon } from "../../ui/CommonSpriteIcon";

const ELEMENT_SPRITE: Record<string, SpriteCommonKey> = {
  Feu: "fire",
  Fire: "fire",
  Forest: "forest",
  Forêt: "forest",
  Montagne: "mountain",
  Mountain: "mountain",
  Vent: "wind",
  Wind: "wind",
};
const ELEMENT_ACCENT: Record<string, string> = {
  Feu: "border-red-500/40",
  Fire: "border-red-500/40",
  Forest: "border-green-500/40",
  Forêt: "border-green-500/40",
  Montagne: "border-amber-500/40",
  Mountain: "border-amber-500/40",
  Néant: "border-purple-500/40",
  Vent: "border-teal-500/40",
  Void: "border-purple-500/40",
  Wind: "border-teal-500/40",
};
const CATEGORY_LABEL: Record<string, string> = {
  Arrêt: "GAR",
  Block: "DEF",
  Catch: "GAR",
  Dribble: "DRI",
  Défense: "DEF",
  Shoot: "TIR",
  Tir: "TIR",
};
const CATEGORY_COLOR: Record<string, string> = {
  Arrêt: "bg-amber-500",
  Block: "bg-blue-600",
  Catch: "bg-amber-500",
  Dribble: "bg-emerald-600",
  Défense: "bg-blue-600",
  Shoot: "bg-red-600",
  Tir: "bg-red-600",
};

export interface MoveCardImage {
  src: string;
  alt: string;
  className: string;
  onError: () => void;
}
export interface MoveCardProps {
  id: string;
  name: string;
  powerMin?: number;
  powerMax?: number;
  tensionCost?: number;
  element?: string;
  category: string;
  className?: string;
  videoUrl?: string;
  imageUrl: string;
  shop?: string;
  /** The host owns the image component and its CDN/VFS implementation. */
  renderImage: (image: MoveCardImage) => ReactNode;
}

/** Shared technique-card presentation. Hosts resolve the localized thumbnail and image runtime. */
export function MoveCard({
  id,
  name,
  powerMin: _powerMin,
  powerMax,
  tensionCost,
  element,
  category,
  className,
  videoUrl,
  imageUrl,
  shop,
  renderImage,
}: MoveCardProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const elementSprite = element ? ELEMENT_SPRITE[element] : undefined;
  const borderAccent = element
    ? ELEMENT_ACCENT[element] || "border-outline-variant/20"
    : "border-outline-variant/20";
  const categoryLabel =
    CATEGORY_LABEL[category] || category.slice(0, 3).toUpperCase();
  const categoryColor = CATEGORY_COLOR[category] || "bg-slate-600";
  return (
    <Link
      href={`/skill/${id}`}
      className={cn(
        "group relative flex flex-col overflow-hidden rounded-xl border transition-all duration-200",
        "hover:-translate-y-0.5 hover:shadow-lg active:scale-[0.98]",
        "bg-surface-container-highest",
        borderAccent,
        className,
      )}
    >
      <div className="relative aspect-[16/9] w-full overflow-hidden bg-surface-container-high">
        {!imageFailed ? (
          renderImage({
            src: imageUrl,
            alt: name,
            className:
              "object-cover transition-transform duration-300 group-hover:scale-105",
            onError: () => setImageFailed(true),
          })
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-3xl font-black text-on-surface/20">
              {categoryLabel}
            </span>
          </div>
        )}
        {videoUrl ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex size-10 items-center justify-center rounded-full border border-white/20 bg-black/50 backdrop-blur-sm transition-all duration-200 group-hover:scale-110 group-hover:bg-black/70 sm:size-12">
              <svg
                viewBox="0 0 24 24"
                fill="white"
                className="ml-0.5 size-5 sm:size-6"
                aria-hidden="true"
              >
                <path d="M8 5v14l11-7z" />
              </svg>
            </div>
          </div>
        ) : null}
        <div className="absolute left-1 top-1 flex items-center gap-1">
          <span
            className={cn(
              "rounded-sm px-1.5 py-0.5 text-[8px] font-black leading-none tracking-wide text-on-surface",
              categoryColor,
            )}
          >
            {categoryLabel}
          </span>
        </div>
        {elementSprite ? (
          <div className="absolute right-1 top-1 drop-shadow-lg">
            <CommonSpriteIcon name={elementSprite} scale={0.35} />
          </div>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 h-10 bg-linear-to-t from-neutral-950 to-transparent" />
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 bg-surface-container-highest px-2 py-1.5">
        <div className="flex min-w-0 items-center justify-between gap-1">
          <p className="min-w-0 flex-1 truncate text-[11px] font-bold leading-tight text-on-surface sm:text-xs">
            {name}
          </p>
          <div className="flex shrink-0 items-center gap-1.5">
            {tensionCost != null && tensionCost > 0 ? (
              <span className="tabular-nums text-[9px] font-bold text-primary/80">
                {tensionCost}TP
              </span>
            ) : null}
            {powerMax != null && powerMax > 0 ? (
              <span className="tabular-nums font-mono text-[9px] font-bold text-on-surface/60">
                {powerMax}
              </span>
            ) : null}
          </div>
        </div>
        {shop ? (
          <div className="flex min-w-0 items-center gap-1">
            <Store
              size={10}
              className="text-on-surface/30"
              aria-hidden="true"
            />
            <span className="truncate text-[9px] leading-tight text-on-surface/40">
              {shop}
            </span>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
