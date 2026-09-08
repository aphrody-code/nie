"use client";

import { Image } from "./image";
import type { ImageProps } from "./image";
import { useImageFallback } from "../../lib/use-image-fallback";

interface SafeImageProps extends ImageProps {
	zukanHash?: string;
	/** URL de l'image placeholder quand toutes les tentatives échouent. Par défaut : /placeholder-chara.webp */
	fallbackSrc?: string;
}

export function SafeImage({
	src,
	zukanHash,
	alt,
	fallbackSrc,
	unoptimized,
	...props
}: SafeImageProps) {
	const { imgSrc, isFailed, handleError } = useImageFallback(src, zukanHash, fallbackSrc);

	return (
		<Image
			{...props}
			src={imgSrc}
			alt={alt}
			onError={isFailed ? undefined : handleError}
			// On respecte le `unoptimized` du caller (images CDN tierces déjà en webp →
			// éviter le quota d'optim Next/402) et on force `unoptimized` au fallback final.
			unoptimized={unoptimized || isFailed}
		/>
	);
}
