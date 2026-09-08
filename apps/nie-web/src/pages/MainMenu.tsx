import {
	BOITES,
	CanvasItem,
	FOND_MENU,
	GameCanvas,
	GLYPHES,
	IconTile,
	LayoutRender,
	LARGEUR_TUILE,
	lireLayout as readLayout,
	type NomGlyphe,
	useAssetSource,
} from "@niers/inacord-ui";
import {
	initialMenuState,
	createStandardGamepadMenuSampler,
	keyboardMenuIntent,
	reduceMenuInteraction,
	type MenuIntent,
	type MenuInteractionItem,
} from "@niers/inacord-ui/shell/menu-interaction";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TITLE_LOGO_VFS_PATH } from "../game/opening-sequence";
import rawLayout from "../layouts/mainmenu01.layout.json";
import "./main-menu.css";

const FULL_LAYOUT = readLayout(rawLayout);
const VERIFIED_LAYER_NAMES = new Set(["mainmenu90_00_background"]);
const VERIFIED_LAYOUT = {
	...FULL_LAYOUT,
	objects: FULL_LAYOUT.objects.filter((object) => VERIFIED_LAYER_NAMES.has(object.name)),
};

export interface MainMenuAction {
	id: string;
	label: string;
	glyph: NomGlyphe;
	onActivate: () => void;
	disabled?: boolean;
}

export interface MainMenuProps {
	actions: readonly MainMenuAction[];
	onCancel?: () => void;
	gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler>;
}

function interactionItems(actions: readonly MainMenuAction[]): MenuInteractionItem[] {
	return actions.map((action, index) => ({
		id: action.id,
		disabled: action.disabled,
		rect: {
			x: BOITES.rangee.x + index * (LARGEUR_TUILE + 8),
			y: BOITES.rangee.y,
			width: LARGEUR_TUILE,
			height: BOITES.rangee.h,
		},
	}));
}

/**
 * Layered main menu built from verified VFS objects and shared measured geometry.
 *
 * The native capture is an offline oracle only. Missing C++/Lua placement remains visible as an
 * incomplete state; this component never fills that gap with player statistics or invented tabs.
 */
export function MainMenu({ actions, onCancel, gamepadSampler }: MainMenuProps) {
	const source = useAssetSource();
	const items = useMemo(() => interactionItems(actions), [actions]);
	const [focusedId, setFocusedId] = useState(() => initialMenuState(items).focusedId);
	const focusState = useRef(initialMenuState(items));
	const [pressedId, setPressedId] = useState<string | null>(null);
	const [leavingId, setLeavingId] = useState<string | null>(null);
	const [layerState, setLayerState] = useState<"loading" | "ready" | "failed">("loading");
	const localGamepadSampler = useRef(createStandardGamepadMenuSampler());
	const sampler = gamepadSampler ?? localGamepadSampler.current;
	const menuRoot = useRef<HTMLElement | null>(null);
	const activationTimer = useRef<number | null>(null);
	const activationPending = useRef(false);
	const latestActions = useRef(actions);
	latestActions.current = actions;

	useEffect(() => () => {
		if (activationTimer.current !== null) window.clearTimeout(activationTimer.current);
	}, []);

	useEffect(() => {
		focusState.current = initialMenuState(items, focusState.current.focusedId);
		setFocusedId(focusState.current.focusedId);
	}, [items]);

	useEffect(() => {
		if (leavingId === null || actions.some((action) => action.id === leavingId && !action.disabled)) return;
		if (activationTimer.current !== null) window.clearTimeout(activationTimer.current);
		activationTimer.current = null;
		activationPending.current = false;
		setLeavingId(null);
	}, [actions, leavingId]);

	const activate = useCallback(
		(id: string | null) => {
			const action = actions.find((candidate) => candidate.id === id);
			if (!action || action.disabled || activationPending.current) return;
			activationPending.current = true;
			setLeavingId(action.id);
			const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 140;
			activationTimer.current = window.setTimeout(() => {
				activationTimer.current = null;
				const currentAction = latestActions.current.find((candidate) => candidate.id === action.id && !candidate.disabled);
				try {
					currentAction?.onActivate();
				} finally {
					activationPending.current = false;
					setLeavingId(null);
				}
			}, delay);
		},
		[actions],
	);

	const applyIntent = useCallback(
		(intent: MenuIntent) => {
			if (activationPending.current) return;
			const update = reduceMenuInteraction(items, focusState.current, intent);
			focusState.current = update.state;
			setFocusedId(update.state.focusedId);
			if (update.activatedId) activate(update.activatedId);
			if (update.cancelled) onCancel?.();
		},
		[activate, items, onCancel],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			const intent = keyboardMenuIntent(event.key);
			if (!intent) return;
			event.preventDefault();
			if (event.repeat && (intent.type === "activate" || intent.type === "cancel")) return;
			applyIntent(intent);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [applyIntent]);

	useEffect(() => {
		const release = () => setPressedId(null);
		window.addEventListener("pointerup", release);
		window.addEventListener("pointercancel", release);
		window.addEventListener("blur", release);
		return () => {
			window.removeEventListener("pointerup", release);
			window.removeEventListener("pointercancel", release);
			window.removeEventListener("blur", release);
		};
	}, []);

	useEffect(() => {
		if (!focusedId) return;
		// GameCanvas stays hidden until its first measurement has committed.
		const frame = window.requestAnimationFrame(() => {
			const target = menuRoot.current?.querySelector<HTMLButtonElement>(
				`[data-menu-target="${CSS.escape(focusedId)}"] button`,
			);
			if (target && document.activeElement !== target) target.focus({ preventScroll: true });
		});
		return () => window.cancelAnimationFrame(frame);
	}, [focusedId]);

	useEffect(() => {
		if (typeof navigator.getGamepads !== "function") return;
		let frame = 0;
		const poll = () => {
			for (const intent of sampler.sample(navigator.getGamepads())) applyIntent(intent);
			frame = window.requestAnimationFrame(poll);
		};
		frame = window.requestAnimationFrame(poll);
		return () => window.cancelAnimationFrame(frame);
	}, [applyIntent, sampler]);

	const logoUrl = source.urlTexture?.(TITLE_LOGO_VFS_PATH) ?? null;
	return (
		<section
			ref={menuRoot}
			aria-label="Menu principal"
			data-render-source="vfs-layers"
			data-runtime-completeness="partial"
			className={`runtime-main-menu${leavingId ? " runtime-main-menu--leaving" : ""}`}
		>
			<GameCanvas canvas={FULL_LAYOUT.canvas} fond={FOND_MENU}>
				<LayoutRender
					layout={VERIFIED_LAYOUT}
					onTexture={(_, loaded) => setLayerState(loaded ? "ready" : "failed")}
				/>
				<CanvasItem {...BOITES.titre} largeur={BOITES.titre.l} hauteur={BOITES.titre.h} z={700}>
					{logoUrl ? (
						<img
							src={logoUrl}
							alt="Inazuma Eleven: Victory Road"
							className="runtime-main-menu__logo"
							onError={() => setLayerState("failed")}
						/>
					) : null}
				</CanvasItem>
				<CanvasItem x={BOITES.rangee.x} y={BOITES.rangee.y} largeur={BOITES.rangee.l} z={720}>
					<div className="runtime-main-menu__actions">
						{actions.map((action, index) => {
							const selected = focusedId === action.id;
							return (
								<div
									key={action.id}
									data-menu-target={action.id}
									className="runtime-main-menu__action"
									style={{ animationDelay: `${index * 45}ms` }}
									onPointerEnter={() =>
										applyIntent({ type: "focus", id: action.id })
									}
									onFocus={() => applyIntent({ type: "focus", id: action.id })}
									onPointerDown={(event) => {
										if (event.button !== 0 || action.disabled) return;
										applyIntent({ type: "focus", id: action.id });
										setPressedId(action.id);
									}}
									onPointerLeave={() => setPressedId(null)}
									onPointerUp={() => setPressedId(null)}
									onPointerCancel={() => setPressedId(null)}
								>
									<IconTile
										icone={GLYPHES[action.glyph]}
										libelle={action.label}
										actif={selected}
										sourdine={action.disabled}
										onClick={() => activate(action.id)}
										className={`runtime-main-menu__tile${pressedId === action.id ? " runtime-main-menu__tile--pressed" : ""}`}
									/>
								</div>
							);
						})}
					</div>
				</CanvasItem>
				<span className="runtime-main-menu__asset-state" data-state={layerState} aria-live="polite">
					{layerState === "failed" ? "Ressources visuelles indisponibles." : ""}
				</span>
			</GameCanvas>
		</section>
	);
}
