/**
 * `/avatar` — the GAME's Chara Edit, and nothing that pretends to be it.
 *
 * The native editor (`NativeAvatarEditor`) draws the VFS layers of the `avatar-*` scenes at
 * their measured positions inside a `GameCanvas`, exactly like the title menu does, and the
 * model slot carries the GLB that `nie-model-serve` assembles from the resolved composition.
 *
 * The additional tabs are the Inacord editing workspaces, lazily imported from the desktop
 * editor. Everything else that used to sit here — a studio brand bar, emoji tabs, character
 * "GABARIT" presets, keshin/mixi-max tables, motion and cinematic catalogues, a dialogue writer,
 * a voice recorder and a 2D paint canvas — was literal data typed into this file: no VFS read,
 * no route, no provenance. It is gone.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { NativeAvatarEditor, type AvatarNameFields } from "@niers/inacord-ui/avatar/NativeAvatarEditor";
import { INITIAL_AVATAR_STATE, type AvatarCatalog, type AvatarComposition, type AvatarState } from "@niers/inacord-ui/avatar/contract";
import type { NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu";
import type { createStandardGamepadMenuSampler } from "@niers/inacord-ui/shell/menu-interaction";
import { RustModelViewport } from "@niers/inacord-ui/shell/rust-model-viewport";
import { GameHintBar } from "@niers/inacord-ui/components/game/GameHintBar";
import { GameTabStrip, type GameTab } from "@niers/inacord-ui/components/game/GameTabStrip";
import { avatarModelUrl, resolveAvatar } from "../game/avatar-runtime";
import { loadMenuPresentation } from "../game/bridge";
import { createNativeViewer } from "../game/native-viewer";
import { InacordWorkspace, type WorkspaceId } from "../avatar/InacordWorkspace";
import { NativeText } from "./NativeText";
import "@niers/inacord-ui/avatar/avatar-editor.css";
import "./avatar-studio.css";
import { GameText } from "@niers/inacord-ui";

const STAGES = ["style", "body", "hair", "clothes", "stats", "name"] as const;
type Stage = typeof STAGES[number];
type AvatarScenes = Record<Stage, NativeMenuScene>;
const SCENES = { style: "avatar-top", body: "avatar-style", hair: "avatar-hair", clothes: "avatar-clothes", stats: "avatar-stats", name: "avatar-name" } as const;
const DRAFT_KEY = "nie.avatar.draft.v1";
const EMPTY_NAMES: AvatarNameFields = { name: "", nickname: "", uniformName: "", shirtNumber: "0" };

type TabId = "chara-edit" | WorkspaceId;

/** The tab glyphs are drawn from the same shapes the game's tab strip uses, not emoji. */
function glyph(path: ReactNode) {
	return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
}

const TABS: readonly (GameTab & { id: TabId })[] = [
	{ id: "chara-edit", label: "Chara Edit", icon: glyph(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" /></>) },
	{ id: "avatar-modeles", label: "Avatar 3D", icon: glyph(<><path d="M12 2l9 5v10l-9 5-9-5V7z" /><path d="M12 12l9-5M12 12v10M12 12L3 7" /></>) },
	{ id: "avatar-ui", label: "Avatar UI", icon: glyph(<><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></>) },
	{ id: "menus", label: "Menus", icon: glyph(<><path d="M4 6h16M4 12h16M4 18h16" /></>) },
];

function storedDraft(): { state: AvatarState; nameFields: AvatarNameFields } {
	try {
		const raw = localStorage.getItem(DRAFT_KEY);
		if (raw && raw.length <= 65536) {
			const value = JSON.parse(raw);
			if (value.version === 1 && value.state && typeof value.state === "object" && value.nameFields) {
				const fields = value.nameFields;
				if ([fields.name, fields.nickname, fields.uniformName].every((field: unknown) => typeof field === "string" && (field as string).length <= 512)
					&& /^(?:\d{1,2})?$/.test(String(fields.shirtNumber))) {
					return {
						state: value.state,
						nameFields: { name: fields.name, nickname: fields.nickname, uniformName: fields.uniformName, shirtNumber: String(fields.shirtNumber) },
					};
				}
			}
		}
	} catch { /* Fallback to default */ }
	return { state: { ...INITIAL_AVATAR_STATE }, nameFields: { ...EMPTY_NAMES } };
}

const nativeText = (text: string, options?: { color?: number; height?: number; width?: number }) => (
	<NativeText text={text} color={options?.color} height={options?.height} width={options?.width} />
);

export function Avatar({ onBack, gamepadSampler }: { onBack: () => void; gamepadSampler?: ReturnType<typeof createStandardGamepadMenuSampler> }) {
	const [draft] = useState(storedDraft);
	const [state, setState] = useState<AvatarState>(draft.state);
	const [nameFields, setNameFields] = useState<AvatarNameFields>(draft.nameFields);
	const [stage, setStage] = useState<Stage>("style");
	const [tab, setTab] = useState<TabId>("chara-edit");

	const [catalog, setCatalog] = useState<AvatarCatalog | null>(null);
	const [scenes, setScenes] = useState<AvatarScenes | null>(null);
	const [composition, setComposition] = useState<AvatarComposition | null>(null);
	const [catalogError, setCatalogError] = useState(false);
	const [sceneError, setSceneError] = useState(false);
	const [compositionError, setCompositionError] = useState(false);
	const [attempt, setAttempt] = useState(0);

	const back = useCallback(() => {
		if (tab !== "chara-edit") { setTab("chara-edit"); return; }
		const previous = STAGES[STAGES.indexOf(stage) - 1];
		if (previous) setStage(previous); else onBack();
	}, [stage, tab, onBack]);

	useEffect(() => {
		const abort = new AbortController();
		setCatalogError(false);
		const fetchCatalog = async () => {
			let response = await fetch("/assets/avatar/catalog.json", {
				signal: abort.signal,
				headers: { accept: "application/json" },
			}).catch(() => null);
			if (!response || !response.ok) {
				response = await fetch("/avatar/catalog.json", {
					signal: abort.signal,
					headers: { accept: "application/json" },
				});
			}
			if (!response.ok) throw new Error("Avatar catalogue unavailable");
			return response.json() as Promise<AvatarCatalog>;
		};

		fetchCatalog()
			.then(value => { if (!abort.signal.aborted) setCatalog(value); })
			.catch(() => { if (!abort.signal.aborted) setCatalogError(true); });
		return () => abort.abort();
	}, [attempt]);

	useEffect(() => {
		let active = true;
		setSceneError(false);
		Promise.all(STAGES.map(async key => [key, await loadMenuPresentation(SCENES[key])] as const))
			.then(values => { if (active) setScenes(Object.fromEntries(values) as AvatarScenes); })
			.catch(() => { if (active) setSceneError(true); });
		return () => { active = false; };
	}, [attempt]);

	useEffect(() => {
		if (!catalog) return;
		let active = true;
		setCompositionError(false);
		resolveAvatar(catalog, state)
			.then(value => { if (active) setComposition(value); })
			.catch(async () => {
				// Self-heal: if saved draft or state is invalid, reset to initial state cleanly
				try {
					const fallback = await resolveAvatar(catalog, INITIAL_AVATAR_STATE);
					if (active) {
						setState({ ...INITIAL_AVATAR_STATE });
						setNameFields({ ...EMPTY_NAMES });
						setComposition(fallback);
						try { localStorage.removeItem(DRAFT_KEY); } catch { /* Ignore */ }
						return;
					}
				} catch {
					/* fallback also failed */
				}
				if (active) setCompositionError(true);
			});
		return () => { active = false; };
	}, [catalog, state, attempt]);

	useEffect(() => {
		if (!composition) return;
		try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ version: 1, state, nameFields })); } catch { /* Ignore */ }
	}, [state, nameFields, composition]);

	// Escape is the game's cancel: one stage back, then the tab, then the caller's screen.
	// `GameHintBar` owns it so the key and the on-screen hint can never drift apart.
	const hints = useMemo(() => [{ key: "Escape", keyLabel: "Esc", label: "Retour", onActivate: back }], [back]);

	const modelViewport = useMemo(() => (
		<RustModelViewport
			url={composition ? avatarModelUrl(composition) : null}
			createViewer={createNativeViewer}
			label="Aperçu de l’avatar"
		/>
	), [composition]);

	const error = catalogError || sceneError || compositionError;
	if (!catalog || !scenes || error) {
		return (
			<section aria-label="Éditeur d’avatar" className="avatar-resource-state">
				<header><button type="button" onClick={back} aria-label="Retour au menu"><GameText>Retour</GameText></button></header>
				{error ? (
					<p role="alert">
						Les ressources de l’avatar n’ont pas pu être chargées.{" "}
						<button type="button" onClick={() => setAttempt(v => v + 1)}><GameText>Réessayer</GameText></button>
					</p>
				) : (
					<p role="status">Chargement de l’avatar…</p>
				)}
				{compositionError && (
					<button type="button" onClick={() => { setState({ ...INITIAL_AVATAR_STATE }); setNameFields({ ...EMPTY_NAMES }); }}>
						Réinitialiser les choix
					</button>
				)}
			</section>
		);
	}

	return (
		<div className="avatar-screen" data-avatar-tab={tab}>
			<div className="avatar-screen__stage">
				{tab === "chara-edit" ? (
					<NativeAvatarEditor
						catalog={catalog}
						state={state}
						onStateChange={setState}
						gamepadSampler={gamepadSampler}
						onBack={back}
						stage={stage}
						onStageChange={setStage}
						scene={scenes[stage]}
						nameFields={nameFields}
						onNameFieldsChange={setNameFields}
						renderText={nativeText}
						model={modelViewport}
					/>
				) : (
					<InacordWorkspace key={tab} workspace={tab} />
				)}
			</div>
			<footer className="avatar-screen__chrome">
				<GameTabStrip tabs={TABS} value={tab} onChange={id => setTab(id as TabId)} />
				<GameHintBar hints={hints} />
			</footer>
		</div>
	);
}
