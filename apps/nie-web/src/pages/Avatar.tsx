/** Native avatar host: shared UI, Rust resource decisions and the native editor's renderer. */
import { useCallback, useEffect, useState } from "react";
import { NativeAvatarEditor, type AvatarNameFields } from "@niers/inacord-ui/avatar/NativeAvatarEditor";
import { INITIAL_AVATAR_STATE, type AvatarCatalog, type AvatarComposition, type AvatarState } from "@niers/inacord-ui/avatar/contract";
import type { NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu";
import type { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
import { RustModelViewport } from "@niers/inacord-ui/shell/rust-model-viewport";
import { avatarModelUrl, resolveAvatar } from "../game/avatar-runtime";
import { loadMenuPresentation } from "../game/bridge";
import { createNativeViewer } from "../game/native-viewer";
import { NativeText } from "./NativeText";

const STAGES = ["style", "body", "hair", "clothes", "stats", "name"] as const;
type Stage = typeof STAGES[number];
const SCENES = { style: "avatar-top", body: "avatar-style", hair: "avatar-hair", clothes: "avatar-clothes", stats: "avatar-stats", name: "avatar-name" } as const;
const DRAFT_KEY = "nie.avatar.draft.v1";
const EMPTY_NAMES: AvatarNameFields = { name: "", nickname: "", uniformName: "", shirtNumber: "0" };
// Scene text colors are RGB; the native bitmap-font ABI accepts packed RGBA.
const nativeText = (text: string, options?: { color?: number; height?: number; width?: number }) => <NativeText text={text} {...options} color={(((options?.color ?? 0xffffff) << 8) | 255) >>> 0} />;
type AvatarScenes = Record<Stage, NativeMenuScene>;

function storedDraft(): { state: AvatarState; nameFields: AvatarNameFields } {
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (raw && raw.length <= 65536) {
			const value = JSON.parse(raw);
			if (value.version === 1 && value.state && typeof value.state === "object" && value.nameFields) {
				const fields = value.nameFields;
				if ([fields.name, fields.nickname, fields.uniformName].every(field => typeof field === "string" && field.length <= 512)
					&& /^(?:\d{1,2})?$/.test(String(fields.shirtNumber))) {
					return { state: value.state, nameFields: { name: fields.name, nickname: fields.nickname, uniformName: fields.uniformName, shirtNumber: String(fields.shirtNumber) } };
				}
			}
		}
	} catch { /* The native resolver validates restored selections before any resource request. */ }
	return { state: { ...INITIAL_AVATAR_STATE }, nameFields: { ...EMPTY_NAMES } };
}

export function Avatar({ onBack, gamepadSampler }: { onBack: () => void; gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler> }) {
	const [draft] = useState(storedDraft);
	const [state, setState] = useState<AvatarState>(draft.state);
	const [nameFields, setNameFields] = useState<AvatarNameFields>(draft.nameFields);
	const [stage, setStage] = useState<Stage>("style");
	const [catalog, setCatalog] = useState<AvatarCatalog | null>(null);
	const [scenes, setScenes] = useState<AvatarScenes | null>(null);
	const [composition, setComposition] = useState<AvatarComposition | null>(null);
	const [catalogError, setCatalogError] = useState(false);
	const [sceneError, setSceneError] = useState(false);
	const [compositionError, setCompositionError] = useState(false);
	const [attempt, setAttempt] = useState(0);

	const back = useCallback(() => {
		const previous = STAGES[STAGES.indexOf(stage) - 1];
		if (previous) setStage(previous); else onBack();
	}, [stage, onBack]);
	useEffect(() => {
		const key = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
			if (document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"], dialog[open]')) return;
			event.preventDefault(); back();
		};
		window.addEventListener("keydown", key);
		return () => window.removeEventListener("keydown", key);
	}, [back]);

	useEffect(() => {
		const abort = new AbortController();
		setCatalogError(false);
		fetch("/assets/avatar/catalog.json", { signal: abort.signal, headers: { accept: "application/json" } }).then(async response => {
			if (!response.ok) throw new Error("Avatar catalogue unavailable");
			return response.json() as Promise<AvatarCatalog>;
		}).then(value => { if (!abort.signal.aborted) setCatalog(value); }).catch(() => { if (!abort.signal.aborted) setCatalogError(true); });
		return () => abort.abort();
	}, [attempt]);

	useEffect(() => {
		let active = true;
		setSceneError(false);
		// Load the small scene descriptions together. Changing steps then preserves the
		// mounted renderer, loaded model and user's orbit instead of creating six devices.
		Promise.all(STAGES.map(async key => [key, await loadMenuPresentation(SCENES[key])] as const))
			.then(values => { if (active) setScenes(Object.fromEntries(values) as AvatarScenes); })
			.catch(() => { if (active) setSceneError(true); });
		return () => { active = false; };
	}, [attempt]);

	useEffect(() => {
		if (!catalog) return;
		let active = true;
		setComposition(null);
		setCompositionError(false);
		resolveAvatar(catalog, state).then(value => {
			if (!active) return;
			setComposition(value);
		}).catch(() => { if (active) setCompositionError(true); });
		return () => { active = false; };
	}, [catalog, state, attempt]);

	useEffect(() => {
		if (!composition) return;
		try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, state, nameFields })); } catch { /* Storage may be disabled; the active editor remains usable. */ }
	}, [state, nameFields, composition]);

	const error = catalogError || sceneError || compositionError;
	if (!catalog || !scenes || error) return <section aria-label="Éditeur d’avatar" className="avatar-resource-state">
		<header><button type="button" onClick={back} aria-label="Retour au menu">Retour</button></header>
		{error ? <p role="alert">Les ressources de l’avatar n’ont pas pu être chargées. <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></p> : <p role="status">Chargement de l’avatar…</p>}
		{compositionError ? <button type="button" onClick={() => { setState({ ...INITIAL_AVATAR_STATE }); setNameFields({ ...EMPTY_NAMES }); }}>Réinitialiser les choix</button> : null}
	</section>;
	return <NativeAvatarEditor catalog={catalog} state={state} onStateChange={setState}
		gamepadSampler={gamepadSampler}
		onBack={back} stage={stage} onStageChange={setStage} scene={scenes[stage]}
		nameFields={nameFields} onNameFieldsChange={setNameFields}
		renderText={nativeText}
		model={<RustModelViewport url={composition ? avatarModelUrl(composition) : null} createViewer={createNativeViewer} label="Aperçu de l’avatar" />} />;
}
