"use client";

import { ScrollArea } from "@rosegriffon/ui";
import { ExcerptSection } from "./sidebar/ExcerptSection";
import { FeaturedImageSection } from "./sidebar/FeaturedImageSection";
import { PublicationSection } from "./sidebar/PublicationSection";
import { SeoSection } from "./sidebar/SeoSection";
import { TagsSection } from "./sidebar/TagsSection";

interface EditorMetadataProps {
	status: string;
	category: string;
	scheduledAt: string;
	imageUrl: string;
	imageAlt: string;
	isUploading: boolean;
	excerpt: string;
	slug: string;
	tags: string[];
	metaTitle: string;
	metaDescription: string;
	title: string;
	articleId?: string;
	slugStatus?: "idle" | "checking" | "available" | "taken";
	onStatusChange: (value: string) => void;
	onCategoryChange: (value: string) => void;
	onScheduledAtChange: (value: string) => void;
	onImageUploadClick: () => void;
	onImageCropClick: () => void;
	onImageRemove: () => void;
	onImageAltChange: (value: string) => void;
	onExcerptChange: (value: string) => void;
	onSlugChange: (value: string) => void;
	onTagsChange: (value: string[]) => void;
	onMetaTitleChange: (value: string) => void;
	onMetaDescriptionChange: (value: string) => void;
	onTitleChange: (value: string) => void;
}

export function EditorMetadata({
	status,
	category,
	scheduledAt,
	imageUrl,
	imageAlt,
	isUploading,
	excerpt,
	slug,
	tags,
	metaTitle,
	metaDescription,
	title,
	articleId,
	slugStatus,
	onStatusChange,
	onCategoryChange,
	onScheduledAtChange,
	onImageUploadClick,
	onImageCropClick,
	onImageRemove,
	onImageAltChange,
	onExcerptChange,
	onSlugChange,
	onTagsChange,
	onMetaTitleChange,
	onMetaDescriptionChange,
	onTitleChange,
}: EditorMetadataProps) {
	return (
		<ScrollArea className="h-full">
			<div className="flex justify-center p-3 md:p-5">
				<div className="w-full max-w-[900px] space-y-8">
					{/* Grid 2 colonnes desktop, 1 colonne mobile */}
					<div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
						{/* Colonne gauche */}
						<div className="space-y-8">
							{/* Titre */}
							<section className="space-y-3">
								<h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
									Titre
								</h3>
								<div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-4">
									<input
										className="w-full bg-transparent text-xl font-bold font-sans placeholder:text-muted-foreground/40 border-none outline-hidden focus:ring-0 p-0 leading-tight"
										placeholder="Titre de l'article"
										value={title}
										onChange={(e) => onTitleChange(e.target.value)}
									/>
								</div>
							</section>

							{/* Publication */}
							<section className="space-y-3">
								<h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
									Publication
								</h3>
								<div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-4">
									<PublicationSection
										status={status}
										category={category}
										scheduledAt={scheduledAt}
										onStatusChange={onStatusChange}
										onCategoryChange={onCategoryChange}
										onScheduledAtChange={onScheduledAtChange}
									/>
								</div>
							</section>

							{/* Tags */}
							<section className="space-y-3">
								<h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
									Tags
								</h3>
								<div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-4">
									<TagsSection tags={tags} onTagsChange={onTagsChange} />
								</div>
							</section>

							{/* Extrait */}
							<section className="space-y-3">
								<h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
									Extrait
								</h3>
								<div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-4">
									<ExcerptSection excerpt={excerpt} onExcerptChange={onExcerptChange} />
								</div>
							</section>
						</div>

						{/* Colonne droite */}
						<div className="space-y-8">
							{/* Image de couverture */}
							<section className="space-y-3">
								<h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
									Image de couverture
								</h3>
								<div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-4">
									<FeaturedImageSection
										imageUrl={imageUrl}
										imageAlt={imageAlt}
										isUploading={isUploading}
										onUploadClick={onImageUploadClick}
										onCropClick={onImageCropClick}
										onRemove={onImageRemove}
										onAltChange={onImageAltChange}
									/>
								</div>
							</section>

							{/* URL & SEO */}
							<section className="space-y-3">
								<h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
									URL & SEO
								</h3>
								<div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 p-4">
									<SeoSection
										slug={slug}
										metaTitle={metaTitle}
										metaDescription={metaDescription}
										title={title}
										articleId={articleId}
										slugStatus={slugStatus}
										onSlugChange={onSlugChange}
										onMetaTitleChange={onMetaTitleChange}
										onMetaDescriptionChange={onMetaDescriptionChange}
									/>
								</div>
							</section>
						</div>
					</div>
				</div>
			</div>
		</ScrollArea>
	);
}
