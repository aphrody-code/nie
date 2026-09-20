/** Browser lifecycle and input binding for the shared Rust renderer. */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { GameText } from "../lib/game-text-context";
import { fetchBytes } from "@niers/asset-source";

export interface RustModelViewer {
	load_glb(bytes: Uint8Array): void;
	orbit(yaw: number, pitch: number, distance: number): void;
	resize(width: number, height: number): void;
	render(): boolean;
	free(): void;
}

/**
 * Les capacités d'ÉDITION du viewer Rust, au-delà de l'affichage d'un modèle.
 *
 * Ce sont les quatre pour lesquelles le viewport three.js de l'éditeur survivait — grille, fil de
 * fer, contour de sélection, gizmo — plus la composition d'une scène à plusieurs objets et le
 * picking qui nomme l'objet touché.
 *
 * Déclarées à part et OPTIONNELLES : `RustModelViewport` affiche un modèle isolé (pages Modèles
 * 3D, Avatar) et n'en a pas besoin. Les exiger de tout viewer casserait ces trois consommateurs
 * pour une capacité qu'ils n'utilisent pas.
 */
export interface RustSceneViewer extends RustModelViewer {
	/** Dépose un asset GLB sous le chemin logique que le document lui donne. */
	stage_asset(asset: string, bytes: Uint8Array): void;
	/** Oublie les assets déposés ; le modèle affiché n'est pas touché. */
	clear_assets(): void;
	/** Compose et affiche un document de scène v2. */
	load_scene(documentJson: string): void;
	/** L'objet sous le pixel, en JSON, ou `undefined` sur le fond. */
	pick_json(x: number, y: number): string | undefined;
	/** Grille de sol. */
	set_grid(visible: boolean): void;
	/** Fil de fer du modèle. */
	set_wireframe(visible: boolean): void;
	/** Sélection par identifiant de document ; chaîne vide pour effacer. */
	select(id: string): void;
	/** L'identifiant sélectionné, chaîne vide s'il n'y en a pas. */
	selected(): string;
	/** L'axe du gizmo sous le pixel : `"x"`, `"y"`, `"z"`, ou chaîne vide. */
	gizmo_axis_at(x: number, y: number): string;
	/** Déplacement monde `[dx, dy, dz]` entre deux pixels, contraint à l'axe ; vide si aucun. */
	gizmo_drag(axis: string, fromX: number, fromY: number, toX: number, toY: number): Float32Array | number[];
}

/**
 * Vrai quand un viewer porte les capacités d'édition.
 *
 * Un garde plutôt qu'un cast : les deux façades wasm (WebGPU et le repli WebGL) exposent le même
 * jeu de méthodes aujourd'hui, mais rien dans le type ne l'impose, et un repli amputé se
 * manifesterait par un `undefined is not a function` au premier clic plutôt qu'à la construction.
 */
export function isSceneViewer(viewer: RustModelViewer): viewer is RustSceneViewer {
	const v = viewer as Partial<RustSceneViewer>;
	return (
		typeof v.load_scene === "function" &&
		typeof v.pick_json === "function" &&
		typeof v.set_grid === "function" &&
		typeof v.set_wireframe === "function" &&
		typeof v.select === "function" &&
		typeof v.gizmo_axis_at === "function" &&
		typeof v.gizmo_drag === "function"
	);
}
export type CreateRustModelViewer = (canvas: HTMLCanvasElement) => Promise<RustModelViewer>;

export interface RustModelCamera {
	yaw: number;
	pitch: number;
	distance: number;
}

interface RustModelViewportProps {
	/** Identity of the model shown, and the default place to fetch it from. */
	url: string | null;
	/**
	 * Alternative source of the GLB bytes, keyed by `url`.
	 *
	 * A host that already holds the bytes — the desktop Explorer assembles them over its own
	 * API — would otherwise have to publish them as a blob URL just to have them fetched back.
	 * `url` remains the identity that decides when to reload.
	 */
	loadBytes?: (signal: AbortSignal) => Promise<Uint8Array>;
	createViewer: CreateRustModelViewer;
	/**
	 * Last-resort renderer used on a fresh canvas when a GPU backend claimed the original
	 * context before failing. A canvas cannot change context type, so retrying on it cannot
	 * make the CPU renderer available.
	 */
	createFallbackViewer?: CreateRustModelViewer;
	label?: string;
	onReady?: () => void;
	initialCamera?: RustModelCamera;
	maxBytes?: number;
	canvasStyle?: CSSProperties;
	loadingFallback?: ReactNode;
	renderError?: (error: Error, retry: () => void) => ReactNode;
}

function asError(value: unknown): Error {
	return value instanceof Error ? value : new Error("Model viewer failed");
}

/** A new recipe preserves the camera. Failed/stale loads never replace the current selection. */
export function RustModelViewport({
	url,
	loadBytes,
	createViewer,
	createFallbackViewer,
	label = "Avatar",
	onReady,
	initialCamera = { yaw: 0, pitch: 0, distance: 3.1 },
	maxBytes = 64 * 1024 * 1024,
	canvasStyle,
	loadingFallback,
	renderError,
}: RustModelViewportProps) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const viewer = useRef<RustModelViewer | null>(null);
	const camera = useRef({ ...initialCamera });
	const needsRender = useRef(false);
	const modelLoaded = useRef(false);
	const readyPending = useRef(false);
	const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
	const readyCallback = useRef(onReady);
	readyCallback.current = onReady;
	const [instance, setInstance] = useState<RustModelViewer | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [usingFallback, setUsingFallback] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [loading, setLoading] = useState(true);
	const [hasPresentedModel, setHasPresentedModel] = useState(false);

	useEffect(() => {
		let disposed = false;
		let owned: RustModelViewer | null = null;
		let raf = 0;
		setError(null);
		setLoading(true);
		const target = canvas.current;
		if (!target) return;
		readyPending.current = false;
		setHasPresentedModel(false);
		delete target.dataset.modelReady;
		const factory = usingFallback ? createFallbackViewer : createViewer;
		if (!factory) {
			setError(new Error("No fallback model viewer is available"));
			setLoading(false);
			return;
		}
		factory(target).then(value => {
			if (disposed) { value.free(); return; }
			owned = value;
			viewer.current = value;
			setInstance(value);
			let previousWidth = 0, previousHeight = 0;
			const frame = () => {
				if (disposed) return;
				try {
					const rect = target.getBoundingClientRect();
					const dpr = Math.min(window.devicePixelRatio || 1, 2);
					const width = Math.round(rect.width * dpr), height = Math.round(rect.height * dpr);
					if (width > 0 && height > 0 && modelLoaded.current) {
						if (width !== previousWidth || height !== previousHeight) {
							value.resize(width, height); previousWidth = width; previousHeight = height;
							needsRender.current = true;
						}
						if (needsRender.current) {
							const c = camera.current; value.orbit(c.yaw, c.pitch, c.distance);
							if (value.render()) {
								needsRender.current = false;
								setHasPresentedModel(true);
								target.dataset.modelReady = "true";
								if (readyPending.current) {
									readyPending.current = false;
									setLoading(false);
									readyCallback.current?.();
								}
							}
						}
					}
					raf = requestAnimationFrame(frame);
				} catch (cause) { setError(asError(cause)); setLoading(false); }
			};
			raf = requestAnimationFrame(frame);
		}).catch((cause) => {
			if (disposed) return;
			if (!usingFallback && createFallbackViewer) {
				setUsingFallback(true);
				return;
			}
			setError(asError(cause));
			setLoading(false);
		});
		return () => {
			disposed = true;
			cancelAnimationFrame(raf);
			modelLoaded.current = false;
			readyPending.current = false;
			if (viewer.current === owned) viewer.current = null;
			owned?.free();
		};
	}, [attempt, createFallbackViewer, createViewer, usingFallback]);

	const retry = () => {
		// A fresh primary canvas is required after a WebGPU/WebGL construction failure.
		setUsingFallback(false);
		setAttempt(value => value + 1);
	};

	useEffect(() => {
		camera.current = { ...initialCamera };
		needsRender.current = modelLoaded.current;
	}, [initialCamera.yaw, initialCamera.pitch, initialCamera.distance]);

	useEffect(() => {
		if (!url) {
			modelLoaded.current = false;
			readyPending.current = false;
			needsRender.current = false;
			if (canvas.current) delete canvas.current.dataset.modelReady;
			setHasPresentedModel(false);
			setError(null);
			setLoading(false);
			return;
		}
		if (!instance || instance !== viewer.current) return;
		const abort = new AbortController();
		readyPending.current = false;
		setLoading(true);
		setError(null);
		(async () => {
			let bytes: Uint8Array;
			if (loadBytes) {
				bytes = await loadBytes(abort.signal);
			} else {
				try {
					bytes = await fetchBytes(url, maxBytes, {
						signal: abort.signal,
						timeoutMs: 30_000,
						retries: 0,
					});
				} catch (cause: unknown) {
					if (cause instanceof Error && cause.message.includes("Payload size exceeds limit")) {
						throw new Error("Model too large");
					}
					throw cause;
				}
			}
			// Le plafond vaut pour les deux sources : un hôte qui fournit ses octets ne doit pas
			// contourner la limite que le chemin réseau respecte.
			if (bytes.byteLength > maxBytes) throw new Error("Model too large");
			if (abort.signal.aborted || instance !== viewer.current) return;
			instance.load_glb(bytes);
			modelLoaded.current = true;
			readyPending.current = true;
			needsRender.current = true;
		})().catch((cause) => { if (!abort.signal.aborted) { setError(asError(cause)); setLoading(false); } });
		return () => abort.abort();
	}, [instance, loadBytes, maxBytes, url]);

	const orbit = (dx: number, dy: number) => {
		camera.current.yaw += dx * 0.01;
		camera.current.pitch = Math.max(-1.2, Math.min(1.2, camera.current.pitch + dy * 0.01));
		needsRender.current = true;
	};
	return <div style={{ position: "relative", width: "100%", height: "100%" }} aria-busy={loading}>
			<canvas key={`${usingFallback ? "fallback" : "primary"}-${attempt}`} ref={canvas} width={640} height={720} aria-label={label} tabIndex={0}
				data-native-renderer="nie-render3d" style={{ width: "100%", height: "100%", touchAction: "none", outline: "none", ...canvasStyle, visibility: !url || (!hasPresentedModel && (loading || error)) ? "hidden" : "visible" }}
			onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }}
			onPointerMove={event => { const p = pointer.current; if (p?.id !== event.pointerId) return; orbit(event.clientX - p.x, event.clientY - p.y); p.x = event.clientX; p.y = event.clientY; }}
			onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }} onLostPointerCapture={() => { pointer.current = null; }}
			onWheel={event => { camera.current.distance = Math.max(1.2, Math.min(10, camera.current.distance * Math.exp(event.deltaY * 0.001))); needsRender.current = true; }}
			onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { orbit(event.key === "ArrowLeft" ? -5 : 5, 0); event.preventDefault(); event.stopPropagation(); } }} />
		{loading ? loadingFallback : null}
		{error ? (renderError?.(error, retry) ?? <div role="alert" style={{ position: "absolute", bottom: 16, left: 16 }}>Le modèle n’a pas pu être affiché. <button type="button" onClick={retry}><GameText>Réessayer</GameText></button></div>) : null}
	</div>;
}
