import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useAssetSource } from "../source";
import { GameCanvas } from "../shell/game-canvas";
import { createStandardGamepadMenuSampler, initialMenuState, keyboardMenuIntent, reduceMenuInteraction, type MenuInteractionItem, type MenuIntent } from "../shell/menu-interaction";
import { NativeSceneLayers, type NativeSceneAssetState } from "../shell/native-scene-layers";
import type { NativeMenuScene, NativeSceneRect } from "../shell/native-title-menu";
import { NativeSprite } from "../shell/native-sprite";
import { GameText, useGameText } from "../lib/game-text-context";
import type { AvatarCatalog, AvatarPart, AvatarProfile, AvatarState } from "./contract";
import "./avatar-editor.css";

export type AvatarStage = "style" | "body" | "hair" | "stats" | "name";
export interface NativeAvatarEditorProps {
	/** Keep the host sampler across route transitions to consume held buttons only once. */
	gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler>;
	catalog: AvatarCatalog; state: AvatarState; onStateChange: (state: AvatarState) => void;
	onBack: () => void; stage: AvatarStage; onStageChange: (stage: AvatarStage) => void;
	scene: NativeMenuScene; model: ReactNode;
	/** Colors are unsigned 24-bit RGB; the host packs alpha for its font-renderer ABI. */
	renderText: (text: string, options?: { color?: number; height?: number; width?: number }) => ReactNode;
}
const STAGES: AvatarStage[] = ["style", "body", "hair", "stats", "name"];
/** Native chara_edit_list_menu order. Category 2 is hidden: Rust reports it unsupported. */
const FACE_CATEGORIES: readonly (number | null)[] = [1, null, 3, 4, 6, 9, 10, 11, 12, 13];
/** Only these palettes currently reach the GLB transport (`tint`/`hair`). */
const COLOR_CATEGORIES = new Set([3, 4, 6]);
const UNAVAILABLE_STAGE_ID = "stage-clothes";
const PROFILE_FIELDS = ["name", "nickname", "uniformName", "shirtNumber"] as const;
type ProfileField = typeof PROFILE_FIELDS[number];
const PROFILE_STATS = [
	["kick", "Frappe", 279],
	["control", "Contrôle", 265],
	["technique", "Technique", 267],
	["pressure", "Pression", 250],
	["physical", "Physique", 242],
	["agility", "Agilité", 256],
	["intelligence", "Intelligence", 279],
] as const satisfies readonly (readonly [keyof AvatarProfile, string, number])[];
const POSITION_LABELS = ["GK", "FW", "MF", "DF"];
const position = (r: NativeSceneRect): CSSProperties => ({ left: r.x, top: r.y, width: r.w, height: r.h });

function LocalizedNativeText({ text, renderText, options }: {
	text: string;
	renderText: NativeAvatarEditorProps["renderText"];
	options?: { color?: number; height?: number; width?: number };
}) {
	return <>{renderText(useGameText(text), options)}</>;
}

/** Host-neutral interactive view; all placement is supplied by the engine scene. */
export function NativeAvatarEditor({ catalog, state, onStateChange, onBack, stage, onStageChange, scene, model, renderText, gamepadSampler }: NativeAvatarEditorProps) {
	const source = useAssetSource();
	const personalityLabel = useGameText("Personnalité");
	const voiceLabel = useGameText("Voix");
	const root = useRef<HTMLElement>(null);
	const [categoryIndex, setCategoryIndex] = useState(0);
	const [page, setPage] = useState(0);
	const [panelMode, setPanelMode] = useState<"parts" | "colors">("parts");
	const [statsMode, setStatsMode] = useState<"base" | "personality" | "voice">("base");
	const [bodyPage, setBodyPage] = useState(0);
	const [focused, setFocused] = useState<string | null>(null);
	const [assetFailed, setAssetFailed] = useState(false);
	const [sceneAssets, setSceneAssets] = useState<{ stage: AvatarStage; sceneId: string; state: NativeSceneAssetState } | null>(null);
	const localSampler = useRef(createStandardGamepadMenuSampler());
	const sampler = gamepadSampler ?? localSampler.current;
	const category = FACE_CATEGORIES[categoryIndex] ?? 1;
	const categoryData = catalog.categories.find(c => c.faceSettingType === category);
	const filteredParts = useCallback((type: number) => (catalog.categories.find(c => c.faceSettingType === type)?.parts ?? [])
		.filter(part => !part.gender || part.gender === state.gender + 1)
		.filter(part => {
			if (type !== 17) return true;
			const base = part.resource.replace(/^edit_body_/, "");
			const morphology = base === "male" && state.gender === 1 ? "female" : base === "female" && state.gender === 0 ? "male" : base;
			return catalog.modelesDeBase.morphologies.includes(morphology)
				&& (catalog.categories.find(category => category.faceSettingType === 17)?.parts ?? []).some(candidate => candidate.resource === `edit_body_${morphology}`);
		}), [catalog, state.gender]);
	const faceParts = useMemo(() => filteredParts(category), [filteredParts, category]);
	const palette = useMemo(() => COLOR_CATEGORIES.has(category) ? (categoryData?.couleurs ?? []).flatMap((id, index) => {
		const rgb = catalog.couleursRgb?.[id]?.rgb;
		return rgb && /^[0-9a-f]{6}$/i.test(rgb) ? [{ id, index, rgb: rgb.toUpperCase() }] : [];
	}) : [], [catalog.couleursRgb, category, categoryData]);
	const bodyParts = useMemo(() => filteredParts(17), [filteredParts]);
	const panelItems = panelMode === "colors" ? palette : faceParts;
	const visiblePanelItems = panelItems.slice(page * 9, page * 9 + 9);
	const visibleParts = panelMode === "parts" ? visiblePanelItems as AvatarPart[] : [];
	const visibleColors = panelMode === "colors" ? visiblePanelItems as { id: string; index: number; rgb: string }[] : [];
	const visibleBodies = bodyParts.slice(bodyPage * 3, bodyPage * 3 + 3);
	const selectedParts = new Set<string>([`stage-${stage}`, `gender${state.gender}`, `category-${categoryIndex}`]);
	if (state.profile.element !== null) selectedParts.add(`element-${state.profile.element}`);
	visibleParts.forEach((part, i) => { if (state.selections[category] === part.id) selectedParts.add(`part-slot-${i}`); });
	visibleColors.forEach((color, i) => { if (state.paletteSelections[category] === color.index) selectedParts.add(`part-slot-${i}`); });
	visibleBodies.forEach((part, i) => { if (state.selections[17] === part.id) selectedParts.add(`body-slot-${i}`); });
	const partForAction = useCallback((id: string): { category: number; part: AvatarPart } | null => {
		if (id.startsWith("part-slot-")) { const part = visibleParts[Number(id.slice(10))]; return part ? { category, part } : null; }
		if (id.startsWith("body-slot-")) { const part = visibleBodies[Number(id.slice(10))]; return part ? { category: 17, part } : null; }
		return null;
	}, [category, visibleBodies, visibleParts]);
	const enabled = useCallback((id: string) => {
		if (id === UNAVAILABLE_STAGE_ID || (stage === "hair" && id === "category-1")) return false;
		if (id === "back" || id.startsWith("gender") || id === "height") return true;
		if (id.startsWith("stage-")) return STAGES.includes(id.slice(6) as AvatarStage);
		if (id === "next") return STAGES.indexOf(stage) < STAGES.length - 1;
		if (PROFILE_FIELDS.includes(id as ProfileField)) return stage === "name";
		if (id.startsWith("element-")) return stage === "stats" && statsMode === "base";
		if (id.startsWith("stat-value-")) return stage === "stats" && statsMode === "base";
		if (stage === "stats" && id.startsWith("category-")) {
			const index = Number(id.slice(9));
			return index === 0 || (index === 1 && (catalog.personnalites?.length ?? 0) > 0)
				|| (index === 2 && (catalog.voix?.some(voice => voice.genre === state.gender + 1) ?? false));
		}
		if (id === "parts-prev") return page > 0;
		if (id === "parts-next") return (page + 1) * 9 < panelItems.length;
		if (id === "body-prev") return bodyPage > 0;
		if (id === "body-next") return (bodyPage + 1) * 3 < bodyParts.length;
		if (id.startsWith("category-")) {
			const type = FACE_CATEGORIES[Number(id.slice(9))];
			return stage === "hair" && type !== null && type !== undefined && filteredParts(type).length > 0;
		}
		if (panelMode === "colors" && id.startsWith("part-slot-")) return Boolean(visibleColors[Number(id.slice(10))]);
		return Boolean(partForAction(id));
	}, [stage, statsMode, catalog.personnalites, catalog.voix, state.gender, page, bodyPage, panelItems.length, bodyParts.length, filteredParts, panelMode, visibleColors, partForAction]);
	const controls = scene.controls.flatMap(control => control.id === UNAVAILABLE_STAGE_ID
		? [{ ...control, disabled: true, label: `${control.label} — indisponible (assemblage GLB non pris en charge)` }]
		: enabled(control.id) ? [{ ...control, disabled: false }] : []);
	const items: MenuInteractionItem[] = controls.map(control => ({ id: control.id, disabled: control.disabled,
		rect: { x: control.rect.x, y: control.rect.y, width: control.rect.w, height: control.rect.h } }));
	const navigation = useRef(initialMenuState(items));
	const activate = useCallback((id: string | null) => {
		if (!id || !enabled(id)) return;
		if (id === "back") { onBack(); return; }
		if (id === "next") { const next = STAGES[STAGES.indexOf(stage) + 1]; if (next) onStageChange(next); return; }
		if (id.startsWith("stage-")) { onStageChange(id.slice(6) as AvatarStage); return; }
		if (id === "gender0" || id === "gender1") {
			const gender = id === "gender0" ? 0 : 1;
			const selections = { ...state.selections };
			delete selections[17];
			const voice = state.profile.voice;
			const profile = voice !== null && catalog.voix?.[voice]?.genre !== gender + 1 ? { ...state.profile, voice: null } : state.profile;
			onStateChange({ ...state, selections, gender, profile });
			setBodyPage(0);
			return;
		}
		if (stage === "stats" && id.startsWith("category-")) {
			const index = Number(id.slice(9));
			const mode = (["base", "personality", "voice"] as const)[index];
			if (mode) { setStatsMode(mode); setCategoryIndex(index); }
			return;
		}
		if (stage === "stats" && id.startsWith("element-")) {
			onStateChange({ ...state, profile: { ...state.profile, element: Number(id.slice(8)) } });
			return;
		}
		if (stage === "stats" && id.startsWith("stat-value-")) {
			const row = Number(id.slice(11));
			const field = (["mainPosition", "subPosition", "buildType"] as const)[row];
			if (!field) return;
			const current = state.profile[field];
			const maximum = field === "buildType" ? 5 : 4;
			const next = field === "buildType" ? ((current ?? -1) + 1) % (maximum + 1) : ((current ?? 0) % maximum) + 1;
			onStateChange({ ...state, profile: { ...state.profile, [field]: next } });
			return;
		}
		if (id.startsWith("category-")) {
			const nextIndex = Number(id.slice(9));
			const nextCategory = FACE_CATEGORIES[nextIndex];
			setCategoryIndex(nextIndex);
			setPanelMode(nextCategory !== null && nextCategory !== undefined && COLOR_CATEGORIES.has(nextCategory) && filteredParts(nextCategory).length <= 1 ? "colors" : "parts");
			setPage(0);
			return;
		}
		if (id === "parts-prev" || id === "parts-next") { setPage(p => p + (id === "parts-next" ? 1 : -1)); return; }
		if (id === "body-prev" || id === "body-next") { setBodyPage(p => p + (id === "body-next" ? 1 : -1)); return; }
		if (panelMode === "colors" && id.startsWith("part-slot-")) {
			const color = visibleColors[Number(id.slice(10))];
			if (!color) return;
			const paletteSelections = { ...state.paletteSelections, [category]: color.index };
			const customColors = { ...state.customColors };
			delete customColors[category];
			onStateChange({ ...state, paletteSelections, customColors });
			return;
		}
		const option = partForAction(id);
		if (option) {
			// Native presets replace the facial recipe; explicit body state is retained.
			const selections: Record<number, string> = option.category === 1 ? { 1: option.part.id } : { ...state.selections, [option.category]: option.part.id };
			if (option.category === 1 && state.selections[17]) selections[17] = state.selections[17];
			onStateChange({ ...state, selections });
		}
	}, [enabled, onBack, onStageChange, stage, state, onStateChange, partForAction, panelMode, visibleColors, category, filteredParts, catalog.voix]);
	const applyIntent = useCallback((intent: MenuIntent) => {
		if (navigation.current.focusedId === "height" && intent.type === "move" && (intent.direction === "left" || intent.direction === "right")) {
			const height = Math.max(0, Math.min(14, (state.height ?? 7) + (intent.direction === "right" ? 1 : -1)));
			if (height !== state.height) onStateChange({ ...state, height });
			return;
		}
		const result = reduceMenuInteraction(items, navigation.current, intent); navigation.current = result.state; setFocused(result.state.focusedId);
		if (result.activatedId) activate(result.activatedId); if (result.cancelled) onBack();
	}, [items, activate, onBack, state, onStateChange]);
	useEffect(() => { setCategoryIndex(0); setPage(0); setPanelMode("parts"); setStatsMode("base"); setAssetFailed(false); navigation.current = initialMenuState(items, `stage-${stage}`); setFocused(navigation.current.focusedId); }, [stage, scene.id]);
	useEffect(() => { navigation.current = initialMenuState(items, navigation.current.focusedId); }, [items]);
	useEffect(() => { if (focused) root.current?.querySelector<HTMLElement>(`[data-avatar-control="${focused}"]`)?.focus({ preventScroll: true }); }, [focused]);
	useEffect(() => {
		if (typeof navigator.getGamepads !== "function") return;
		let frame = 0; const sample = () => { for (const intent of sampler.sample(navigator.getGamepads())) applyIntent(intent); frame = requestAnimationFrame(sample); };
		frame = requestAnimationFrame(sample); return () => cancelAnimationFrame(frame);
	}, [applyIntent, sampler]);
	const slot = (id: string) => scene.slots?.find(s => s.id === id);
	const dynamicIcon = (id: string, part: AvatarPart) => {
		const target = slot(`${id}-icon`), atlas = part.icone?.match(/^(icon_ava_(?:face\d{2}|body\d{2}|uniform\d{2}|gender\d{2}))_/i)?.[1];
		if (!target || !atlas || !part.icone) return null;
		return <NativeSprite key={`${id}-icon`} source={source} assetPath={`data/dx11/menu/200_icon/21_icon_avatar/${atlas}.g4tx`}
			region={part.icone} rect={target.rect} drawOrder={250} className="native-avatar-editor__image"
			partId={part.id} onError={() => setAssetFailed(true)} />;
	};
	const number = (id: string, part: AvatarPart) => {
		const target = slot(`${id}-number`); return target ? <div key={`${id}-number`} className="native-avatar-editor__text" style={{ ...position(target.rect), zIndex: 510 }}>{renderText(String(part.itemNo).padStart(2, "0"), { color: 0x686b70, height: target.rect.h, width: target.rect.w })}</div> : null;
	};
	const modelSlot = slot("model");
	const statusLabels = catalog.panneaux?.find(panel => panel.nom === "chara_edit_parts_menu_status")?.libelles.map(label => label.libelle) ?? [];
	const buildLabels = statusLabels.slice(4, 10);
	const voices = (catalog.voix ?? []).map((voice, index) => ({ voice, index })).filter(({ voice }) => voice.genre === state.gender + 1);
	const profileValue = (id: string) => {
		if (id === "stat-value-0") return state.profile.mainPosition === null ? "—" : POSITION_LABELS[state.profile.mainPosition - 1] ?? String(state.profile.mainPosition);
		if (id === "stat-value-1") return state.profile.subPosition === null ? "—" : POSITION_LABELS[state.profile.subPosition - 1] ?? String(state.profile.subPosition);
		if (id === "stat-value-2") return state.profile.buildType === null ? "—" : buildLabels[state.profile.buildType] ?? String(state.profile.buildType + 1);
		return "";
	};
	const presentationScene = useMemo<NativeMenuScene>(() => {
		const controlIds = scene.controls.map(control => control.id).sort((left, right) => right.length - left.length);
		const layerControl = (id: string) => controlIds.find(controlId => id === controlId || id.startsWith(`${controlId}-`));
		return {
			...scene,
			controls,
			layers: scene.layers.filter(layer => {
				const controlId = layer.actionId ?? layerControl(layer.id);
					return !controlId || controlId === UNAVAILABLE_STAGE_ID || enabled(controlId);
			}),
			texts: scene.texts?.filter(text => {
				if (text.id === "category-1-label" && stage === "hair") return false;
				if (text.id === "next-label" && stage === STAGES.at(-1)) return false;
				return true;
			}),
		};
	}, [scene, controls, enabled, stage]);
	const activeLayerIds = new Set(scene.layers.filter(layer => {
		const selected = Boolean(layer.actionId && selectedParts.has(layer.actionId));
		return layer.id.endsWith("-check") || layer.actionId?.startsWith("stage-") ? selected : selected || focused === layer.actionId;
	}).map(layer => layer.id));
	const unavailableControl = controls.find(control => control.id === UNAVAILABLE_STAGE_ID);
	const sceneAssetFailed = sceneAssets?.stage === stage && sceneAssets.sceneId === scene.id && sceneAssets.state === "failed";
	return <section ref={root} className="native-avatar-editor" aria-label="Éditeur d’avatar" data-avatar-stage={stage} data-scene-id={scene.id} data-render-source="vfs-layers"
		onKeyDown={event => {
			if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
			if (event.key === "Escape") {
				if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')) return;
				event.preventDefault(); event.stopPropagation(); if (!event.repeat) applyIntent({ type: "cancel" }); return;
			}
			if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || (event.target instanceof HTMLElement && event.target.tagName === "CANVAS")) return;
			const intent = keyboardMenuIntent(event.key); if (!intent) return;
			event.preventDefault(); event.stopPropagation(); if (!event.repeat || intent.type !== "activate") applyIntent(intent);
		}}>
			<GameCanvas canvas={{ w: scene.canvas.width, h: scene.canvas.height }} fond={scene.background ?? "transparent"}>
				<NativeSceneLayers key={`${stage}:${scene.id}`} scene={presentationScene} source={source} activeLayerIds={activeLayerIds}
				className="native-avatar-editor__image"
				onStateChange={assetState => setSceneAssets({ stage, sceneId: scene.id, state: assetState })} />
			{modelSlot ? <div className="native-avatar-editor__model" style={{ ...position(modelSlot.rect), zIndex: 100 }}>{model}</div> : null}
			{stage === "body" ? visibleBodies.flatMap((part, i) => [dynamicIcon(`body-slot-${i}`, part), number(`body-slot-${i}`, part)]) : null}
				{stage === "hair" && panelMode === "parts" ? visibleParts.flatMap((part, i) => [dynamicIcon(`part-slot-${i}`, part), number(`part-slot-${i}`, part)]) : null}
				{stage === "hair" && palette.length > 0 ? <div className="native-avatar-editor__panel-mode" role="group" aria-label="Affichage de la personnalisation">
					{faceParts.length > 1 ? <button type="button" aria-pressed={panelMode === "parts"} onClick={() => { setPanelMode("parts"); setPage(0); }}><GameText>Pièces</GameText></button> : null}
					<button type="button" aria-pressed={panelMode === "colors"} onClick={() => { setPanelMode("colors"); setPage(0); }}><GameText>Couleurs</GameText></button>
				</div> : null}
				{stage === "hair" && panelMode === "colors" ? visibleColors.map((color, i) => {
					const target = scene.controls.find(control => control.id === `part-slot-${i}`);
					const selected = state.paletteSelections[category] === color.index;
					return target ? <span key={color.id} className={`native-avatar-editor__swatch${selected ? " native-avatar-editor__swatch--selected" : ""}`} data-avatar-color={color.index} style={{ ...position(target.rect), backgroundColor: `#${color.rgb}` }} /> : null;
				}) : null}
				{stage === "stats" && statsMode === "base" ? scene.controls.filter(control => control.id.startsWith("stat-value-")).map(control => <div key={`${control.id}-value`} className="native-avatar-editor__text native-avatar-editor__profile-value" style={{ ...position(control.rect), zIndex: 510 }}>{renderText(profileValue(control.id), { color: 0x087fff, height: control.rect.h, width: control.rect.w })}</div>) : null}
				{stage === "stats" && statsMode === "base" ? <fieldset className="native-avatar-editor__stat-grid">
					<legend>Statistiques de l’OC</legend>
					{PROFILE_STATS.map(([field, fallback, maximum], index) => {
						const label = catalog.statsRadar?.[index]?.libelle ?? fallback;
						const value = state.profile[field] as number | null;
						return <label key={field}>{label}
							<input type="number" min={0} max={maximum} step={1} value={value ?? ""}
								aria-label={label} data-avatar-stat={field}
								onInput={event => {
									const raw = event.currentTarget.value;
									const next = raw === "" ? null : Math.min(maximum, Math.max(0, Math.trunc(Number(raw))));
									onStateChange({ ...state, profile: { ...state.profile, [field]: Number.isFinite(next) ? next : null } });
								}} />
						</label>;
					})}
				</fieldset> : null}
				{stage === "stats" && statsMode === "personality" ? <label className="native-avatar-editor__profile-select">{personalityLabel}
					<select aria-label={personalityLabel} value={state.profile.personality ?? ""} onChange={event => onStateChange({ ...state, profile: { ...state.profile, personality: event.target.value === "" ? null : Number(event.target.value) } })}>
						<option value=""><GameText>Non définie</GameText></option>
						{(catalog.personnalites ?? []).map((personality, index) => <option key={`${personality.texte}:${index}`} value={index}>{personality.libelle ?? personality.texte}</option>)}
					</select>
				</label> : null}
				{stage === "stats" && statsMode === "voice" ? <label className="native-avatar-editor__profile-select">{voiceLabel}
					<select aria-label={voiceLabel} value={state.profile.voice ?? ""} onChange={event => onStateChange({ ...state, profile: { ...state.profile, voice: event.target.value === "" ? null : Number(event.target.value) } })}>
						<option value=""><GameText>Non définie</GameText></option>
						{voices.map(({ voice, index }) => <option key={`${voice.banque}:${index}`} value={index}>{voice.banque} · {voice.itemNo + 1}</option>)}
					</select>
				</label> : null}
				{unavailableControl ? <div className="native-avatar-editor__text native-avatar-editor__unavailable" style={{ left: 330, top: unavailableControl.rect.y, width: 160, height: unavailableControl.rect.h, zIndex: 715 }}><LocalizedNativeText text="Indisponible" renderText={renderText} options={{ color: 0xb8c4d8, height: unavailableControl.rect.h, width: 160 }} /></div> : null}
				{presentationScene.texts?.map(text => {
				let value = text.text; if (text.id === "selection-label") value = state.gender === 0 ? "Masculin" : "Féminin";
				if (text.id === "panel-heading" && stage === "hair") value = scene.controls.find(c => c.id === `category-${categoryIndex}`)?.label ?? value;
				return <div key={text.id} className="native-avatar-editor__text" data-native-text={text.id} style={{ ...position(text.rect), zIndex: text.drawOrder }}><LocalizedNativeText text={value} renderText={renderText} options={{ color: text.color, height: text.rect.h, width: text.rect.w }} /></div>;
			})}
				{controls.map(control => {
					if (PROFILE_FIELDS.includes(control.id as ProfileField)) {
						const field = control.id as ProfileField;
						const rect = slot(`${field}-text`)?.rect ?? control.rect;
						const value = state.profile[field];
						const displayed = value === null ? "" : String(value);
						return <div key={field}>
							<div className="native-avatar-editor__text native-avatar-editor__field-text" style={{ ...position(rect), zIndex: 715 }}>{renderText(displayed, { color: 0x087fff, height: rect.h, width: rect.w })}</div>
							<input className="native-avatar-editor__name" aria-label={control.label} data-avatar-field={field} data-avatar-control={field} style={position(rect)} value={displayed} maxLength={field === "shirtNumber" ? 2 : 32} inputMode={field === "shirtNumber" ? "numeric" : "text"} onFocus={() => applyIntent({ type: "focus", id: field })}
								onInput={event => {
									const cleaned = field === "shirtNumber" ? event.currentTarget.value.replace(/\D/g, "").slice(0, 2) : event.currentTarget.value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").slice(0, 32);
									const next = field === "shirtNumber" ? (cleaned === "" ? null : Number(cleaned)) : cleaned;
									onStateChange({ ...state, profile: { ...state.profile, [field]: next } as AvatarProfile });
								}} />
						</div>;
					}
					if (control.id === "height") return <input key="height" type="range" className="native-avatar-editor__height" data-avatar-control="height" aria-label={control.label} style={position(control.rect)} min={0} max={14} step={1} value={state.height ?? 7} onFocus={() => applyIntent({ type: "focus", id: "height" })} onChange={event => onStateChange({ ...state, height: Number(event.target.value) })} />;
					const color = panelMode === "colors" && control.id.startsWith("part-slot-") ? visibleColors[Number(control.id.slice(10))] : null;
					const currentValue = profileValue(control.id);
					const option = partForAction(control.id), label = color ? `${control.label} — #${color.rgb}` : option ? `${control.label} — ${option.part.itemNo}` : currentValue ? `${control.label} — ${currentValue}` : control.label;
				return <button key={control.id} type="button" className="native-avatar-editor__control" data-avatar-control={control.id} style={position(control.rect)} aria-label={label} aria-pressed={selectedParts.has(control.id)} disabled={control.disabled} aria-disabled={control.disabled} title={control.disabled ? `${label} — indisponible` : label}
					onPointerEnter={() => { if (!control.disabled) applyIntent({ type: "focus", id: control.id }); }} onFocus={() => { if (!control.disabled && navigation.current.focusedId !== control.id) applyIntent({ type: "focus", id: control.id }); }} onClick={() => activate(control.id)} />;
			})}
			{assetFailed || sceneAssetFailed ? <p className="native-avatar-editor__error" role="alert">Certaines ressources visuelles sont indisponibles.</p> : null}
		</GameCanvas>
	</section>;
}
