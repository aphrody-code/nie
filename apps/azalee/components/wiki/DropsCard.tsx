"use client";

import Image from "next/image";
import {
	DropsCard as SharedDropsCard,
	type DropsCardProps as SharedDropsCardProps,
} from "@niers/inacord-ui/components/wiki/wiki/DropsCard";
import type { DropEntry } from "@rosegriffon/azalee/wiki/drops-shared";
import { dropCategoryLabel, dropSourceLabel } from "@rosegriffon/azalee/wiki/drops-shared";
import { getItemIconUrl, PLACEHOLDERS, resolveAssetUrl } from "@rosegriffon/azalee/images";

export interface DropsCardProps extends Omit<SharedDropsCardProps, "drop" | "resolveImage" | "renderImage" | "sourceLabel" | "categoryLabel" | "groupLabel" | "weightLabel"> {
	drop: DropEntry;
}

/** Azalée adapter: data labels and Next/CDN image decoding remain host-owned. */
export function DropsCard({ drop, ...props }: DropsCardProps) {
	return <SharedDropsCard {...props} drop={drop} resolveImage={(image, internalCode) => { const source = resolveAssetUrl(image) || (internalCode ? getItemIconUrl(internalCode) : null); return source === PLACEHOLDERS.item ? null : source; }} renderImage={({ src, alt, className, onError }) => <Image src={src} alt={alt} width={48} height={48} className={className} unoptimized onError={onError} />} sourceLabel={dropSourceLabel} categoryLabel={dropCategoryLabel} groupLabel={(sourceId) => `Groupe ${sourceId}`} weightLabel={(weight) => `Poids ${weight} dans le groupe`} />;
}
