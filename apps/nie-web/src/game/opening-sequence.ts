/** Ordered frames captured from the real Windows build before the WASM hand-off. */
export const OPENING_PHASES = [
	"loading",
	"inazuma-eleven",
	"level5",
	"autosave",
	"start",
	"menu",
] as const;

export type OpeningPhase = (typeof OPENING_PHASES)[number];
export type OpeningEvent = "resources-ready" | "timeout" | "media-ended" | "confirm";

/** Original logo movies; both native video and soundtrack are required by the browser host. */
export const OPENING_LOGO_MOVIES = {
	"inazuma-eleven": "data/common/movie/IE_15th.usm",
	level5: "data/common/movie/L5logo.usm",
} as const;

/** Maps the confirm button from a browser gamepad using the standard mapping. */
export function openingEventForStandardGamepadButton(buttonIndex: number): OpeningEvent | null {
	return buttonIndex === 0 ? "confirm" : null;
}

/** Localized title-logo texture verified in the mounted VFS. */
export const TITLE_LOGO_VFS_PATH =
	"data/dx11/menu/50_title/title00/title00_03_02/fr/title00_03_02.g4tx";

export interface OpeningFrame {
	surface: "loading-layout" | "title-logo" | "level5-mark" | "autosave-notice" | "start-screen";
	alt: string;
	/** Only host resource waiting has a timer; logo films end on their native media event. */
	durationMs: number | null;
	advanceOn: OpeningEvent;
	actionLabel?: string;
}

/**
 * Presentation timings are browser transitions, not game/save data. Interactive frames never
 * advance on a timer, so a slow reader cannot miss the autosave warning or START screen.
 */
export const OPENING_FRAMES: Readonly<Record<Exclude<OpeningPhase, "menu">, OpeningFrame>> = {
	loading: {
		surface: "loading-layout",
		alt: "Chargement en cours",
		durationMs: null,
		advanceOn: "resources-ready",
	},
	"inazuma-eleven": {
		surface: "title-logo",
		alt: "Logo Inazuma Eleven",
		durationMs: null,
		advanceOn: "media-ended",
	},
	level5: {
		surface: "level5-mark",
		alt: "Logo LEVEL5",
		durationMs: null,
		advanceOn: "media-ended",
	},
	autosave: {
		surface: "autosave-notice",
		alt: "Avertissement de sauvegarde automatique",
		durationMs: null,
		advanceOn: "confirm",
		actionLabel: "OK — continuer",
	},
	start: {
		surface: "start-screen",
		alt: "Écran START d’Inazuma Eleven: Victory Road",
		durationMs: null,
		advanceOn: "confirm",
		actionLabel: "COMMENCER",
	},
};

/** Advances only when the event matches the native interaction model for the current frame. */
export function advanceOpeningPhase(phase: OpeningPhase, event: OpeningEvent): OpeningPhase {
	// Startup media must never sit between readiness and the user. The legacy logo, notice and
	// title frames remain callable test/inspection surfaces, but browser startup skips them.
	if (phase === "loading") return event === "resources-ready" ? "menu" : phase;
	const index = OPENING_PHASES.indexOf(phase);
	if (index < 0 || phase === "menu") return "menu";
	const frame = OPENING_FRAMES[phase];
	return event === frame.advanceOn ? (OPENING_PHASES[index + 1] ?? "menu") : phase;
}
