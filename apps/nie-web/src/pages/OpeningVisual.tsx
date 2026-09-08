/** Opening presentation consumes native VFS media and engine-owned scene metadata. */
import { GameCanvas, useAssetSource } from "@niers/inacord-ui";
import { type NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadMenuPresentation } from "../game/bridge";
import type { OpeningPhase } from "../game/opening-sequence";
import { NativeText } from "./NativeText";
import { NativeSceneLayers } from "@niers/inacord-ui/shell/native-scene-layers";

export interface OpeningVisualProps {
	phase: Exclude<OpeningPhase, "menu">;
	onReady?: () => void;
	onEnded?: () => void;
	onConfirm?: () => void;
}

const LOGO_MOVIES = {
	"inazuma-eleven": "data/common/movie/IE_15th.usm",
	level5: "data/common/movie/L5logo.usm",
} as const;

export function OpeningVisual({ phase, onReady, onEnded, onConfirm }: OpeningVisualProps) {
	if (phase === "inazuma-eleven" || phase === "level5") {
		return <NativeLogoMovie path={LOGO_MOVIES[phase]} onReady={onReady} onEnded={onEnded} />;
	}
	return <NativeOpeningScene key={phase} id={phase} onReady={onReady} onConfirm={onConfirm} />;
}

function NativeLogoMovie({ path, onReady, onEnded }: { path: string; onReady?: () => void; onEnded?: () => void }) {
	const source = useAssetSource();
	const [failed, setFailed] = useState(false);
	const [paused, setPaused] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const movie = useRef<HTMLVideoElement>(null);
	const url = source.urlVideo?.(path);
	return (
		<div className="opening-native-movie" data-vfs-path={path}>
			{url && !failed ? <video
				key={attempt}
				ref={movie}
				src={url}
				autoPlay
				muted
				playsInline
				preload="auto"
				onCanPlay={() => { onReady?.(); void movie.current?.play().catch(() => setPaused(true)); }}
				onEnded={onEnded}
				onError={() => { setFailed(true); setPaused(false); }}
				onPause={(event) => setPaused(!event.currentTarget.ended)}
				onPlaying={() => setPaused(false)}
			/> : <div role="alert">La vidéo du jeu n’est pas disponible. <button type="button" onClick={() => { setFailed(false); setPaused(false); setAttempt(value => value + 1); }}>Réessayer</button></div>}
			{paused && !failed ? <button type="button" onClick={() => { void movie.current?.play().catch(() => setPaused(true)); }}>Reprendre</button> : null}
		</div>
	);
}


function NativeOpeningScene({ onReady, id, onConfirm }: {
	onReady?: () => void; id: "loading" | "start" | "autosave"; onConfirm?: () => void;
}) {
	const [scene, setScene] = useState<NativeMenuScene | null>(null);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const fail = useCallback(() => setFailed(true), []);
	useEffect(() => {
		let active = true;
		loadMenuPresentation(id).then(value => { if (active) setScene(value); }).catch(() => { if (active) setFailed(true); });
		return () => { active = false; };
	}, [id, attempt]);
	if (failed) return <p role="alert">Les ressources de l\u2019\u00E9cran ne sont pas disponibles. <button type="button"
		onClick={() => { setFailed(false); setScene(null); setAttempt(value => value + 1); }}>R\u00E9essayer</button></p>;
	if (!scene) return <div aria-busy="true" aria-label="Chargement des ressources" />;
	return <OpeningSceneContent key={attempt} scene={scene} onReady={onReady} onError={fail} onConfirm={onConfirm} />;
}

/** Scene coordinates govern both visible artwork and hit targets, including letterboxed hosts. */
function OpeningSceneContent({ scene, onReady, onError, onConfirm }: {
	scene: NativeMenuScene; onReady?: () => void; onError: () => void; onConfirm?: () => void;
}) {
	const source = useAssetSource();
	const [layersReady, setLayersReady] = useState(false);
	const [readyTexts, setReadyTexts] = useState<ReadonlySet<string>>(() => new Set());
	const action = useRef<HTMLButtonElement>(null);
	const markLayersReady = useCallback(() => setLayersReady(true), []);
	const markTextReady = useCallback((id: string) => setReadyTexts(previous => previous.has(id) ? previous : new Set([...previous, id])), []);
	const ready = layersReady && (scene.texts ?? []).every(text => readyTexts.has(text.id));
	useEffect(() => { if (ready) { onReady?.(); action.current?.focus({ preventScroll: true }); } }, [ready, onReady]);
	return <GameCanvas canvas={{ w: scene.canvas.width, h: scene.canvas.height }} fond={scene.background}>
		<div data-native-scene={scene.id} data-native-scene-ready={ready} data-runtime-completeness="partial">
			<NativeSceneLayers scene={scene} source={source} onReady={markLayersReady} onError={onError} />
			{scene.slots?.filter(slot => slot.id === "saving-ribbon").map(slot => <div key={slot.id}
				className="opening-autosave__stripe" aria-hidden="true"
				style={{ left: slot.rect.x, top: slot.rect.y, width: slot.rect.w, height: slot.rect.h }} />)}
			{scene.texts?.map(text => <OpeningText key={text.id} text={text} onReady={markTextReady} onError={onError} />)}
			{scene.controls.filter(control => control.hostActionId === "confirm").map(control => <button key={control.id}
				ref={action} type="button" aria-label={control.label} data-native-control={control.id}
				disabled={!ready || !onConfirm} onClick={onConfirm}
				onKeyDown={event => { if (event.repeat && (event.key === "Enter" || event.key === " ")) event.preventDefault(); }}
				className={"opening-screen__action opening-screen__action--" + scene.id}
				style={{ left: control.rect.x, top: control.rect.y, width: control.rect.w, height: control.rect.h }} />)}
		</div>
	</GameCanvas>;
}

function OpeningText({ text, onReady, onError }: {
	text: NonNullable<NativeMenuScene["texts"]>[number]; onReady: (id: string) => void; onError: () => void;
}) {
	const ready = useCallback(() => onReady(text.id), [onReady, text.id]);
	return <div data-native-text={text.id} style={{ position: "absolute", pointerEvents: "none", left: text.rect.x,
		top: text.rect.y, width: text.rect.w, height: text.rect.h, zIndex: text.drawOrder }}>
		<NativeText text={text.text} color={(((text.color ?? 0xffffff) << 8) | 255) >>> 0}
			height={text.rect.h} width={text.rect.w} onReady={ready} onError={onError} />
	</div>;
}
