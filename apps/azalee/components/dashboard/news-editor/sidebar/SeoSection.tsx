"use client";

import { AlertCircle, Check, Loader2, RefreshCw } from "lucide-react";
import { Button, Input, Textarea } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";
import { generateSlug } from "../utils";

interface SeoSectionProps {
	slug: string;
	metaTitle: string;
	metaDescription: string;
	title: string;
	articleId?: string;
	slugStatus?: "idle" | "checking" | "available" | "taken";
	onSlugChange: (value: string) => void;
	onMetaTitleChange: (value: string) => void;
	onMetaDescriptionChange: (value: string) => void;
}

export function SeoSection({
	slug,
	metaTitle,
	metaDescription,
	title,
	slugStatus = "idle",
	onSlugChange,
	onMetaTitleChange,
	onMetaDescriptionChange,
}: SeoSectionProps) {
	const generatedSlug = title ? generateSlug(title) : "";

	return (
		<div className="space-y-4">
			{/* Slug */}
			<div className="space-y-2">
				<label
					htmlFor="article-slug"
					className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider"
				>
					Slug URL
				</label>
				<div className="flex gap-1.5">
					<div className="relative flex-1">
						<Input
							id="article-slug"
							value={slug}
							onChange={(e) => onSlugChange(e.target.value)}
							className={cn(
								"bg-surface-container-high border-none rounded-xl text-sm h-10 font-sans pr-8",
								slugStatus === "taken" && "ring-2 ring-destructive/50",
								slugStatus === "available" && "ring-2 ring-green-500/50"
							)}
							placeholder={generatedSlug || "auto-generated"}
							aria-describedby="slug-hint"
						/>
						{/* Status indicator */}
						{slugStatus === "checking" && (
							<Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 animate-spin text-muted-foreground" />
						)}
						{slugStatus === "available" && (
							<Check className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-green-500" />
						)}
						{slugStatus === "taken" && (
							<AlertCircle className="absolute right-2.5 top-1/2 -translate-y-1/2 size-3.5 text-destructive" />
						)}
					</div>
					{title && (
						<Button
							type="button"
							variant="ghost"
							size="icon"
							className="shrink-0 size-10 rounded-xl hover:bg-surface-container-highest"
							onClick={() => onSlugChange(generatedSlug)}
							aria-label="Regénérer le slug depuis le titre"
						>
							<RefreshCw className="size-3.5" />
						</Button>
					)}
				</div>
				<div className="space-y-0.5">
					{slugStatus === "taken" && (
						<p className="text-[10px] text-destructive font-medium">Ce slug est déjà utilisé</p>
					)}
					{slugStatus === "available" && (
						<p className="text-[10px] text-green-600 font-medium">Slug disponible</p>
					)}
					<p id="slug-hint" className="text-[10px] text-muted-foreground/50">
						{slug ? (
							<>
								Aperçu : <span className="font-mono">/{slug}</span>
							</>
						) : generatedSlug ? (
							<>
								Auto : <span className="font-mono">/{generatedSlug}</span>
							</>
						) : (
							"Entrez un titre pour générer automatiquement le slug"
						)}
					</p>
				</div>
			</div>

			{/* Meta Title */}
			<div className="space-y-2">
				<label
					htmlFor="article-meta-title"
					className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider"
				>
					Titre SEO
				</label>
				<Input
					id="article-meta-title"
					value={metaTitle}
					onChange={(e) => onMetaTitleChange(e.target.value)}
					className="bg-surface-container-high border-none rounded-xl text-sm h-10 font-sans"
					placeholder="Titre SEO (optionnel)"
					aria-describedby="meta-title-hint"
				/>
				<p
					id="meta-title-hint"
					className={cn(
						"text-[10px]",
						metaTitle.length > 60 ? "text-destructive" : "text-muted-foreground/50"
					)}
				>
					{metaTitle.length}/60 caractères recommandés
				</p>
			</div>

			{/* Meta Description */}
			<div className="space-y-2">
				<label
					htmlFor="article-meta-description"
					className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider"
				>
					Meta description
				</label>
				<Textarea
					id="article-meta-description"
					value={metaDescription}
					onChange={(e) => onMetaDescriptionChange(e.target.value)}
					className="bg-surface-container-high border-none rounded-xl resize-none text-sm font-sans"
					placeholder="Meta description (optionnel)"
					rows={2}
					aria-describedby="meta-desc-hint"
				/>
				<p
					id="meta-desc-hint"
					className={cn(
						"text-[10px]",
						metaDescription.length > 160 ? "text-destructive" : "text-muted-foreground/50"
					)}
				>
					{metaDescription.length}/160 caractères recommandés
				</p>
			</div>
		</div>
	);
}
