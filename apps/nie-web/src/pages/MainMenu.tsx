import { GameCanvas, type NomGlyphe, useAssetSource } from "@niers/inacord-ui";
import {
	initialMenuState,
	createStandardGamepadMenuSampler,
	keyboardMenuIntent,
	reduceMenuInteraction,
	type MenuIntent,
	type MenuInteractionItem,
} from "@niers/inacord-ui/shell/menu-interaction";
import {
	nativeAssetUrl,
	type NativeMenuScene,
} from "@niers/inacord-ui/shell/native-title-menu.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadMenuPresentation } from "../game/bridge";
import "./main-menu.css";

export interface MainMenuAction {
	id: string;
	label: string;
	/** Compatibility with the host catalogue; native presentation owns its actual icon. */
	glyph: NomGlyphe;
	onActivate: () => void;
	disabled?: boolean;
}

export interface MainMenuProps {
	actions: readonly MainMenuAction[];
	onCancel?: () => void;
	gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler>;
}

/** The browser supplies destinations; the engine supplies the native scene and control identities. */
export function MainMenu(props: MainMenuProps) {
	const [scene, setScene] = useState<NativeMenuScene | null>(null);
	const [failed, setFailed] = useState(false);
	useEffect(() => {
		let mounted = true;
		loadMenuPresentation("title-menu").then(
			(value) => { if (mounted) setScene(value); },
			() => { if (mounted) setFailed(true); },
		);
		return () => { mounted = false; };
	}, []);
	if (!scene) return (
		<section className="runtime-main-menu" aria-label="Menu principal" aria-busy={!failed}>
			{failed ? <p role="alert">Le menu est indisponible.</p> : null}
		</section>
	);
	return <NativeMainMenu scene={scene} {...props} />;
}

/** Presentation of a compiled scene, also used for deterministic host-binding checks. */
export function NativeMainMenu({ scene, actions, onCancel, gamepadSampler }: MainMenuProps & { scene: NativeMenuScene }) {
	const source = useAssetSource();
	const boundActions = useMemo(() => scene.controls.map((control) => {
		const host = actions.find((action) => action.id === control.hostActionId);
		return { ...control, disabled: !host || Boolean(host.disabled), onActivate: host?.onActivate };
	}), [scene, actions]);
	const items = useMemo<MenuInteractionItem[]>(() => boundActions.map((action) => ({
		id: action.id,
		disabled: action.disabled,
		rect: { x: action.rect.x, y: action.rect.y, width: action.rect.w, height: action.rect.h },
	})), [boundActions]);
	const [focusedId, setFocusedId] = useState(() => initialMenuState(items).focusedId);
	const focusState = useRef(initialMenuState(items));
	const [pressedId, setPressedId] = useState<string | null>(null);
	const [failedAssets, setFailedAssets] = useState(false);
	const [loadedLayers, setLoadedLayers] = useState<ReadonlySet<string>>(() => new Set());
	const [canvasReady, setCanvasReady] = useState(false);
	const onCanvasReady = useCallback(() => setCanvasReady(true), []);
	const localGamepadSampler = useRef(createStandardGamepadMenuSampler());
	const sampler = gamepadSampler ?? localGamepadSampler.current;
	const menuRoot = useRef<HTMLElement | null>(null);
	const activationPending = useRef(false);

	useEffect(() => {
		focusState.current = initialMenuState(items, focusState.current.focusedId);
		setFocusedId(focusState.current.focusedId);
	}, [items]);

	const activate = useCallback((id: string | null) => {
		const action = boundActions.find((candidate) => candidate.id === id);
		if (!action || action.disabled || activationPending.current) return;
		activationPending.current = true;
		try { action.onActivate?.(); }
		finally { queueMicrotask(() => { activationPending.current = false; }); }
	}, [boundActions]);

	const applyIntent = useCallback((intent: MenuIntent) => {
		if (activationPending.current) return;
		const update = reduceMenuInteraction(items, focusState.current, intent);
		focusState.current = update.state;
		setFocusedId(update.state.focusedId);
		if (update.activatedId) activate(update.activatedId);
		if (update.cancelled) onCancel?.();
	}, [activate, items, onCancel]);

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
		if (!focusedId || !canvasReady) return;
		const target = menuRoot.current?.querySelector<HTMLButtonElement>(`[data-menu-target="${CSS.escape(focusedId)}"] button`);
		if (target && document.activeElement !== target) target.focus({ preventScroll: true });
	}, [focusedId, canvasReady]);

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

	const visibleLayers = scene.layers.filter((layer) => layer.visibleWhen !== "focused" || layer.actionId === focusedId);
	const assetState = failedAssets ? "failed" : visibleLayers.every((layer) => loadedLayers.has(layer.id)) ? "ready" : "loading";
	return (
		<section ref={menuRoot} aria-label="Menu principal" data-render-source="vfs-layers"
			data-scene-id={scene.id} data-runtime-completeness="partial" className="runtime-main-menu">
			<GameCanvas canvas={{ w: scene.canvas.width, h: scene.canvas.height }} fond={scene.background ?? "transparent"} onReady={onCanvasReady}>
				{visibleLayers.map((layer) => {
					const selected = layer.actionId === focusedId;
					const region = selected && layer.focusedRegion ? layer.focusedRegion : layer.region;
					const url = nativeAssetUrl(source, layer.assetPath, region);
					const mask = layer.maskRegion ? nativeAssetUrl(source, layer.assetPath, layer.maskRegion) : null;
					return url ? <img key={layer.id} src={url} alt="" aria-hidden="true" draggable={false}
						data-native-layer={layer.id} data-native-region={region}
						className="runtime-main-menu__layer"
						style={{ left: layer.rect.x, top: layer.rect.y, width: layer.rect.w, height: layer.rect.h,
							zIndex: layer.drawOrder, transform: layer.rotationDeg ? `rotate(${layer.rotationDeg}deg)` : undefined,
							maskImage: mask ? `url("${mask}")` : undefined, maskSize: mask ? "100% 100%" : undefined,
							maskMode: mask ? layer.maskMode : undefined,
							maskRepeat: mask ? "no-repeat" : undefined }}
						onLoad={() => setLoadedLayers((loaded) => new Set([...loaded, layer.id]))}
						onError={() => setFailedAssets(true)} /> : null;
				})}
				{boundActions.map((action) => <div key={action.id} data-menu-target={action.id}
					data-host-action={action.hostActionId} data-native-action={action.nativeActionHash}
					className="runtime-main-menu__control"
					style={{ left: action.rect.x, top: action.rect.y, width: action.rect.w, height: action.rect.h }}>
					<button type="button" aria-label={action.label} aria-current={focusedId === action.id ? "true" : undefined}
						aria-disabled={action.disabled} disabled={action.disabled}
						title={action.disabled ? `${action.label} — indisponible` : action.label}
						data-state={pressedId === action.id ? "pressed" : focusedId === action.id ? "focused" : "idle"}
						onPointerEnter={() => applyIntent({ type: "focus", id: action.id })}
						onFocus={() => applyIntent({ type: "focus", id: action.id })}
						onPointerDown={(event) => { if (event.button === 0 && !action.disabled) setPressedId(action.id); }}
						onPointerLeave={() => setPressedId(null)} onClick={() => activate(action.id)} />
				</div>)}
				<span className="runtime-main-menu__asset-state" data-state={assetState} aria-live="polite">
					{assetState === "failed" ? "Ressources visuelles indisponibles." : ""}
				</span>
			</GameCanvas>
		</section>
	);
}
