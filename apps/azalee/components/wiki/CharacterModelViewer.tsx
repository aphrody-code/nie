"use client";

import { Box, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
	Button,
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@rosegriffon/ui";

interface CharacterModelViewerProps {
	/** URL absolue du GLB complet (cdn.rosegriffon.fr/model-full/<code>.glb, nie-model-serve). */
	glbUrl: string;
	name?: string;
	/** Rend le viewer **directement** (sans dialog/clic) — pour l'explorateur, fiches perso/skill. */
	inline?: boolean;
}

import { loadModelViewer } from "../../lib/model-viewer-loader";

export default function CharacterModelViewer({ glbUrl, name, inline }: CharacterModelViewerProps) {
	const [open, setOpen] = useState(false);
	const [ready, setReady] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [errored, setErrored] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	// En mode inline, le viewer est toujours « ouvert » (rendu direct, sans dialog).
	const active = inline || open;

	// Charge le custom element à la 1re ouverture, puis injecte <model-viewer>.
	useEffect(() => {
		if (!active) {
			return;
		}
		// Reset de l'état d'erreur à chaque (ré)ouverture : sinon un échec antérieur
		// (GLB 404/réseau) laisserait l'overlay « indisponible » collé après réouverture.
		setErrored(false);
		let cancelled = false;
		loadModelViewer()
			.then(() => {
				if (!cancelled) {
					setReady(true);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setErrored(true);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [active]);

	// Monte l'élément impérativement (custom element non typé par React/JSX).
	useEffect(() => {
		if (!active || !ready || !containerRef.current) {
			return;
		}
		const host = containerRef.current;
		setErrored(false);
		setLoaded(false);
		let cancelled = false;
		host.innerHTML = "";
		const mv = document.createElement("model-viewer");
		mv.setAttribute("alt", `Modèle 3D de ${name ?? "personnage"}`);
		mv.setAttribute("camera-controls", "");
		mv.setAttribute("auto-rotate", "");
		mv.setAttribute("rotation-per-second", "30deg");
		mv.setAttribute("shadow-intensity", "1");
		mv.setAttribute("exposure", "1");
		mv.setAttribute("touch-action", "pan-y");
		mv.style.width = "100%";
		mv.style.height = "100%";
		mv.style.backgroundColor = "transparent";

		// Enregistre les écouteurs d'événements AVANT de définir la source (src),
		// pour éviter les conditions de concurrence si le modèle est déjà en cache.
		mv.addEventListener("load", () => { if (!cancelled) setLoaded(true); });
		mv.addEventListener("error", () => { if (!cancelled) setErrored(true); });

		mv.setAttribute("src", glbUrl);

		host.appendChild(mv);
		return () => {
			cancelled = true;
			host.innerHTML = "";
		};
	}, [active, ready, glbUrl, name]);

	// Bouton de téléchargement du GLB (assemblage complet texturé) — affiché dès que le
	// modèle est chargé sans erreur. Couvre tous les usages du viewer (perso, keshin, cut-in).
	const downloadBtn = loaded && !errored && (
		<a
			href={glbUrl}
			download={`${name ?? "modele"}.glb`}
			onClick={(e) => e.stopPropagation()}
			className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 rounded-full bg-surface/70 backdrop-blur px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface border border-outline-variant/30 transition-colors"
			title="Télécharger le modèle 3D (GLB)"
		>
			<Download className="size-3" /> GLB
		</a>
	);

	// Corps du viewer (boîte 3:4 + spinner/erreur/aide) — partagé inline et en dialog.
	const viewerBody = (
		<div className="aspect-[3/4] relative bg-surface-container-high rounded-xl overflow-hidden">
			<div ref={containerRef} className="absolute inset-0" />
			{!loaded && !errored && (
				<div className="absolute inset-0 flex items-center justify-center bg-surface/50">
					<div className="animate-spin rounded-full size-8 border-b-2 border-primary" />
				</div>
			)}
			{errored && (
				<div className="absolute inset-0 flex items-center justify-center p-6 text-center">
					<span className="text-sm text-on-surface-variant">Modèle 3D indisponible.</span>
				</div>
			)}
			{downloadBtn}
			{loaded && !errored && (
				<div className="absolute bottom-3 left-0 right-0 text-center pointer-events-none">
					<span className="text-xs text-on-surface-variant/60 bg-surface/40 px-2 py-1 rounded">
						Glissez pour tourner · molette pour zoomer
					</span>
				</div>
			)}
		</div>
	);

	// Mode inline : rendu direct, sans dialog ni clic.
	if (inline) {
		return viewerBody;
	}

	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-11 sm:size-8 text-on-surface-variant hover:text-primary"
				>
					<Box className="size-4" />
					<span className="sr-only">Voir le modèle 3D de {name}</span>
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[420px] bg-surface p-0 overflow-hidden border-outline-variant rounded-xl sm:rounded-2xl">
				{/* `pointer-events-none` sur le bandeau + `pr-10` laissent le bouton de
				    fermeture (coin haut-droit du DialogContent, sous ce header en z-10)
				    cliquable ; seul le titre capte les events. */}
				<DialogHeader className="p-4 pr-10 bg-surface-container/80 absolute top-0 w-full z-10 backdrop-blur-sm border-b border-outline-variant/20 pointer-events-none">
					<DialogTitle className="text-on-surface flex items-center gap-2 text-base pointer-events-auto">
						<Box className="size-4 text-primary" />
						{name || "Modèle 3D"}
					</DialogTitle>
				</DialogHeader>

				<div className="aspect-[3/4] relative bg-surface-container-high">
					<div ref={containerRef} className="absolute inset-0" />

					{!loaded && !errored && (
						<div className="absolute inset-0 flex items-center justify-center bg-surface/50">
							<div className="animate-spin rounded-full size-8 border-b-2 border-primary" />
						</div>
					)}

					{errored && (
						<div className="absolute inset-0 flex items-center justify-center p-6 text-center">
							<span className="text-sm text-on-surface-variant">
								Modèle 3D indisponible.
							</span>
						</div>
					)}

					{loaded && !errored && (
						<a
							href={glbUrl}
							download={`${name ?? "modele"}.glb`}
							className="absolute bottom-3 right-3 z-10 inline-flex items-center gap-1 rounded-full bg-surface/70 backdrop-blur px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface border border-outline-variant/30 transition-colors"
							title="Télécharger le modèle 3D (GLB)"
						>
							<Download className="size-3" /> GLB
						</a>
					)}

					{loaded && !errored && (
						<div className="absolute bottom-3 left-0 right-0 text-center pointer-events-none">
							<span className="text-xs text-on-surface-variant/60 bg-surface/40 px-2 py-1 rounded">
								Glissez pour tourner · molette pour zoomer
							</span>
						</div>
					)}
				</div>
			</DialogContent>
		</Dialog>
	);
}
