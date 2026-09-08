import type { AssetSource } from "@niers/asset-source";
import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeMenuScene } from "./native-title-menu";
import { NativeSprite, nativeSpriteUrl, type NativeSpriteResourceFailure, type NativeSpriteState } from "./native-sprite";

export type NativeSceneAssetState = NativeSpriteState;
export type NativeSceneResourceFailure = NativeSpriteResourceFailure;
export interface NativeSceneLayersProps {
	scene: NativeMenuScene;
	source: Pick<AssetSource, "urlTexture">;
	focusedId?: string | null;
	selectedIds?: ReadonlySet<string>;
	/** Overrides action focus/selection for layers such as persistent stage markers and checkmarks. */
	activeLayerIds?: ReadonlySet<string>;
	className?: string;
	onStateChange?: (state: NativeSceneAssetState) => void;
	onReady?: () => void;
	onError?: (failure: NativeSceneResourceFailure) => void;
}

/** Scene identity resets readiness; focus changes retain only correctly keyed resource results. */
export function NativeSceneLayers(props: NativeSceneLayersProps) {
	return <SceneLayers key={JSON.stringify([props.scene.id, props.scene.layers])} {...props} />;
}

/** Portable sprite presentation only: domain state, text and controls stay with callers. */
function SceneLayers({ scene, source, focusedId, selectedIds, activeLayerIds, className, onStateChange, onReady, onError }: NativeSceneLayersProps) {
	const [results, setResults] = useState<ReadonlyMap<string, NativeSceneAssetState>>(() => new Map());
	const callbacks = useRef({ onStateChange, onReady, onError });
	callbacks.current = { onStateChange, onReady, onError };
	const layers = scene.layers.flatMap(layer => {
		const active = activeLayerIds ? activeLayerIds.has(layer.id)
			: Boolean(layer.actionId && (layer.actionId === focusedId || selectedIds?.has(layer.actionId)));
		if (layer.visibleWhen === "focused" && !active) return [];
		const region = active && layer.focusedRegion ? layer.focusedRegion : layer.region;
		const url = nativeSpriteUrl(source, layer.assetPath, region);
		const mask = layer.maskRegion ? nativeSpriteUrl(source, layer.assetPath, layer.maskRegion) : null;
		return [{ layer, active, region, missing: !url || Boolean(layer.maskRegion && !mask),
			key: JSON.stringify([layer.id, layer.assetPath, region, layer.maskRegion, url, mask]) }];
	});
	const signature = JSON.stringify(layers.map(layer => layer.key));
	const state: NativeSceneAssetState = layers.some(layer => layer.missing || results.get(layer.key) === "failed") ? "failed"
		: layers.every(layer => results.get(layer.key) === "ready") ? "ready" : "loading";
	const mark = useCallback((key: string, result: NativeSceneAssetState) => {
		setResults(previous => {
			if (previous.get(key) === result) return previous;
			const next = new Map(previous); next.set(key, result); return next;
		});
	}, []);
	useEffect(() => {
		callbacks.current.onStateChange?.(state);
		if (state === "ready") callbacks.current.onReady?.();
	}, [state, signature]);

	return <>{layers.map(({ layer, region, active, key }) => <NativeSprite key={key}
		source={source} assetPath={layer.assetPath} region={region} rect={layer.rect}
		drawOrder={layer.drawOrder} rotationDeg={layer.rotationDeg} maskRegion={layer.maskRegion} maskMode={layer.maskMode}
		layerId={layer.id} actionId={layer.actionId} active={active} className={className}
		onStateChange={value => mark(key, value)} onError={failure => callbacks.current.onError?.(failure)} />)}</>;
}
