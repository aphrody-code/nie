/** Layered startup and menu built from VFS assets, shared geometry, and explicit incomplete states. */
import { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
import { emitNativeCommand } from "@niers/inacord-ui/lib/native-command";
import type { SanteApi as SiteHealth } from "@niers/asset-source/nie-site";
import { useCallback, useEffect, useRef, useState } from "react";
import { AVATAR, EXPLORER, MEDIA, SETTINGS, menuEntries } from "../entries";
import { bindMenuActions } from "../game/menu-actions";
import {
	advanceOpeningPhase,
	OPENING_FRAMES,
	type OpeningEvent,
	type OpeningPhase,
} from "../game/opening-sequence";
import { MainMenu } from "./MainMenu";
import { OpeningVisual } from "./OpeningVisual";
import "./opening.css";

export interface GameProps {
	gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler>;
	phase: OpeningPhase;
	onPhaseChange: (phase: OpeningPhase) => void;
	onOpenAvatar: () => void;
	onOpenSettings: () => void;
	onOpenMedia: () => void;
	onOpenExplorer: () => void;
	startupReady?: boolean;
	health?: SiteHealth | null;
	startupFailed?: boolean;
}

/** Runs the VFS/component startup sequence before mounting the layered menu. */
export function Game({
	gamepadSampler: suppliedGamepadSampler,
	phase,
	onPhaseChange,
	onOpenAvatar,
	onOpenSettings,
	onOpenMedia,
	onOpenExplorer,
	startupReady = false,
	health = null,
	startupFailed = false,
}: GameProps) {
	const localGamepadSampler = useRef(createStandardGamepadMenuSampler());
	const gamepadSampler = suppliedGamepadSampler ?? localGamepadSampler.current;
	const advance = useCallback((event: OpeningEvent) => {
		onPhaseChange(advanceOpeningPhase(phase, event));
	}, [phase, onPhaseChange]);

	if (phase === "menu") {
		const actions = bindMenuActions(menuEntries(null), {
			[MEDIA]: { id: "media", onActivate: onOpenMedia },
			[AVATAR]: { id: "avatar", onActivate: onOpenAvatar },
			[EXPLORER]: { id: "explorer", onActivate: onOpenExplorer },
			[SETTINGS]: { id: "settings", onActivate: onOpenSettings },
		});
		return (
			<MainMenu
				actions={actions}
				gamepadSampler={gamepadSampler}
			/>
		);
	}
	return (
		<OpeningScreen
			key={phase}
			phase={phase}
			onAdvance={advance}
			gamepadSampler={gamepadSampler}
			startupReady={startupReady}
			health={health}
			startupFailed={startupFailed}
		/>
	);
}

function OpeningScreen({
	phase,
	onAdvance,
	gamepadSampler,
	startupReady,
	health,
	startupFailed,
}: {
	phase: Exclude<OpeningPhase, "menu">;
	onAdvance: (event: OpeningEvent) => void;
	gamepadSampler: ReturnType<typeof createStandardGamepadMenuSampler>;
	startupReady: boolean;
	health: SiteHealth | null;
	startupFailed: boolean;
}) {
	const frame = OPENING_FRAMES[phase];
	const movie = frame.advanceOn === "media-ended";
	const [ready, setReady] = useState(false);
	const onReady = useCallback(() => setReady(true), []);
	const advanced = useRef(false);
	const advanceOnce = useCallback((event: OpeningEvent) => {
		if (advanced.current) return;
		advanced.current = true;
		if (phase === "start" && event === "confirm") {
			emitNativeCommand("data/common/gamedata/menu/obj/title00_04_gamestart.objbin", "CMD_ENTER");
		}
		onAdvance(event);
	}, [onAdvance, phase]);

	useEffect(() => {
		if (phase === "loading" && startupReady) {
			advanceOnce("resources-ready");
			return;
		}
		if (!ready || movie || frame.durationMs === null) return;
		const timer = window.setTimeout(() => advanceOnce("timeout"), frame.durationMs);
		return () => window.clearTimeout(timer);
	}, [phase, startupReady, ready, movie, frame.durationMs, advanceOnce]);

	useEffect(() => {
		if (typeof navigator.getGamepads !== "function") return;
		let animationFrame = 0;
		const poll = () => {
			for (const intent of gamepadSampler.sample(navigator.getGamepads())) {
				if (ready && intent.type === "activate" && frame.advanceOn === "confirm") advanceOnce("confirm");
			}
			animationFrame = window.requestAnimationFrame(poll);
		};
		animationFrame = window.requestAnimationFrame(poll);
		return () => window.cancelAnimationFrame(animationFrame);
	}, [ready, frame.advanceOn, advanceOnce, gamepadSampler]);

	return (
		<section
			aria-label={frame.alt}
			aria-live="polite"
			data-opening-phase={phase}
			className={`opening-screen opening-screen--${phase}`}
		>
			<OpeningVisual phase={phase} health={health} failed={startupFailed} onReady={onReady} onEnded={movie ? () => advanceOnce("media-ended") : undefined}
				onConfirm={frame.advanceOn === "confirm" ? () => advanceOnce("confirm") : undefined} />
		</section>
	);
}
