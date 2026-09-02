"use client";

import { useEffect, useRef } from "react";
import { trackReading } from "@/app/actions/reading-history";
import { useAuth } from "@/components/providers/AuthProvider";

interface ReadingProgressTrackerProps {
	articleId: string;
}

const THRESHOLDS = [25, 50, 75, 100];

export function ReadingProgressTracker({ articleId }: ReadingProgressTrackerProps) {
	const { user } = useAuth();
	const trackedRef = useRef<Set<number>>(new Set());
	const lastCallRef = useRef<number>(0);
	const endMarkerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!user) {
			return;
		}

		const calculateProgress = (): number => {
			const scrollTop = window.scrollY;
			const docHeight = document.documentElement.scrollHeight - window.innerHeight;
			if (docHeight <= 0) {
				return 0;
			}
			return Math.min(Math.round((scrollTop / docHeight) * 100), 99);
		};

		const report = (progress: number) => {
			// Find which thresholds have been crossed
			for (const threshold of THRESHOLDS) {
				if (progress >= threshold && !trackedRef.current.has(threshold)) {
					trackedRef.current.add(threshold);
					trackReading(articleId, threshold).catch(() => {
						// Silently ignore — non-blocking
					});
				}
			}
		};

		const handleScroll = () => {
			const now = Date.now();
			if (now - lastCallRef.current < 1000) {
				return;
			}
			lastCallRef.current = now;
			report(calculateProgress());
		};

		window.addEventListener("scroll", handleScroll, { passive: true });

		// IntersectionObserver pour détecter la fin de l'article (100%)
		const marker = endMarkerRef.current;
		let observer: IntersectionObserver | null = null;

		if (marker) {
			observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting && !trackedRef.current.has(100)) {
							trackedRef.current.add(100);
							trackReading(articleId, 100).catch(() => {});
						}
					}
				},
				{ threshold: 0.5 }
			);
			observer.observe(marker);
		}

		return () => {
			window.removeEventListener("scroll", handleScroll);
			if (observer && marker) {
				observer.unobserve(marker);
			}
		};
	}, [user, articleId]);

	if (!user) {
		return null;
	}

	// Marqueur invisible placé en fin de contenu via un portail n'étant pas possible ici,
	// On expose une ref pour que le parent puisse placer ce marqueur si besoin.
	// Par défaut on insère un élément de hauteur nulle en position fixed hors viewport
	// Que l'IntersectionObserver surveillera.
	return (
		<div
			ref={endMarkerRef}
			aria-hidden="true"
			className="pointer-events-none fixed bottom-0 left-0 w-px h-px opacity-0"
		/>
	);
}
