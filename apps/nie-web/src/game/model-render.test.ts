/**
 * Ce que ce test protège : ce que le rendu CPU promet, et ce qu'il refuse de simuler.
 *
 * Le rastériseur lui-même est éprouvé en Rust, sur les vrais octets du jeu
 * (`crates/engine/nie-wasm/tests/model_render.rs`). Ici c'est la couche de présentation : la
 * borne de taille qui garde la page réactive, le lacet effectivement transmis, et le tangage et
 * la distance qui sont IGNORÉS plutôt qu'approximés — une approximation silencieuse ferait
 * croire à une caméra libre.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

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

/** Ce que la chaîne de repli a construit, dans l'ordre. */
let rangs: string[] = [];
/** Les rangs qui doivent échouer à la construction. */
let rangsEnEchec = new Set<string>();

function rang(nom: string) {
	rangs.push(nom);
	if (rangsEnEchec.has(nom)) throw new Error(`${nom} indisponible`);
	return { rang: nom };
}

// `mock.module` est GLOBAL à ce moteur de test : deux fichiers ne peuvent pas doubler le même
// spécificateur différemment. Les tests de `native-viewer` vivent donc ici, avec les doubles
// qu'ils partagent — les séparer faisait tomber sept tests de ce fichier-ci, mesuré.
mock.module("../wasm/nie_wasm.js", () => ({
	ModelRenderer: ModelRendererDouble,
	model_to_glb: (a: Uint8Array, b: Uint8Array) => new Uint8Array([...a, ...b]),
	WebGpuViewer: {
		create: async () => rang("webgpu"),
		create_transparent: async () => rang("webgpu"),
	},
}));
mock.module("../wasm-viewer/nie_viewer_web.js", () => ({
	initSync: () => ({}),
	ModelViewer: {
		create: async () => rang("webgl"),
		create_transparent: async () => rang("webgl"),
	},
}));
mock.module("./bridge", () => ({
	ensureWasm: async () => {},
	// Une mémoire assez grande pour que la vue sur l'image soit valide.
	moduleMemory: () => ({ buffer: new ArrayBuffer(4 * 1024 * 1024) }),
}));

const { createCpuModelViewer } = await import("./model-render");
const { createOpaqueNativeViewer } = await import("./native-viewer");

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

/** Installe les sondes : WebGPU par `navigator.gpu`, WebGL 2 par un contexte de canvas. */
function sondes({ gpu, webgl2, moduleServi = true }: { gpu: boolean; webgl2: boolean; moduleServi?: boolean }) {
	rangs = [];
	// `navigator` est en lecture seule ici : redéfinir la propriété, pas l'affecter.
	Object.defineProperty(globalThis, "navigator", {
		configurable: true,
		value: gpu ? { gpu: { requestAdapter: async () => ({}) } } : {},
	});
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { createElement: () => ({ getContext: () => (webgl2 ? {} : null) }) },
	});
	globalThis.fetch = (async () =>
		moduleServi ? new Response(new Uint8Array([0]), { status: 200 }) : new Response("", { status: 404 })) as unknown as typeof fetch;
}

// Le rang 3 n'est PAS doublé : `createOpaqueNativeViewer` appelle le vrai
// `createCpuModelViewer`, qui réclame un contexte 2D. Le canvas en fournit un, et `rang("cpu")`
// est posé par le double du module principal quand ce viewer construit son modèle.
const canvasChaine = {
	getContext: () => {
		rangs.push("cpu");
		return { putImageData: () => {}, drawImage: () => {}, clearRect: () => {} };
	},
} as unknown as HTMLCanvasElement;

describe("la chaîne de repli du viewer", () => {
	// EN PREMIER, et ce n'est pas un hasard : `loadLazyViewer` mémorise le module une fois
	// chargé, pour ne pas retélécharger 3 Mio à chaque écran. Un cas de 404 placé après un cas
	// réussi lirait donc le cache et passerait pour un repli qui marche.
	test("le CPU prend le relais quand le module paresseux n'est pas SERVI", async () => {
		// Le cas d'un déploiement sans `nie_viewer_web_bg.wasm` : un 404 ne doit pas laisser
		// l'écran sans rendu alors que le rastériseur est dans le module principal.
		sondes({ gpu: false, webgl2: true, moduleServi: false });
		const viewer = await createOpaqueNativeViewer(canvasChaine);
		expect(typeof (viewer as { load_glb?: unknown }).load_glb).toBe("function");
		expect(rangs).not.toContain("webgl");
	});

	test("WebGPU d'abord quand l'adaptateur répond", async () => {
		sondes({ gpu: true, webgl2: true });
		expect(await createOpaqueNativeViewer(canvasChaine)).toMatchObject({ rang: "webgpu" });
		expect(rangs).toEqual(["webgpu"]);
	});

	test("le module paresseux quand WebGPU manque", async () => {
		sondes({ gpu: false, webgl2: true });
		expect(await createOpaqueNativeViewer(canvasChaine)).toMatchObject({ rang: "webgl" });
		// Le rang 1 n'est même pas tenté : sonder `navigator.gpu` évite d'empoisonner le canvas.
		expect(rangs).toEqual(["webgl"]);
	});

	test("le rastériseur CPU quand ni WebGPU ni WebGL 2", async () => {
		sondes({ gpu: false, webgl2: false });
		// Le rang 3 rend un VRAI `CpuViewer` (pas un double) : on le reconnaît à sa surface, et
		// ce qui compte est qu'aucun des deux rangs GPU n'ait été tenté.
		const viewer = await createOpaqueNativeViewer(canvasChaine);
		expect(typeof (viewer as { load_glb?: unknown }).load_glb).toBe("function");
		expect(rangs).not.toContain("webgpu");
		expect(rangs).not.toContain("webgl");
	});

	test("un WebGPU qui échoue à la construction retombe sur le module paresseux", async () => {
		sondes({ gpu: true, webgl2: true });
		rangsEnEchec = new Set(["webgpu"]);
		expect(await createOpaqueNativeViewer(canvasChaine)).toMatchObject({ rang: "webgl" });
		expect(rangs).toEqual(["webgpu", "webgl"]);
	});
});

// `navigator` et `document` sont GLOBAUX et ce moteur exécute tous les fichiers dans le même
// processus : les remplacer sans les rendre faisait tomber dix-huit tests d'autres fichiers.
const originaux = {
	navigator: Object.getOwnPropertyDescriptor(globalThis, "navigator"),
	document: Object.getOwnPropertyDescriptor(globalThis, "document"),
	fetch: globalThis.fetch,
};

afterAll(() => {
	for (const nom of ["navigator", "document"] as const) {
		const descripteur = originaux[nom];
		if (descripteur) Object.defineProperty(globalThis, nom, descripteur);
		else Reflect.deleteProperty(globalThis, nom);
	}
	globalThis.fetch = originaux.fetch;
});
