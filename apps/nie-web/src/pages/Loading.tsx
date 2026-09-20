/**
 * The zero-asset readiness screen.
 *
 * It intentionally requests no VFS texture, font, audio, video, WASM decode, or secondary scene.
 * The only work on the critical path is the server readiness probe that opens both databases and
 * waits for the complete VFS index.
 */
import type { SanteApi as SiteHealth } from "@niers/asset-source/nie-site";
import { ScreenStatus } from "./screen-parts";

export interface LoadingProps {
	/** Latest `/api/v1/health` response, or `null` while it has not answered. */
	health: SiteHealth | null;
	/** Whether the host failed to reach its resources at all. */
	failed?: boolean;
	/** Retry the failed WASM readiness request without reloading the page. */
	onRetry?: () => void;
	/** Bypass and continue to the opening sequence / main menu directly. */
	onSkip?: () => void;
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
export function Loading({ health, failed = false, onRetry, onSkip }: LoadingProps) {
	if (needsStartupRecovery(health, failed)) {
		return (
			<div style={STARTUP_STYLE}>
				<ScreenStatus state="unavailable" onRetry={onRetry} />
				{onSkip ? (
					<button
						type="button"
						onClick={onSkip}
						style={{
							marginTop: "0.5rem",
							padding: "0.4rem 0.8rem",
							fontSize: "0.85rem",
							background: "rgba(255, 255, 255, 0.1)",
							border: "1px solid rgba(255, 255, 255, 0.3)",
							borderRadius: "4px",
							color: "#fff",
							cursor: "pointer",
						}}
					>
						Accéder au menu principal
					</button>
				) : null}
			</div>
		);
	}

	return (
		<div style={STARTUP_STYLE}>
			<ScreenStatus state="loading" />
			{onSkip ? (
				<button
					type="button"
					onClick={onSkip}
					style={{
						marginTop: "0.5rem",
						padding: "0.3rem 0.7rem",
						fontSize: "0.8rem",
						background: "transparent",
						border: "1px solid rgba(255, 255, 255, 0.2)",
						borderRadius: "4px",
						color: "#94a3b8",
						cursor: "pointer",
					}}
				>
					Passer
				</button>
			) : null}
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
