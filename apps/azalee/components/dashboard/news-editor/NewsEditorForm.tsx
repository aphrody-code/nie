"use client";

import type { SerializedEditorState } from "lexical";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Tabs, TabsContent } from "@rosegriffon/ui";
import { EMPTY_CONTENT } from "./constants";
import { EditorContent } from "./EditorContent";
import { EditorHeader } from "./EditorHeader";
import { EditorMetadata } from "./EditorMetadata";
import { EditorPreview } from "./EditorPreview";
import { ImageCropDialog } from "./ImageCropDialog";
import type { CropData, NewsEditorFormProps } from "./types";
import {
	countWords,
	datetimeLocalToIso,
	estimateReadTime,
	generateSlug,
	isoToDatetimeLocal,
	parseInitialContent,
} from "./utils";

export function NewsEditorForm({ initialData }: NewsEditorFormProps) {
	const router = useRouter();

	const [loading, setLoading] = useState(false);
	const lastSavedRef = useRef<string | null>(null);
	const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);

	// Content State
	const [content, setContent] = useState<SerializedEditorState>(
		parseInitialContent(initialData?.content, EMPTY_CONTENT)
	);
	const [title, setTitle] = useState(initialData?.title || "");

	// Metadata State
	const [slug, setSlug] = useState(initialData?.slug || "");
	const [category, setCategory] = useState(initialData?.category || "announcement");
	const [status, setStatus] = useState(initialData?.status || "draft");
	const [excerpt, setExcerpt] = useState(initialData?.excerpt || "");
	const [imageUrl, setImageUrl] = useState(initialData?.featured_image_url || "");
	const [imageAlt, setImageAlt] = useState(initialData?.featured_image_alt || "");
	const [tags, setTags] = useState<string[]>(initialData?.tags || []);
	const [metaTitle, setMetaTitle] = useState(initialData?.meta_title || "");
	const [metaDescription, setMetaDescription] = useState(initialData?.meta_description || "");
	const [scheduledAt, setScheduledAt] = useState(() => {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const sa = (initialData as any)?.scheduled_at;
		// `<input type="datetime-local">` veut du LOCAL — on rebase l'ISO UTC.
		return isoToDatetimeLocal(sa);
	});

	// UI State
	const [isUploading, setIsUploading] = useState(false);
	const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
	const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
	const [showPreview, setShowPreview] = useState(false);
	const [showCropDialog, setShowCropDialog] = useState(false);
	const [activeTab, setActiveTab] = useState("content");

	// Slug validation state
	const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
	const slugCheckTimerRef = useRef<NodeJS.Timeout | null>(null);

	// Discord share state
	const [shareOnDiscord, setShareOnDiscord] = useState(!initialData?.id);

	// Word count
	const wordCount = countWords(content);
	const readTime = estimateReadTime(wordCount);

	// Draft key for localStorage auto-save
	const draftKey = initialData?.id ? `draft_news_${initialData.id}` : "draft_news_new";

	// Slug validation with debounce
	const checkSlugAvailability = async (slugToCheck: string) => {
		if (!slugToCheck) {
			setSlugStatus("idle");
			return;
		}
		setSlugStatus("checking");
		try {
			const { checkSlugAvailability: checkSlug } = await import("@/app/actions/articles");
			const result = await checkSlug(slugToCheck, initialData?.id);
			setSlugStatus(result.available ? "available" : "taken");
		} catch {
			setSlugStatus("idle");
		}
	};

	// Debounced slug check
	const handleSlugChange = (newSlug: string) => {
		setSlug(newSlug);
		if (slugCheckTimerRef.current) {
			clearTimeout(slugCheckTimerRef.current);
		}
		if (newSlug) {
			slugCheckTimerRef.current = setTimeout(() => checkSlugAvailability(newSlug), 500);
		} else {
			setSlugStatus("idle");
		}
	};

	// Auto-save to localStorage
	const autoSaveToLocal = useCallback(() => {
		const draftData = JSON.stringify({
			category,
			content,
			excerpt,
			imageAlt,
			imageUrl,
			metaDescription,
			metaTitle,
			scheduledAt,
			slug,
			status,
			tags,
			title,
		});
		if (draftData !== lastSavedRef.current) {
			localStorage.setItem(draftKey, draftData);
			lastSavedRef.current = draftData;
			setLastAutoSave(new Date());
			setHasUnsavedChanges(false);
		}
	}, [
		title,
		content,
		slug,
		category,
		status,
		excerpt,
		imageUrl,
		imageAlt,
		tags,
		metaTitle,
		metaDescription,
		scheduledAt,
		draftKey,
	]);

	// Recover draft on mount
	useEffect(() => {
		if (initialData?.id) {
			return;
		}
		const saved = localStorage.getItem(draftKey);
		if (saved) {
			try {
				const data = JSON.parse(saved);
				if (data.title && data.title !== title) {
					const recover = window.confirm(
						"Un brouillon non sauvegardé a été trouvé. Voulez-vous le récupérer ?"
					);
					if (recover) {
						setTitle(data.title || "");
						setContent(data.content || EMPTY_CONTENT);
						setSlug(data.slug || "");
						setCategory(data.category || "announcement");
						setStatus(data.status || "draft");
						setExcerpt(data.excerpt || "");
						setImageUrl(data.imageUrl || "");
						setImageAlt(data.imageAlt || "");
						setTags(data.tags || []);
						setMetaTitle(data.metaTitle || "");
						setMetaDescription(data.metaDescription || "");
						setScheduledAt(data.scheduledAt || "");
						toast.success("Brouillon récupéré");
					}
				}
			} catch {
				// Invalid draft data
			}
		}
	}, [draftKey, title, initialData?.id]);

	// Mark unsaved any time a tracked field changes — DOIT dépendre des champs
	// (sinon `setHasUnsavedChanges(true)` ne s'exécute qu'au mount, et l'auto-save
	// Serveur s'arrête après le 1ᵉʳ snapshot localStorage qui repasse le flag à false).
	// On skippe le tout premier rendu via `mountedRef` pour ne pas marquer dirty
	// Sans modification utilisateur.
	const mountedRef = useRef(false);
	useEffect(() => {
		if (!mountedRef.current) {
			mountedRef.current = true;
			return;
		}
		setHasUnsavedChanges(true);
	}, [
		title,
		content,
		slug,
		category,
		status,
		excerpt,
		imageUrl,
		imageAlt,
		tags,
		metaTitle,
		metaDescription,
		scheduledAt,
	]);

	// Auto-save every 30 seconds
	useEffect(() => {
		autoSaveTimerRef.current = setInterval(autoSaveToLocal, 30_000);
		return () => {
			if (autoSaveTimerRef.current) {
				clearInterval(autoSaveTimerRef.current);
			}
		};
	}, [autoSaveToLocal]);

	// Server save timestamp
	const [lastServerSave, setLastServerSave] = useState<Date | null>(null);
	const [isSaving, setIsSaving] = useState(false);
	const autoSaveServerTimerRef = useRef<NodeJS.Timeout | null>(null);

	/**
	 * Save handler — supports:
	 *  - overrideStatus: force a specific status
	 *  - silent: save without redirect, toast discret (pour auto-save serveur)
	 *  - redirect: if false, stay in editor (pour "Sauvegarder et continuer")
	 */
	const handleSave = useCallback(
		async (overrideStatus?: string, options?: { silent?: boolean; redirect?: boolean }) => {
			const { silent = false, redirect: shouldRedirect = true } = options || {};

			if (!title) {
				if (!silent) {
					toast.error("Le titre est obligatoire");
				}
				return;
			}
			if (slugStatus === "taken") {
				if (!silent) {
					toast.error("Ce slug est déjà utilisé, veuillez en choisir un autre");
					setActiveTab("metadata");
				}
				return;
			}
			const finalStatusVal = overrideStatus || status;
			if (finalStatusVal === "scheduled" && !scheduledAt) {
				if (!silent) {
					toast.error("Veuillez choisir une date de publication programmée");
					setActiveTab("metadata");
				}
				return;
			}
			if (loading || isSaving) {
				return;
			}

			if (silent) {
				setIsSaving(true);
			} else {
				setLoading(true);
			}

			const finalStatus = overrideStatus || status;
			const now = new Date().toISOString();
			const finalSlug = slug || generateSlug(title);

			const data: Record<string, unknown> = {
				category,
				content,
				excerpt,
				featured_image_alt: imageAlt || null,
				featured_image_url: imageUrl,
				meta_description: metaDescription || null,
				meta_title: metaTitle || null,
				slug: finalSlug,
				status: finalStatus,
				tags: tags.length > 0 ? tags : null,
				title,
				updated_at: now,
			};

			if (finalStatus === "published") {
				if (!initialData?.published_at) {
					data.published_at = now;
				}
				data.scheduled_at = null;
			} else if (finalStatus === "scheduled") {
				// `scheduledAt` vient du <input type="datetime-local"> en heure locale.
				data.scheduled_at = datetimeLocalToIso(scheduledAt);
				data.published_at = null;
			} else {
				data.scheduled_at = null;
			}

			try {
				// Snapshot avant update : on conserve l'historique pour TOUTE update
				// D'article existant (sauf en mode silent — auto-save trop fréquent).
				// L'ancienne logique excluait les drafts jamais publiés, perdant leur
				// Historique en cas de refonte avant 1ʳᵉ publication.
				if (initialData?.id && !silent) {
					try {
						const { createArticleVersion } = await import("@/app/actions/articles");
						await createArticleVersion(initialData.id);
					} catch {
						// Version snapshot failure is not critical
					}
				}

				// Sauvegarde via server action (bypass RLS, revalidation incluse)
				const { saveArticle } = await import("@/app/actions/articles");
				const result = await saveArticle(initialData?.id || null, data);
				if (result.error) {
					throw new Error(result.error);
				}

				localStorage.removeItem(draftKey);
				setHasUnsavedChanges(false);
				setLastServerSave(new Date());

				if (silent) {
					// Auto-save silencieuse : pas de toast, pas de redirect
					setIsSaving(false);
					return;
				}

				// Discord auto-share on publish
				if (finalStatus === "published" && shareOnDiscord) {
					try {
						const { shareToDiscord } = await import("@/app/actions/articles");
						await shareToDiscord({
							excerpt,
							featured_image_url: imageUrl,
							slug: finalSlug,
							title,
						});
						toast.success("Article publié et partagé sur Discord !");
					} catch {
						toast.success("Article publié ! (Partage Discord échoué)");
					}
				} else {
					const msg =
						finalStatus === "published"
							? "Article publié !"
							: finalStatus === "scheduled"
								? "Publication programmée !"
								: shouldRedirect
									? "Brouillon sauvegardé"
									: "Sauvegardé";
					toast.success(msg);
				}

				// Send push notifications on first publish
				if (finalStatus === "published" && !initialData?.published_at) {
					try {
						const { sendPushToAll } = await import("@/app/actions/notifications");
						await sendPushToAll(title, excerpt || "Nouvel article sur Azalée", {
							url: `/news/${finalSlug}`,
						});
					} catch {
						// Push notification failure is not critical
					}
				}

				if (shouldRedirect) {
					router.push("/dashboard/news");
					router.refresh();
				} else {
					router.refresh();
				}
			} catch (error: unknown) {
				console.error("Error saving news:", error);
				if (!silent) {
					toast.error(`Erreur: ${error instanceof Error ? error.message : String(error)}`);
				}
			} finally {
				setLoading(false);
				setIsSaving(false);
			}
		},
		[
			title,
			slugStatus,
			loading,
			isSaving,
			status,
			slug,
			content,
			category,
			excerpt,
			imageUrl,
			imageAlt,
			tags,
			metaTitle,
			metaDescription,
			scheduledAt,
			initialData,
			draftKey,
			router,
			shareOnDiscord,
		]
	);

	// Auto-save serveur toutes les 60s pour les articles existants (brouillons)
	useEffect(() => {
		if (!initialData?.id || status === "published") {
			return;
		}

		autoSaveServerTimerRef.current = setInterval(() => {
			if (hasUnsavedChanges && title) {
				handleSave(undefined, { redirect: false, silent: true });
			}
		}, 60_000);

		return () => {
			if (autoSaveServerTimerRef.current) {
				clearInterval(autoSaveServerTimerRef.current);
			}
		};
	}, [initialData?.id, status, hasUnsavedChanges, title, handleSave]);

	// Keyboard shortcuts: Ctrl+S = save (stay in editor), Ctrl+Shift+P = publish
	useEffect(() => {
		const handler = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "s") {
				e.preventDefault();
				// Ctrl+S : sauvegarde rapide sans quitter l'éditeur
				handleSave(undefined, { redirect: false });
			}
			if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "p") {
				e.preventDefault();
				handleSave("published");
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [handleSave]);

	// Warn before leaving with unsaved changes
	useEffect(() => {
		const handler = (e: BeforeUnloadEvent) => {
			if (hasUnsavedChanges) {
				e.preventDefault();
			}
		};
		window.addEventListener("beforeunload", handler);
		return () => window.removeEventListener("beforeunload", handler);
	}, [hasUnsavedChanges]);

	// Image upload
	const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0];
		if (!file) {
			return;
		}

		setIsUploading(true);
		const formData = new FormData();
		formData.append("file", file);

		try {
			const { uploadImage } = await import("@/app/actions/image-upload");
			const result = await uploadImage(formData);
			if ("url" in result) {
				setImageUrl(result.url);
				toast.success("Image importée");
			} else {
				toast.error(result.error);
			}
		} catch {
			toast.error("Échec de l'upload");
		} finally {
			setIsUploading(false);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	};

	// Image crop
	const handleCropApply = async (cropData: CropData, file: File) => {
		setShowCropDialog(false);
		setIsUploading(true);

		const formData = new FormData();
		formData.append("file", file);
		formData.append("cropX", String(cropData.x));
		formData.append("cropY", String(cropData.y));
		formData.append("cropWidth", String(cropData.width));
		formData.append("cropHeight", String(cropData.height));

		try {
			const { uploadImageWithCrop } = await import("@/app/actions/image-upload");
			const result = await uploadImageWithCrop(formData);
			if ("url" in result) {
				setImageUrl(result.url);
				toast.success("Image recadrée et importée");
			} else {
				toast.error(result.error);
			}
		} catch {
			toast.error("Échec du recadrage");
		} finally {
			setIsUploading(false);
		}
	};

	const triggerFileInput = () => {
		fileInputRef.current?.click();
	};

	const handleImageCropClick = () => {
		if (imageUrl) {
			setShowCropDialog(true);
		}
	};

	// Shared metadata props
	const metadataProps = {
		articleId: initialData?.id,
		category,
		excerpt,
		imageAlt,
		imageUrl,
		isUploading,
		metaDescription,
		metaTitle,
		onCategoryChange: setCategory,
		onExcerptChange: setExcerpt,
		onFileDrop: async (file: File) => {
			setIsUploading(true);
			const formData = new FormData();
			formData.append("file", file);
			try {
				const { uploadImage } = await import("@/app/actions/image-upload");
				const result = await uploadImage(formData);
				if ("url" in result) {
					setImageUrl(result.url);
					toast.success("Image importée");
				} else {
					toast.error(result.error);
				}
			} catch {
				toast.error("Échec de l'upload");
			} finally {
				setIsUploading(false);
			}
		},
		onImageAltChange: setImageAlt,
		onImageCropClick: handleImageCropClick,
		onImageRemove: () => {
			setImageUrl("");
			setImageAlt("");
		},
		onImageUploadClick: triggerFileInput,
		onMetaDescriptionChange: setMetaDescription,
		onMetaTitleChange: setMetaTitle,
		onScheduledAtChange: setScheduledAt,
		onSlugChange: handleSlugChange,
		onStatusChange: setStatus,
		onTagsChange: setTags,
		onTitleChange: setTitle,
		scheduledAt,
		slug,
		slugStatus,
		status,
		tags,
		title,
	};

	return (
		<Tabs
			value={activeTab}
			onValueChange={setActiveTab}
			className="flex flex-col bg-background font-sans h-screen overflow-hidden"
		>
			{/* Hidden file input */}
			<input
				ref={fileInputRef}
				type="file"
				className="hidden"
				accept="image/*"
				onChange={handleImageUpload}
				aria-label="Sélectionner une image de couverture"
				tabIndex={-1}
			/>

			{/* Header */}
			<EditorHeader
				status={status}
				wordCount={wordCount}
				readTime={readTime}
				hasUnsavedChanges={hasUnsavedChanges}
				lastAutoSave={lastAutoSave}
				lastServerSave={lastServerSave}
				isSaving={isSaving}
				showPreview={showPreview}
				loading={loading}
				title={title}
				slug={slug}
				initialId={initialData?.id}
				initialStatus={initialData?.status ?? undefined}
				activeTab={activeTab}
				shareOnDiscord={shareOnDiscord}
				onTogglePreview={() => setShowPreview((v) => !v)}
				onSaveDraft={() => handleSave("draft")}
				onSaveAndContinue={() => handleSave(undefined, { redirect: false })}
				onRevertToDraft={() => {
					const confirmed = window.confirm(
						"Repasser cet article en brouillon ?\n\nIl ne sera plus visible publiquement."
					);
					if (confirmed) {
						handleSave("draft");
					}
				}}
				onPublish={() => {
					// Confirmation uniquement pour la première publication
					if (!initialData?.published_at) {
						const confirmed = window.confirm(
							"Publier cet article ?\n\nIl sera visible par tous les utilisateurs et une notification sera envoyée."
						);
						if (!confirmed) {
							return;
						}
					}
					handleSave("published");
				}}
				onShareOnDiscordChange={setShareOnDiscord}
			/>

			{/* Tabs content */}
			<TabsContent value="content" className="flex-1 min-h-0 mt-0">
				<EditorContent content={content} onContentChange={setContent} />
			</TabsContent>

			<TabsContent value="metadata" className="flex-1 min-h-0 mt-0">
				<EditorMetadata {...metadataProps} />
			</TabsContent>

			{/* Image Crop Dialog */}
			{showCropDialog && imageUrl && (
				<ImageCropDialog
					open={showCropDialog}
					imageUrl={imageUrl}
					onClose={() => setShowCropDialog(false)}
					onApply={handleCropApply}
				/>
			)}

			{/* Preview overlay */}
			{showPreview && (
				<EditorPreview
					title={title}
					excerpt={excerpt}
					imageUrl={imageUrl}
					category={category}
					content={content}
					onClose={() => setShowPreview(false)}
				/>
			)}
		</Tabs>
	);
}
