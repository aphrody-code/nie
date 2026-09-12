/**
 * Ce que ce test protège : ce que le rendu CPU promet, et ce qu'il refuse de simuler.
 *
 * Le rastériseur lui-même est éprouvé en Rust, sur les vrais octets du jeu
 * (`crates/engine/nie-wasm/tests/model_render.rs`). Ici c'est la couche de présentation : la
 * borne de taille qui garde la page réactive, le lacet effectivement transmis, et le tangage et
 * la distance qui sont IGNORÉS plutôt qu'approximés — une approximation silencieuse ferait
 * croire à une caméra libre.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test";

/** Les appels reçus par le double du module. */
const appels: { render: [number, number, number][]; libere: number } = { render: [], libere: 0 };

/** `true` quand le double doit refuser le GLB qu'on lui donne. */
let refuseGlb = false;

class ModelRendererDouble {
	constructor(bytes: Uint8Array) {
		if (refuseGlb || bytes.length === 0) throw new Error("GLB refusé");
	}
	get primitives() {
		return 3;
	}
	get textures() {
		return 2;
	}
	render(angle: number, width: number, height: number) {
		appels.render.push([angle, width, height]);
	}
	frame_ptr() {
		return 0;
	}
	frame_len() {
		return appels.render.at(-1)![1] * appels.render.at(-1)![2] * 4;
	}
	free() {
		appels.libere += 1;
	}
}

mock.module("../wasm/nie_wasm.js", () => ({
	ModelRenderer: ModelRendererDouble,
	model_to_glb: (a: Uint8Array, b: Uint8Array) => new Uint8Array([...a, ...b]),
}));
mock.module("./bridge", () => ({
	ensureWasm: async () => {},
	// Une mémoire assez grande pour que la vue sur l'image soit valide.
	moduleMemory: () => ({ buffer: new ArrayBuffer(4 * 1024 * 1024) }),
}));

const { createCpuModelViewer } = await import("./model-render");

/** Un canvas suffisant pour la présentation : un contexte 2D qui enregistre ce qu'on lui pose. */
function faireCanvas() {
	const pose: { putImageData: number; drawImage: number } = { putImageData: 0, drawImage: 0 };
	const context = {
		putImageData: () => {
			pose.putImageData += 1;
		},
		drawImage: () => {
			pose.drawImage += 1;
		},
		clearRect: () => {},
	};
	const canvas = { width: 0, height: 0, getContext: () => context } as unknown as HTMLCanvasElement;
	return { canvas, pose };
}

beforeEach(() => {
	appels.render = [];
	appels.libere = 0;
	refuseGlb = false;
	// `ImageData` et `OffscreenCanvas` n'existent pas dans ce moteur de test : des doubles
	// minimaux suffisent, puisque ce qui est vérifié est la taille demandée, pas les pixels.
	globalThis.ImageData = class {
		constructor(
			public data: Uint8ClampedArray,
			public width: number,
			public height: number,
		) {}
	} as unknown as typeof ImageData;
	globalThis.OffscreenCanvas = class {
		constructor(
			public width: number,
			public height: number,
		) {}
		getContext() {
			return { putImageData: () => {} };
		}
	} as unknown as typeof OffscreenCanvas;
});

describe("createCpuModelViewer", () => {
	test("transmet le lacet, et IGNORE le tangage et la distance", async () => {
		const { canvas } = faireCanvas();
		const viewer = await createCpuModelViewer(canvas);
		viewer.load_glb(new Uint8Array([1, 2, 3]));
		viewer.resize(256, 256);

		viewer.orbit(1.25, 0.9, 8);
		expect(viewer.render()).toBe(true);
		viewer.orbit(1.25, -0.9, 1);
		expect(viewer.render()).toBe(true);

		// Deux tangages et deux distances opposés, un seul et même rendu demandé : la caméra du
		// rastériseur n'a qu'un axe, et rien ici ne prétend le contraire.
		expect(appels.render).toEqual([
			[1.25, 256, 256],
			[1.25, 256, 256],
		]);
	});

	test("borne l'image rendue, quelle que soit la taille du canvas", async () => {
		const { canvas, pose } = faireCanvas();
		const viewer = await createCpuModelViewer(canvas);
		viewer.load_glb(new Uint8Array([1]));
		viewer.resize(2048, 1024);
		viewer.render();

		// 512 est le bord maximal : 2048×1024 se rend en 512×256, puis le contexte 2D l'étire.
		expect(appels.render).toEqual([[0, 512, 256]]);
		expect(pose.drawImage).toBe(1);
		expect(pose.putImageData).toBe(0);
	});

	test("pose l'image directement quand elle tient déjà dans la borne", async () => {
		const { canvas, pose } = faireCanvas();
		const viewer = await createCpuModelViewer(canvas);
		viewer.load_glb(new Uint8Array([1]));
		viewer.resize(320, 200);
		viewer.render();

		expect(appels.render).toEqual([[0, 320, 200]]);
		expect(pose.putImageData).toBe(1);
		expect(pose.drawImage).toBe(0);
	});

	test("ne dessine rien tant qu'aucun modèle n'est chargé", async () => {
		const { canvas } = faireCanvas();
		const viewer = await createCpuModelViewer(canvas);
		viewer.resize(128, 128);
		expect(viewer.render()).toBe(false);
		expect(appels.render).toEqual([]);
	});

	test("un GLB illisible échoue à voix haute, sans laisser un modèle à moitié chargé", async () => {
		const { canvas } = faireCanvas();
		const viewer = await createCpuModelViewer(canvas);
		refuseGlb = true;
		expect(() => viewer.load_glb(new Uint8Array([1]))).toThrow("illisible");
		expect(viewer.render()).toBe(false);
	});

	test("recharger un modèle libère le précédent", async () => {
		const { canvas } = faireCanvas();
		const viewer = await createCpuModelViewer(canvas);
		viewer.load_glb(new Uint8Array([1]));
		viewer.load_glb(new Uint8Array([2]));
		expect(appels.libere).toBe(1);
		viewer.free();
		expect(appels.libere).toBe(2);
	});

	test("refuse un canvas sans contexte 2D plutôt que de dessiner dans le vide", async () => {
		const canvas = { getContext: () => null } as unknown as HTMLCanvasElement;
		expect(createCpuModelViewer(canvas)).rejects.toThrow("contexte 2D");
	});
});
