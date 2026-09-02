"use client";

import { ChevronLeft, ChevronRight, Download, Loader2, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

/** Item minimal nécessaire au lightbox (sous-ensemble sérialisable de `GalleryItem`). */
export interface GalleryLightboxItem {
	id: string;
	title: string;
	/** Variante WebP grande (w=1600) affichée en plein écran (~65–300 Ko). */
	full: string | null;
	/** PNG plein cadre d'origine — utilisé pour le téléchargement haute résolution. */
	original: string | null;
	categoryLabel?: string;
	categoryIcon?: string;
}

interface GalleryLightboxProps {
	items: GalleryLightboxItem[];
	/** Index de l'item ouvert, ou `null` si le lightbox est fermé. */
	index: number | null;
	onClose: () => void;
	onNavigate: (nextIndex: number) => void;
}

/** Nom de fichier de téléchargement dérivé du titre, sinon du basename de l'URL. */
function downloadName(item: GalleryLightboxItem): string {
	const fromUrl = (item.original ?? item.full)?.split("/").pop()?.split("?")[0];
	const base = item.title?.trim() || fromUrl?.replace(/\.[a-z0-9]+$/i, "") || item.id;
	const safe = base.replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "illustration";
	return safe.toLowerCase().endsWith(".png") ? safe : `${safe}.png`;
}

/**
 * Lightbox plein écran pour la galerie : image complète (`object-contain`), bouton
 * de téléchargement (fetch blob → `a[download]`), navigation précédent/suivant
 * (flèches clavier ←/→ + boutons), fermeture (Échap, clic backdrop, bouton ✕).
 * Accessible : `role="dialog"`/`aria-modal`, focus trap léger, scroll du body bloqué.
 */
export function GalleryLightbox({ items, index, onClose, onNavigate }: GalleryLightboxProps) {
	const [mounted, setMounted] = useState(false);
	const [downloading, setDownloading] = useState(false);
	const closeRef = useRef<HTMLButtonElement>(null);
	const dialogRef = useRef<HTMLDivElement>(null);

	const isOpen = index !== null;
	const item = isOpen ? items[index] : undefined;
	const hasPrev = isOpen && index > 0;
	const hasNext = isOpen && index < items.length - 1;

	useEffect(() => {
		setMounted(true);
	}, []);

	// Navigation clavier + fermeture + focus trap léger (Tab cyclé dans la modale).
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
			} else if (e.key === "ArrowLeft" && index > 0) {
				onNavigate(index - 1);
			} else if (e.key === "ArrowRight" && index < items.length - 1) {
				onNavigate(index + 1);
			} else if (e.key === "Tab") {
				const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(
					'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
				);
				if (!focusables || focusables.length === 0) {
					return;
				}
				const first = focusables[0];
				const last = focusables[focusables.length - 1];
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen, index, items.length, onClose, onNavigate]);

	// Bloquer le scroll du body + donner le focus au bouton de fermeture à l'ouverture.
	useEffect(() => {
		if (!isOpen) {
			return;
		}
		document.body.style.overflow = "hidden";
		closeRef.current?.focus();
		return () => {
			document.body.style.overflow = "";
		};
	}, [isOpen]);

	if (!mounted || !isOpen || !item) {
		return null;
	}

	const handleDownload = async () => {
		// Téléchargement = PNG plein cadre d'origine (haute résolution). Repli sur la
		// grande variante WebP si l'original n'est pas disponible.
		const downloadUrl = item.original ?? item.full;
		if (!downloadUrl || downloading) {
			return;
		}
		setDownloading(true);
		try {
			const res = await fetch(downloadUrl, { mode: "cors" });
			if (!res.ok) {
				throw new Error(`HTTP ${res.status}`);
			}
			const blob = await res.blob();
			const objectUrl = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = objectUrl;
			a.download = downloadName(item);
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(objectUrl);
		} catch {
			// Fallback : ouvrir l'image dans un nouvel onglet si le fetch blob échoue.
			window.open(downloadUrl, "_blank", "noopener");
		} finally {
			setDownloading(false);
		}
	};

	return createPortal(
		<div
			ref={dialogRef}
			role="dialog"
			aria-modal="true"
			aria-label={`Illustration : ${item.title}`}
			className="fixed inset-0 z-[60] flex flex-col bg-surface/95 backdrop-blur-md"
		>
			{/* Barre d'outils : titre + catégorie à gauche, actions à droite. */}
			<div className="flex items-center justify-between gap-3 border-b border-outline-variant/30 px-4 py-3">
				<div className="flex min-w-0 items-center gap-2">
					{item.categoryLabel && (
						<span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">
							<Icon name={item.categoryIcon || "image"} size={12} />
							{item.categoryLabel}
						</span>
					)}
					<h2 className="truncate text-sm font-bold text-on-surface" title={item.title}>
						{item.title}
					</h2>
				</div>
				<div className="flex shrink-0 items-center gap-2">
					<button
						type="button"
						onClick={handleDownload}
						disabled={downloading || (!item.original && !item.full)}
						aria-label="Télécharger l'illustration"
						className={cn(
							"inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors min-h-11 sm:min-h-0",
							"bg-primary text-on-primary hover:bg-primary/90 disabled:opacity-50"
						)}
					>
						{downloading ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<Download className="size-4" />
						)}
						<span className="hidden sm:inline">Télécharger</span>
					</button>
					<button
						ref={closeRef}
						type="button"
						onClick={onClose}
						aria-label="Fermer"
						className="flex size-11 sm:size-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high"
					>
						<X className="size-5" />
					</button>
				</div>
			</div>

			{/* Zone image : clic sur le backdrop ferme, clic sur l'image ne ferme pas. */}
			<button
				type="button"
				aria-label="Fermer"
				onClick={onClose}
				className="relative flex flex-1 cursor-zoom-out items-center justify-center overflow-hidden p-4 sm:p-8"
			>
				{item.full ? (
					/* biome-ignore lint/a11y/noStaticElementInteractions: stop propagation pour ne pas fermer au clic sur l'image */
					<div
						className="relative flex size-full items-center justify-center"
						onClick={(e) => e.stopPropagation()}
					>
						<Image
							key={item.id}
							src={item.full}
							alt={item.title}
							fill
							sizes="100vw"
							className="object-contain"
							unoptimized
							priority
						/>
					</div>
				) : (
					<div className="flex flex-col items-center gap-2 text-on-surface-variant/50">
						<Icon name={item.categoryIcon || "image"} size={64} />
						<span className="text-sm">Image indisponible</span>
					</div>
				)}

				{/* Flèche précédent. */}
				{hasPrev && (
					/* biome-ignore lint/a11y/useSemanticElements: élément span cliquable superposé à l'image */
					<span
						role="button"
						tabIndex={0}
						aria-label="Illustration précédente"
						onClick={(e) => {
							e.stopPropagation();
							onNavigate(index - 1);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation();
								onNavigate(index - 1);
							}
						}}
						className="absolute left-2 top-1/2 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-surface-container/80 text-on-surface backdrop-blur-sm transition-colors hover:bg-surface-container-high sm:left-4"
					>
						<ChevronLeft className="size-6" />
					</span>
				)}
				{/* Flèche suivant. */}
				{hasNext && (
					/* biome-ignore lint/a11y/useSemanticElements: élément span cliquable superposé à l'image */
					<span
						role="button"
						tabIndex={0}
						aria-label="Illustration suivante"
						onClick={(e) => {
							e.stopPropagation();
							onNavigate(index + 1);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.stopPropagation();
								onNavigate(index + 1);
							}
						}}
						className="absolute right-2 top-1/2 flex size-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full bg-surface-container/80 text-on-surface backdrop-blur-sm transition-colors hover:bg-surface-container-high sm:right-4"
					>
						<ChevronRight className="size-6" />
					</span>
				)}
			</button>

			{/* Compteur de position. */}
			<div className="border-t border-outline-variant/30 px-4 py-2 text-center text-xs font-medium text-on-surface-variant">
				{index + 1} / {items.length}
			</div>
		</div>,
		document.body
	);
}
