/**
 * The zero-asset readiness screen.
 *
 * It intentionally requests no VFS texture, font, audio, video, WASM decode, or secondary scene.
 * The only work on the critical path is the server readiness probe that opens both databases and
 * waits for the complete VFS index.
 */
import type { SanteApi as SiteHealth } from "@niers/asset-source/nie-site";
import type { CSSProperties } from "react";

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

	return <div role="status" style={LOADING_STYLE}>Chargement des données…</div>;
}

const LOADING_STYLE: CSSProperties = {
	height: "100%",
	display: "grid",
	placeItems: "center",
	background: "#000",
	color: "#fff",
	font: "600 1rem/1.5 system-ui, sans-serif",
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
