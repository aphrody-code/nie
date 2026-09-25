"use client";

import { ClipboardList } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Link } from "../../../compat/next";
import { cn } from "../../../lib/utils";

const ROLE_ACCENT: Record<string, string> = {
  Coach: "text-tertiary",
  Coordinator: "text-primary",
  Manager: "text-secondary",
};

export interface CoachCardImage {
  src: string;
  alt: string;
  className: string;
  onError: () => void;
}
export interface CoachCardProps {
  id: number;
  name: string;
  roleLabel: string;
  role: string;
  playstyleLabel?: string | null;
  elementLabel?: string | null;
  faceUrl?: string | null;
  stat?: string | null;
  buff?: string | null;
  className?: string;
  renderImage: (image: CoachCardImage) => ReactNode;
  renderElement?: () => ReactNode;
}

/** Shared coach-card presentation. Hosts own portrait and element-art resolution. */
export function CoachCard({
  id,
  name,
  roleLabel,
  role,
  playstyleLabel,
  elementLabel,
  faceUrl,
  stat,
  buff,
  className,
  renderImage,
  renderElement,
}: CoachCardProps) {
  const accent = ROLE_ACCENT[role] ?? "text-on-surface-variant";
  const [imageFailed, setImageFailed] = useState(false);
  const showFace = Boolean(faceUrl) && !imageFailed;
  return (
    <Link
      href={`/entraineur/${id}`}
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-2xl border border-outline-variant/30 bg-surface-container-low",
        "transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-container hover:shadow-lg",
        className,
      )}
    >
      <div className="relative flex aspect-[3/2] w-full items-center justify-center overflow-hidden bg-surface-container-high">
        {showFace && faceUrl ? (
          renderImage({
            src: faceUrl,
            alt: name,
            className:
              "object-contain transition-transform duration-300 group-hover:scale-110",
            onError: () => setImageFailed(true),
          })
        ) : (
          <ClipboardList
            size={40}
            className={cn(
              "opacity-30 transition-transform duration-300 group-hover:scale-110",
              accent,
            )}
            aria-hidden="true"
          />
        )}
        {renderElement ? (
          <div className="absolute right-2 top-2 rounded-full bg-surface/80 p-1 backdrop-blur-sm">
            {renderElement()}
          </div>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <span
          className={cn(
            "text-[10px] font-bold uppercase tracking-wider",
            accent,
          )}
        >
          {roleLabel}
          {playstyleLabel ? ` · ${playstyleLabel}` : ""}
        </span>
        <h3 className="line-clamp-1 text-sm font-bold leading-tight text-on-surface transition-colors group-hover:text-primary">
          {name}
        </h3>
        {stat ? (
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <span className="line-clamp-1 text-xs text-on-surface-variant">
              {stat}
            </span>
            {buff ? (
              <span className="shrink-0 rounded-full bg-primary-container px-2 py-0.5 text-[11px] font-bold text-on-primary-container">
                {buff}
              </span>
            ) : null}
          </div>
        ) : (
          <span className="mt-auto pt-1 text-xs italic text-on-surface-variant/50">
            {elementLabel ?? "—"}
          </span>
        )}
      </div>
    </Link>
  );
}
