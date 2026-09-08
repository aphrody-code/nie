/** Browser lifecycle and input binding for the shared Rust renderer. */
import { useEffect, useRef, useState } from "react";

export interface RustModelViewer {
	load_glb(bytes: Uint8Array): void;
	orbit(yaw: number, pitch: number, distance: number): void;
	resize(width: number, height: number): void;
	render(): boolean;
	free(): void;
}
export type CreateRustModelViewer = (canvas: HTMLCanvasElement) => Promise<RustModelViewer>;

/** A new recipe preserves the camera. Failed/stale loads never replace the current selection. */
export function RustModelViewport({ url, createViewer, label = "Avatar", onReady }: {
	url: string | null; createViewer: CreateRustModelViewer; label?: string; onReady?: () => void;
}) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const viewer = useRef<RustModelViewer | null>(null);
	const camera = useRef({ yaw: 0, pitch: 0, distance: 3.1 });
	const needsRender = useRef(false);
	const modelLoaded = useRef(false);
	const pointer = useRef<{ id: number; x: number; y: number } | null>(null);
	const readyCallback = useRef(onReady);
	readyCallback.current = onReady;
	const [instance, setInstance] = useState<RustModelViewer | null>(null);
	const [attempt, setAttempt] = useState(0);
	const [error, setError] = useState(false);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		let disposed = false;
		let owned: RustModelViewer | null = null;
		let raf = 0;
		setError(false);
		setLoading(true);
		const target = canvas.current;
		if (!target) return;
		createViewer(target).then(value => {
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
								target.dataset.modelReady = "true";
								readyCallback.current?.();
							}
						}
					}
					raf = requestAnimationFrame(frame);
				} catch { setError(true); setLoading(false); }
			};
			raf = requestAnimationFrame(frame);
		}).catch(() => { if (!disposed) { setError(true); setLoading(false); } });
		return () => {
			disposed = true;
			cancelAnimationFrame(raf);
			modelLoaded.current = false;
			if (viewer.current === owned) viewer.current = null;
			owned?.free();
		};
	}, [createViewer, attempt]);

	useEffect(() => {
		if (!url) {
			modelLoaded.current = false;
			needsRender.current = false;
			if (canvas.current) delete canvas.current.dataset.modelReady;
			setLoading(false);
			return;
		}
		if (!instance || instance !== viewer.current) return;
		const abort = new AbortController();
		setLoading(true);
		setError(false);
		modelLoaded.current = false;
		if (canvas.current) delete canvas.current.dataset.modelReady;
		(async () => {
			const response = await fetch(url, { signal: abort.signal });
			if (!response.ok) throw new Error("Model response failed");
			if (Number(response.headers.get("content-length")) > 64 * 1024 * 1024) throw new Error("Model too large");
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (abort.signal.aborted || instance !== viewer.current) return;
			instance.load_glb(bytes);
			modelLoaded.current = true;
			needsRender.current = true;
			setLoading(false);
		})().catch(() => { if (!abort.signal.aborted) { setError(true); setLoading(false); } });
		return () => abort.abort();
	}, [instance, url]);

	const orbit = (dx: number, dy: number) => {
		camera.current.yaw += dx * 0.01;
		camera.current.pitch = Math.max(-1.2, Math.min(1.2, camera.current.pitch + dy * 0.01));
		needsRender.current = true;
	};
	return <div style={{ position: "relative", width: "100%", height: "100%" }} aria-busy={loading}>
		<canvas ref={canvas} width={640} height={720} aria-label={label} tabIndex={0}
			data-native-renderer="nie-render3d" style={{ width: "100%", height: "100%", touchAction: "none", outline: "none", visibility: loading || !url ? "hidden" : "visible" }}
			onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY }; }}
			onPointerMove={event => { const p = pointer.current; if (p?.id !== event.pointerId) return; orbit(event.clientX - p.x, event.clientY - p.y); p.x = event.clientX; p.y = event.clientY; }}
			onPointerUp={() => { pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }} onLostPointerCapture={() => { pointer.current = null; }}
			onWheel={event => { camera.current.distance = Math.max(1.2, Math.min(10, camera.current.distance * Math.exp(event.deltaY * 0.001))); needsRender.current = true; }}
			onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { orbit(event.key === "ArrowLeft" ? -5 : 5, 0); event.preventDefault(); event.stopPropagation(); } }} />
		{error ? <div role="alert" style={{ position: "absolute", bottom: 16, left: 16 }}>Le modèle n’a pas pu être affiché. <button type="button" onClick={() => setAttempt(value => value + 1)}>Réessayer</button></div> : null}
	</div>;
}
