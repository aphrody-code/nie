"use client";

import { AuraCard as SharedAuraCard, type AuraCardProps as SharedAuraCardProps } from "@niers/inacord-ui";
import { Image } from "@niers/inacord-ui/components/ui/image";
import { getAuraImageUrl, resolveAssetUrl } from "@niers/inacord-ui/lib/wikiImages";
import { ElementIcon } from "@/components/wiki/ElementIcon";

/** Desktop adapter: VFS image decoding remains in the desktop image component. */
export interface AuraCardProps extends Omit<SharedAuraCardProps, "resolveImage" | "renderImage" | "renderElement"> {
	description?: string;
}

export function AuraCard(props: AuraCardProps) {
	return (
		<SharedAuraCard
			{...props}
			resolveImage={(image, assetCode, subType) => resolveAssetUrl(image) || getAuraImageUrl(assetCode, subType)}
			renderImage={({ src, alt, className, onError }) => (
				<Image src={src} alt={alt} fill className={className} sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" onError={onError} unoptimized />
			)}
			renderElement={(element) => <ElementIcon element={element} size="sm" />}
		/>
	);
}
