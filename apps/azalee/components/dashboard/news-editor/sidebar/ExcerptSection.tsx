"use client";

import { Textarea } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";

interface ExcerptSectionProps {
	excerpt: string;
	onExcerptChange: (value: string) => void;
}

export function ExcerptSection({ excerpt, onExcerptChange }: ExcerptSectionProps) {
	return (
		<div className="space-y-2">
			<label htmlFor="article-excerpt" className="sr-only">
				Extrait de l&apos;article
			</label>
			<Textarea
				id="article-excerpt"
				value={excerpt}
				onChange={(e) => onExcerptChange(e.target.value)}
				className="bg-surface-container-high border-none rounded-xl resize-none text-sm font-sans"
				placeholder="Résumé court de l'article..."
				rows={3}
				aria-describedby="excerpt-hint"
			/>
			<p
				id="excerpt-hint"
				className={cn(
					"text-[10px]",
					excerpt.length > 160 ? "text-destructive" : "text-muted-foreground/50"
				)}
			>
				{excerpt.length}/160 caractères
			</p>
		</div>
	);
}
