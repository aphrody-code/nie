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
	viewer.pick_json = mock(() => JSON.stringify({ owner: "a.glb#0" }));
	const choisis: (string | null)[] = [];
	await monter(viewer, { onSelect: (id: string | null) => choisis.push(id) });
	await act(async () => {
		container.querySelector("canvas")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
	});
	expect(choisis).toEqual(["a.glb#0"]);
});
