/** Layered startup and menu built from VFS assets, shared geometry, and explicit incomplete states. */
import { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
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
import { NativeText } from "./NativeText";
import "./opening.css";

export interface GameProps {
	phase: OpeningPhase;
	onPhaseChange: (phase: OpeningPhase) => void;
	onOpenAvatar: () => void;
	onOpenSettings: () => void;
	onOpenMedia: () => void;
	onOpenExplorer: () => void;
}

/** Runs the VFS/component startup sequence before mounting the layered menu. */
export function Game({
	phase,
	onPhaseChange,
	onOpenAvatar,
	onOpenSettings,
	onOpenMedia,
	onOpenExplorer,
}: GameProps) {
	const gamepadSampler = useRef(createStandardGamepadMenuSampler());
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
				onCancel={() => onPhaseChange("start")}
				gamepadSampler={gamepadSampler.current}
			/>
		);
	}
	return (
		<OpeningScreen
			key={phase}
			phase={phase}
			onAdvance={advance}
			gamepadSampler={gamepadSampler.current}
		/>
	);
}

function OpeningScreen({
	phase,
	onAdvance,
	gamepadSampler,
}: {
	phase: Exclude<OpeningPhase, "menu">;
	onAdvance: (event: OpeningEvent) => void;
	gamepadSampler: ReturnType<typeof createStandardGamepadMenuSampler>;
}) {
	const frame = OPENING_FRAMES[phase];
	const movie = frame.advanceOn === "media-ended";
	const [ready, setReady] = useState(false);
	const onReady = useCallback(() => setReady(true), []);
	const action = useRef<HTMLButtonElement | null>(null);
	const advanced = useRef(false);
	const advanceOnce = useCallback((event: OpeningEvent) => {
		if (advanced.current) return;
		advanced.current = true;
		onAdvance(event);
	}, [onAdvance]);

	useEffect(() => {
		if (!ready || movie || frame.durationMs === null) return;
		const timer = window.setTimeout(() => advanceOnce("timeout"), frame.durationMs);
		return () => window.clearTimeout(timer);
	}, [ready, movie, frame.durationMs, advanceOnce]);

	useEffect(() => {
		if (frame.advanceOn !== "confirm") return;
		action.current?.focus({ preventScroll: true });
	}, [frame.advanceOn]);

	useEffect(() => {
		if (typeof navigator.getGamepads !== "function") return;
		let animationFrame = 0;
		const poll = () => {
			for (const intent of gamepadSampler.sample(navigator.getGamepads())) {
				if (intent.type === "activate" && frame.advanceOn === "confirm") advanceOnce("confirm");
			}
			animationFrame = window.requestAnimationFrame(poll);
		};
		animationFrame = window.requestAnimationFrame(poll);
		return () => window.cancelAnimationFrame(animationFrame);
	}, [frame.advanceOn, advanceOnce, gamepadSampler]);

	return (
		<section
			aria-label={frame.alt}
			aria-live="polite"
			data-opening-phase={phase}
			className={`opening-screen opening-screen--${phase}`}
		>
			<OpeningVisual phase={phase} onReady={onReady} onEnded={movie ? () => advanceOnce("media-ended") : undefined} />
			{frame.actionLabel ? (
				<button
					ref={action}
					type="button"
					aria-label={frame.actionLabel}
					onClick={() => advanceOnce("confirm")}
					onKeyDown={(event) => {
						if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
					}}
					className={`opening-screen__action opening-screen__action--${phase}`}
				>
					<NativeText text={phase === "autosave" ? "OK" : "COMMENCER"} color={phase === "autosave" ? 0xffffffff : 0x005affff} height={phase === "autosave" ? 64 : 88} width={phase === "autosave" ? 56 : 432} />
				</button>
			) : null}
		</section>
	);
}
