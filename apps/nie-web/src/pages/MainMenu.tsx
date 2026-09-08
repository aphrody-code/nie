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
	keyboardMenuIntent,
	reduceMenuInteraction,
	standardGamepadButtonMenuIntent,
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
}

export interface MainMenuProps {
	actions: readonly MainMenuAction[];
	onCancel?: () => void;
}

function interactionItems(actions: readonly MainMenuAction[]): MenuInteractionItem[] {
	return actions.map((action, index) => ({
		id: action.id,
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
export function MainMenu({ actions, onCancel }: MainMenuProps) {
	const source = useAssetSource();
	const items = useMemo(() => interactionItems(actions), [actions]);
	const [focusedId, setFocusedId] = useState(() => initialMenuState(items).focusedId);
	const [pressedId, setPressedId] = useState<string | null>(null);
	const [leavingId, setLeavingId] = useState<string | null>(null);
	const [layerState, setLayerState] = useState<"loading" | "ready" | "failed">("loading");
	const gamepadHeld = useRef(new Set<number>());
	const menuRoot = useRef<HTMLElement | null>(null);

	const activate = useCallback(
		(id: string | null) => {
			const action = actions.find((candidate) => candidate.id === id);
			if (!action || leavingId !== null) return;
			setLeavingId(action.id);
			window.setTimeout(action.onActivate, 140);
		},
		[actions, leavingId],
	);

	const applyIntent = useCallback(
		(intent: MenuIntent) => {
			const update = reduceMenuInteraction(items, { focusedId }, intent);
			setFocusedId(update.state.focusedId);
			if (update.activatedId) activate(update.activatedId);
			if (update.cancelled) onCancel?.();
		},
		[activate, focusedId, items, onCancel],
	);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			const intent = keyboardMenuIntent(event.key);
			if (!intent) return;
			event.preventDefault();
			applyIntent(intent);
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [applyIntent]);

	useEffect(() => {
		if (!focusedId) return;
		const target = menuRoot.current?.querySelector<HTMLButtonElement>(
			`[data-menu-target="${CSS.escape(focusedId)}"] button`,
		);
		if (target && document.activeElement !== target) target.focus({ preventScroll: true });
	}, [focusedId]);

	useEffect(() => {
		if (typeof navigator.getGamepads !== "function") return;
		let frame = 0;
		const poll = () => {
			const gamepad = Array.from(navigator.getGamepads()).find(
				(candidate) => candidate?.connected && candidate.mapping === "standard",
			);
			if (gamepad) {
				for (const [index, button] of gamepad.buttons.entries()) {
					if (button.pressed && !gamepadHeld.current.has(index)) {
						const intent = standardGamepadButtonMenuIntent(index);
						if (intent) applyIntent(intent);
					}
					if (button.pressed) gamepadHeld.current.add(index);
					else gamepadHeld.current.delete(index);
				}
			}
			frame = window.requestAnimationFrame(poll);
		};
		frame = window.requestAnimationFrame(poll);
		return () => window.cancelAnimationFrame(frame);
	}, [applyIntent]);

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
									onMouseEnter={() =>
										applyIntent({ type: "focus", id: action.id })
									}
									onFocus={() => applyIntent({ type: "focus", id: action.id })}
									onPointerDown={() => setPressedId(action.id)}
									onPointerUp={() => setPressedId(null)}
									onPointerCancel={() => setPressedId(null)}
								>
									<IconTile
										icone={GLYPHES[action.glyph]}
										libelle={action.label}
										actif={selected}
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
