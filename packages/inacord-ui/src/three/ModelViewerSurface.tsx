"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export interface ModelViewerSurfaceProps {
	src: string;
	label: string;
	loadViewer: () => Promise<void>;
	active?: boolean;
	observeVisibility?: boolean;
	checkAvailability?: boolean;
	autoRotate?: boolean;
	rotationPerSecond?: string;
	shadowIntensity?: string;
	interactionPrompt?: string;
	className?: string;
	children?: (state: { loaded: boolean; errored: boolean; visible: boolean }) => ReactNode;
}

/** Shared lifecycle for the retained model-viewer compatibility renderer. */
export function ModelViewerSurface({ src, label, loadViewer, active = true,
	observeVisibility = false, checkAvailability = false, autoRotate = true,
	rotationPerSecond = "30deg", shadowIntensity = "1", interactionPrompt,
	className = "absolute inset-0", children }: ModelViewerSurfaceProps) {
	const hostRef = useRef<HTMLDivElement>(null);
	const [intersecting, setIntersecting] = useState(false);
	const [loaded, setLoaded] = useState(false);
	const [errored, setErrored] = useState(false);
	const visible = active && (!observeVisibility || intersecting);

	useEffect(() => {
		const host = hostRef.current;
		if (!host || !observeVisibility) return;
		const observer = new IntersectionObserver(entries => {
			for (const entry of entries) setIntersecting(entry.isIntersecting);
		}, { rootMargin: "200px" });
		observer.observe(host);
		return () => observer.disconnect();
	}, [observeVisibility]);

	useEffect(() => {
		const host = hostRef.current;
		if (!host) return;
		setLoaded(false);
		setErrored(false);
		if (!visible) return;
		let cancelled = false;
		const controller = new AbortController();
		let element: HTMLElement | undefined;
		const onLoad = () => { if (!cancelled) setLoaded(true); };
		const onError = () => { if (!cancelled) setErrored(true); };
		async function mount() {
			if (checkAvailability) {
				const response = await fetch(src, { method: "HEAD", signal: controller.signal, cache: "no-store" });
				if (!response.ok) throw new Error(`Model unavailable (${response.status})`);
			}
			if (cancelled) return;
			await loadViewer();
			if (cancelled) return;
			element = document.createElement("model-viewer");
			const attributes: Record<string, string> = {
				alt: label, "camera-controls": "", "camera-orbit": "0deg 85deg auto",
				"rotation-per-second": rotationPerSecond, "shadow-intensity": shadowIntensity,
				exposure: "1", "touch-action": "pan-y",
			};
			if (autoRotate) attributes["auto-rotate"] = "";
			if (interactionPrompt !== undefined) attributes["interaction-prompt"] = interactionPrompt;
			for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
			element.style.cssText = "width:100%;height:100%;background-color:transparent";
			element.addEventListener("load", onLoad);
			element.addEventListener("error", onError);
			element.setAttribute("src", src);
			host!.replaceChildren(element);
		}
		void mount().catch(onError);
		return () => {
			cancelled = true;
			controller.abort();
			element?.removeEventListener("load", onLoad);
			element?.removeEventListener("error", onError);
			element?.remove();
		};
	}, [src, label, loadViewer, visible, checkAvailability, autoRotate,
		rotationPerSecond, shadowIntensity, interactionPrompt]);

	return <div className={className}>
		<div ref={hostRef} className="absolute inset-0" />
		{children?.({ loaded, errored, visible })}
	</div>;
}
