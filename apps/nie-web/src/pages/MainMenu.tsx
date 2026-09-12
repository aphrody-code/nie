import { GameCanvas, type NomGlyphe, useAssetSource } from "@niers/inacord-ui";
import {
	initialMenuState,
	createStandardGamepadMenuSampler,
	keyboardMenuIntent,
	reduceMenuInteraction,
	type MenuIntent,
	type MenuInteractionItem,
} from "@niers/inacord-ui/shell/menu-interaction";
import type { NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu.ts";
import { NativeSceneLayers, type NativeSceneAssetState } from "@niers/inacord-ui/shell/native-scene-layers";
import { emitNativeCommand } from "@niers/inacord-ui/lib/native-command";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadMenuPresentation } from "../game/bridge";
import { createMenuRuntime, type MenuRuntimeResult } from "../game/menu-runtime";
import "./main-menu.css";
import { GameText } from "@niers/inacord-ui";

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

// title_menu_2_setting.cfg.bin layer IDs; title_menu_2 Lua native item order is
// recorded in the compiled title scene provenance. These are callback identities,
// not nativeActionHash values or an alternative geometry/focus model.
const TITLE_LAYERS = [
	{ id: 2250456639, items: [1, 2, 7, 3, 9, 4, 11, 10] },
	{ id: 3873872512, items: [6, 5, 8] },
] as const;
const TITLE_OBJECT = "data/common/gamedata/menu/obj/title00_07_item_button.objbin";
const AVATAR_OBJECT = "data/common/gamedata/menu/obj/title02_11_avatar_banner.objbin";
function nativeBinding(id: string) {
	if (id === "avatar") return { layer: 1526508152, index: 0, objectPath: AVATAR_OBJECT };
	for (const layer of TITLE_LAYERS) {
		const index = layer.items.findIndex(item => id === `title-item-${item}`);
		if (index >= 0) return { layer: layer.id, index, objectPath: TITLE_OBJECT };
	}
	return null;
}

interface TitleObservation {
	result: MenuRuntimeResult | null;
	state: "loading" | "observed" | "partial" | "unavailable";
	enter: (id: string) => Promise<void>;
}

function ObservedMainMenu(props: MainMenuProps & { scene: NativeMenuScene }) {
	const runtime = useMemo(() => createMenuRuntime("title_menu_2", {
		locale: "fr", itemCounts: { 2250456639: 8, 3873872512: 3 },
	}), []);
	const [result, setResult] = useState<MenuRuntimeResult | null>(null);
	const [state, setState] = useState<TitleObservation["state"]>("loading");
	const mounted = useRef(false);
	const receive = useCallback((value: MenuRuntimeResult) => {
		if (!mounted.current) return;
		setResult(value);
		setState(value.complete ? "observed" : "partial");
	}, []);
	useEffect(() => {
		mounted.current = true;
		void runtime.replay([]).then(receive, () => { if (mounted.current) setState("unavailable"); });
		return () => { mounted.current = false; runtime.abort(); };
	}, [runtime, receive]);
	const enter = useCallback(async (id: string) => {
		const binding = nativeBinding(id);
		if (!binding || !runtime.snapshot?.callbacks.includes("OnEnter")) {
			if (mounted.current) setState("partial");
			return;
		}
		// menu_host.rs passes (layerId, zero-based itemIndex) to OnEnter.
		try { receive(await runtime.dispatch({ callback: "OnEnter", args: [binding.layer, binding.index] })); }
		catch { if (mounted.current) setState("unavailable"); }
	}, [runtime, receive]);
	return <NativeMainMenu {...props} observation={{ result, state, enter }} />;
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
	useEffect(() => {
		if (scene || !props.onCancel) return;
		const cancel = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
			event.preventDefault(); props.onCancel?.();
		};
		window.addEventListener("keydown", cancel);
		return () => window.removeEventListener("keydown", cancel);
	}, [scene, props.onCancel]);
	if (!scene) return (
		<section className="runtime-main-menu" aria-label="Menu principal" aria-busy={!failed}>
			{failed ? <p role="alert">Le menu est indisponible.</p> : null}
			{props.onCancel ? <button type="button" onClick={props.onCancel}><GameText>Retour</GameText></button> : null}
		</section>
	);
	return <ObservedMainMenu scene={scene} {...props} />;
}

/** Presentation of a compiled scene, also used for deterministic host-binding checks. */
export function NativeMainMenu({ scene, actions, onCancel, gamepadSampler, observation }: MainMenuProps & { scene: NativeMenuScene; observation?: TitleObservation }) {
	const source = useAssetSource();
	const boundActions = useMemo(() => scene.controls.map((control) => {
		const host = actions.find((action) => action.id === control.hostActionId);
		const binding = nativeBinding(control.id);
		const nativeLayer = binding && observation?.result?.complete ? observation.result.scene.layers[binding.layer] : undefined;
		return { ...control, disabled: !host || Boolean(host.disabled) || nativeLayer?.enabled === false || nativeLayer?.visible === false, onActivate: host?.onActivate };
	}), [scene, actions, observation?.result]);
	const items = useMemo<MenuInteractionItem[]>(() => boundActions.map((action) => ({
		id: action.id,
		disabled: action.disabled,
		rect: { x: action.rect.x, y: action.rect.y, width: action.rect.w, height: action.rect.h },
	})), [boundActions]);
	const [focusedId, setFocusedId] = useState(() => initialMenuState(items).focusedId);
	const focusState = useRef(initialMenuState(items));
	const [pressedId, setPressedId] = useState<string | null>(null);
	const [assetState, setAssetState] = useState<NativeSceneAssetState>("loading");
	const [canvasReady, setCanvasReady] = useState(false);
	const onCanvasReady = useCallback(() => setCanvasReady(true), []);
	const localGamepadSampler = useRef(createStandardGamepadMenuSampler());
	const sampler = gamepadSampler ?? localGamepadSampler.current;
	const menuRoot = useRef<HTMLElement | null>(null);
	const activationPending = useRef(false);
	const alive = useRef(true);
	useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

	useEffect(() => {
		focusState.current = initialMenuState(items, focusState.current.focusedId);
		setFocusedId(focusState.current.focusedId);
	}, [items]);

	const activate = useCallback((id: string | null) => {
		const action = boundActions.find((candidate) => candidate.id === id);
		if (!action || action.disabled || activationPending.current) return;
		activationPending.current = true;
		const binding = nativeBinding(action.id);
		if (binding) emitNativeCommand(binding.objectPath, "CMD_ENTER");
		const finish = () => {
			try { if (alive.current) action.onActivate?.(); }
			finally { queueMicrotask(() => { activationPending.current = false; }); }
		};
		if (observation) void observation.enter(action.id).then(finish, finish);
		else finish();
	}, [boundActions, observation]);

	const applyIntent = useCallback((intent: MenuIntent) => {
		if (activationPending.current) return;
		const update = reduceMenuInteraction(items, focusState.current, intent);
		if (update.state.focusedId && update.state.focusedId !== focusState.current.focusedId) {
			const binding = nativeBinding(update.state.focusedId);
			const previous = items.findIndex(item => item.id === focusState.current.focusedId);
			const next = items.findIndex(item => item.id === update.state.focusedId);
			if (binding) emitNativeCommand(binding.objectPath, next < previous ? "CMD_FCS_BACK" : "CMD_FCS_NEXT");
		}
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

	return (
		<section ref={menuRoot} aria-label="Menu principal" data-render-source="vfs-layers"
			data-scene-id={scene.id} data-runtime-completeness="partial" data-lua-observation={observation?.state ?? "unmounted"} className="runtime-main-menu">
			<GameCanvas canvas={{ w: scene.canvas.width, h: scene.canvas.height }} fond={scene.background ?? "transparent"} onReady={onCanvasReady}>
				<NativeSceneLayers scene={scene} source={source} focusedId={focusedId}
					className="runtime-main-menu__layer" onStateChange={setAssetState} />
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
