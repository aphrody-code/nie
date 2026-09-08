/** Layered startup and menu built from VFS assets, shared geometry, and explicit incomplete states. */
import { useAssetSource } from "@niers/inacord-ui";
import { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
import { useCallback, useEffect, useRef, useState } from "react";
import { AVATAR, EXPLORER, MEDIA, SETTINGS, menuEntries } from "../entries";
import { bindMenuActions } from "../game/menu-actions";
import {
	advanceOpeningPhase,
	OPENING_FRAMES,
	TITLE_LOGO_VFS_PATH,
	type OpeningEvent,
	type OpeningPhase,
} from "../game/opening-sequence";
import { Loading } from "./Loading";
import { MainMenu } from "./MainMenu";
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
	const gamepadSampler = useRef(createStandardGamepadMenuSampler());
	const advance = useCallback((event: OpeningEvent) => {
		setPhase((current) => advanceOpeningPhase(current, event));
	}, []);

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
				onCancel={() => setPhase("start")}
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
	const action = useRef<HTMLButtonElement | null>(null);
	const advanced = useRef(false);
	const advanceOnce = useCallback((event: OpeningEvent) => {
		if (advanced.current) return;
		advanced.current = true;
		onAdvance(event);
	}, [onAdvance]);

	useEffect(() => {
		if (frame.durationMs === null) return;
		const timer = window.setTimeout(() => advanceOnce("timeout"), frame.durationMs);
		return () => window.clearTimeout(timer);
	}, [frame.durationMs, advanceOnce]);

	useEffect(() => {
		if (frame.durationMs !== null) return;
		action.current?.focus({ preventScroll: true });
	}, [frame.durationMs]);

	useEffect(() => {
		if (typeof navigator.getGamepads !== "function") return;
		let animationFrame = 0;
		const poll = () => {
			for (const intent of gamepadSampler.sample(navigator.getGamepads())) {
				if (intent.type === "activate" && frame.durationMs === null) advanceOnce("confirm");
			}
			animationFrame = window.requestAnimationFrame(poll);
		};
		animationFrame = window.requestAnimationFrame(poll);
		return () => window.cancelAnimationFrame(animationFrame);
	}, [frame.durationMs, advanceOnce, gamepadSampler]);

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
					onClick={() => advanceOnce("confirm")}
					onKeyDown={(event) => {
						if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault();
					}}
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
