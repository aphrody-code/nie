"use client";

import Image from "next/image";
import {
  CoachCard as SharedCoachCard,
  type CoachCardProps as SharedCoachCardProps,
} from "@niers/inacord-ui/components/wiki/wiki/CoachCard";
import { ElementIcon } from "@/components/wiki/ElementIcon";
import { getCharacterFaceUrl } from "@rosegriffon/azalee/images";

export interface CoachCardProps extends Omit<
  SharedCoachCardProps,
  | "roleLabel"
  | "playstyleLabel"
  | "elementLabel"
  | "faceUrl"
  | "renderImage"
  | "renderElement"
> {
  roleFr: string;
  playstyleFr?: string | null;
  elementKey?: string | null;
  elementFr?: string | null;
  internalCode?: string | null;
}

/** Azalée adapter: it keeps the CDN portrait and localized element pipelines. */
export function CoachCard({
  roleFr,
  playstyleFr,
  elementKey,
  elementFr,
  internalCode,
  ...props
}: CoachCardProps) {
  return (
    <SharedCoachCard
      {...props}
      roleLabel={roleFr}
      playstyleLabel={playstyleFr}
      elementLabel={elementFr}
      faceUrl={internalCode ? getCharacterFaceUrl(internalCode) : null}
      renderImage={({ src, alt, className, onError }) => (
        <Image
          src={src}
          alt={alt}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
          unoptimized
          className={className}
          onError={onError}
        />
      )}
      renderElement={
        elementKey
          ? () => <ElementIcon element={elementKey} size="sm" />
          : undefined
      }
    />
  );
}
