import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

interface ViewerOptions {
	src: string;
	alt: string;
	autoRotate?: boolean;
	onLoad(): void;
	onError(error: unknown): void;
}

/** Scène commune aux fiches et aux galeries. Le GLB reste la source de géométrie et de pose. */
export function mountCharacterRenderer(host: HTMLElement, options: ViewerOptions) {
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.domElement.setAttribute("role", "img");
	renderer.domElement.setAttribute("aria-label", options.alt);
	renderer.domElement.tabIndex = 0;
	renderer.domElement.style.cssText = "width:100%;height:100%;display:block;touch-action:pan-y";
	host.replaceChildren(renderer.domElement);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 1000);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.enablePan = false;
	controls.autoRotate = options.autoRotate ?? false;
	controls.autoRotateSpeed = 1.6;
	const light = new THREE.DirectionalLight(0xffffff, Math.PI);
	light.position.set(-3, 5, 4);
	scene.add(light);
	const fill = new THREE.AmbientLight(0xffffff, 0);
	scene.add(fill);
	const controller = new AbortController();
	const geometries = new Set<THREE.BufferGeometry>();
	const materials = new Set<THREE.Material>();
	const textures = new Set<THREE.Texture>();
	const skeletons = new Set<THREE.Skeleton>();
	let disposed = false;
	let root: THREE.Group | undefined;
	let radius = 1;
	let fitted = false;
	const trackMaterial = (material: THREE.Material) => {
		materials.add(material);
		for (const value of Object.values(material)) {
			if (value instanceof THREE.Texture) textures.add(value);
		}
	};
	const releaseAssets = () => {
		for (const geometry of geometries) geometry.dispose();
		for (const material of materials) material.dispose();
		for (const texture of textures) {
			texture.dispose();
			if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close();
		}
		for (const skeleton of skeletons) skeleton.dispose();
		geometries.clear(); materials.clear(); textures.clear(); skeletons.clear();
	};
	const resize = () => {
		const width = Math.max(1, host.clientWidth), height = Math.max(1, host.clientHeight);
		renderer.setSize(width, height, false);
		camera.aspect = width / height;
		camera.updateProjectionMatrix();
		if (root && !fitted && width > 1 && height > 1) {
			const fov = THREE.MathUtils.degToRad(camera.fov);
			const distance = radius / Math.sin(Math.min(fov / 2, Math.atan(Math.tan(fov / 2) * camera.aspect))) * 1.08;
			camera.position.copy(controls.target).add(new THREE.Vector3(0, distance * 0.087, distance));
			camera.near = Math.max(0.001, distance / 1000);
			camera.far = distance * 100;
			controls.minDistance = radius * 1.1;
			controls.maxDistance = distance * 4;
			camera.updateProjectionMatrix();
			controls.update();
			fitted = true;
		}
	};
	const observer = new ResizeObserver(resize);
	observer.observe(host);
	resize();
	let previousTime = 0;
	renderer.setAnimationLoop((time) => {
		const delta = previousTime ? Math.min((time - previousTime) / 1000, 0.1) : 0;
		previousTime = time;
		controls.update(delta);
		renderer.render(scene, camera);
	});
	const keydown = (event: KeyboardEvent) => {
		if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
		event.preventDefault();
		const offset = camera.position.clone().sub(controls.target);
		const spherical = new THREE.Spherical().setFromVector3(offset);
		if (event.key === "ArrowLeft") spherical.theta -= Math.PI / 12;
		if (event.key === "ArrowRight") spherical.theta += Math.PI / 12;
		if (event.key === "ArrowUp") spherical.phi -= Math.PI / 18;
		if (event.key === "ArrowDown") spherical.phi += Math.PI / 18;
		spherical.makeSafe();
		camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));
		controls.update();
	};
	renderer.domElement.addEventListener("keydown", keydown);
	const contextLost = (event: Event) => {
		event.preventDefault();
		if (!disposed) options.onError(new Error("Contexte graphique perdu"));
	};
	renderer.domElement.addEventListener("webglcontextlost", contextLost);

	async function load() {
		const response = await fetch(options.src, { signal: controller.signal });
		if (!response.ok) throw new Error(`GLB indisponible (${response.status})`);
		const bytes = await response.arrayBuffer();
		if (disposed) return;
		const gltf: GLTF = await new GLTFLoader().parseAsync(bytes, new URL(".", new URL(options.src, location.href)).href);
		root = gltf.scene;
		const meshes: THREE.Mesh[] = [];
		root.traverse((object) => {
			if (!(object instanceof THREE.Mesh)) return;
			meshes.push(object);
			geometries.add(object.geometry);
			for (const material of Array.isArray(object.material) ? object.material : [object.material]) trackMaterial(material);
			if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
		});
		if (disposed) { releaseAssets(); return; }
		// Les textures auxiliaires sont déclarées par le serveur dans extras.nie, par matériau.
		const toonBySource = new Map<THREE.Material, THREE.Material>();
		for (const mesh of meshes) {
			const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			const replacements: THREE.Material[] = [];
			for (const original of sourceMaterials) {
				const cached = toonBySource.get(original);
				if (cached) { replacements.push(cached); continue; }
				const character = original.userData.nie;
				if (!(original instanceof THREE.MeshStandardMaterial) || character?.shader !== "Character") {
					fill.intensity = 1;
					replacements.push(original);
					continue;
				}
				const lineIndex = character.textures?.line?.texture;
				const occlusionIndex = character.textures?.occlusion?.texture;
				const line: THREE.Texture | null = Number.isInteger(lineIndex) ? await gltf.parser.getDependency("texture", lineIndex) : null;
				const occlusion: THREE.Texture | null = Number.isInteger(occlusionIndex) ? await gltf.parser.getDependency("texture", occlusionIndex) : null;
				if (line) textures.add(line);
				if (occlusion) textures.add(occlusion);
				if (disposed) { releaseAssets(); return; }
				const toon = new THREE.MeshToonMaterial({
					name: original.name, color: original.color, map: original.map,
					transparent: original.transparent, opacity: original.opacity,
					alphaTest: original.alphaTest, side: original.side,
					vertexColors: original.vertexColors, normalMap: line,
				});
				toon.userData = original.userData;
				toon.onBeforeCompile = (shader) => {
					// Palette de présentation cel : albédo intact à la lumière, ombre chaude.
					shader.uniforms.nieShadow = { value: new THREE.Vector3(0.62, 0.35, 0.40) };
					if (occlusion) shader.uniforms.nieOcclusion = { value: occlusion };
					shader.fragmentShader = shader.fragmentShader.replace("#include <gradientmap_pars_fragment>", `
uniform vec3 nieShadow;
${occlusion ? "uniform sampler2D nieOcclusion;" : ""}
vec3 getGradientIrradiance(vec3 normal, vec3 lightDirection) {
 float brightness = dot(normal, lightDirection) * 0.5 + 0.5;
 ${occlusion ? "brightness += texture2D(nieOcclusion, vMapUv).r * 0.18 - 0.18;" : ""}
 float edge = max(fwidth(brightness), 0.002);
 return mix(nieShadow, vec3(1.0), smoothstep(0.60-edge, 0.60+edge, brightness));
}`);
					if (line) shader.fragmentShader = shader.fragmentShader.replace("#include <normal_fragment_maps>", `
#ifdef USE_NORMALMAP_TANGENTSPACE
 vec4 packedNormal = texture2D(normalMap, vNormalMapUv);
 vec2 xy = packedNormal.rg * 2.0 - 1.0;
 vec3 mapN = vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy))));
 mapN.xy *= normalScale;
 normal = normalize(tbn * mapN);
#endif`);
				};
				toon.customProgramCacheKey = () => `nie-cel-1-${Boolean(line)}-${Boolean(occlusion)}`;
				trackMaterial(toon);
				toonBySource.set(original, toon);
				replacements.push(toon);
			}
			mesh.material = Array.isArray(mesh.material) ? replacements : replacements[0];
		}
		root.updateMatrixWorld(true);
		const box = new THREE.Box3().setFromObject(root, true);
		if (box.isEmpty()) throw new Error("Modèle vide");
		const sphere = box.getBoundingSphere(new THREE.Sphere());
		radius = sphere.radius;
		controls.target.copy(sphere.center);
		// Contour géométrique qui suit le même squelette et la même pose.
		const outline = new THREE.MeshBasicMaterial({ color: 0x292130, side: THREE.BackSide });
		outline.onBeforeCompile = (shader) => {
			shader.uniforms.nieOutline = { value: box.getSize(new THREE.Vector3()).y * 0.0012 };
			shader.vertexShader = `uniform float nieOutline;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "vec3 transformed = vec3(position) + normal * nieOutline;");
		};
		outline.customProgramCacheKey = () => "nie-outline-1";
		materials.add(outline);
		for (const mesh of meshes) {
			const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
			if (!mats.every((mat) => mat instanceof THREE.MeshToonMaterial && !mat.transparent && mat.alphaTest === 0)) continue;
			const shell = mesh.clone(false);
			shell.material = outline;
			shell.name = `${mesh.name}_contour`;
			mesh.parent?.add(shell);
		}
		scene.add(root);
		resize();
		renderer.compile(scene, camera);
		options.onLoad();
	}
	void load().catch((error) => { if (!disposed) options.onError(error); });
	return {
		setAngle(degrees: number) {
			const distance = camera.position.distanceTo(controls.target);
			camera.position.copy(controls.target).add(new THREE.Vector3(Math.sin(THREE.MathUtils.degToRad(degrees)) * distance, distance * 0.087, Math.cos(THREE.MathUtils.degToRad(degrees)) * distance));
			controls.update();
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			controller.abort(); observer.disconnect();
			renderer.setAnimationLoop(null); controls.dispose();
			renderer.domElement.removeEventListener("keydown", keydown);
			renderer.domElement.removeEventListener("webglcontextlost", contextLost);
			scene.clear(); releaseAssets(); renderer.dispose(); renderer.forceContextLoss();
			renderer.domElement.remove();
		},
	};
}
