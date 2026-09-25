import { useEffect, useState } from "react";

/** Shared wiki/VFS image fallback state; each adapter retains its own image renderer. */
export function useImageFallback<T extends string | { src: string }>(src: T, zukanHash?: string, fallbackSrc?: string) {
	const [imgSrc, setImgSrc] = useState<T | string>(src);
	const [fallbackStage, setFallbackStage] = useState(0);
	const [isFailed, setIsFailed] = useState(false);
	useEffect(() => {
		setImgSrc(src);
		setFallbackStage(0);
		setIsFailed(false);
	}, [src]);

	const handleError = () => {
		const nextStage = fallbackStage + 1;
		setFallbackStage(nextStage);
		const zukanUrl = zukanHash
			? `https://dxi4wb638ujep.cloudfront.net/1/${zukanHash.startsWith("/") ? zukanHash.slice(1) : zukanHash}.png`
			: null;
		if (nextStage === 1 && zukanUrl && imgSrc !== zukanUrl) {
			setImgSrc(zukanUrl);
			return;
		}
		if (nextStage <= 2) {
			const value = typeof imgSrc === "string" ? imgSrc : "";
			if (value.includes("/face/")) {
				const clean = value.replaceAll(/_\d{4}/g, "");
				if (clean !== value) { setImgSrc(clean); return; }
			}
		}
		setIsFailed(true);
		setImgSrc(fallbackSrc || "/ievr.webp");
	};
	return { imgSrc, isFailed, handleError };
}
