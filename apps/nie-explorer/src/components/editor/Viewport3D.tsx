// Viewport 3D TEMPS RÉEL — le cœur du mode éditeur.
//
// Jusqu'ici, « aperçu 3D » voulait dire une image rastérisée côté Rust (`vfs_glb_preview_png_b64`)
// ou une vidéo turntable pré-rendue de 36 images (`..._turntable_mp4_b64`) : la caméra était
// décidée par le backend, et « interactif » se réduisait à faire défiler des images déjà
// calculées. Ici le GLB assemblé (géométrie + textures embarquées, `vfs_glb_bytes_b64`) est chargé
// dans un VRAI moteur temps réel WebGL — caméra libre, éclairage, sélection de maillage,
// wireframe : le viewport d'un éditeur, pas une planche-contact.
//
// three.js est importé depuis le paquet npm (bundlé par Vite) — aucun CDN, l'app reste
// intégralement hors ligne comme le reste de niers (même contrainte que `monacoSetup.ts`).
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { b64ToBytes } from "@/lib/bytes";

/** Un noeud de la scène chargée, à plat — alimente l'outliner. */
export interface SceneNode {
  id: number;
  name: string;
  type: string;
  depth: number;
  /** Nombre de triangles pour un maillage (0 sinon) — l'info que tout éditeur affiche. */
  triangles: number;
}

export interface ViewportStats {
  meshes: number;
  triangles: number;
  vertices: number;
  materials: number;
}

export interface Viewport3DProps {
  /** GLB en base64 (`api.glbBytesB64`) — `null` = viewport vide. */
  glbB64: string | null;
  /** Identifiant du noeud à mettre en surbrillance (depuis l'outliner). */
  selectedId: number | null;
  onSelect?: (id: number | null) => void;
  onSceneLoaded?: (nodes: SceneNode[], stats: ViewportStats) => void;
  wireframe?: boolean;
  showGrid?: boolean;
  className?: string;
}

/** Cadre la caméra sur la boîte englobante de l'objet — sans ça, un modèle de 2 unités et un
 * modèle de 200 unités s'affichent l'un microscopique, l'autre hors champ. */
function frameObject(object: THREE.Object3D, camera: THREE.PerspectiveCamera, controls: OrbitControls) {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const fitDist = (maxDim / 2) / Math.tan((camera.fov * Math.PI) / 360);

  controls.target.copy(center);
  camera.position.set(center.x + fitDist * 0.9, center.y + maxDim * 0.35, center.z + fitDist * 1.4);
  camera.near = maxDim / 1000;
  camera.far = maxDim * 1000;
  camera.updateProjectionMatrix();
  controls.update();
}

export function Viewport3D({
  glbB64,
  selectedId,
  onSelect,
  onSceneLoaded,
  wireframe = false,
  showGrid = true,
  className,
}: Viewport3DProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Objets three.js persistants entre rendus React — dans une ref, jamais dans un état : les
  // toucher ne doit provoquer aucun re-rendu, et la boucle d'animation doit survivre aux
  // changements de props.
  const gl = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    grid: THREE.GridHelper;
    root: THREE.Group | null;
    byId: Map<number, THREE.Object3D>;
    raf: number;
  } | null>(null);

  // Montage : renderer, scène, caméra, éclairage, boucle. Une seule fois — le contexte WebGL est
  // coûteux à recréer et le perdre à chaque changement de fichier ferait clignoter le viewport.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
    camera.position.set(2, 1.5, 3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    // Éclairage neutre à trois sources : les modèles du jeu n'embarquent pas de lumières, un
    // simple ambient les rendrait plats.
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0x99bbff, 0.6);
    fill.position.set(-4, 2, -3);
    scene.add(fill);

    const grid = new THREE.GridHelper(10, 20, 0x3b82f6, 0x2a2c3a);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    scene.add(grid);

    const state = { renderer, scene, camera, controls, grid, root: null as THREE.Group | null, byId: new Map(), raf: 0 };
    gl.current = state;

    const resize = () => {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const tick = () => {
      state.raf = requestAnimationFrame(tick);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(state.raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      gl.current = null;
    };
  }, []);

  // Chargement du modèle courant.
  useEffect(() => {
    const state = gl.current;
    if (!state) return;

    // Libère le modèle précédent : sans `dispose()` explicite, chaque changement de fichier fuit
    // sa géométrie et ses textures dans la mémoire GPU (three.js ne les libère pas tout seul).
    if (state.root) {
      state.scene.remove(state.root);
      state.root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const mat = mesh.material;
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      });
      state.root = null;
      state.byId.clear();
    }

    setError(null);
    if (!glbB64) {
      onSceneLoaded?.([], { meshes: 0, triangles: 0, vertices: 0, materials: 0 });
      return;
    }

    setLoading(true);
    const bytes = b64ToBytes(glbB64);
    // `slice()` : `parse` veut un ArrayBuffer, et celui d'un Uint8Array issu du décodage peut être
    // plus grand que la vue (offset non nul).
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

    let cancelled = false;
    new GLTFLoader().parse(
      buffer,
      "",
      (gltf) => {
        if (cancelled || !gl.current) return;
        const root = new THREE.Group();
        root.add(gltf.scene);
        gl.current.scene.add(root);
        gl.current.root = root;

        // Aplatit la hiérarchie pour l'outliner et indexe les objets par identifiant stable.
        const nodes: SceneNode[] = [];
        const stats: ViewportStats = { meshes: 0, triangles: 0, vertices: 0, materials: 0 };
        const materials = new Set<string>();
        let nextId = 1;

        const walk = (obj: THREE.Object3D, depth: number) => {
          const id = nextId++;
          obj.userData.nieId = id;
          gl.current!.byId.set(id, obj);

          let triangles = 0;
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh && mesh.geometry) {
            const geom = mesh.geometry;
            const count = geom.index ? geom.index.count : geom.getAttribute("position")?.count ?? 0;
            triangles = Math.floor(count / 3);
            stats.meshes += 1;
            stats.triangles += triangles;
            stats.vertices += geom.getAttribute("position")?.count ?? 0;
            const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            mats.forEach((m) => m && materials.add(m.uuid));
          }

          nodes.push({
            id,
            name: obj.name || (mesh.isMesh ? "Mesh" : obj.type),
            type: obj.type,
            depth,
            triangles,
          });
          obj.children.forEach((c) => walk(c, depth + 1));
        };
        gltf.scene.children.forEach((c) => walk(c, 0));
        stats.materials = materials.size;

        frameObject(root, gl.current.camera, gl.current.controls);
        setLoading(false);
        onSceneLoaded?.(nodes, stats);
      },
      (e) => {
        if (cancelled) return;
        setLoading(false);
        setError(`Chargement du modèle : ${e instanceof Error ? e.message : String(e)}`);
      },
    );

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbB64]);

  // Wireframe / grille — appliqués sans recharger le modèle.
  useEffect(() => {
    const state = gl.current;
    if (!state?.root) return;
    state.root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach((m) => {
        if (m && "wireframe" in m) (m as THREE.MeshStandardMaterial).wireframe = wireframe;
      });
    });
  }, [wireframe, glbB64]);

  useEffect(() => {
    if (gl.current) gl.current.grid.visible = showGrid;
  }, [showGrid]);

  // Surbrillance de la sélection : boîte englobante du noeud choisi dans l'outliner.
  useEffect(() => {
    const state = gl.current;
    if (!state) return;
    const previous = state.scene.getObjectByName("__nie_selection__");
    if (previous) state.scene.remove(previous);
    if (selectedId == null) return;
    const target = state.byId.get(selectedId);
    if (!target) return;
    const helper = new THREE.BoxHelper(target, 0x3b82f6);
    helper.name = "__nie_selection__";
    state.scene.add(helper);
  }, [selectedId]);

  // Clic dans le viewport → sélection par lancer de rayon, comme tout éditeur 3D.
  function onPointerDown(e: React.PointerEvent) {
    const state = gl.current;
    if (!state || !state.root) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, state.camera);
    const hit = ray.intersectObject(state.root, true)[0];
    onSelect?.(hit ? (hit.object.userData.nieId as number) ?? null : null);
  }

  return (
    <div className={className} style={{ position: "relative" }}>
      <div ref={hostRef} className="h-full w-full" onPointerDown={onPointerDown} />
      {loading && (
        <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-app-box/80 px-2 py-1 text-tiny text-ink-dull">
          chargement du modèle…
        </div>
      )}
      {error && (
        <div className="absolute left-3 top-3 max-w-[80%] rounded-md bg-app-box/90 px-2 py-1 text-tiny text-status-error">
          {error}
        </div>
      )}
      {!glbB64 && !loading && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-ink-faint">
          Sélectionnez un modèle (.g4md / .g4mg) dans le navigateur de contenu.
        </div>
      )}
    </div>
  );
}
