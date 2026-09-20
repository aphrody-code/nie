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
	NodeTransform,
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
	/** Émis à chaque déplacement du gizmo. Seul `translate` a un effet. */
	onTransform?: (id: string, trs: NodeTransform) => void;
	/** `translate`, `rotate` et `scale` manipulent ; `none` ne dessine aucune poignée. */
	gizmoMode?: GizmoMode;
	notice?: string | null;
	wireframe?: boolean;
	showGrid?: boolean;
	/** Accepté et ignoré — cf. l'en-tête. */
	referenceImage?: ViewportReferenceImage | null;
	className?: string;
	/** Fabrique du viewer wasm. Injectée pour que le composant reste testable sans WebGPU. */
	createViewer: CreateRustModelViewer;
	/**
	 * Appelé quand le viewer ne peut PAS être construit — ni WebGPU ni WebGL 2, ou un viewer
	 * amputé des capacités de scène.
	 *
	 * Sépare « l'éditeur ne marchera pas ici » de « cette scène n'a pas chargé » : le premier
	 * appelle un repli, le second un message. Les confondre ferait basculer tout un navigateur
	 * sur un rendu de secours à cause d'un seul asset illisible.
	 */
	onUnavailable?: (reason: string) => void;
}

const CANVAS_STYLE: CSSProperties = { width: "100%", height: "100%", display: "block" };

export function RustSceneViewport({
	services,
	assets,
	selectedId,
	onSelect,
	onSceneLoaded,
	onTransform,
	gizmoMode = "none",
	notice,
	wireframe = false,
	showGrid = true,
	className,
	createViewer,
	onUnavailable,
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
				if (cancelled) return;
				const raison = cause instanceof Error ? cause.message : String(cause);
				setError(raison);
				onUnavailable?.(raison);
			});

		return () => {
			cancelled = true;
			created?.free();
			viewerRef.current = null;
			setReady(false);
		};
	}, [createViewer, onUnavailable]);

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
			// Les comptes viennent de la géométrie RÉELLEMENT téléversée, pas du document : un
			// objet dont l'asset n'a pas résolu n'y figure pas, et un outliner qui afficherait
			// zéro partout se lirait comme une scène vide plutôt que comme une statistique
			// manquante.
			const parObjet = new Map<string, { triangles: number; vertices: number }>();
			try {
				const stats = JSON.parse(viewer.scene_stats_json()) as {
					object: string;
					triangles: number;
					vertices: number;
				}[];
				for (const s of stats) {
					parObjet.set(s.object, { triangles: s.triangles, vertices: s.vertices });
				}
			} catch {
				// Statistiques illisibles : la scène est affichée, l'outliner montrera zéro. Ne
				// pas faire échouer le chargement pour un compte.
			}
			let triangles = 0;
			let vertices = 0;
			for (const v of parObjet.values()) {
				triangles += v.triangles;
				vertices += v.vertices;
			}
			onSceneLoaded?.(
				objects.map((o, depth) => ({
					id: o.id,
					assetKey: o.asset,
					name: o.name,
					type: "Mesh",
					depth: depth === 0 ? 0 : 1,
					triangles: parObjet.get(o.id)?.triangles ?? 0,
				})),
				{ meshes: objects.length, triangles, vertices, materials: 0 },
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

	useEffect(() => {
		const viewer = viewerRef.current;
		if (!viewer || !ready || gizmoMode === "none") return;
		viewer.set_gizmo_mode(gizmoMode);
	}, [gizmoMode, ready]);

	// Glissement du gizmo. L'état vit dans une ref et non dans React : un déplacement émet un
	// événement par image, et re-rendre le composant à chaque mouvement de souris annulerait
	// l'intérêt d'un rendu natif.
	const dragRef = useRef<{ axis: string; x: number; y: number; id: string } | null>(null);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !ready) return;

		const local = (e: PointerEvent) => {
			const r = canvas.getBoundingClientRect();
			return { x: e.clientX - r.left, y: e.clientY - r.top };
		};

		const onDown = (e: PointerEvent) => {
			const viewer = viewerRef.current;
			if (!viewer || gizmoMode === "none" || !selectedId) return;
			const { x, y } = local(e);
			const axis = viewer.gizmo_axis_at(x, y);
			if (!axis) return;
			dragRef.current = { axis, x, y, id: selectedId };
			// Capturer le pointeur : sans cela, sortir du canvas en glissant perd les événements
			// et l'objet reste figé à mi-course sans que rien ne le dise.
			canvas.setPointerCapture(e.pointerId);
			e.preventDefault();
		};

		const onMove = (e: PointerEvent) => {
			const viewer = viewerRef.current;
			const drag = dragRef.current;
			if (!viewer || !drag || !onTransform) return;
			const { x, y } = local(e);
			// Chaque mode rend un DELTA relatif au début du glissement, pas un absolu : c'est à
			// l'hôte de le composer avec la transformation existante, parce que lui seul sait
			// quelle était celle de départ.
			if (gizmoMode === "rotate") {
				const angle = viewer.gizmo_rotate(drag.axis, drag.x, drag.y, x, y);
				if (Number.isNaN(angle)) return;
				const axe: [number, number, number] =
					drag.axis === "x" ? [angle, 0, 0] : drag.axis === "y" ? [0, angle, 0] : [0, 0, angle];
				onTransform(drag.id, { position: [0, 0, 0], rotation: axe, scale: [1, 1, 1] });
				return;
			}
			if (gizmoMode === "scale") {
				const facteur = viewer.gizmo_scale(drag.axis, drag.x, drag.y, x, y);
				if (Number.isNaN(facteur)) return;
				const s: [number, number, number] =
					drag.axis === "x"
						? [facteur, 1, 1]
						: drag.axis === "y"
							? [1, facteur, 1]
							: [1, 1, facteur];
				onTransform(drag.id, { position: [0, 0, 0], rotation: [0, 0, 0], scale: s });
				return;
			}
			const delta = viewer.gizmo_drag(drag.axis, drag.x, drag.y, x, y);
			if (delta.length !== 3) return;
			onTransform(drag.id, {
				position: [delta[0] ?? 0, delta[1] ?? 0, delta[2] ?? 0],
				rotation: [0, 0, 0],
				scale: [1, 1, 1],
			});
		};

		const onUp = (e: PointerEvent) => {
			if (!dragRef.current) return;
			dragRef.current = null;
			if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
		};

		canvas.addEventListener("pointerdown", onDown);
		canvas.addEventListener("pointermove", onMove);
		canvas.addEventListener("pointerup", onUp);
		canvas.addEventListener("pointercancel", onUp);
		return () => {
			canvas.removeEventListener("pointerdown", onDown);
			canvas.removeEventListener("pointermove", onMove);
			canvas.removeEventListener("pointerup", onUp);
			canvas.removeEventListener("pointercancel", onUp);
		};
	}, [ready, gizmoMode, selectedId, onTransform]);

	// Clic : `pick_json` nomme l'objet touché, `undefined` sur le fond — ce qui désélectionne,
	// comme tout éditeur.
	useEffect(() => {
		const canvas = canvasRef.current;
		if (!canvas || !ready || !onSelect) return;
		const onClick = (event: MouseEvent) => {
			const viewer = viewerRef.current;
			// Un relâchement de gizmo produit aussi un `click` : le traiter comme une sélection
			// désélectionnerait l'objet qu'on vient de déplacer.
			if (!viewer || dragRef.current) return;
			const rect = canvas.getBoundingClientRect();
			const hit = viewer.pick_json(event.clientX - rect.left, event.clientY - rect.top);
			if (!hit) {
				onSelect(null);
				return;
			}
			try {
				// La clé est `object`, celle que `WebViewer::pick_json` écrit. Une faute de nom ici
				// ne casse rien de visible : le JSON se lit, le champ est `undefined`, et le clic
				// désélectionne silencieusement — un éditeur où rien ne se sélectionne jamais.
				const parsed = JSON.parse(hit) as { object?: string };
				onSelect(parsed.object ?? null);
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
