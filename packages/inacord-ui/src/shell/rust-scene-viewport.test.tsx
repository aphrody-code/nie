import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RustSceneViewport } from "./rust-scene-viewport";
import type { RustSceneViewer } from "./rust-model-viewport";

let root: Root | null;
let container: HTMLDivElement;
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
const previousActEnvironment = environment.IS_REACT_ACT_ENVIRONMENT;

/** Un viewer complet : toutes les méthodes de scène, chacune enregistrée. */
function fakeSceneViewer() {
	return {
		load_glb: mock(() => {}),
		orbit: mock(() => {}),
		resize: mock(() => {}),
		render: mock(() => true),
		free: mock(() => {}),
		stage_asset: mock((_asset: string, _bytes: Uint8Array) => {}),
		clear_assets: mock(() => {}),
		load_scene: mock((_json: string) => {}),
		pick_json: mock((_x: number, _y: number) => undefined as string | undefined),
		set_grid: mock((_v: boolean) => {}),
		set_wireframe: mock((_v: boolean) => {}),
		select: mock((_id: string) => {}),
		selected: mock(() => ""),
		gizmo_axis_at: mock((_x: number, _y: number) => ""),
		gizmo_drag: mock((_a: string, _fx: number, _fy: number, _tx: number, _ty: number) => [] as number[]),
		set_gizmo_mode: mock((_m: string) => {}),
		gizmo_rotate: mock((_a: string, _fx: number, _fy: number, _tx: number, _ty: number) => Number.NaN),
		gizmo_scale: mock((_a: string, _fx: number, _fy: number, _tx: number, _ty: number) => Number.NaN),
		scene_stats_json: mock(() => "[]"),
	};
}

const services = { decodeBase64: (b64: string) => new TextEncoder().encode(b64) };

beforeEach(() => {
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	container = document.createElement("div");
	document.body.appendChild(container);
	root = createRoot(container);
});

afterEach(() => {
	act(() => root?.unmount());
	root = null;
	container.remove();
	environment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

async function monter(viewer: ReturnType<typeof fakeSceneViewer>, props: Record<string, unknown>) {
	const createViewer = mock(async () => viewer as unknown as RustSceneViewer);
	await act(async () => {
		root?.render(
			<RustSceneViewport
				services={services}
				assets={[]}
				selectedId={null}
				createViewer={createViewer}
				{...props}
			/>,
		);
	});
	return createViewer;
}

/** Les assets sont déposés PUIS référencés par un document : c'est le contrat de `load_scene`. */
test("dépose chaque asset puis compose la scène", async () => {
	const viewer = fakeSceneViewer();
	await monter(viewer, {
		assets: [
			{ key: "a.glb", glbB64: "AAA" },
			{ key: "b.glb", glbB64: "BBB" },
		],
	});
	expect(viewer.clear_assets).toHaveBeenCalled();
	expect(viewer.stage_asset).toHaveBeenCalledTimes(2);
	expect(viewer.stage_asset.mock.calls[0]?.[0]).toBe("a.glb");
	expect(viewer.load_scene).toHaveBeenCalledTimes(1);
	const doc = JSON.parse(viewer.load_scene.mock.calls[0]?.[0] as string) as {
		version: number;
		objects: { id: string; asset: string }[];
	};
	expect(doc.version).toBe(2);
	expect(doc.objects).toHaveLength(2);
	expect(doc.objects[1]?.asset).toBe("b.glb");
});

/** Une scène vide ne compose PAS : `load_scene` refuse un document sans primitive. */
test("une liste d'assets vide ne compose pas de scène", async () => {
	const viewer = fakeSceneViewer();
	const vus: unknown[] = [];
	await monter(viewer, { assets: [], onSceneLoaded: (n: unknown) => vus.push(n) });
	expect(viewer.load_scene).not.toHaveBeenCalled();
	expect(vus).toHaveLength(1);
});

/** Les bascules sont poussées séparément : changer une case ne retéléverse pas la géométrie. */
test("les bascules ne recomposent pas la scène", async () => {
	const viewer = fakeSceneViewer();
	const createViewer = mock(async () => viewer as unknown as RustSceneViewer);
	const rendre = async (grid: boolean, wire: boolean) => {
		await act(async () => {
			root?.render(
				<RustSceneViewport
					services={services}
					assets={[{ key: "a.glb", glbB64: "AAA" }]}
					selectedId={null}
					showGrid={grid}
					wireframe={wire}
					createViewer={createViewer}
				/>,
			);
		});
	};
	await rendre(true, false);
	const composesApresMontage = viewer.load_scene.mock.calls.length;
	await rendre(false, true);
	expect(viewer.set_grid).toHaveBeenLastCalledWith(false);
	expect(viewer.set_wireframe).toHaveBeenLastCalledWith(true);
	expect(viewer.load_scene.mock.calls.length).toBe(composesApresMontage);
});

/** Un viewer amputé est refusé à la CONSTRUCTION, pas au premier clic. */
test("un viewer sans capacités de scène est refusé et libéré", async () => {
	const ampute = {
		load_glb: mock(() => {}),
		orbit: mock(() => {}),
		resize: mock(() => {}),
		render: mock(() => true),
		free: mock(() => {}),
	};
	const createViewer = mock(async () => ampute as unknown as RustSceneViewer);
	await act(async () => {
		root?.render(
			<RustSceneViewport
				services={services}
				assets={[]}
				selectedId={null}
				createViewer={createViewer}
			/>,
		);
	});
	expect(ampute.free).toHaveBeenCalled();
	expect(container.textContent).toContain("capacités de scène");
});

/** Un clic sur le fond DÉSÉLECTIONNE — c'est ce que fait tout éditeur. */
test("un clic sur le fond désélectionne", async () => {
	const viewer = fakeSceneViewer();
	const choisis: (string | null)[] = [];
	await monter(viewer, { onSelect: (id: string | null) => choisis.push(id) });
	const canvas = container.querySelector("canvas");
	expect(canvas).not.toBeNull();
	await act(async () => {
		canvas?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	expect(choisis).toEqual([null]);
});

/** Un clic sur un objet rend son identifiant de document. */
test("un clic sur un objet rend son identifiant", async () => {
	const viewer = fakeSceneViewer();
	viewer.pick_json = mock(() => JSON.stringify({ object: "a.glb#0" }));
	const choisis: (string | null)[] = [];
	await monter(viewer, { onSelect: (id: string | null) => choisis.push(id) });
	await act(async () => {
		container.querySelector("canvas")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	expect(choisis).toEqual(["a.glb#0"]);
});

/** Un glissement sur une poignée émet `onTransform` avec le déplacement contraint. */
test("un glissement de gizmo émet le déplacement", async () => {
	const viewer = fakeSceneViewer();
	viewer.gizmo_axis_at = mock(() => "x");
	viewer.gizmo_drag = mock(() => [2.5, 0, 0]);
	const mouvements: [string, number[]][] = [];
	await monter(viewer, {
		selectedId: "a.glb#0",
		gizmoMode: "translate",
		onTransform: (id: string, trs: { position: number[] }) => mouvements.push([id, trs.position]),
	});
	const canvas = container.querySelector("canvas");
	await act(async () => {
		canvas?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
		canvas?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1 }));
	});
	expect(mouvements).toHaveLength(1);
	expect(mouvements[0]?.[0]).toBe("a.glb#0");
	expect(mouvements[0]?.[1]).toEqual([2.5, 0, 0]);
});

/** En mode `none`, aucune poignée n'est attrapée. */
test("le mode none ne manipule pas", async () => {
	const viewer = fakeSceneViewer();
	viewer.gizmo_axis_at = mock(() => "x");
	const mouvements: unknown[] = [];
	await monter(viewer, {
		selectedId: "a.glb#0",
		gizmoMode: "none",
		onTransform: () => mouvements.push(1),
	});
	const canvas = container.querySelector("canvas");
	await act(async () => {
		canvas?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
		canvas?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1 }));
	});
	expect(viewer.gizmo_axis_at).not.toHaveBeenCalled();
	expect(mouvements).toHaveLength(0);
});

/** Le mode `rotate` émet une rotation sur le bon axe, et rien sur un angle indéterminé. */
test("le mode rotate émet un angle sur le bon axe", async () => {
	const viewer = fakeSceneViewer();
	viewer.gizmo_axis_at = mock(() => "y");
	viewer.gizmo_rotate = mock(() => 0.75);
	const vus: number[][] = [];
	await monter(viewer, {
		selectedId: "a.glb#0",
		gizmoMode: "rotate",
		onTransform: (_id: string, trs: { rotation: number[] }) => vus.push(trs.rotation),
	});
	const canvas = container.querySelector("canvas");
	await act(async () => {
		canvas?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
		canvas?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1 }));
	});
	expect(vus).toEqual([[0, 0.75, 0]]);
	expect(viewer.set_gizmo_mode).toHaveBeenLastCalledWith("rotate");
});

/** Un angle indéterminé (`NaN`) n'émet RIEN — sinon l'objet tournoierait sur un bruit. */
test("une rotation indéterminée n'émet rien", async () => {
	const viewer = fakeSceneViewer();
	viewer.gizmo_axis_at = mock(() => "y");
	viewer.gizmo_rotate = mock(() => Number.NaN);
	const vus: unknown[] = [];
	await monter(viewer, {
		selectedId: "a.glb#0",
		gizmoMode: "rotate",
		onTransform: () => vus.push(1),
	});
	const canvas = container.querySelector("canvas");
	await act(async () => {
		canvas?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
		canvas?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1 }));
	});
	expect(vus).toHaveLength(0);
});

/** Le mode `scale` émet un facteur sur le bon axe, les autres restant à 1. */
test("le mode scale émet un facteur sur le bon axe", async () => {
	const viewer = fakeSceneViewer();
	viewer.gizmo_axis_at = mock(() => "z");
	viewer.gizmo_scale = mock(() => 2.5);
	const vus: number[][] = [];
	await monter(viewer, {
		selectedId: "a.glb#0",
		gizmoMode: "scale",
		onTransform: (_id: string, trs: { scale: number[] }) => vus.push(trs.scale),
	});
	const canvas = container.querySelector("canvas");
	await act(async () => {
		canvas?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
		canvas?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1 }));
	});
	expect(vus).toEqual([[1, 1, 2.5]]);
});

/** Le clic qui termine un glissement ne DÉSÉLECTIONNE pas l'objet déplacé. */
test("relâcher le gizmo ne désélectionne pas", async () => {
	const viewer = fakeSceneViewer();
	viewer.gizmo_axis_at = mock(() => "x");
	viewer.gizmo_drag = mock(() => [1, 0, 0]);
	const choisis: (string | null)[] = [];
	await monter(viewer, {
		selectedId: "a.glb#0",
		gizmoMode: "translate",
		onSelect: (id: string | null) => choisis.push(id),
		onTransform: () => {},
	});
	const canvas = container.querySelector("canvas");
	await act(async () => {
		canvas?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
		// Le `click` du navigateur arrive AVANT que le glissement soit oublié.
		canvas?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	expect(choisis).toHaveLength(0);
});

/** La clé du JSON de picking est `object` — une faute de nom désélectionnerait en silence. */
test("le picking lit la clé `object` et non une autre", async () => {
	const viewer = fakeSceneViewer();
	viewer.pick_json = mock(() => JSON.stringify({ owner: "mauvaise-cle", object: "a.glb#2" }));
	const choisis: (string | null)[] = [];
	await monter(viewer, { onSelect: (id: string | null) => choisis.push(id) });
	await act(async () => {
		container.querySelector("canvas")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	expect(choisis).toEqual(["a.glb#2"]);
});

/** Les comptes de l'outliner viennent de la géométrie téléversée, pas du document. */
test("les triangles par objet remontent à l'outliner", async () => {
	const viewer = fakeSceneViewer();
	viewer.scene_stats_json = mock(() =>
		JSON.stringify([
			{ object: "a.glb#0", triangles: 120, vertices: 300 },
			{ object: "b.glb#1", triangles: 40, vertices: 90 },
		]),
	);
	let noeuds: { id: string; triangles: number }[] = [];
	let total = { meshes: 0, triangles: 0, vertices: 0, materials: 0 };
	await monter(viewer, {
		assets: [
			{ key: "a.glb", glbB64: "AAA" },
			{ key: "b.glb", glbB64: "BBB" },
		],
		onSceneLoaded: (n: typeof noeuds, s: typeof total) => {
			noeuds = n;
			total = s;
		},
	});
	expect(noeuds.map((n) => n.triangles)).toEqual([120, 40]);
	expect(total.triangles).toBe(160);
	expect(total.vertices).toBe(390);
});

/** Des statistiques illisibles n'empêchent PAS la scène de s'afficher. */
test("des statistiques illisibles ne font pas échouer le chargement", async () => {
	const viewer = fakeSceneViewer();
	viewer.scene_stats_json = mock(() => "pas du json");
	let noeuds: { triangles: number }[] = [];
	await monter(viewer, {
		assets: [{ key: "a.glb", glbB64: "AAA" }],
		onSceneLoaded: (n: typeof noeuds) => {
			noeuds = n;
		},
	});
	expect(viewer.load_scene).toHaveBeenCalled();
	expect(noeuds).toHaveLength(1);
	expect(noeuds[0]?.triangles).toBe(0);
	expect(container.textContent).not.toContain("json");
});
