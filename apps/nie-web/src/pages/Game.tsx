/** Layered startup and menu built from VFS assets, shared geometry, and explicit incomplete states. */
import { useAssetSource } from "@niers/inacord-ui";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	advanceOpeningPhase,
	OPENING_FRAMES,
	openingEventForStandardGamepadButton,
	TITLE_LOGO_VFS_PATH,
	type OpeningEvent,
	type OpeningPhase,
} from "../game/opening-sequence";
import { Loading } from "./Loading";
import { MainMenu, type MainMenuAction } from "./MainMenu";
import "./opening.css";

export interface GameProps {
	onOpenAvatar: () => void;
	onOpenSettings: () => void;
	onOpenMedia: () => void;
	onOpenExplorer: () => void;
}

/** Runs the VFS/component startup sequence before mounting the layered menu. */
export function Game({
	onOpenAvatar,
	onOpenSettings,
	onOpenMedia,
	onOpenExplorer,
}: GameProps) {
	const [phase, setPhase] = useState<OpeningPhase>("loading");
	const advance = useCallback((event: OpeningEvent) => {
		setPhase((current) => advanceOpeningPhase(current, event));
	}, []);

	if (phase === "menu") {
		const actions: MainMenuAction[] = [
			{ id: "media", label: "Médias", glyph: "image", onActivate: onOpenMedia },
			{ id: "avatar", label: "Avatar", glyph: "ballon", onActivate: onOpenAvatar },
			{ id: "explorer", label: "Explorer", glyph: "arbre", onActivate: onOpenExplorer },
			{ id: "settings", label: "Options", glyph: "engrenage", onActivate: onOpenSettings },
		];
		return (
			<MainMenu actions={actions} onCancel={() => setPhase("start")} />
		);
	}
	return <OpeningScreen key={phase} phase={phase} onAdvance={advance} />;
}

function OpeningScreen({
	phase,
	onAdvance,
}: {
	phase: Exclude<OpeningPhase, "menu">;
	onAdvance: (event: OpeningEvent) => void;
}) {
	const frame = OPENING_FRAMES[phase];
	const action = useRef<HTMLButtonElement | null>(null);
	const gamepadHeld = useRef(new Set<number>());

	useEffect(() => {
		if (frame.durationMs === null) return;
		const timer = window.setTimeout(() => onAdvance("timeout"), frame.durationMs);
		return () => window.clearTimeout(timer);
	}, [frame.durationMs, onAdvance]);

	useEffect(() => {
		if (frame.durationMs !== null) return;
		action.current?.focus({ preventScroll: true });
	}, [frame.durationMs]);

	useEffect(() => {
		if (frame.durationMs !== null || typeof navigator.getGamepads !== "function") return;
		let animationFrame = 0;
		const poll = () => {
			const gamepad = Array.from(navigator.getGamepads()).find(
				(candidate) => candidate?.connected && candidate.mapping === "standard",
			);
			if (gamepad) {
				for (const [index, button] of gamepad.buttons.entries()) {
					if (button.pressed && !gamepadHeld.current.has(index)) {
						const event = openingEventForStandardGamepadButton(index);
						if (event) onAdvance(event);
					}
					if (button.pressed) gamepadHeld.current.add(index);
					else gamepadHeld.current.delete(index);
				}
			}
			animationFrame = window.requestAnimationFrame(poll);
		};
		animationFrame = window.requestAnimationFrame(poll);
		return () => window.cancelAnimationFrame(animationFrame);
	}, [frame.durationMs, onAdvance]);

	return (
		<section
			aria-label={frame.alt}
			aria-live="polite"
			data-opening-phase={phase}
			className={`opening-screen opening-screen--${phase}`}
		>
			<OpeningVisual phase={phase} />
			{frame.actionLabel ? (
				<button
					ref={action}
					type="button"
					aria-label={frame.actionLabel}
					onClick={() => onAdvance("confirm")}
					className={`opening-screen__action opening-screen__action--${phase}`}
				>
					{phase === "autosave" ? "OK" : "COMMENCER"}
				</button>
			) : null}
		</section>
	);
}

function OpeningVisual({ phase }: { phase: Exclude<OpeningPhase, "menu"> }) {
	if (phase === "loading") return <Loading health={null} />;
	if (phase === "level5") {
		return (
			<div className="opening-brand" aria-label="LEVEL5">
				<span>LEVEL5</span>
			</div>
		);
	}
	if (phase === "autosave") {
		return (
			<div className="opening-autosave">
				<p>Ce jeu dispose d’une fonction de sauvegarde automatique.</p>
				<p>Cette icône s’affichera à l’écran lors d’une sauvegarde.</p>
				<div className="opening-autosave__stripe">
					<span className="opening-autosave__spinner" aria-hidden="true" />
					Sauvegarde en cours
				</div>
				<strong>[AVERTISSEMENT]</strong>
				<p>Si le jeu est fermé pendant la sauvegarde, le fichier peut être corrompu.</p>
			</div>
		);
	}
	return <TitleLogo />;
}

function TitleLogo() {
	const source = useAssetSource();
	const [failed, setFailed] = useState(false);
	const src = source.urlTexture?.(TITLE_LOGO_VFS_PATH) ?? null;
	return (
		<div className="opening-title">
			{src && !failed ? (
				<img
					src={src}
					alt="Inazuma Eleven: Victory Road"
					className="opening-title__logo"
					onError={() => setFailed(true)}
				/>
			) : null}
		</div>
	);
}
