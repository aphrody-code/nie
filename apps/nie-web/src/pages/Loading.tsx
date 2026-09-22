/**
 * The zero-asset readiness screen.
 *
 * It intentionally requests no VFS texture, font, audio, video, WASM decode, or secondary scene.
 * The only work on the critical path is the server readiness probe that opens both databases and
 * waits for the complete VFS index.
 */
import type { SanteApi as SiteHealth } from "@nie/asset-source/nie-site";
import { ScreenStatus } from "./screen-parts";

export interface LoadingProps {
	/** Latest `/api/v1/health` response, or `null` while it has not answered. */
	health: SiteHealth | null;
	/** Whether the host failed to reach its resources at all. */
	failed?: boolean;
	/** Retry the failed WASM readiness request without reloading the page. */
	onRetry?: () => void;
}

/**
 * True when the native transition has to stay in recovery state.
 *
 * An unknown state is still an actual wait, not evidence that the VFS is absent.
 */
export function needsStartupRecovery(health: SiteHealth | null, failed: boolean): boolean {
	return failed || health?.capacites.vfs === "absent";
}

/** Renders the real loading layout, or a neutral factual failure state. */
export function Loading({ health, failed = false, onRetry }: LoadingProps) {
	if (needsStartupRecovery(health, failed)) {
		return (
			<div style={STARTUP_STYLE}>
				<ScreenStatus state="unavailable" onRetry={onRetry} />
			</div>
		);
	}

	return (
		<div style={STARTUP_STYLE}>
			<ScreenStatus state="loading" />
		</div>
	);
}

const STARTUP_STYLE = {
	height: "100%",
	display: "grid",
	gap: "0.75rem",
	placeItems: "center",
	background: "#000",
	color: "#fff",
	font: "600 1rem/1.5 system-ui, sans-serif",
};
