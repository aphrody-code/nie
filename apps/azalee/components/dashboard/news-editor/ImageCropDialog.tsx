"use client";

import type * as React from "react";
import { useCallback, useRef, useState } from "react";
import RawReactCrop from "react-image-crop";
import type { Crop, PixelCrop } from "react-image-crop";

// React 19 / react-image-crop typings drift: cast to FC<any> (TS2607/TS2786).
const ReactCrop = RawReactCrop as unknown as React.FC<any>;
import {
	Button,
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@rosegriffon/ui";
import { cn } from "@/lib/utils";
import "react-image-crop/dist/ReactCrop.css";
import { CROP_RATIO_PRESETS } from "./constants";
import type { CropData } from "./types";

interface ImageCropDialogProps {
	open: boolean;
	imageUrl: string;
	onClose: () => void;
	onApply: (cropData: CropData, file: File) => void;
}

export function ImageCropDialog({ open, imageUrl, onClose, onApply }: ImageCropDialogProps) {
	const imgRef = useRef<HTMLImageElement | null>(null);
	const [crop, setCrop] = useState<Crop>();
	const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
	const [selectedRatioIndex, setSelectedRatioIndex] = useState(0);

	const onImageLoad = useCallback(
		(e: React.SyntheticEvent<HTMLImageElement>) => {
			imgRef.current = e.currentTarget;
			const { width, height } = e.currentTarget;
			const ratio = CROP_RATIO_PRESETS[selectedRatioIndex].value;

			if (ratio) {
				// Center a crop that fills as much as possible
				const cropHeight = ratio > width / height ? width / ratio : height;
				const cropWidth = ratio > width / height ? width : height * ratio;
				const x = (width - cropWidth) / 2;
				const y = (height - cropHeight) / 2;

				const percentCrop: Crop = {
					height: (cropHeight / height) * 100,
					unit: "%",
					width: (cropWidth / width) * 100,
					x: (x / width) * 100,
					y: (y / height) * 100,
				};
				setCrop(percentCrop);
			} else {
				setCrop({
					height: 90,
					unit: "%",
					width: 90,
					x: 5,
					y: 5,
				});
			}
		},
		[selectedRatioIndex]
	);

	const handleRatioChange = (index: number) => {
		setSelectedRatioIndex(index);
		const ratio = CROP_RATIO_PRESETS[index].value;
		const img = imgRef.current;
		if (!img) {
			return;
		}

		const { width, height } = img;
		if (ratio) {
			const cropHeight = ratio > width / height ? width / ratio : height;
			const cropWidth = ratio > width / height ? width : height * ratio;
			const x = (width - cropWidth) / 2;
			const y = (height - cropHeight) / 2;

			setCrop({
				height: (cropHeight / height) * 100,
				unit: "%",
				width: (cropWidth / width) * 100,
				x: (x / width) * 100,
				y: (y / height) * 100,
			});
		} else {
			setCrop({
				height: 90,
				unit: "%",
				width: 90,
				x: 5,
				y: 5,
			});
		}
	};

	const handleApply = async () => {
		if (!completedCrop || !imgRef.current) {
			return;
		}

		const img = imgRef.current;
		const { naturalWidth } = img;
		const { naturalHeight } = img;
		const scaleX = naturalWidth / img.width;
		const scaleY = naturalHeight / img.height;

		// Convert pixel crop to percentage of natural image dimensions
		const cropData: CropData = {
			height: ((completedCrop.height * scaleY) / naturalHeight) * 100,
			width: ((completedCrop.width * scaleX) / naturalWidth) * 100,
			x: ((completedCrop.x * scaleX) / naturalWidth) * 100,
			y: ((completedCrop.y * scaleY) / naturalHeight) * 100,
		};

		// Fetch the image as a file to re-upload with crop
		try {
			const response = await fetch(imageUrl);
			const blob = await response.blob();
			const file = new File([blob], "cropped-image.webp", {
				type: blob.type,
			});
			onApply(cropData, file);
		} catch {
			// If fetching the image fails (CORS), we can't crop
			// The parent should handle this gracefully
			onClose();
		}
	};

	return (
		<Dialog open={open} onOpenChange={(v) => !v && onClose()}>
			<DialogContent className="max-w-2xl bg-surface-container border-none rounded-3xl">
				<DialogHeader>
					<DialogTitle className="text-lg font-bold">Recadrer l&apos;image</DialogTitle>
				</DialogHeader>

				{/* Ratio presets */}
				<div className="flex gap-2 justify-center">
					{CROP_RATIO_PRESETS.map((preset, i) => (
						<Button
							key={preset.label}
							variant="outline"
							size="sm"
							className={cn(
								"rounded-full h-8 px-4 text-xs font-medium",
								selectedRatioIndex === i
									? "bg-primary text-on-primary border-primary hover:bg-primary/90 hover:text-on-primary"
									: "bg-surface-container-high border-none"
							)}
							onClick={() => handleRatioChange(i)}
						>
							{preset.label}
						</Button>
					))}
				</div>

				{/* Crop area */}
				<div className="flex justify-center max-h-[60vh] overflow-hidden rounded-xl bg-muted">
					<ReactCrop
						crop={crop}
						onChange={(c: Crop) => setCrop(c)}
						onComplete={(c: PixelCrop) => setCompletedCrop(c)}
						aspect={CROP_RATIO_PRESETS[selectedRatioIndex].value}
						className="max-h-[60vh]"
					>
						{/* eslint-disable-next-line @next/next/no-img-element */}
						<img
							src={imageUrl}
							alt="Crop preview"
							onLoad={onImageLoad}
							className="max-h-[60vh] w-auto"
						/>
					</ReactCrop>
				</div>

				<DialogFooter className="gap-2">
					<Button
						variant="outline"
						onClick={onClose}
						className="rounded-full border-none bg-surface-container-high"
					>
						Annuler
					</Button>
					<Button
						onClick={handleApply}
						disabled={!completedCrop}
						className="rounded-full bg-primary text-on-primary"
					>
						Appliquer
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
