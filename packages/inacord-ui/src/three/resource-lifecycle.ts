import * as THREE from "three";

/** Release every GPU-backed resource reachable from one imported object tree exactly once. */
export function disposeObjectResources(root: THREE.Object3D) {
	const geometries = new Set<THREE.BufferGeometry>();
	const materials = new Set<THREE.Material>();
	const textures = new Set<THREE.Texture>();
	const skeletons = new Set<THREE.Skeleton>();

	root.traverse((object) => {
		const renderable = object as THREE.Mesh;
		if (renderable.geometry?.isBufferGeometry) geometries.add(renderable.geometry);
		const objectMaterials = Array.isArray(renderable.material) ? renderable.material : [renderable.material];
		for (const material of objectMaterials) {
			if (!material?.isMaterial) continue;
			materials.add(material);
			for (const value of Object.values(material)) {
				if ((value as THREE.Texture | undefined)?.isTexture) textures.add(value as THREE.Texture);
			}
		}
		const skinned = object as THREE.SkinnedMesh;
		if (skinned.isSkinnedMesh && skinned.skeleton) skeletons.add(skinned.skeleton);
	});

	for (const skeleton of skeletons) skeleton.dispose();
	for (const geometry of geometries) geometry.dispose();
	for (const material of materials) material.dispose();
	const closedSources = new Set<unknown>();
	for (const texture of textures) {
		texture.dispose();
		const source = texture.source?.data;
		if (!source || closedSources.has(source)) continue;
		const close = (source as { close?: () => void }).close;
		if (typeof close === "function") {
			close.call(source);
			closedSources.add(source);
		}
	}
}
