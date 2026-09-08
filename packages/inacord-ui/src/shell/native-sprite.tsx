import type { AssetSource } from "@niers/asset-source";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { nativeAssetUrl, type NativeSceneRect } from "./native-title-menu";
import "./native-sprite.css";

export type NativeSpriteState = "loading" | "ready" | "failed";
export interface NativeSpriteResourceFailure {
	layerId: string;
	resource: "image" | "mask";
	url: string | null;
}
export interface NativeSpriteProps {
	source: Pick<AssetSource, "urlTexture">;
	assetPath: string;
	region: string;
	rect: NativeSceneRect;
	drawOrder?: number;
	rotationDeg?: number;
	maskRegion?: string;
	maskMode?: "alpha" | "luminance";
	layerId?: string;
	actionId?: string;
	partId?: string;
	active?: boolean;
	className?: string;
	onStateChange?: (state: NativeSpriteState) => void;
	onReady?: () => void;
	onError?: (failure: NativeSpriteResourceFailure) => void;
}

/** Native pixels come from the host's Rust decoder, including spatial atlas-region cropping. */
export function nativeSpriteUrl(source: Pick<AssetSource, "urlTexture">, path: string, region: string): string | null {
	try { return nativeAssetUrl(source, path, region) || null; }
	catch { return null; }
}

/** Keep every caller in native canvas units; GameCanvas owns viewport scaling. */
export function nativeSpriteGeometry(rect: NativeSceneRect, drawOrder?: number, rotationDeg?: number): CSSProperties {
	return { left: rect.x, top: rect.y, width: rect.w, height: rect.h, zIndex: drawOrder,
		transform: rotationDeg ? `rotate(${rotationDeg}deg)` : undefined };
}

/** A single named texture or spatial region, never an inferred grid cell or a screen capture. */
export function NativeSprite(props: NativeSpriteProps) {
	const url = nativeSpriteUrl(props.source, props.assetPath, props.region);
	const mask = props.maskRegion ? nativeSpriteUrl(props.source, props.assetPath, props.maskRegion) : null;
	const identity = JSON.stringify([props.assetPath, props.region, props.maskRegion, url, mask]);
	return <ResolvedSprite key={identity} {...props} url={url} mask={mask} />;
}

function ResolvedSprite({ assetPath, region, rect, drawOrder, rotationDeg, maskRegion, maskMode,
	layerId, actionId, partId, active, className, onStateChange, onReady, onError, url, mask,
}: NativeSpriteProps & { url: string | null; mask: string | null }) {
	const [imageState, setImageState] = useState<NativeSpriteState>(url ? "loading" : "failed");
	const [maskState, setMaskState] = useState<NativeSpriteState>(!maskRegion ? "ready" : mask ? "loading" : "failed");
	const callbacks = useRef({ onStateChange, onReady, onError });
	callbacks.current = { onStateChange, onReady, onError };
	const reported = useRef(new Set<"image" | "mask">());
	const state = imageState === "failed" || maskState === "failed" ? "failed"
		: imageState === "ready" && maskState === "ready" ? "ready" : "loading";
	useEffect(() => {
		if (!mask) return;
		const image = new Image();
		image.onload = () => setMaskState("ready");
		image.onerror = () => setMaskState("failed");
		image.src = mask;
		if (image.complete) setMaskState(image.naturalWidth > 0 ? "ready" : "failed");
		return () => { image.onload = null; image.onerror = null; };
	}, [mask]);
	useEffect(() => {
		callbacks.current.onStateChange?.(state);
		if (state === "ready") callbacks.current.onReady?.();
	}, [state]);
	useEffect(() => {
		for (const resource of ["image", "mask"] as const) {
			if ((resource === "image" ? imageState : maskState) !== "failed" || reported.current.has(resource)) continue;
			reported.current.add(resource);
			callbacks.current.onError?.({ layerId: layerId ?? partId ?? region, resource, url: resource === "image" ? url : mask });
		}
	}, [imageState, maskState, layerId, partId, region, url, mask]);
	if (!url) return null;
	return <img src={url} alt="" aria-hidden="true" draggable={false}
		className={["native-sprite", className].filter(Boolean).join(" ")}
		data-native-layer={layerId} data-native-region={region} data-vfs-path={assetPath}
		data-native-action={actionId} data-avatar-part={partId} data-native-active={active}
		data-native-asset-state={state}
		style={{ ...nativeSpriteGeometry(rect, drawOrder, rotationDeg), maskImage: mask ? `url("${mask}")` : undefined,
			maskMode: mask ? maskMode : undefined }}
		ref={image => { if (image?.complete) setImageState(image.naturalWidth > 0 ? "ready" : "failed"); }}
		onLoad={() => setImageState("ready")} onError={() => setImageState("failed")} />;
}
