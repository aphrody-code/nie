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
export type OpeningEvent = "timeout" | "confirm";

/** Maps the confirm button from a browser gamepad using the standard mapping. */
export function openingEventForStandardGamepadButton(buttonIndex: number): OpeningEvent | null {
	return buttonIndex === 0 ? "confirm" : null;
}

/** Localized title-logo texture verified in the mounted VFS. */
export const TITLE_LOGO_VFS_PATH =
	"data/dx11/menu/220_img/logo_title/fr/logo_title_switch2_edition.g4tx";

export interface OpeningFrame {
	surface: "loading-layout" | "title-logo" | "level5-mark" | "autosave-notice" | "start-screen";
	alt: string;
	/** Null means that the game waits for explicit confirmation. */
	durationMs: number | null;
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
		durationMs: 1_200,
	},
	"inazuma-eleven": {
		surface: "title-logo",
		alt: "Logo Inazuma Eleven",
		durationMs: 2_000,
	},
	level5: {
		surface: "level5-mark",
		alt: "Logo LEVEL5",
		durationMs: 2_000,
	},
	autosave: {
		surface: "autosave-notice",
		alt: "Avertissement de sauvegarde automatique",
		durationMs: null,
		actionLabel: "OK — continuer",
	},
	start: {
		surface: "start-screen",
		alt: "Écran START d’Inazuma Eleven: Victory Road",
		durationMs: null,
		actionLabel: "COMMENCER",
	},
};

/** Advances only when the event matches the native interaction model for the current frame. */
export function advanceOpeningPhase(phase: OpeningPhase, event: OpeningEvent): OpeningPhase {
	const index = OPENING_PHASES.indexOf(phase);
	if (index < 0 || phase === "menu") return "menu";
	const frame = OPENING_FRAMES[phase];
	const expects = frame.durationMs === null ? "confirm" : "timeout";
	return event === expects ? (OPENING_PHASES[index + 1] ?? "menu") : phase;
}
