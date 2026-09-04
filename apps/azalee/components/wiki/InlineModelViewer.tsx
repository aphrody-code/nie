"use client";

import { useEffect, useRef, useState } from "react";

interface InlineModelViewerProps {
	/** URL absolue du GLB complet (cdn.rosegriffon.fr/model-full/<code>.glb, nie-model-serve). */
	glbUrl: string;
	name?: string;
}

import { loadModelViewer } from "../../lib/model-viewer-loader";

/**
 * Viewer 3D **inline** d'un GLB texturé (vrai `<model-viewer>` natif, pas une icône
 * placeholder). Le canvas WebGL n'est monté QUE lorsque la carte entre dans le viewport
 * (IntersectionObserver) et démonté quand elle en sort largement — sinon une galerie de
 * dizaines de modèles ouvrirait des dizaines de contextes WebGL (limite navigateur ~16).
 * En attente/hors-champ : fond stade neutre + spinner au chargement (aucune fausse icône).
 */
export default function InlineModelViewer({ glbUrl, name }: InlineModelViewerProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [visible, setVisible] = useState(false);
	const [ready, setReady] = useState(false);
	const [errored, setErrored] = useState(false);

	// Monte/démonte selon la visibilité (préchargement à 200px du viewport).
	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) setVisible(e.isIntersecting);
			},
			{ rootMargin: "200px" }
		);
		io.observe(host);
		return () => io.disconnect();
	}, []);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		if (!visible) {
			// Hors-champ : libère le contexte WebGL.
			host.innerHTML = "";
			setReady(false);
			return;
		}
		let cancelled = false;
		setReady(false);
		setErrored(false);
		const controller = new AbortController();
		fetch(glbUrl, { method: "HEAD", signal: controller.signal, cache: "no-store" })
			.then((response) => {
				if (!response.ok) throw new Error(`GLB indisponible (${response.status})`);
				return loadModelViewer();
			})
			.then(() => {
				if (cancelled || !hostRef.current) return;
				const mv = document.createElement("model-viewer");
				mv.setAttribute("alt", `Modèle 3D de ${name ?? "modèle"}`);
				mv.setAttribute("camera-controls", "");
				mv.setAttribute("auto-rotate", "");
				mv.setAttribute("rotation-per-second", "24deg");
				mv.setAttribute("interaction-prompt", "none");
				mv.setAttribute("shadow-intensity", "0.8");
				mv.setAttribute("exposure", "1");
				mv.setAttribute("touch-action", "pan-y");
				mv.style.width = "100%";
				mv.style.height = "100%";
				mv.style.backgroundColor = "transparent";

				// Enregistre les écouteurs d'événements AVANT de définir la source (src),
				// pour éviter les conditions de concurrence si le modèle est déjà en cache.
				mv.addEventListener("load", () => {
					if (!cancelled) setReady(true);
				});
				mv.addEventListener("error", () => {
					if (!cancelled) setErrored(true);
				});

				mv.setAttribute("src", glbUrl);

				hostRef.current.innerHTML = "";
				hostRef.current.appendChild(mv);
			})
			.catch(() => !cancelled && setErrored(true));
		return () => {
			cancelled = true;
			controller.abort();
			host.replaceChildren();
		};
	}, [visible, glbUrl, name]);

	return (
		<div className="absolute inset-0">
			<div ref={hostRef} className="absolute inset-0" />
			{visible && !ready && !errored && (
				<div className="absolute inset-0 flex items-center justify-center">
					<div className="animate-spin rounded-full size-7 border-b-2 border-primary" />
				</div>
			)}
			{errored && (
				<div className="absolute inset-0 flex items-center justify-center p-3 text-center">
					<span className="text-xs text-on-surface-variant">Modèle indisponible</span>
				</div>
			)}
		</div>
	);
}
