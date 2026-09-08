"use client";

import { Image } from "@niers/inacord-ui/components/ui/image";
import {
	ElementIcon as SharedElementIcon,
	type ElementIconProps as SharedElementIconProps,
} from "@niers/inacord-ui";
import { getSkillIconUrl } from "@niers/inacord-ui/lib/wikiImages";

export type ElementIconProps = Omit<SharedElementIconProps, "resolveIcon" | "renderImage">;

/** Desktop adapter: it keeps VFS-aware image decoding in the host image component. */
export function ElementIcon(props: ElementIconProps) {
	return (
		<SharedElementIcon
			{...props}
			resolveIcon={getSkillIconUrl}
			renderImage={({ src, alt, width, height, className }) => (
				<Image src={src} alt={alt} width={width} height={height} className={className} />
			)}
		/>
	);
}
