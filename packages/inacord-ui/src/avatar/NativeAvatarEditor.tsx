import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAssetSource } from "../source";
import { GameCanvas } from "../shell/layout-render";
import { createStandardGamepadMenuSampler, initialMenuState, keyboardMenuIntent, reduceMenuInteraction, type MenuInteractionItem, type MenuIntent } from "../shell/menu-interaction";
import { nativeAssetUrl, type NativeMenuScene, type NativeSceneRect } from "../shell/native-title-menu";
import type { AvatarCatalog, AvatarPart, AvatarState } from "./contract";
import "./avatar-editor.css";

export type AvatarStage = "style" | "body" | "hair" | "clothes" | "stats" | "name";
export interface AvatarNameFields { name: string; nickname: string; uniformName: string; shirtNumber: string; }
export interface NativeAvatarEditorProps {
	catalog: AvatarCatalog; state: AvatarState; onStateChange: (state: AvatarState) => void;
	onBack: () => void; stage: AvatarStage; onStageChange: (stage: AvatarStage) => void;
	scene: NativeMenuScene; model: ReactNode;
	nameFields: AvatarNameFields; onNameFieldsChange: (fields: AvatarNameFields) => void;
	/** Colors are unsigned 24-bit RGB; the host packs alpha for its font-renderer ABI. */
	renderText: (text: string, options?: { color?: number; height?: number; width?: number }) => ReactNode;
}
const STAGES: AvatarStage[] = ["style", "body", "hair", "clothes", "stats", "name"];
/** Native chara_edit_list_menu order and resolved faceSettingType categories. */
const FACE_CATEGORIES = [1, 2, 3, 4, 6, 9, 10, 11, 12, 13];
const fieldNames = ["name", "nickname", "uniformName", "shirtNumber"] as const;
const position = (r: NativeSceneRect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

/** Host-neutral interactive view; all placement is supplied by the engine scene. */
export function NativeAvatarEditor({ catalog, state, onStateChange, onBack, stage, onStageChange, scene, model, nameFields, onNameFieldsChange, renderText }: NativeAvatarEditorProps) {
	const source = useAssetSource();
	const root = useRef<HTMLElement>(null);
	const [categoryIndex, setCategoryIndex] = useState(0);
	const [page, setPage] = useState(0);
	const [bodyPage, setBodyPage] = useState(0);
	const [focused, setFocused] = useState<string | null>(null);
	const [assetFailed, setAssetFailed] = useState(false);
	const sampler = useRef(createStandardGamepadMenuSampler());
	const category = FACE_CATEGORIES[categoryIndex] ?? 1;
	const filteredParts = useCallback((type: number) => (catalog.categories.find(c => c.faceSettingType === type)?.parts ?? [])
		.filter(part => !part.gender || part.gender === state.gender + 1), [catalog, state.gender]);
	const faceParts = useMemo(() => filteredParts(category), [filteredParts, category]);
	const bodyParts = useMemo(() => filteredParts(17), [filteredParts]);
	const visibleParts = faceParts.slice(page * 9, page * 9 + 9), visibleBodies = bodyParts.slice(bodyPage * 3, bodyPage * 3 + 3);
	const selectedParts = new Set<string>([`stage-${stage}`, `gender${state.gender}`, `category-${categoryIndex}`]);
	visibleParts.forEach((part, i) => { if (state.selections[category] === part.id) selectedParts.add(`part-slot-${i}`); });
	visibleBodies.forEach((part, i) => { if (state.selections[17] === part.id) selectedParts.add(`body-slot-${i}`); });
	for (const type of [19, 20, 21]) filteredParts(type).forEach((part, i) => { if (state.selections[type] === part.id) selectedParts.add(`clothing-${type}-${i}`); });
	const partForAction = useCallback((id: string): { category: number; part: AvatarPart } | null => {
		if (id.startsWith("part-slot-")) { const part = visibleParts[Number(id.slice(10))]; return part ? { category, part } : null; }
		if (id.startsWith("body-slot-")) { const part = visibleBodies[Number(id.slice(10))]; return part ? { category: 17, part } : null; }
		const match = /^clothing-(\d+)-(\d+)$/.exec(id);
		if (match) { const type = Number(match[1]), part = filteredParts(type)[Number(match[2])]; return part ? { category: type, part } : null; }
		return null;
	}, [category, filteredParts, visibleBodies, visibleParts]);
	const enabled = useCallback((id: string) => {
		if (id === "back" || id.startsWith("stage-") || id.startsWith("gender") || id === "height" || fieldNames.some(field => field === id)) return true;
		if (id === "next") return stage !== "name";
		if (id === "parts-prev") return page > 0;
		if (id === "parts-next") return (page + 1) * 9 < faceParts.length;
		if (id === "body-prev") return bodyPage > 0;
		if (id === "body-next") return (bodyPage + 1) * 3 < bodyParts.length;
		if (id.startsWith("category-")) {
			const type = FACE_CATEGORIES[Number(id.slice(9))];
			return stage === "hair" && type !== undefined && filteredParts(type).length > 0;
		}
		return Boolean(partForAction(id));
	}, [stage, page, bodyPage, faceParts.length, bodyParts.length, filteredParts, partForAction]);
	const controls = scene.controls.map(control => ({ ...control, disabled: !enabled(control.id) }));
	const items: MenuInteractionItem[] = controls.map(control => ({ id: control.id, disabled: control.disabled,
		rect: { x: control.rect.x, y: control.rect.y, width: control.rect.w, height: control.rect.h } }));
	const navigation = useRef(initialMenuState(items));
	const activate = useCallback((id: string | null) => {
		if (!id || !enabled(id)) return;
		if (id === "back") { onBack(); return; }
		if (id === "next") { const next = STAGES[STAGES.indexOf(stage) + 1]; if (next) onStageChange(next); return; }
		if (id.startsWith("stage-")) { onStageChange(id.slice(6) as AvatarStage); return; }
		if (id === "gender0" || id === "gender1") { const selections = { ...state.selections }; delete selections[17]; onStateChange({ ...state, selections, gender: id === "gender0" ? 0 : 1 }); setBodyPage(0); return; }
		if (id.startsWith("category-")) { setCategoryIndex(Number(id.slice(9))); setPage(0); return; }
		if (id === "parts-prev" || id === "parts-next") { setPage(p => p + (id === "parts-next" ? 1 : -1)); return; }
		if (id === "body-prev" || id === "body-next") { setBodyPage(p => p + (id === "body-next" ? 1 : -1)); return; }
		const option = partForAction(id);
		if (option) {
			// Native presets replace the facial recipe; explicit body state is retained.
			const selections: Record<number, string> = option.category === 1 ? { 1: option.part.id } : { ...state.selections, [option.category]: option.part.id };
			if (option.category === 1 && state.selections[17]) selections[17] = state.selections[17];
			onStateChange({ ...state, selections });
		}
	}, [enabled, onBack, onStageChange, stage, state, onStateChange, partForAction]);
	const applyIntent = useCallback((intent: MenuIntent) => {
		const result = reduceMenuInteraction(items, navigation.current, intent); navigation.current = result.state; setFocused(result.state.focusedId);
		if (result.activatedId) activate(result.activatedId); if (result.cancelled) onBack();
	}, [items, activate, onBack]);
	useEffect(() => { setCategoryIndex(0); setPage(0); setAssetFailed(false); navigation.current = initialMenuState(items, `stage-${stage}`); setFocused(navigation.current.focusedId); }, [stage, scene.id]);
	useEffect(() => { navigation.current = initialMenuState(items, navigation.current.focusedId); }, [items]);
	useEffect(() => { if (focused) root.current?.querySelector<HTMLButtonElement>(`button[data-avatar-control="${focused}"]`)?.focus({ preventScroll: true }); }, [focused]);
	useEffect(() => {
		if (typeof navigator.getGamepads !== "function") return;
		let frame = 0; const sample = () => { for (const intent of sampler.current.sample(navigator.getGamepads())) applyIntent(intent); frame = requestAnimationFrame(sample); };
		frame = requestAnimationFrame(sample); return () => cancelAnimationFrame(frame);
	}, [applyIntent]);
	const slot = (id: string) => scene.slots?.find(s => s.id === id);
	const dynamicIcon = (id: string, part: AvatarPart) => {
		const target = slot(`${id}-icon`), atlas = part.icone?.match(/^(icon_ava_(?:face\d{2}|body\d{2}|uniform\d{2}|gender\d{2}))_/i)?.[1];
		if (!target || !atlas || !part.icone) return null;
		const url = nativeAssetUrl(source, `data/dx11/menu/200_icon/21_icon_avatar/${atlas}.g4tx`, part.icone);
		return url ? <img key={`${id}-icon`} className="native-avatar-editor__image" src={url} alt="" draggable={false} data-native-region={part.icone} data-avatar-part={part.id} style={{ ...position(target.rect), zIndex: 250 }} onError={() => setAssetFailed(true)} /> : null;
	};
	const number = (id: string, part: AvatarPart) => {
		const target = slot(`${id}-number`); return target ? <div key={`${id}-number`} className="native-avatar-editor__text" style={{ ...position(target.rect), zIndex: 510 }}>{renderText(String(part.itemNo).padStart(2, "0"), { color: 0x686b70, height: target.rect.h, width: target.rect.w })}</div> : null;
	};
	const modelSlot = slot("model");
	return <section ref={root} className="native-avatar-editor" aria-label="Éditeur d’avatar" data-avatar-stage={stage} data-scene-id={scene.id} data-render-source="vfs-layers"
		onKeyDown={event => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.key === "Escape") return;
			if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.tagName === "CANVAS")) return;
			const intent = keyboardMenuIntent(event.key); if (!intent) return;
			event.preventDefault(); event.stopPropagation(); if (!event.repeat || intent.type !== "activate") applyIntent(intent);
		}}>
		<GameCanvas canvas={{ w: scene.canvas.width, h: scene.canvas.height }} fond={scene.background ?? "transparent"}>
			{scene.layers.map(layer => {
				const selected = Boolean(layer.actionId && selectedParts.has(layer.actionId));
				const active = layer.id.endsWith("-check") || layer.actionId?.startsWith("stage-") ? selected : selected || focused === layer.actionId;
				if (layer.visibleWhen === "focused" && !active) return null;
				const region = active && layer.focusedRegion ? layer.focusedRegion : layer.region, url = nativeAssetUrl(source, layer.assetPath, region); if (!url) return null;
				const mask = layer.maskRegion ? nativeAssetUrl(source, layer.assetPath, layer.maskRegion) : null;
				return <img key={layer.id} className="native-avatar-editor__image" src={url} alt="" aria-hidden="true" draggable={false} data-native-layer={layer.id} data-native-region={region}
					style={{ ...position(layer.rect), zIndex: layer.drawOrder, transform: layer.rotationDeg ? `rotate(${layer.rotationDeg}deg)` : undefined,
						maskImage: mask ? `url("${mask}")` : undefined, maskMode: layer.maskMode, maskSize: "100% 100%", maskRepeat: "no-repeat" }} onError={() => setAssetFailed(true)} />;
			})}
			{modelSlot ? <div className="native-avatar-editor__model" style={{ ...position(modelSlot.rect), zIndex: 100 }}>{model}</div> : null}
			{stage === "body" ? visibleBodies.flatMap((part, i) => [dynamicIcon(`body-slot-${i}`, part), number(`body-slot-${i}`, part)]) : null}
			{stage === "hair" ? visibleParts.flatMap((part, i) => [dynamicIcon(`part-slot-${i}`, part), number(`part-slot-${i}`, part)]) : null}
			{stage === "clothes" ? [19, 20, 21].flatMap(type => filteredParts(type).map((part, i) => dynamicIcon(`clothing-${type}-${i}`, part))) : null}
			{scene.texts?.map(text => {
				let value = text.text; if (text.id === "selection-label") value = state.gender === 0 ? "Masculin" : "Féminin";
				if (text.id === "panel-heading" && stage === "hair") value = scene.controls.find(c => c.id === `category-${categoryIndex}`)?.label ?? value;
				if (text.id === "next-label" && stage === "name") value = "Terminé";
				return <div key={text.id} className="native-avatar-editor__text" data-native-text={text.id} style={{ ...position(text.rect), zIndex: text.drawOrder }}>{renderText(value, { color: text.color, height: text.rect.h, width: text.rect.w })}</div>;
			})}
			{controls.map(control => {
				if (fieldNames.some(field => field === control.id)) {
					const field = control.id as keyof AvatarNameFields, rect = slot(`${field}-text`)?.rect ?? control.rect;
					return <div key={field}>
						<div className="native-avatar-editor__text native-avatar-editor__field-text" style={{ ...position(rect), zIndex: 715 }}>
							{renderText(nameFields[field], { color: 0x087fff, height: rect.h, width: rect.w })}
						</div>
						<input className="native-avatar-editor__name" aria-label={control.label} data-avatar-field={field} style={position(rect)} value={nameFields[field]} inputMode={field === "shirtNumber" ? "numeric" : "text"} onFocus={() => setFocused(field)} onChange={event => onNameFieldsChange({ ...nameFields, [field]: event.target.value })} />
					</div>;
				}
				if (control.id === "height") return <input key="height" type="range" className="native-avatar-editor__height" data-avatar-control="height" aria-label={control.label} style={position(control.rect)} min={0} max={14} step={1} value={state.height ?? 7} onChange={event => onStateChange({ ...state, height: Number(event.target.value) })} />;
				const option = partForAction(control.id), label = option ? `${control.label} — ${option.part.itemNo}` : control.label;
				return <button key={control.id} type="button" className="native-avatar-editor__control" data-avatar-control={control.id} style={position(control.rect)} aria-label={label} aria-pressed={selectedParts.has(control.id)} disabled={control.disabled} aria-disabled={control.disabled} title={control.disabled ? `${label} — indisponible` : label}
					onPointerEnter={() => { if (!control.disabled) applyIntent({ type: "focus", id: control.id }); }} onFocus={() => { if (!control.disabled && navigation.current.focusedId !== control.id) applyIntent({ type: "focus", id: control.id }); }} onClick={() => activate(control.id)} />;
			})}
			{assetFailed ? <p className="native-avatar-editor__error" role="alert">Certaines ressources visuelles sont indisponibles.</p> : null}
		</GameCanvas>
	</section>;
}
