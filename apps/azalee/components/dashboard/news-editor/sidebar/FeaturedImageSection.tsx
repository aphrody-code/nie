"use client";

import { Crop, ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";
import { Button, Input } from "@rosegriffon/ui";
import { cn } from "@/lib/utils";

interface FeaturedImageSectionProps {
	imageUrl: string;
	imageAlt: string;
	isUploading: boolean;
	onUploadClick: () => void;
	onCropClick: () => void;
	onRemove: () => void;
	onAltChange: (value: string) => void;
	onFileDrop?: (file: File) => void;
}

export function FeaturedImageSection({
	imageUrl,
	imageAlt,
	isUploading,
	onUploadClick,
	onCropClick,
	onRemove,
	onAltChange,
	onFileDrop,
}: FeaturedImageSectionProps) {
	const [isDragging, setIsDragging] = useState(false);

	const handleDragOver = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(true);
	}, []);

	const handleDragLeave = useCallback((e: React.DragEvent) => {
		e.preventDefault();
		e.stopPropagation();
		setIsDragging(false);
	}, []);

	const handleDrop = useCallback(
		(e: React.DragEvent) => {
			e.preventDefault();
			e.stopPropagation();
			setIsDragging(false);

			const file = e.dataTransfer.files?.[0];
			if (file?.type.startsWith("image/")) {
				onFileDrop?.(file);
			}
		},
		[onFileDrop]
	);

	if (isUploading) {
		return (
			<div className="flex flex-col items-center justify-center py-8 gap-3" role="status">
				<div className="relative">
					<Loader2 className="animate-spin size-8 text-primary" aria-hidden="true" />
					<div className="absolute inset-0 size-8 rounded-full border-2 border-primary/20" />
				</div>
				<div className="text-center">
					<p className="text-xs font-medium text-on-surface">Optimisation en cours...</p>
					<p className="text-[10px] text-on-surface-variant/50 mt-0.5">
						3 variantes (hero, carte, miniature)
					</p>
				</div>
			</div>
		);
	}

	if (imageUrl) {
		return (
			<div className="space-y-3">
				{/* Preview avec overlay d'actions */}
				<div className="relative aspect-[21/9] w-full overflow-hidden rounded-xl bg-surface-container group">
					<Image
						src={imageUrl}
						alt={imageAlt || "Image de couverture"}
						fill
						className="object-cover transition-transform duration-300 group-hover:scale-105"
						sizes="400px"
					/>
					{/* Overlay actions on hover */}
					<div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center gap-2 opacity-0 group-hover:opacity-100">
						<Button
							variant="outline"
							size="sm"
							className="rounded-full h-8 px-3 text-xs bg-white/90 text-black border-none hover:bg-white"
							onClick={onUploadClick}
						>
							<Upload className="size-3 mr-1.5" />
							Remplacer
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="rounded-full h-8 px-3 text-xs bg-white/90 text-black border-none hover:bg-white"
							onClick={onCropClick}
						>
							<Crop className="size-3 mr-1.5" />
							Recadrer
						</Button>
						<Button
							variant="outline"
							size="sm"
							className="rounded-full size-8 p-0 bg-red-500/90 text-white border-none hover:bg-red-600"
							onClick={onRemove}
							aria-label="Supprimer l'image"
						>
							<Trash2 className="size-3" />
						</Button>
					</div>
				</div>

				{/* Alt text */}
				<Input
					value={imageAlt}
					onChange={(e) => onAltChange(e.target.value)}
					className="bg-surface-container-high border-none rounded-xl text-xs h-8 font-sans"
					placeholder="Texte alternatif (accessibilité, SEO)"
					aria-label="Texte alternatif de l'image"
				/>

				{/* Action buttons (mobile fallback — toujours visibles) */}
				<div className="flex gap-2 sm:hidden">
					<Button
						variant="outline"
						size="sm"
						className="flex-1 rounded-lg h-8 text-xs gap-1.5"
						onClick={onUploadClick}
					>
						<Upload className="size-3" />
						Remplacer
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="rounded-lg h-8 text-xs gap-1.5 px-3"
						onClick={onCropClick}
						aria-label="Recadrer l'image"
					>
						<Crop className="size-3" />
					</Button>
					<Button
						variant="outline"
						size="sm"
						className="rounded-lg h-8 text-xs gap-1.5 px-3 text-destructive hover:text-destructive"
						onClick={onRemove}
						aria-label="Supprimer l'image"
					>
						<Trash2 className="size-3" />
					</Button>
				</div>
			</div>
		);
	}

	// Zone d'upload avec drag-and-drop
	return (
		<button
			onClick={onUploadClick}
			onDragOver={handleDragOver}
			onDragLeave={handleDragLeave}
			onDrop={handleDrop}
			aria-label="Importer une image de couverture"
			className={cn(
				"w-full aspect-video rounded-xl border-2 border-dashed transition-all duration-200",
				"flex flex-col items-center justify-center gap-2",
				isDragging
					? "border-primary bg-primary/10 text-primary scale-[1.02]"
					: "border-outline-variant/20 hover:border-primary/40 hover:bg-primary/5 text-on-surface-variant/40 hover:text-primary/60"
			)}
		>
			<ImagePlus
				className={cn("size-8 transition-transform", isDragging && "scale-110")}
				aria-hidden="true"
			/>
			<span className="text-xs font-medium">
				{isDragging ? "Déposer l'image ici" : "Cliquer ou glisser une image"}
			</span>
			<span className="text-[10px] text-on-surface-variant/30">
				JPEG, PNG, WebP, AVIF ou GIF — max 10 Mo
			</span>
		</button>
	);
}
