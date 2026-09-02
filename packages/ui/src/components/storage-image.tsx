"use client";

import Image, { type ImageProps } from "next/image";
import { useState } from "react";
import { getAssetUrl } from "@rosegriffon/db/storage";
import { cn } from "../lib/utils";

export interface StorageImageProps extends Omit<ImageProps, "src"> {
	src: string;
	width?: number;
	height?: number;
	quality?: number;
	fallback?: string;
	showSkeleton?: boolean;
}

/**
 * Composant Image optimisé pour Supabase Storage.
 * Utilise automatiquement l'URL du bucket 'assets' pour les chemins relatifs.
 * Supporte les transformations d'image Supabase si activées.
 *
 * Fonctionnalités :
 * - Skeleton loading pendant le chargement
 * - Gestion des erreurs avec fallback
 * - Animation de fondu à l'apparition
 */
export function StorageImage({
	src,
	className,
	alt,
	width,
	height,
	quality,
	fallback = "/images/placeholder-chronicle.svg",
	showSkeleton = true,
	...props
}: StorageImageProps) {
	const [isLoading, setIsLoading] = useState(true);
	const [hasError, setHasError] = useState(false);

	const imageUrl = hasError ? fallback : getAssetUrl(src);

	return (
		<div className={cn("relative overflow-hidden", props.fill ? "w-full h-full" : "")}>
			{/* Skeleton loader */}
			{showSkeleton && isLoading && !hasError && (
				<div className="absolute inset-0 bg-linear-to-r from-muted via-muted/80 to-muted animate-pulse z-10" />
			)}

			<Image
				src={imageUrl}
				alt={alt}
				className={cn(
					"transition-all duration-500",
					isLoading ? "opacity-0 scale-105" : "opacity-100 scale-100",
					className
				)}
				width={width}
				height={height}
				quality={quality}
				{...props}
				onLoad={(e) => {
					setIsLoading(false);
					if (props.onLoad) {
						props.onLoad(e);
					}
				}}
				onError={(e) => {
					setHasError(true);
					setIsLoading(false);
					if (props.onError) {
						props.onError(e);
					}
				}}
			/>
		</div>
	);
}
