"use server";

import sharp from "sharp";
import { requireEditorOrFail } from "@/lib/auth-helpers";
import { createClient } from "@/lib/supabase/server";

// --- Configuration ---

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"]);
const STORAGE_BUCKET = "article";
const BASE_URL =
	process.env.NEXT_PUBLIC_STORAGE_URL || "https://azalee.rosegriffon.fr/storage/v1/object/public";

interface ImageVariant {
	suffix: string;
	width: number;
	quality: number;
}

/**
 * Variantes générées pour chaque image uploadée.
 * - full   : hero pleine largeur (max 2400px, qualité 85)
 * - card   : cartes du feed (max 800px, qualité 80)
 * - thumb  : miniatures sidebar/OG (max 400px, qualité 75)
 */
const VARIANTS: ImageVariant[] = [
	{ quality: 85, suffix: "", width: 2400 },
	{ quality: 80, suffix: "_card", width: 800 },
	{ quality: 75, suffix: "_thumb", width: 400 },
];

export interface UploadResult {
	url: string;
	cardUrl: string;
	thumbUrl: string;
	width: number;
	height: number;
}

// --- Helpers internes ---

async function verifyEditorRole(): Promise<{ error?: string }> {
	try {
		await requireEditorOrFail();
		return {};
	} catch (error) {
		return { error: (error as Error).message };
	}
}

function validateFile(file: File): string | null {
	if (!ALLOWED_TYPES.has(file.type)) {
		return `Type de fichier non supporté (${file.type}). Types acceptés : JPEG, PNG, WebP, AVIF, GIF.`;
	}
	if (file.size > MAX_FILE_SIZE) {
		const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
		return `Fichier trop volumineux (${sizeMB} Mo). Maximum : ${MAX_FILE_SIZE / (1024 * 1024)} Mo.`;
	}
	return null;
}

async function processAndUpload(
	inputBuffer: Buffer,
	filenameBase: string
): Promise<UploadResult | { error: string }> {
	const supabase = await createClient();
	const metadata = await sharp(inputBuffer).metadata();

	if (!metadata.width || !metadata.height) {
		return { error: "Impossible de lire les dimensions de l'image" };
	}

	// Générer toutes les variantes en parallèle
	const uploads = VARIANTS.map(async (variant) => {
		const filename = `${filenameBase}${variant.suffix}.webp`;

		const buffer = await sharp(inputBuffer)
			.resize({
				fit: "inside",
				width: variant.width,
				withoutEnlargement: true,
			})
			.webp({ effort: 4, quality: variant.quality })
			.toBuffer();

		const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(filename, buffer, {
			cacheControl: "public, max-age=31536000, immutable",
			contentType: "image/webp",
			upsert: false,
		});

		if (error) {
			console.error(`Storage upload error (${variant.suffix || "full"}):`, error);
			throw new Error(`Upload échoué pour la variante ${variant.suffix || "full"}`);
		}

		return `${BASE_URL}/${STORAGE_BUCKET}/${filename}`;
	});

	try {
		const [fullUrl, cardUrl, thumbUrl] = await Promise.all(uploads);

		// Dimensions de la variante principale (après resize)
		const resizedMeta = await sharp(inputBuffer)
			.resize({ fit: "inside", width: VARIANTS[0].width, withoutEnlargement: true })
			.metadata();

		return {
			cardUrl,
			height: resizedMeta.height || metadata.height,
			thumbUrl,
			url: fullUrl,
			width: resizedMeta.width || metadata.width,
		};
	} catch (error) {
		console.error("Image processing failed:", error);
		return { error: error instanceof Error ? error.message : "Échec du traitement de l'image" };
	}
}

// --- Actions publiques ---

/**
 * Upload une image, génère 3 variantes (full 2400px, card 800px, thumb 400px)
 * et retourne les URLs + dimensions.
 */
export async function uploadImage(formData: FormData): Promise<UploadResult | { error: string }> {
	try {
		const file = formData.get("file") as File;
		if (!file) {
			return { error: "Aucun fichier fourni" };
		}

		const validationError = validateFile(file);
		if (validationError) {
			return { error: validationError };
		}

		const authError = await verifyEditorRole();
		if (authError.error) {
			return { error: authError.error };
		}

		const buffer = Buffer.from(await file.arrayBuffer());
		const filenameBase = crypto.randomUUID();

		return await processAndUpload(buffer, filenameBase);
	} catch (error) {
		console.error("Image upload failed:", error);
		return { error: "Échec de l'upload de l'image" };
	}
}

/**
 * Upload une image avec recadrage côté serveur.
 * Les valeurs de crop sont en pourcentages (0-100) des dimensions originales.
 * Génère les mêmes 3 variantes que uploadImage.
 */
export async function uploadImageWithCrop(
	formData: FormData
): Promise<UploadResult | { error: string }> {
	try {
		const file = formData.get("file") as File;
		const cropX = Number.parseFloat(formData.get("cropX") as string);
		const cropY = Number.parseFloat(formData.get("cropY") as string);
		const cropWidth = Number.parseFloat(formData.get("cropWidth") as string);
		const cropHeight = Number.parseFloat(formData.get("cropHeight") as string);

		if (!file) {
			return { error: "Aucun fichier fourni" };
		}

		const validationError = validateFile(file);
		if (validationError) {
			return { error: validationError };
		}

		if ([cropX, cropY, cropWidth, cropHeight].some(Number.isNaN)) {
			return { error: "Données de recadrage invalides" };
		}

		const authError = await verifyEditorRole();
		if (authError.error) {
			return { error: authError.error };
		}

		const buffer = Buffer.from(await file.arrayBuffer());
		const metadata = await sharp(buffer).metadata();

		if (!metadata.width || !metadata.height) {
			return { error: "Impossible de lire les dimensions de l'image" };
		}

		// Convertir les pourcentages en pixels
		const left = Math.round((cropX / 100) * metadata.width);
		const top = Math.round((cropY / 100) * metadata.height);
		const width = Math.round((cropWidth / 100) * metadata.width);
		const height = Math.round((cropHeight / 100) * metadata.height);

		// Clamper aux limites valides
		const safeLeft = Math.max(0, Math.min(left, metadata.width - 1));
		const safeTop = Math.max(0, Math.min(top, metadata.height - 1));
		const safeWidth = Math.max(1, Math.min(width, metadata.width - safeLeft));
		const safeHeight = Math.max(1, Math.min(height, metadata.height - safeTop));

		// Extraire la zone de crop
		const croppedBuffer = await sharp(buffer)
			.extract({ height: safeHeight, left: safeLeft, top: safeTop, width: safeWidth })
			.toBuffer();

		const filenameBase = crypto.randomUUID();

		return await processAndUpload(croppedBuffer, filenameBase);
	} catch (error) {
		console.error("Image crop upload failed:", error);
		return { error: "Échec de l'upload de l'image recadrée" };
	}
}
