/**
 * Le viewport d'éditeur adossé au rendu **Rust**, au contrat de `Viewport3D` (three.js).
 *
 * # Pourquoi ce composant existe
 *
 * L'éditeur du dépôt porte deux rendus 3D : `Viewport3D.tsx` (646 lignes de three.js, un seul
 * consommateur — `EditorView`) et `nie-render3d`, qui sert déjà tout le reste. Le premier
 * survivait pour quatre capacités que le second n'avait pas : grille, fil de fer, contour de
 * sélection et gizmo. Elles existent maintenant côté Rust, jusqu'aux façades wasm.
 *
 * Ce composant expose **les mêmes props**, de sorte que basculer l'éditeur ne coûte qu'un
 * import. Réécrire `EditorView` (1 049 lignes) pour changer de rendu aurait mêlé deux
 * changements dont l'un seulement est vérifiable.
 *
 * # Ce qu'il ne fait pas, et pourquoi c'est dit plutôt que caché
 *
 * - **Le gizmo ne manipule pas encore.** Ses poignées sont dessinées par le Rust et la
 *   géométrie du glissement existe (`nie_render3d::gizmo::drag_along_axis`), mais la boucle
 *   pointeur → axe attrapé → `onTransform` n'est pas branchée. `gizmoMode` n'a donc d'effet que
 *   sur l'affichage des poignées. Un composant qui prétendrait manipuler sans le faire serait
 *   pire que celui-ci : l'utilisateur glisserait sans rien déplacer.
 * - **Pas d'image de référence.** `referenceImage` est accepté et ignoré ; le canvas Rust n'est
 *   pas transparent sur le chemin WebGL.
 *
 * Tant que ces deux points tiennent, `Viewport3D` reste le viewport de l'éditeur et celui-ci
 * est un remplaçant partiel, pas un successeur.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
	isSceneViewer,
	type CreateRustModelViewer,
	type RustSceneViewer,
} from "./rust-model-viewport";
import type {
	GizmoMode,
	SceneNode,
	ViewportAsset,
	ViewportReferenceImage,
	ViewportStats,
} from "../three/Viewport3D";

export interface RustSceneViewportProps {
	/** Décodage du transport seulement ; l'assemblage natif reste au propriétaire Rust. */
	services: { decodeBase64: (base64: string) => Uint8Array };
	/** Assets composant la scène, dans l'ordre d'affichage. Vide = viewport vide. */
	assets: ViewportAsset[];
	/** Identifiant du noeud à mettre en surbrillance. */
	selectedId: string | null;
	onSelect?: (id: string | null) => void;
	onSceneLoaded?: (nodes: SceneNode[], stats: ViewportStats) => void;
	/** Accepté pour la compatibilité de contrat ; la manipulation n'est pas branchée. */
	gizmoMode?: GizmoMode;
	notice?: string | null;
	wireframe?: boolean;
	showGrid?: boolean;
	/** Accepté et ignoré — cf. l'en-tête. */
	referenceImage?: ViewportReferenceImage | null;
	className?: string;
	/** Fabrique du viewer wasm. Injectée pour que le composant reste testable sans WebGPU. */
	createViewer: CreateRustModelViewer;
}

const CANVAS_STYLE: CSSProperties = { width: "100%", height: "100%", display: "block" };

export function RustSceneViewport({
	services,
	assets,
	selectedId,
	onSelect,
	onSceneLoaded,
	notice,
	wireframe = false,
	showGrid = true,
	className,
	createViewer,
}: RustSceneViewportProps) {
	const canvasRef = useRef<HTMLCanvasElement | null>(null);
	const viewerRef = useRef<RustSceneViewer | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);

	// Construction et destruction du viewer. `cancelled` garde contre le démontage pendant
	// l'attente : sans lui, un viewer construit après le démontage ne serait jamais libéré.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas) return;
		let cancelled = false;
		let created: RustSceneViewer | null = null;

		createViewer(canvas)
			.then((viewer) => {
				if (!isSceneViewer(viewer)) {
					viewer.free();
					throw new Error(
						"ce viewer Rust n'expose pas les capacités de scène (load_scene, pick_json, set_grid…)",
					);
				}
				if (cancelled) {
					viewer.free();
					return;
				}
				created = viewer;
				viewerRef.current = viewer;
				setReady(true);
			})
			.catch((cause: unknown) => {
				if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
			});

		return () => {
			cancelled = true;
			created?.free();
			viewerRef.current = null;
			setReady(false);
		};
	}, [createViewer]);

	// Signature du CONTENU des assets, et non identité du tableau.
	//
	// Un parent qui reconstruit `assets` à chaque rendu — ce que fait tout composant dérivant sa
	// liste d'un état — donnerait une référence neuve à chaque clic de case à cocher, et la scène
	// entière serait recomposée et retéléversée pour un changement d'affichage. `revision` entre
	// dans la signature parce qu'une même clé peut recevoir de nouveaux octets.
	const assetsSignature = useMemo(
		() => assets.map((a) => `${a.key}@${a.revision ?? 0}`).join("|"),
		[assets],
	);
	// Les octets restent accessibles à l'effet sans le déclencher : seule la signature le fait.
	const assetsRef = useRef(assets);
	assetsRef.current = assets;

	// Composition de la scène. Les assets sont déposés puis un document les référence : c'est le
	// contrat de `load_scene`, qui nomme chaque objet et permet à `pick_json` de le retrouver.
	useEffect(() => {
		const viewer = viewerRef.current;
		if (!viewer || !ready) return;
		const assets = assetsRef.current;
		try {
			viewer.clear_assets();
			if (assets.length === 0) {
				onSceneLoaded?.([], { meshes: 0, triangles: 0, vertices: 0, materials: 0 });
				return;
			}
			for (const asset of assets) {
				viewer.stage_asset(asset.key, services.decodeBase64(asset.glbB64));
			}
			const objects = assets.map((asset, index) => ({
				id: `${asset.key}#${index}`,
				name: asset.key,
				asset: asset.key,
				position: [0, 0, 0],
				rotation: [0, 0, 0, 1],
				scale: [1, 1, 1],
				visible: true,
			}));
			viewer.load_scene(JSON.stringify({ version: 2, objects }));
			onSceneLoaded?.(
				objects.map((o, depth) => ({
					id: o.id,
					assetKey: o.asset,
					name: o.name,
					type: "Mesh",
					depth: depth === 0 ? 0 : 1,
					triangles: 0,
				})),
				{ meshes: objects.length, triangles: 0, vertices: 0, materials: 0 },
			);
			setError(null);
		} catch (cause: unknown) {
			setError(cause instanceof Error ? cause.message : String(cause));
		}
	}, [assetsSignature, ready, services, onSceneLoaded]);

	// Les bascules et la sélection sont poussées séparément de la scène : les recomposer
	// ensemble retéléverserait toute la géométrie pour un simple changement de case à cocher.
	useEffect(() => {
		const viewer = viewerRef.current;
		if (!viewer || !ready) return;
		viewer.set_grid(showGrid);
		viewer.set_wireframe(wireframe);
	}, [showGrid, wireframe, ready]);

	useEffect(() => {
		const viewer = viewerRef.current;
		if (!viewer || !ready) return;
		viewer.select(selectedId ?? "");
	}, [selectedId, ready]);

	// Clic : `pick_json` nomme l'objet touché, `undefined` sur le fond — ce qui désélectionne,
	// comme tout éditeur.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !ready || !onSelect) return;
		const onClick = (event: MouseEvent) => {
			const viewer = viewerRef.current;
			if (!viewer) return;
			const rect = canvas.getBoundingClientRect();
			const hit = viewer.pick_json(event.clientX - rect.left, event.clientY - rect.top);
			if (!hit) {
				onSelect(null);
				return;
			}
			try {
				const parsed = JSON.parse(hit) as { owner?: string };
				onSelect(parsed.owner ?? null);
			} catch {
				onSelect(null);
			}
		};
		canvas.addEventListener("click", onClick);
		return () => canvas.removeEventListener("click", onClick);
	}, [ready, onSelect]);

	return (
		<div className={className} style={{ position: "relative", width: "100%", height: "100%" }}>
			<canvas ref={canvasRef} style={CANVAS_STYLE} />
			{(error ?? notice) ? (
				<p style={{ position: "absolute", inset: "auto 0 0 0", margin: 0, padding: "0.5rem" }}>
					{error ?? notice}
				</p>
			) : null}
		</div>
	);
}
