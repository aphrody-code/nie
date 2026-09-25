/**
 * Le canevas du jeu : un repère de 1280×720 mis à l'échelle de la zone qu'on lui donne.
 *
 * ## Ce qui a quitté ce fichier
 *
 * Il s'appelait `layout-render.tsx` et contenait, à côté de ce canevas, un SECOND compositeur de
 * menu : un `<img>` par objet, placé par un `transform` CSS. Cette voie ne sait faire aucune des
 * quatre opérations que le jeu applique — échantillonnage bilinéaire, rotation autour d'une
 * ancre, teinte, mélange additif — et elle ne pouvait pas les apprendre : un navigateur empile
 * des boîtes, il ne compose pas des sprites.
 *
 * Le compositeur Rust/WASM peint les écrans qu'il prend en charge. Quelques scènes encore
 * partielles, dont le menu titre, placent temporairement des sprites VFS mesurés en DOM/CSS.
 * `GameCanvas` n'est donc pas un moteur de rendu : il possède uniquement le repère natif et sa
 * mise à l'échelle responsive, quel que soit le compositeur employé par l'écran.
 */
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { type CanvasLayout, echellePourZone } from "./game-layout";

export function useEchelleCanvas(canvas: CanvasLayout) {
	const zone = useRef<HTMLDivElement | null>(null);
	const [echelle, setEchelle] = useState(0);
	useEffect(() => {
		const noeud = zone.current;
		if (!noeud) return;
		const mesurer = () => {
			const r = noeud.getBoundingClientRect();
			setEchelle(echellePourZone(r.width, r.height, canvas));
		};
		mesurer();
		if (typeof ResizeObserver === "undefined") return;
		const ro = new ResizeObserver(mesurer);
		ro.observe(noeud);
		return () => ro.disconnect();
	}, [canvas]);
	return { zone, echelle };
}

/**
 * La scene : un canevas aux dimensions du jeu, mis a l'echelle de la place disponible.
 *
 * Les enfants travaillent donc TOUJOURS en pixels du jeu (1280x720 pour `mainmenu01`), quelle
 * que soit la taille de l'ecran. C'est la seule facon de poser une coordonnee exportee sans la
 * convertir a chaque usage — et une conversion repetee dans dix composants finit toujours par
 * diverger dans l'un d'eux.
 */
export function GameCanvas({
	canvas,
	children,
	fond,
	className,
	onReady,
}: {
	canvas: CanvasLayout;
	children: ReactNode;
	/** Le fond de la zone, hors du canevas mis a l'echelle. */
	fond?: string;
	className?: string;
	/** Called once the measured canvas is visible and its controls can receive focus. */
	onReady?: () => void;
}) {
	const { zone, echelle } = useEchelleCanvas(canvas);
	const ready = echelle > 0;
	useEffect(() => {
		if (ready) onReady?.();
	}, [ready, onReady]);
	return (
		<div
			ref={zone}
			className={className}
			style={{
				position: "relative",
				width: "100%",
				height: "100%",
				overflow: "hidden",
				background: fond ?? "var(--jeu-fond-abysse)",
				display: "grid",
				placeItems: "center",
			}}
		>
			<div
				style={{
					position: "absolute",
					left: "50%",
					top: "50%",
					width: `${canvas.w}px`,
					height: `${canvas.h}px`,
					flex: "0 0 auto",
					// Tant que la zone n'est pas mesuree, l'echelle vaut 0 : afficher le canevas a
					// taille reelle pendant une frame provoquerait un saut visible. On le garde
					// invisible plutot que faux.
					transform: `translate(-50%, -50%) scale(${echelle || 1})`,
					transformOrigin: "center",
					visibility: echelle > 0 ? "visible" : "hidden",
				}}
			>
				{children}
			</div>
		</div>
	);
}

/** Ce que le mode diagnostic met en evidence sur un objet. */
