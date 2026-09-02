"use client";

import type { SerializedEditorState } from "lexical";
import Image from "next/image";
import { Button } from "@rosegriffon/ui";
import { X } from "@/lib/icons-config";
import { CATEGORIES } from "./constants";
import { LexicalRenderer } from "./LexicalRenderer";
import { countWords, estimateReadTime } from "./utils";

interface EditorPreviewProps {
	title: string;
	excerpt: string;
	imageUrl: string;
	category: string;
	content: SerializedEditorState;
	onClose: () => void;
}

export function EditorPreview({
	title,
	excerpt,
	imageUrl,
	category,
	content,
	onClose,
}: EditorPreviewProps) {
	const currentCategory = CATEGORIES.find((c) => c.value === category);
	const wordCount = countWords(content);
	const readTime = estimateReadTime(wordCount);

	return (
		<div className="fixed inset-0 z-50 bg-background overflow-y-auto">
			<div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-outline-variant/30 px-6 py-3 flex items-center justify-between">
				<h2 className="text-sm font-bold text-on-surface">Aperçu de l&apos;article</h2>
				<Button variant="ghost" size="icon" className="rounded-full" onClick={onClose}>
					<X className="size-5" />
				</Button>
			</div>
			<article className="max-w-3xl mx-auto px-6 py-12 space-y-6">
				{imageUrl && (
					<div className="relative aspect-[21/9] w-full overflow-hidden rounded-2xl bg-muted">
						<Image
							src={imageUrl}
							alt="Cover"
							fill
							sizes="(max-width: 768px) 100vw, 768px"
							className="object-cover"
						/>
					</div>
				)}
				<div className="space-y-2">
					<span className="text-xs font-bold uppercase tracking-wider text-primary">
						{currentCategory?.label}
					</span>
					<h1 className="text-4xl font-black tracking-tight leading-tight">
						{title || "Sans titre"}
					</h1>
					{excerpt && <p className="text-lg text-muted-foreground">{excerpt}</p>}
				</div>
				<div className="flex items-center gap-3 text-sm text-muted-foreground border-y border-outline-variant/20 py-3">
					<span>{wordCount} mots</span>
					<span>~{readTime} min de lecture</span>
				</div>
				<div className="prose prose-lg dark:prose-invert max-w-none break-words">
					{wordCount > 0 ? (
						<LexicalRenderer content={content} />
					) : (
						<p className="text-muted-foreground italic">
							Le contenu est vide pour l&apos;instant. Commencez à rédiger dans l&apos;éditeur.
						</p>
					)}
				</div>
			</article>
		</div>
	);
}
