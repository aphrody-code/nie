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
 * Depuis le 2026-09-12, les écrans composent avec le compositeur du jeu lui-même
 * (`nie_formats::menu_layout`, en WebAssembly) et peignent un `<canvas>`. Le garde de placement
 * — un objet dont la position n'est pas établie ne se dessine pas — est parti avec lui, dans le
 * compositeur, qui l'applique désormais pour les trois surfaces à la fois.
 *
 * Ce qui reste ici est ce que le compositeur ne fait pas : donner au canevas la taille de sa
 * zone, et mesurer cette zone au lieu de la supposer.
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
					position: "relative",
					width: `${canvas.w}px`,
					height: `${canvas.h}px`,
					flex: "0 0 auto",
					// Tant que la zone n'est pas mesuree, l'echelle vaut 0 : afficher le canevas a
					// taille reelle pendant une frame provoquerait un saut visible. On le garde
					// invisible plutot que faux.
					transform: `scale(${echelle || 1})`,
					visibility: echelle > 0 ? "visible" : "hidden",
				}}
			>
				{children}
			</div>
		</div>
	);
}

/** Ce que le mode diagnostic met en evidence sur un objet. */
