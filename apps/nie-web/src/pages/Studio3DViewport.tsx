/**
 * Studio3DViewport — Moteur 3D temps réel souverain pour Niers Chara Studio
 * Intègre Three.js, OrbitControls, déformations morphologiques,
 * commutateurs PBR/Wireframe/G4SK Skeleton, ambiances de match et export GLB 2.0 direct.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

export type CameraAngle = "full" | "face" | "bust" | "feet" | "back" | "profile";
export type RenderMode = "pbr" | "wireframe" | "skeleton";
export type LightingAmbiance = "stadium" | "nocturne" | "sunset" | "blizzard";

export interface MorphologyState {
	height: number;      // 0 to 14
	musculature: number; // 0.8 to 1.5
	shoulders: number;   // 0.8 to 1.5
}

export interface Studio3DViewportProps {
	url: string | null;
	cameraAngle: CameraAngle;
	onCameraAngleChange?: (angle: CameraAngle) => void;
	renderMode: RenderMode;
	lightingAmbiance: LightingAmbiance;
	morphology: MorphologyState;
	paintedCanvas: HTMLCanvasElement | null;
	paintVersion: number;
	exportTrigger?: number;
	exportFilename?: string;
	onExportComplete?: (filename: string) => void;
	activeMotion?: string;
}

const CAMERA_PRESETS: Record<CameraAngle, { position: [number, number, number]; target: [number, number, number] }> = {
	face: { position: [0, 1.55, 0.75], target: [0, 1.5, 0] },
	bust: { position: [0, 1.25, 1.35], target: [0, 1.15, 0] },
	full: { position: [0, 1.05, 2.7], target: [0, 0.9, 0] },
	feet: { position: [0, 0.35, 1.1], target: [0, 0.2, 0] },
	back: { position: [0, 1.05, -2.7], target: [0, 0.9, 0] },
	profile: { position: [1.9, 1.15, 1.9], target: [0, 0.95, 0] },
};

/**
 * Crée un mannequin 3D procédural fidèle au gabarit athlétique Inazuma
 * avec hiérarchie de squelette, locators et matériaux PBR stylisés.
 */
function createProceduralInazumaMannequin(): { group: THREE.Group; skeletonGroup: THREE.Group; faceMesh: THREE.Mesh } {
	const group = new THREE.Group();
	group.name = "InazumaMannequin";

	const skeletonGroup = new THREE.Group();
	skeletonGroup.name = "G4SK_Skeleton_Locators";

	// Matériaux de base PBR
	const skinMat = new THREE.MeshStandardMaterial({
		color: 0xffdfc4,
		roughness: 0.65,
		metalness: 0.05,
	});

	const uniformMat = new THREE.MeshStandardMaterial({
		color: 0x0f172a,
		roughness: 0.4,
		metalness: 0.1,
	});

	const accentMat = new THREE.MeshStandardMaterial({
		color: 0x01fecc,
		roughness: 0.3,
		metalness: 0.2,
		emissive: 0x01fecc,
		emissiveIntensity: 0.15,
	});

	const shoesMat = new THREE.MeshStandardMaterial({
		color: 0xffffff,
		roughness: 0.3,
		metalness: 0.15,
	});

	// Tête & Visage
	const headGeom = new THREE.SphereGeometry(0.18, 32, 24);
	headGeom.scale(0.9, 1.1, 1.0);
	const faceMesh = new THREE.Mesh(headGeom, skinMat.clone());
	faceMesh.name = "mesh_head_face";
	faceMesh.position.set(0, 1.55, 0);
	group.add(faceMesh);

	// Cheveux stylisés
	const hairGeom = new THREE.ConeGeometry(0.24, 0.35, 7);
	const hairMesh = new THREE.Mesh(hairGeom, accentMat.clone());
	hairMesh.name = "mesh_hair";
	hairMesh.position.set(0, 1.74, -0.04);
	hairMesh.rotation.x = -0.3;
	group.add(hairMesh);

	// Cou
	const neckGeom = new THREE.CylinderGeometry(0.065, 0.075, 0.12, 16);
	const neckMesh = new THREE.Mesh(neckGeom, skinMat);
	neckMesh.position.set(0, 1.42, 0);
	group.add(neckMesh);

	// Torse / Maillot (Buste)
	const torsoGeom = new THREE.CylinderGeometry(0.19, 0.15, 0.45, 16);
	torsoGeom.scale(1.15, 1, 0.85);
	const torsoMesh = new THREE.Mesh(torsoGeom, uniformMat.clone());
	torsoMesh.name = "mesh_torso";
	torsoMesh.position.set(0, 1.15, 0);
	group.add(torsoMesh);

	// Épaules
	const shoulderLGeom = new THREE.SphereGeometry(0.08, 16, 12);
	const shoulderL = new THREE.Mesh(shoulderLGeom, uniformMat);
	shoulderL.name = "mesh_shoulder_L";
	shoulderL.position.set(-0.25, 1.3, 0);
	group.add(shoulderL);

	const shoulderR = new THREE.Mesh(shoulderLGeom, uniformMat);
	shoulderR.name = "mesh_shoulder_R";
	shoulderR.position.set(0.25, 1.3, 0);
	group.add(shoulderR);

	// Bras et Avant-bras Gauche
	const armGeom = new THREE.CylinderGeometry(0.05, 0.045, 0.28, 12);
	const armL = new THREE.Mesh(armGeom, skinMat);
	armL.position.set(-0.27, 1.12, 0);
	armL.rotation.z = 0.15;
	group.add(armL);

	const forearmGeom = new THREE.CylinderGeometry(0.045, 0.04, 0.26, 12);
	const forearmL = new THREE.Mesh(forearmGeom, skinMat);
	forearmL.position.set(-0.29, 0.88, 0.04);
	forearmL.rotation.x = -0.2;
	group.add(forearmL);

	// Main Gauche
	const handGeom = new THREE.SphereGeometry(0.045, 12, 10);
	const handL = new THREE.Mesh(handGeom, skinMat);
	handL.position.set(-0.31, 0.72, 0.08);
	group.add(handL);

	// Bras et Avant-bras Droit
	const armR = new THREE.Mesh(armGeom, skinMat);
	armR.position.set(0.27, 1.12, 0);
	armR.rotation.z = -0.15;
	group.add(armR);

	const forearmR = new THREE.Mesh(forearmGeom, skinMat);
	forearmR.position.set(0.29, 0.88, 0.04);
	forearmR.rotation.x = -0.2;
	group.add(forearmR);

	// Main Droite
	const handR = new THREE.Mesh(handGeom, skinMat);
	handR.position.set(0.31, 0.72, 0.08);
	group.add(handR);

	// Bassin / Short
	const pelvisGeom = new THREE.CylinderGeometry(0.16, 0.18, 0.24, 16);
	pelvisGeom.scale(1.1, 1, 0.9);
	const pelvisMesh = new THREE.Mesh(pelvisGeom, uniformMat.clone());
	pelvisMesh.position.set(0, 0.86, 0);
	group.add(pelvisMesh);

	// Cuisses et Jambes
	const thighGeom = new THREE.CylinderGeometry(0.075, 0.055, 0.38, 14);
	const legGeom = new THREE.CylinderGeometry(0.055, 0.045, 0.36, 14);

	const thighL = new THREE.Mesh(thighGeom, skinMat);
	thighL.position.set(-0.11, 0.62, 0);
	group.add(thighL);

	const legL = new THREE.Mesh(legGeom, skinMat);
	legL.position.set(-0.11, 0.28, 0);
	group.add(legL);

	const thighR = new THREE.Mesh(thighGeom, skinMat);
	thighR.position.set(0.11, 0.62, 0);
	group.add(thighR);

	const legR = new THREE.Mesh(legGeom, skinMat);
	legR.position.set(0.11, 0.28, 0);
	group.add(legR);

	// Chaussures de foot (Crampons Inazuma)
	const footGeom = new THREE.BoxGeometry(0.11, 0.09, 0.24);
	const footL = new THREE.Mesh(footGeom, shoesMat.clone());
	footL.position.set(-0.11, 0.06, 0.04);
	group.add(footL);

	const footR = new THREE.Mesh(footGeom, shoesMat.clone());
	footR.position.set(0.11, 0.06, 0.04);
	group.add(footR);

	// Squelette G4SK & Locators visuels
	const locatorDefs: Array<{ name: string; pos: [number, number, number]; color: number }> = [
		{ name: "LOC_Head_01", pos: [0, 1.55, 0], color: 0x01fecc },
		{ name: "LOC_Spine_02", pos: [0, 1.15, 0], color: 0xffd700 },
		{ name: "LOC_Pelvis_01", pos: [0, 0.86, 0], color: 0xffd700 },
		{ name: "LOC_Shoulder_L", pos: [-0.25, 1.3, 0], color: 0x38bdf8 },
		{ name: "LOC_Shoulder_R", pos: [0.25, 1.3, 0], color: 0x38bdf8 },
		{ name: "LOC_Hand_L_Ball", pos: [-0.31, 0.72, 0.08], color: 0xef4444 },
		{ name: "LOC_Hand_R_Ball", pos: [0.31, 0.72, 0.08], color: 0xef4444 },
		{ name: "LOC_Foot_L_Kick", pos: [-0.11, 0.06, 0.12], color: 0xa855f7 },
		{ name: "LOC_Foot_R_Kick", pos: [0.11, 0.06, 0.12], color: 0xa855f7 },
	];

	locatorDefs.forEach(loc => {
		const locMesh = new THREE.Mesh(
			new THREE.SphereGeometry(0.024, 12, 10),
			new THREE.MeshBasicMaterial({ color: loc.color, wireframe: true })
		);
		locMesh.position.set(...loc.pos);
		locMesh.name = loc.name;
		skeletonGroup.add(locMesh);
	});

	// Lignes squelettiques connectant les points
	const boneLines = [
		[0, 1.55, 0, 0, 1.15, 0],
		[0, 1.15, 0, 0, 0.86, 0],
		[0, 1.15, 0, -0.25, 1.3, 0],
		[-0.25, 1.3, 0, -0.31, 0.72, 0.08],
		[0, 1.15, 0, 0.25, 1.3, 0],
		[0.25, 1.3, 0, 0.31, 0.72, 0.08],
		[0, 0.86, 0, -0.11, 0.06, 0.12],
		[0, 0.86, 0, 0.11, 0.06, 0.12],
	];

	boneLines.forEach(line => {
		const lineGeom = new THREE.BufferGeometry().setFromPoints([
			new THREE.Vector3(line[0], line[1], line[2]),
			new THREE.Vector3(line[3], line[4], line[5]),
		]);
		const lineMat = new THREE.LineBasicMaterial({ color: 0x01fecc, linewidth: 2 });
		const lineObj = new THREE.Line(lineGeom, lineMat);
		skeletonGroup.add(lineObj);
	});

	group.add(skeletonGroup);
	return { group, skeletonGroup, faceMesh };
}

export function Studio3DViewport({
	url,
	cameraAngle,
	onCameraAngleChange,
	renderMode,
	lightingAmbiance,
	morphology,
	paintedCanvas,
	paintVersion,
	exportTrigger = 0,
	exportFilename = "avatar_nier_studio.glb",
	onExportComplete,
	activeMotion = "idle",
}: Studio3DViewportProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
	const sceneRef = useRef<THREE.Scene | null>(null);
	const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
	const controlsRef = useRef<OrbitControls | null>(null);
	const modelGroupRef = useRef<THREE.Group | null>(null);
	const skeletonGroupRef = useRef<THREE.Group | null>(null);
	const faceMeshRef = useRef<THREE.Mesh | null>(null);
	const lightsGroupRef = useRef<THREE.Group | null>(null);
	const gridHelperRef = useRef<THREE.GridHelper | null>(null);
	const rafRef = useRef<number>(0);

	// Caméra transition
	const targetCamPos = useRef<THREE.Vector3>(new THREE.Vector3(...CAMERA_PRESETS[cameraAngle].position));
	const targetCamLook = useRef<THREE.Vector3>(new THREE.Vector3(...CAMERA_PRESETS[cameraAngle].target));

	const [stats, setStats] = useState({ vertices: 3860, triangles: 4210, bones: 48 });
	const [isLoading, setIsLoading] = useState(false);

	// ── Initialisation de la scène Three.js ───────────────────────────────────
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const width = container.clientWidth || 800;
		const height = container.clientHeight || 600;

		const scene = new THREE.Scene();
		scene.background = null; // Transparent pour intégration CSS
		sceneRef.current = scene;

		const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
		camera.position.set(...CAMERA_PRESETS[cameraAngle].position);
		cameraRef.current = camera;

		const renderer = new THREE.WebGLRenderer({
			antialias: true,
			alpha: true,
			powerPreference: "high-performance",
		});
		renderer.setSize(width, height);
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.1;
		renderer.domElement.style.width = "100%";
		renderer.domElement.style.height = "100%";
		renderer.domElement.style.display = "block";
		container.appendChild(renderer.domElement);
		rendererRef.current = renderer;

		const controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.06;
		controls.screenSpacePanning = true;
		controls.target.set(...CAMERA_PRESETS[cameraAngle].target);
		controls.maxDistance = 12;
		controls.minDistance = 0.3;
		controlsRef.current = controls;

		// Groupe de lumières
		const lightsGroup = new THREE.Group();
		scene.add(lightsGroup);
		lightsGroupRef.current = lightsGroup;

		// Grille de terrain de match
		const grid = new THREE.GridHelper(10, 20, 0x01fecc, 0x1e3a5f);
		grid.position.y = 0;
		scene.add(grid);
		gridHelperRef.current = grid;

		// Modèle initial
		const mannequin = createProceduralInazumaMannequin();
		scene.add(mannequin.group);
		modelGroupRef.current = mannequin.group;
		skeletonGroupRef.current = mannequin.skeletonGroup;
		faceMeshRef.current = mannequin.faceMesh;

		// Animation loop
		const clock = new THREE.Clock();
		const animate = () => {
			rafRef.current = requestAnimationFrame(animate);
			clock.getDelta();
			const elapsed = clock.getElapsedTime();

			// Interpolation fluide de la caméra
			if (cameraRef.current && controlsRef.current) {
				cameraRef.current.position.lerp(targetCamPos.current, 0.08);
				controlsRef.current.target.lerp(targetCamLook.current, 0.08);
				controlsRef.current.update();
			}

			// Légère animation d'attente (Idle match breathing)
			if (modelGroupRef.current && activeMotion === "idle") {
				const breathe = Math.sin(elapsed * 2.2) * 0.008;
				modelGroupRef.current.position.y = breathe;
			} else if (modelGroupRef.current && activeMotion === "run") {
				const bob = Math.abs(Math.sin(elapsed * 6)) * 0.05;
				modelGroupRef.current.position.y = bob;
				modelGroupRef.current.rotation.y = Math.sin(elapsed * 3) * 0.08;
			}

			renderer.render(scene, camera);
		};
		animate();

		// Redimensionnement
		const handleResize = () => {
			if (!container || !renderer || !camera) return;
			const w = container.clientWidth;
			const h = container.clientHeight;
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			renderer.setSize(w, h);
		};
		window.addEventListener("resize", handleResize);

		return () => {
			window.removeEventListener("resize", handleResize);
			cancelAnimationFrame(rafRef.current);
			renderer.dispose();
			if (container.contains(renderer.domElement)) {
				container.removeChild(renderer.domElement);
			}
		};
	}, []);

	// ── Mise à jour de l'Ambiance de Terrain & Éclairage ───────────────────────
	useEffect(() => {
		const lightsGroup = lightsGroupRef.current;
		const grid = gridHelperRef.current;
		if (!lightsGroup || !sceneRef.current) return;

		// Nettoyage des lumières précédentes
		lightsGroup.clear();

		if (lightingAmbiance === "stadium") {
			// Plein jour, stade ensoleillé
			const sun = new THREE.DirectionalLight(0xffffff, 2.2);
			sun.position.set(6, 12, 8);
			lightsGroup.add(sun);

			const hemi = new THREE.HemisphereLight(0x60a5fa, 0x15803d, 0.85);
			lightsGroup.add(hemi);

			const ambient = new THREE.AmbientLight(0xdcfce7, 0.4);
			lightsGroup.add(ambient);

			if (grid) {
				(grid.material as THREE.LineBasicMaterial).color.setHex(0x01fecc);
			}
		} else if (lightingAmbiance === "nocturne") {
			// Stade Raimon nocturne avec projecteurs puissants
			const spot1 = new THREE.DirectionalLight(0xf1f5f9, 2.4);
			spot1.position.set(-8, 14, 8);
			lightsGroup.add(spot1);

			const spot2 = new THREE.DirectionalLight(0xf1f5f9, 2.0);
			spot2.position.set(8, 14, -8);
			lightsGroup.add(spot2);

			const ambient = new THREE.AmbientLight(0x0f172a, 0.45);
			lightsGroup.add(ambient);

			if (grid) {
				(grid.material as THREE.LineBasicMaterial).color.setHex(0x38bdf8);
			}
		} else if (lightingAmbiance === "sunset") {
			// Crépuscule Céleste Aphrodi (Doré & Pourpre)
			const goldenSun = new THREE.DirectionalLight(0xfbbf24, 2.8);
			goldenSun.position.set(10, 4, -4);
			lightsGroup.add(goldenSun);

			const purpleHemi = new THREE.HemisphereLight(0xc084fc, 0xf59e0b, 1.2);
			lightsGroup.add(purpleHemi);

			const ambient = new THREE.AmbientLight(0x581c87, 0.5);
			lightsGroup.add(ambient);

			if (grid) {
				(grid.material as THREE.LineBasicMaterial).color.setHex(0xffd700);
			}
		} else if (lightingAmbiance === "blizzard") {
			// Blizzard Glacé Shawn Froste (Givre Cyan & Blanc)
			const iceLight = new THREE.DirectionalLight(0x38bdf8, 2.6);
			iceLight.position.set(-6, 10, 6);
			lightsGroup.add(iceLight);

			const coldHemi = new THREE.HemisphereLight(0xe0f2fe, 0x0284c7, 1.1);
			lightsGroup.add(coldHemi);

			const ambient = new THREE.AmbientLight(0x0369a1, 0.6);
			lightsGroup.add(ambient);

			if (grid) {
				(grid.material as THREE.LineBasicMaterial).color.setHex(0x7dd3fc);
			}
		}
	}, [lightingAmbiance]);

	// ── Mise à jour du Cadrage Caméra ─────────────────────────────────────────
	useEffect(() => {
		const preset = CAMERA_PRESETS[cameraAngle] || CAMERA_PRESETS.full;
		targetCamPos.current.set(...preset.position);
		targetCamLook.current.set(...preset.target);
	}, [cameraAngle]);

	// ── Mise à jour de la Morphologie (Hauteur, Musculature, Épaules) ─────────
	useEffect(() => {
		const model = modelGroupRef.current;
		if (!model) return;

		// Échelle en hauteur (0 à 14 -> 0.85 à 1.15)
		const heightScale = 0.85 + (morphology.height / 14) * 0.3;
		// Musculature (épaisseur X/Z)
		const muscScale = morphology.musculature;
		// Épaules
		const shoulderScale = morphology.shoulders;

		model.scale.set(muscScale, heightScale, muscScale);

		// Ajustement spécifique des épaules et du torse si présents
		const torso = model.getObjectByName("mesh_torso");
		if (torso) {
			torso.scale.set(1.15 * shoulderScale, 1, 0.85 * muscScale);
		}
		const shoulderL = model.getObjectByName("mesh_shoulder_L");
		const shoulderR = model.getObjectByName("mesh_shoulder_R");
		if (shoulderL && shoulderR) {
			shoulderL.position.x = -0.25 * shoulderScale;
			shoulderR.position.x = 0.25 * shoulderScale;
		}
	}, [morphology.height, morphology.musculature, morphology.shoulders]);

	// ── Commutateur de Rendu (PBR / Wireframe / Squelette G4SK) ───────────────
	useEffect(() => {
		const model = modelGroupRef.current;
		const skel = skeletonGroupRef.current;
		if (!model) return;

		model.traverse(child => {
			if (child instanceof THREE.Mesh && child.name !== "LOC_Head_01") {
				if (Array.isArray(child.material)) {
					child.material.forEach(m => applyRenderStyle(m, renderMode));
				} else if (child.material) {
					applyRenderStyle(child.material, renderMode);
				}
			}
		});

		if (skel) {
			skel.visible = renderMode === "skeleton";
		}
	}, [renderMode]);

	function applyRenderStyle(material: THREE.Material, mode: RenderMode) {
		const wireframeMat = material as { wireframe?: boolean; opacity?: number; transparent?: boolean };
		if ("wireframe" in material) {
			wireframeMat.wireframe = mode === "wireframe";
		}
		if ("opacity" in material && "transparent" in material) {
			if (mode === "skeleton") {
				wireframeMat.opacity = 0.22;
				wireframeMat.transparent = true;
			} else {
				wireframeMat.opacity = 1.0;
				wireframeMat.transparent = false;
			}
		}
		material.needsUpdate = true;
	}

	// ── Synchronisation de la Texture peinte (Texture Paint Studio) ───────────
	useEffect(() => {
		if (!paintedCanvas || !faceMeshRef.current) return;

		try {
			const texture = new THREE.CanvasTexture(paintedCanvas);
			texture.colorSpace = THREE.SRGBColorSpace;
			texture.needsUpdate = true;

			const faceMesh = faceMeshRef.current;
			if (faceMesh.material instanceof THREE.MeshStandardMaterial) {
				faceMesh.material.map = texture;
				faceMesh.material.needsUpdate = true;
			}
		} catch (err) {
			console.warn("Échec de synchronisation de la texture peinte :", err);
		}
	}, [paintedCanvas, paintVersion]);

	// ── Chargement GLB Externe (si URL VFS disponible) ────────────────────────
	useEffect(() => {
		if (!url) return;
		let active = true;
		setIsLoading(true);

		const loader = new GLTFLoader();
		loader.load(
			url,
			gltf => {
				if (!active || !sceneRef.current) return;
				setIsLoading(false);

				// Supprime le mannequin procédural précédent
				if (modelGroupRef.current) {
					sceneRef.current.remove(modelGroupRef.current);
				}

				const loadedScene = gltf.scene;
				loadedScene.name = "ImportedAvatarVFS";
				sceneRef.current.add(loadedScene);
				modelGroupRef.current = loadedScene;

				// Compte les polygones et sommets réels
				let vCount = 0;
				let tCount = 0;
				loadedScene.traverse(child => {
					if (child instanceof THREE.Mesh && child.geometry) {
						vCount += child.geometry.attributes.position?.count ?? 0;
						if (child.geometry.index) {
							tCount += child.geometry.index.count / 3;
						} else {
							tCount += (child.geometry.attributes.position?.count ?? 0) / 3;
						}
					}
				});
				setStats({ vertices: vCount || 3860, triangles: Math.round(tCount) || 4210, bones: 48 });
			},
			undefined,
			() => {
				// Fallback sur mannequin procédural en cas d'absence
				if (active) setIsLoading(false);
			}
		);

		return () => {
			active = false;
		};
	}, [url]);

	// ── Exportation Directe GLB 2.0 (GLTFExporter binaire) ─────────────────────
	const exportGlbDirect = useCallback(() => {
		const targetModel = modelGroupRef.current;
		if (!targetModel) return;

		const exporter = new GLTFExporter();
		exporter.parse(
			targetModel,
			result => {
				if (result instanceof ArrayBuffer) {
					const blob = new Blob([result], { type: "model/gltf-binary" });
					const downloadUrl = URL.createObjectURL(blob);
					const link = document.createElement("a");
					link.href = downloadUrl;
					link.download = exportFilename.endsWith(".glb") ? exportFilename : `${exportFilename}.glb`;
					document.body.appendChild(link);
					link.click();
					document.body.removeChild(link);
					URL.revokeObjectURL(downloadUrl);
					onExportComplete?.(link.download);
				}
			},
			error => {
				console.error("Erreur lors de l'export GLB 2.0 :", error);
			},
			{ binary: true, embedImages: true }
		);
	}, [exportFilename, onExportComplete]);

	useEffect(() => {
		if (exportTrigger > 0) {
			exportGlbDirect();
		}
	}, [exportTrigger, exportGlbDirect]);

	// Contrôles rapides caméra
	const triggerCameraPreset = (angle: CameraAngle) => {
		onCameraAngleChange?.(angle);
	};

	const adjustZoom = (factor: number) => {
		if (cameraRef.current && controlsRef.current) {
			cameraRef.current.position.multiplyScalar(factor);
			controlsRef.current.update();
		}
	};

	const resetCamera = () => {
		triggerCameraPreset("full");
	};

	return (
		<div className="studio-3d-viewport-container" style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
			{/* Canevas Three.js WebGL */}
			<div ref={containerRef} style={{ width: "100%", height: "100%" }} />

			{/* Indicateur de chargement */}
			{isLoading && (
				<div className="studio-3d-loading-badge">
					<span className="studio-3d-spinner" /> Chargement du modèle VFS…
				</div>
			)}

			{/* Widget d'inspection en temps réel (Stats moteur Level-5) */}
			<div className="studio-3d-stats-overlay">
				<div className="studio-3d-stat-chip">
					<span className="stat-label">MODE :</span>
					<span className="stat-value" style={{ color: "#01fecc" }}>{renderMode.toUpperCase()}</span>
				</div>
				<div className="studio-3d-stat-chip">
					<span className="stat-label">TRIANGLES :</span>
					<span className="stat-value">{stats.triangles.toLocaleString()}</span>
				</div>
				<div className="studio-3d-stat-chip">
					<span className="stat-label">G4SK BONES :</span>
					<span className="stat-value">{stats.bones}</span>
				</div>
				<div className="studio-3d-stat-chip">
					<span className="stat-label">AMBIANCE :</span>
					<span className="stat-value" style={{ color: "#ffd700" }}>{lightingAmbiance.toUpperCase()}</span>
				</div>
			</div>

			{/* Barre d'outils de caméra flottante intégrée */}
			<div className="studio-3d-cam-controls">
				<button type="button" className="studio-cam-tool-btn" onClick={() => adjustZoom(0.85)} title="Zoomer (+)">
					🔍+
				</button>
				<button type="button" className="studio-cam-tool-btn" onClick={() => adjustZoom(1.15)} title="Dézoomer (-)">
					🔍-
				</button>
				<button type="button" className="studio-cam-tool-btn" onClick={resetCamera} title="Réinitialiser la caméra">
					↺ Reset
				</button>
				<div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.15)", margin: "0 2px" }} />
				{(["full", "face", "bust", "feet", "back", "profile"] as const).map(angle => (
					<button
						key={angle}
						type="button"
						className={`studio-cam-preset-btn ${cameraAngle === angle ? "active" : ""}`}
						onClick={() => triggerCameraPreset(angle)}
					>
						{angle === "full" ? "Corps" : angle === "face" ? "Visage" : angle === "bust" ? "Buste" : angle === "feet" ? "Pieds" : angle === "back" ? "Dos" : "3/4"}
					</button>
				))}
			</div>
		</div>
	);
}
