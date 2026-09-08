"use client";

import Image from "next/image";
import {
  MoveCard as SharedMoveCard,
  type MoveCardProps as SharedMoveCardProps,
} from "@niers/inacord-ui/components/wiki/wiki/MoveCard";
import { getSkillImageUrl } from "@rosegriffon/azalee/images";

export interface MoveCardProps extends Omit<
  SharedMoveCardProps,
  "imageUrl" | "renderImage"
> {
  posterUrl?: string;
  thumbnailUrl?: string;
}

/** Azalée adapter: it resolves CDN artwork and keeps Next image behaviour. */
export function MoveCard({ thumbnailUrl, posterUrl, ...props }: MoveCardProps) {
  return (
    <SharedMoveCard
      {...props}
      imageUrl={thumbnailUrl || posterUrl || getSkillImageUrl(props.id)}
      renderImage={({ src, alt, className, onError }) => (
        <Image
          src={src}
          alt={alt}
          fill
          className={className}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          onError={onError}
          unoptimized
        />
      )}
    />
  );
}
