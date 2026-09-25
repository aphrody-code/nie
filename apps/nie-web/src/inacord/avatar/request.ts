import type { AvatarComposition } from "./contract";

/** Existing HTTP compatibility route; Rust has already resolved every resource relationship. */
export function avatarModelUrl(composition: AvatarComposition, assetBase = "/assets"): string {
	const path = composition.pieces.map(piece => `${encodeURIComponent(piece.directory)}/${encodeURIComponent(piece.name)}`).join("+");
	const query = new URLSearchParams();
	if (composition.faceLayers.length) query.set("face", composition.faceLayers.join(","));
	query.set("morpho", composition.morphology);
	if (composition.height !== null) query.set("taille", String(composition.height));
	if (composition.skinColor || composition.irisColor) query.set("tint", [composition.skinColor ?? "F3CAC1", composition.irisColor ?? "533B3B", "FFFFFF"].join(","));
	if (composition.hairColor) query.set("hair", composition.hairColor);
	return `${assetBase.replace(/\/$/, "")}/model-avatar/${path}.glb?${query}`;
}
