import { expect, mock, test } from "bun:test";
import * as THREE from "three";
import { disposeObjectResources } from "./resource-lifecycle";

test("disposes shared model resources, skeletons, and bitmap sources exactly once", () => {
	const close = mock(() => {});
	const texture = new THREE.Texture({ close } as unknown as TexImageSource);
	const textureDispose = mock(() => {});
	texture.dispose = textureDispose;
	const material = new THREE.MeshStandardMaterial({ map: texture });
	material.emissiveMap = texture;
	const materialDispose = mock(() => {});
	material.dispose = materialDispose;
	const geometry = new THREE.BufferGeometry();
	const geometryDispose = mock(() => {});
	geometry.dispose = geometryDispose;
	const skeleton = new THREE.Skeleton([new THREE.Bone()]);
	const skeletonDispose = mock(() => {});
	skeleton.dispose = skeletonDispose;

	const root = new THREE.Group();
	const skinned = new THREE.SkinnedMesh(geometry, material);
	skinned.bind(skeleton);
	root.add(skinned, new THREE.Mesh(geometry, material));

	disposeObjectResources(root);

	expect(geometryDispose).toHaveBeenCalledTimes(1);
	expect(materialDispose).toHaveBeenCalledTimes(1);
	expect(textureDispose).toHaveBeenCalledTimes(1);
	expect(skeletonDispose).toHaveBeenCalledTimes(1);
	expect(close).toHaveBeenCalledTimes(1);
});
