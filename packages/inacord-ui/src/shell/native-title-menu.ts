import type { AssetSource } from "@niers/asset-source";

export interface NativeSceneRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface NativeSceneProvenance {
	source: string;
	record: string;
	method: string;
}

export interface NativeSceneLayer {
	id: string;
	assetPath: string;
	region: string;
	rect: NativeSceneRect;
	drawOrder: number;
	rotationDeg?: number;
	maskRegion?: string;
	maskMode?: "alpha" | "luminance";
	actionId?: string;
	visibleWhen?: "focused";
	focusedRegion?: string;
	provenance: NativeSceneProvenance;
}

export interface NativeSceneControl {
	id: string;
	label: string;
	nativeActionHash?: number;
	hostActionId?: string;
	rect: NativeSceneRect;
	provenance: NativeSceneProvenance;
}

export interface NativeSceneText {
	id: string;
	text: string;
	rect: NativeSceneRect;
	drawOrder: number;
	/** Packed 24-bit RGB; the host adds opacity when calling a bitmap-font binding. */
	color?: number;
	provenance: NativeSceneProvenance;
}

export interface NativeSceneSlot {
	id: string;
	rect: NativeSceneRect;
	provenance: NativeSceneProvenance;
}

/** Engine-owned presentation data compiled by nie-formats and returned by its WASM binding. */
export interface NativeMenuScene {
	schemaVersion: number;
	id: string;
	canvas: { width: number; height: number };
	background?: string;
	layers: NativeSceneLayer[];
	controls: NativeSceneControl[];
	texts?: NativeSceneText[];
	slots?: NativeSceneSlot[];
	provenance?: NativeSceneProvenance;
	unresolved: string[];
}

/**
 * Select a named texture or spatial region through the host's decoded-texture binding.
 * The Rust texture endpoint accepts the `.g4tx/<region>` selector and fails on unknown names.
 */
export function nativeAssetUrl(source: Pick<AssetSource, "urlTexture">, path: string, region: string): string | null {
	return source.urlTexture?.(`${path}/${region}`) ?? null;
}
