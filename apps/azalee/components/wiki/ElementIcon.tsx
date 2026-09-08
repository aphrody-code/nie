"use client";

import Image from "next/image";
import {
	ElementIcon as SharedElementIcon,
	type ElementIconProps as SharedElementIconProps,
} from "@niers/inacord-ui";
import { getSkillIconUrl } from "@rosegriffon/azalee/images";

export type ElementIconProps = Omit<SharedElementIconProps, "resolveIcon" | "renderImage">;

/** Azalée adapter: it owns CDN resolution and Next image optimization. */
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
