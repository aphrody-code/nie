/**
 * The VFS-backed `loading01` screen.
 *
 * The rendered loading state contains only the single object exported by
 * `nie-game --runtime --menu loading01 --export-layout`: the 784×136 sprite at the centre of the
 * 1280×720 canvas. Status text remains available to assistive technology, but no mascot, progress
 * value, service count, or locally composed decoration is placed over the game layout.
 *
 * When the VFS is known to be unavailable, its texture cannot be rendered truthfully. That case
 * uses a plain system-colour message instead of presenting an incomplete game screen.
 */
import type { SanteApi as SiteHealth } from "@niers/asset-source/nie-site";
import { GameCanvas, LayoutRender, lireLayout as readLayout } from "@niers/inacord-ui";
import type { CSSProperties } from "react";
import rawLayout from "../layouts/loading01.layout.json";

/** Runtime layout exported from the real `loading01` VFS assets. */
const LAYOUT = readLayout(rawLayout);

export interface LoadingProps {
	/** Latest `/api/v1/health` response, or `null` while it has not answered. */
	health: SiteHealth | null;
	/** Whether the host failed to reach its resources at all. */
	failed?: boolean;
}

/**
 * Returns the factual fallback required when the real VFS screen cannot be served.
 *
 * `null` means the layout may be shown. In particular, an unknown state is still an actual wait,
 * not evidence that the VFS is absent.
 */
export function loadingFallbackMessage(health: SiteHealth | null, failed: boolean): string | null {
	if (failed) return "Les ressources ne sont pas joignables.";
	if (health?.capacites.vfs === "absent") return "Les fichiers du jeu ne sont pas disponibles.";
	return null;
}

/** Renders the real loading layout, or a neutral factual failure state. */
export function Loading({ health, failed = false }: LoadingProps) {
	const fallback = loadingFallbackMessage(health, failed);
	if (fallback) {
		return (
			<div role="alert" style={FALLBACK_STYLE}>
				{fallback}
			</div>
		);
	}

	return (
		<GameCanvas canvas={LAYOUT.canvas} fond="var(--jeu-ciel-clair)">
			<LayoutRender layout={LAYOUT} />
			<span role="status" style={VISUALLY_HIDDEN_STYLE}>
				Chargement en cours.
			</span>
		</GameCanvas>
	);
}

const VISUALLY_HIDDEN_STYLE: CSSProperties = {
	position: "absolute",
	width: 1,
	height: 1,
	padding: 0,
	margin: -1,
	overflow: "hidden",
	clip: "rect(0, 0, 0, 0)",
	whiteSpace: "nowrap",
	border: 0,
};

const FALLBACK_STYLE: CSSProperties = {
	height: "100%",
	boxSizing: "border-box",
	display: "grid",
	placeItems: "center",
	padding: "1rem",
	background: "Canvas",
	color: "CanvasText",
	font: "600 1rem/1.5 system-ui, sans-serif",
	textAlign: "center",
};
