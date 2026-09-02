"use client";

import { Eye } from "lucide-react";
import { useEffect, useRef } from "react";
import { trackArticleView } from "@/app/actions/article-views";

interface ArticleViewTrackerProps {
	articleId: string;
	initialViewCount: number;
}

export function ArticleViewTracker({ articleId, initialViewCount }: ArticleViewTrackerProps) {
	const hasTracked = useRef(false);

	useEffect(() => {
		if (hasTracked.current) {
			return;
		}
		hasTracked.current = true;

		const trackView = async () => {
			const viewedKey = `viewed_${articleId}`;
			if (sessionStorage.getItem(viewedKey)) {
				return;
			}

			try {
				const result = await trackArticleView(articleId);
				if (result.success) {
					sessionStorage.setItem(viewedKey, "1");
				}
			} catch {
				// Tracking de vues non critique — silencieux.
			}
		};

		// Délai pour ne pas compter les bounces.
		const timer = setTimeout(trackView, 3000);
		return () => clearTimeout(timer);
	}, [articleId]);

	return (
		<div className="flex items-center gap-1.5 text-xs text-on-surface-variant/60">
			<Eye className="size-3.5" />
			<span>
				{initialViewCount} vue{initialViewCount !== 1 ? "s" : ""}
			</span>
		</div>
	);
}
