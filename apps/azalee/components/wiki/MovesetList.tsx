"use client";

import Image from "next/image";
import Link from "next/link";
import { getSkillElementIconUrl } from "@rosegriffon/azalee/images";
import {
	MovesetList as SharedMovesetList,
	type MovesetListProps as SharedMovesetListProps,
} from "@niers/inacord-ui";

export type MovesetSkill = SharedMovesetListProps["skills"][number];
export type MovesetListProps = Omit<
	SharedMovesetListProps,
	"resolveSkillHref" | "resolveElementIcon" | "renderSkillLink" | "renderElementImage"
>;

/** Azalée adapter: it keeps Next navigation, image rendering, and CDN asset lookup. */
export function MovesetList(props: MovesetListProps) {
	return (
		<SharedMovesetList
			{...props}
			resolveSkillHref={(skill) => (skill.id ? `/skill/${skill.id}` : "#")}
			resolveElementIcon={getSkillElementIconUrl}
			renderSkillLink={({ href, className, children }) => (
				<Link href={href} className={className}>
					{children}
				</Link>
			)}
			renderElementImage={({ src, alt, className }) => (
				<Image src={src} alt={alt} fill className={className} />
			)}
		/>
	);
}
