"use client";

import type { ReactNode } from "react";

import { cn } from "../../../lib/utils";

export type ElementIconSize = "sm" | "md" | "lg";

export interface ElementIconImage {
	src: string;
	alt: string;
	width: number;
	height: number;
	className: string;
}

export interface ElementIconProps {
	element: string;
	size?: ElementIconSize;
	className?: string;
	/** The host resolves the element artwork from its CDN or local VFS. */
	resolveIcon: (element: string) => string | null | undefined;
	/** Hosts keep their image implementation (Next image or VFS-aware desktop image). */
	renderImage: (image: ElementIconImage) => ReactNode;
}

const SIZES: Record<ElementIconSize, number> = {
	lg: 32,
	md: 24,
	sm: 16,
};

/**
 * Shared element-icon geometry. Resource lookup and image decoding belong to
 * the host so this component never assumes a CDN, browser route, or VFS mount.
 */
export function ElementIcon({ element, size = "md", className, resolveIcon, renderImage }: ElementIconProps) {
	const px = SIZES[size];
	const iconUrl = resolveIcon(element);

	if (!iconUrl) {
		return null;
	}

	return (
		<div
			className={cn("relative inline-flex items-center justify-center", className)}
			style={{ height: px, width: px }}
		>
			{renderImage({ src: iconUrl, alt: element, width: px, height: px, className: "object-contain" })}
		</div>
	);
}
