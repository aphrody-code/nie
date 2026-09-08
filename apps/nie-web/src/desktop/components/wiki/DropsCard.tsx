"use client";

import { Image } from "@niers/inacord-ui/components/ui/image";
import {
	DropsCard as SharedDropsCard,
	type DropsCardProps as SharedDropsCardProps,
} from "@niers/inacord-ui/components/wiki/wiki/DropsCard";
import type { DropEntry } from "@/lib/wikiTypes";
import { dropCategoryLabel, dropSourceLabel } from "@/lib/wikiTypes";
import { getItemIconUrl, PLACEHOLDERS, resolveAssetUrl } from "@niers/inacord-ui/lib/wikiImages";

/** Desktop adapter: VFS-aware image decoding stays in the desktop image component. */
export interface DropsCardProps extends Omit<SharedDropsCardProps, "drop" | "resolveImage" | "renderImage" | "sourceLabel" | "categoryLabel" | "groupLabel" | "weightLabel"> {
	drop: DropEntry;
}

export function DropsCard({ drop, ...props }: DropsCardProps) {
	return <SharedDropsCard {...props} drop={drop} resolveImage={(image, internalCode) => { const source = resolveAssetUrl(image) || (internalCode ? getItemIconUrl(internalCode) : null); return source === PLACEHOLDERS.item ? null : source; }} renderImage={({ src, alt, className, onError }) => <Image src={src} alt={alt} width={48} height={48} className={className} unoptimized onError={onError} />} sourceLabel={dropSourceLabel} categoryLabel={dropCategoryLabel} groupLabel={(sourceId) => `Groupe ${sourceId}`} weightLabel={(weight) => `Poids ${weight} dans le groupe`} />;
}
