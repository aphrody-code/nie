/** Opening presentation consumes native VFS media and engine-owned scene metadata. */
import { GameCanvas, useAssetSource } from "@niers/inacord-ui";
import { nativeAssetUrl, type NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { loadMenuPresentation } from "../game/bridge";
import type { OpeningPhase } from "../game/opening-sequence";
import { NativeText } from "./NativeText";

export interface OpeningVisualProps {
	phase: Exclude<OpeningPhase, "menu">;
	onReady?: () => void;
	onEnded?: () => void;
}

const LOGO_MOVIES = {
	"inazuma-eleven": "data/common/movie/IE_15th.usm",
	level5: "data/common/movie/L5logo.usm",
} as const;

export function OpeningVisual({ phase, onReady, onEnded }: OpeningVisualProps) {
	if (phase === "inazuma-eleven" || phase === "level5") {
		return <NativeLogoMovie path={LOGO_MOVIES[phase]} onReady={onReady} onEnded={onEnded} />;
	}
	if (phase === "start") return <NativeStart onReady={onReady} />;
	if (phase === "loading") return <NativeLoading onReady={onReady} />;
	return <AutosaveNotice onReady={onReady} />;
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

function NativeStart({ onReady, id = "start", children }: { onReady?: () => void; id?: "start" | "autosave"; children?: ReactNode }) {
	const source = useAssetSource();
	const [scene, setScene] = useState<NativeMenuScene | null>(null);
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const loaded = useRef(new Set<string>());
	useEffect(() => {
		let active = true;
		loaded.current.clear();
		loadMenuPresentation(id).then((value) => {
			if (active) setScene(value);
		}).catch(() => { if (active) setFailed(true); });
		return () => { active = false; };
	}, [id, attempt]);
	if (failed) return <p role="alert">Les ressources de l’écran ne sont pas disponibles. <button type="button" onClick={() => { setFailed(false); setScene(null); setAttempt(value => value + 1); }}>Réessayer</button></p>;
	if (!scene) return <div aria-busy="true" aria-label="Chargement des ressources" />;
	return (
		<GameCanvas canvas={{ w: scene.canvas.width, h: scene.canvas.height }} fond={scene.background}>
			<div data-native-scene={id} data-runtime-completeness="partial">
				{scene.layers.map((layer) => <img
					key={layer.id}
					alt=""
					data-native-region={layer.region}
					data-vfs-path={layer.assetPath}
					src={nativeAssetUrl(source, layer.assetPath, layer.region) ?? undefined}
					draggable={false}
					onLoad={() => {
						loaded.current.add(layer.id);
						if (loaded.current.size === scene.layers.length) onReady?.();
					}}
					onError={() => setFailed(true)}
					style={{ position: "absolute", left: layer.rect.x, top: layer.rect.y, width: layer.rect.w, height: layer.rect.h, zIndex: layer.drawOrder }}
				/>)}
			</div>
			{children}
		</GameCanvas>
	);
}

/** Region and corner measured from the PC client, separate from its localized label. */
function NativeLoading({ onReady }: { onReady?: () => void }) {
	const source = useAssetSource();
	const [failed, setFailed] = useState(false);
	const [attempt, setAttempt] = useState(0);
	const ready = useRef(new Set<string>());
	const markReady = useCallback((part: string) => { ready.current.add(part); if (ready.current.size === 2) onReady?.(); }, [onReady]);
	const fontReady = useCallback(() => markReady("font"), [markReady]);
	const fail = useCallback(() => setFailed(true), []);
	const path = "data/dx11/menu/11_loading/loading01/loading01_01/loading01_01.g4tx";
	return (
		<GameCanvas canvas={{ w: 1920, h: 1080 }} fond="#000000">
			<div key={attempt} className="opening-native-loading" data-runtime-completeness="partial">
				<img alt="" src={nativeAssetUrl(source, path, "load_ball01") ?? undefined} onLoad={() => markReady("ball")} onError={fail} />
				<NativeText text="CHARGEMENT EN COURS…" height={48} width={420} onReady={fontReady} onError={fail} />
			</div>
			{failed ? <div className="opening-resource-error" role="alert">Les ressources n’ont pas pu être chargées. <button type="button" onClick={() => { ready.current.clear(); setFailed(false); setAttempt(value => value + 1); }}>Réessayer</button></div> : null}
		</GameCanvas>
	);
}

function AutosaveNotice({ onReady }: { onReady?: () => void }) {
	return (
		<NativeStart id="autosave" onReady={onReady}>
		<div className="opening-autosave" data-runtime-completeness="partial">
			<p><NativeText text="Ce jeu dispose d'une fonction de sauvegarde automatique." color={0x161ddbff} height={71} width={870} /></p>
			<p><NativeText text="Cette icône s'affichera à l'écran lors d'une sauvegarde." color={0x161ddbff} height={71} width={810} /></p>
			<div className="opening-autosave__stripe"><NativeText text="Sauvegarde en cours" height={60} width={289} /></div>
			<strong><NativeText text="[AVERTISSEMENT]" color={0xfa4c51ff} height={71} width={290} /></strong>
			<p className="opening-autosave__warning"><NativeText text="Si la console est éteinte ou que le jeu est fermé pendant la sauvegarde," color={0xfa4c51ff} height={71} width={1044} /></p>
			<p className="opening-autosave__warning"><NativeText text="le fichier peut être corrompu." color={0xfa4c51ff} height={71} width={417} /></p>
		</div>
		</NativeStart>
	);
}
