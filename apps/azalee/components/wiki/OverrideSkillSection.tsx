"use client";

import Image from "next/image";
import {
	OverrideSkillSection as SharedOverrideSkillSection,
	type OverrideSkillData,
	type OverrideSkillSectionProps as SharedOverrideSkillSectionProps,
} from "@niers/inacord-ui/components/wiki/wiki/OverrideSkillSection";
import { getSkillImageUrl } from "@rosegriffon/azalee/images";

export type { OverrideSkillData };

export type OverrideSkillSectionProps = Pick<
	SharedOverrideSkillSectionProps,
	"overrides" | "currentSkillId"
>;

/** Azalée adapter: it keeps the CDN resolver and Next image implementation. */
export function OverrideSkillSection(props: OverrideSkillSectionProps) {
	return (
		<SharedOverrideSkillSection
			{...props}
			resolveSkillImage={getSkillImageUrl}
			renderSkillImage={({ src, alt, className, onError }) => (
				<Image src={src} alt={alt} fill className={className} onError={onError} />
			)}
		/>
	);
}
