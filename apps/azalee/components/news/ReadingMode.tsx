"use client";

import { BookOpen, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const LS_KEY = "azalee:reading-mode";

interface ReadingModeProps {
	children: React.ReactNode;
}

export function ReadingMode({ children }: ReadingModeProps) {
	const [isOpen, setIsOpen] = useState(false);
	const [mounted, setMounted] = useState(false);
	const [visible, setVisible] = useState(false);

	// Initialiser depuis localStorage
	useEffect(() => {
		setMounted(true);
		const stored = localStorage.getItem(LS_KEY);
		if (stored === "true") {
			setIsOpen(true);
			setVisible(true);
		}
	}, []);

	// Gérer la transition fade-in/out
	useEffect(() => {
		if (isOpen) {
			// Petit délai pour déclencher la transition CSS après le montage du portal
			const raf = requestAnimationFrame(() => setVisible(true));
			return () => cancelAnimationFrame(raf);
		}
		setVisible(false);
	}, [isOpen]);

	const open = () => {
		setIsOpen(true);
		localStorage.setItem(LS_KEY, "true");
	};

	const close = () => {
		setVisible(false);
		localStorage.setItem(LS_KEY, "false");
		// Attendre la fin de la transition avant de démonter
		setTimeout(() => setIsOpen(false), 200);
	};

	// Fermeture au clavier (Escape)
	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				close();
			}
		};

		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [isOpen]);

	// Bloquer le scroll du body quand l'overlay est ouvert
	useEffect(() => {
		if (isOpen) {
			document.body.style.overflow = "hidden";
		} else {
			document.body.style.overflow = "";
		}
		return () => {
			document.body.style.overflow = "";
		};
	}, [isOpen]);

	return (
		<>
			{/* Bouton déclencheur */}
			<button
				onClick={open}
				title="Mode lecture"
				aria-label="Activer le mode lecture"
				className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
			>
				<BookOpen className="size-4" />
				<span className="hidden sm:inline">Mode lecture</span>
			</button>

			{/* Portal overlay */}
			{mounted &&
				isOpen &&
				createPortal(
					<div
						role="dialog"
						aria-modal="true"
						aria-label="Mode lecture"
						className={cn(
							"fixed inset-0 z-50 bg-background overflow-y-auto transition-opacity duration-200",
							visible ? "opacity-100" : "opacity-0"
						)}
					>
						{/* Barre d'outils */}
						<div className="sticky top-0 z-10 flex items-center justify-between px-4 py-3 bg-background/80 backdrop-blur border-b border-outline-variant/20">
							<div className="flex items-center gap-2 text-on-surface-variant text-sm">
								<BookOpen className="size-4" />
								<span className="font-medium">Mode lecture</span>
							</div>
							<button
								onClick={close}
								aria-label="Fermer le mode lecture"
								className="flex items-center justify-center size-9 rounded-full text-on-surface-variant hover:bg-surface-container-high transition-colors"
							>
								<X className="size-4" />
							</button>
						</div>

						{/* Contenu de l'article */}
						<div className="mx-auto max-w-2xl px-6 py-10 text-on-surface leading-relaxed">
							<div
								className="[font-size:var(--article-font-size,1rem)] [line-height:1.8]
                  prose-headings:font-bold prose-headings:text-on-surface
                  prose-p:text-on-surface-variant"
							>
								{children}
							</div>
						</div>
					</div>,
					document.body
				)}
		</>
	);
}
