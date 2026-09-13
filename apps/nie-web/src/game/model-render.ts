/**
 * Un modèle 3D du jeu, rendu DANS la page, sans GPU.
 *
 * ## Ce que ça change
 *
 * Le viewport 3D du navigateur passait par WebGPU (`nie_render3d::web`). C'est le chemin rapide,
 * et c'était le seul : un moteur sans WebGPU n'affichait aucun modèle, et la page retombait sur
 * une image que `nie-model-serve` avait rendue pour elle — c'est-à-dire sur un serveur qui
 * dessine.
 *
 * Le rastériseur de `nie_render3d::render` est du Rust pur — z-buffer, éclairage, textures
 * décodées — et c'est LUI dont les tests golden natifs figent la sortie. Il est maintenant lié
 * dans le module du navigateur, donc la chaîne entière tient dans la page :
 *
 * ```text
 *   un GLB (servi, ou assemblé par `model_to_glb`) → ModelRenderer (wasm) → <canvas>
 * ```
 *
 * Ce module n'expose que ce que la chaîne de repli appelle. Deux enveloppes qui allaient
 * chercher les octets elles-mêmes (`loadGameModel`, `loadGameModelFromGlb`) ont été retirées le
 * 2026-09-13 : personne ne les appelait, et une capacité exportée sans appelant se lit comme une
 * garantie. La chaîne `.g4md`/`.g4mg` → GLB → pixels reste prouvée, en Rust et sur les vrais
 * octets du jeu, par `crates/engine/nie-wasm/tests/model_render.rs`.
 *
 * ## Ce que ça ne prétend pas
 *
 * Ce n'est pas le rendu de `nie.exe`. C'est le rendu des DONNÉES du jeu — géométrie, textures,
 * pose de liaison — par le rastériseur de ce dépôt. La conformité pixel n'est pas mesurée, et
 * `crates/engine/nie-wasm/tests/model_render.rs` ne prétend rien de plus : il vérifie que la
 * chaîne rend un modèle plutôt qu'un fond (17 % des pixels couverts sur `c05024700`, 3
 * primitives, mesuré le 2026-09-12) et que l'angle change l'image.
 */
import { ensureWasm, moduleMemory } from "./bridge";
import {
	ModelRenderer,
	model_replace_texture_glb,
	model_validate_editor_png,
} from "../wasm/nie_wasm.js";

/** Ce qu'un modèle chargé permet de faire, et ce qu'il contient. */
export interface LoadedModel {
	/** Rend une image à `angle` radians autour de l'axe vertical. */
	render(angle: number, width: number, height: number): ImageData;
	/** Nombre de primitives réellement rasterisées. */
	readonly primitives: number;
	/** Nombre de textures décodées que le modèle porte. */
	readonly textures: number;
	/** Replace one decoded texture in the Rust renderer session. */
	replaceTexturePng(index: number, png: Uint8Array): void;
	/** Decoded dimensions of one indexed texture. */
	textureSize(index: number): readonly [number, number] | null;
	/** Measured glTF texture name, or null when the document carries none. */
	textureName(index: number): string | null;
	/** Libère la mémoire du module. Après cet appel, `render` n'est plus utilisable. */
	free(): void;
}

/** Enveloppe un GLB déjà en mémoire dans un modèle rendu par le module. */
function modelFromGlb(glb: Uint8Array): LoadedModel | null {
	let renderer: ModelRenderer;
	try {
		renderer = new ModelRenderer(glb);
	} catch {
		return null;
	}

	return {
		primitives: renderer.primitives,
		textures: renderer.textures,
		replaceTexturePng(index: number, png: Uint8Array) {
			renderer.replace_texture_png(index, png);
		},
		textureSize(index: number) {
			const size = renderer.texture_size(index);
			return size.length === 2 ? [size[0]!, size[1]!] as const : null;
		},
		textureName(index: number) {
			return renderer.texture_name(index) ?? null;
		},
		free: () => renderer.free(),
		render(angle: number, width: number, height: number): ImageData {
			renderer.render(angle, width, height);
			const memory = moduleMemory();
			if (memory === null) throw new Error("module WebAssembly sans mémoire exposée");
			const pointer = renderer.frame_ptr();
			const length = renderer.frame_len();
			if (length !== width * height * 4 || pointer + length > memory.buffer.byteLength) {
				throw new Error(`image rendue invalide : offset=${pointer} length=${length}`);
			}
			// Copie UNE fois vers l'`ImageData` : la vue partagée cesse d'être valide dès que le
			// tas WebAssembly grandit, et l'appelant garde son image le temps qu'il veut.
			const pixels = new Uint8ClampedArray(memory.buffer as ArrayBuffer, pointer, length);
			return new ImageData(new Uint8ClampedArray(pixels), width, height);
		},
	};
}

/** Result of parsing a GLB through the repository-owned Rust reader. */
export interface ModelGlbInspection {
	primitives: number;
	textures: number;
	textureSizes: readonly (readonly [number, number])[];
	textureNames: readonly (string | null)[];
}

/**
 * Validate an imported GLB with `nie_render3d::glb`, compiled in `nie-wasm`.
 *
 * `GLTFLoader` remains the interactive presentation backend, but it is not the authority that
 * admits a file into the editor: the same bounded Rust parser used by the native renderer is.
 */
export async function inspectModelGlb(glb: Uint8Array): Promise<ModelGlbInspection> {
	await ensureWasm();
	const model = modelFromGlb(glb);
	if (model === null) throw new Error("GLB refusé par le lecteur Rust de nie-render3d");
	try {
		return {
			primitives: model.primitives,
			textures: model.textures,
			textureSizes: Array.from({ length: model.textures }, (_, index) => model.textureSize(index)).filter(
				(size): size is readonly [number, number] => size !== null,
			),
			textureNames: Array.from({ length: model.textures }, (_, index) => model.textureName(index)),
		};
	} finally {
		model.free();
	}
}

/** Replace one embedded GLB image through the bounded Rust GLB writer. */
export async function replaceModelTextureGlb(
	glb: Uint8Array,
	index: number,
	png: Uint8Array,
): Promise<Uint8Array> {
	await ensureWasm();
	return new Uint8Array(model_replace_texture_glb(glb, index, png));
}

/** Decode a standalone PNG through the bounded Rust owner before browser presentation. */
export async function validateEditorPng(
	png: Uint8Array,
): Promise<readonly [number, number]> {
	await ensureWasm();
	const dimensions = model_validate_editor_png(png);
	if (dimensions.length !== 2) {
		throw new Error("Le décodeur Rust n’a pas retourné les dimensions PNG");
	}
	return [dimensions[0]!, dimensions[1]!] as const;
}

/**
 * Render a GLB through the Rust CPU renderer and encode the resulting RGBA frame as PNG.
 *
 * Canvas is only the browser's PNG encoder here; geometry, textures, camera angle and pixels are
 * evaluated by `nie_render3d::render`. This intentionally exports one asset, not a merged editor
 * scene: the scene-document GLB exporter required for that does not exist yet.
 */
export async function renderModelPng(
	glb: Uint8Array,
	options: { angle?: number; width?: number; height?: number; texture?: { index: number; png: Uint8Array } } = {},
): Promise<Uint8Array> {
	await ensureWasm();
	const model = modelFromGlb(glb);
	if (model === null) throw new Error("GLB refusé par le lecteur Rust de nie-render3d");
	const width = Math.max(1, Math.min(2048, Math.floor(options.width ?? 1024)));
	const height = Math.max(1, Math.min(2048, Math.floor(options.height ?? 1024)));
	try {
		if (options.texture) model.replaceTexturePng(options.texture.index, options.texture.png);
		const frame = model.render(options.angle ?? 0, width, height);
		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext("2d");
		if (context === null) throw new Error("contexte 2D indisponible pour encoder le PNG");
		context.putImageData(frame, 0, 0);
		const blob = await new Promise<Blob>((resolve, reject) => {
			canvas.toBlob((value) => value ? resolve(value) : reject(new Error("encodage PNG refusé par le navigateur")), "image/png");
		});
		return new Uint8Array(await blob.arrayBuffer());
	} finally {
		model.free();
	}
}

/**
 * Le rastériseur CPU présenté comme un viewer de `RustModelViewport`.
 *
 * ## Sa place dans la chaîne
 *
 * `native-viewer.ts` essaie WebGPU, puis le module `nie-viewer-web` (le même renderer Rust sur
 * WebGL 2), puis celui-ci. Les trois appellent désormais le renderer de ce dépôt : la
 * réimplémentation TypeScript qui occupait le deuxième rang a été supprimée le 2026-09-12.
 *
 * Celui-ci est le seul des trois qui n'a besoin d'aucun GPU : il appelle `nie_render3d::render`,
 * la fonction dont les golden natifs figent la sortie, et il est déjà dans le module principal —
 * donc il ne coûte aucun téléchargement supplémentaire.
 *
 * ## Ce qu'il N'HONORE PAS, et le dit
 *
 * `nie_render3d::render` prend un seul angle : la rotation autour de l'axe vertical. Le tangage
 * et la distance de `orbit()` sont donc **ignorés** — pas approximés. Les afficher comme
 * fonctionnels ferait croire à une caméra libre là où il n'y a qu'un tourne-disque.
 *
 * ## Le coût, borné
 *
 * Rasteriser à la taille physique du canvas à chaque image coûte cher sur un processeur. Le
 * rendu se fait donc dans une image bornée par [`CPU_MAX_EDGE`] et le contexte 2D l'étire : la
 * netteté baisse, la page reste réactive, et le compromis est ici plutôt que caché.
 */
const CPU_MAX_EDGE = 512;

/** Un viewer conforme à `RustModelViewer`, dessinant sur le processeur. */
export interface CpuViewer {
	load_glb(bytes: Uint8Array): void;
	orbit(yaw: number, pitch: number, distance: number): void;
	resize(width: number, height: number): void;
	render(): boolean;
	free(): void;
}

/** Construit le viewer CPU sur un canvas. Échoue si le contexte 2D est refusé. */
export async function createCpuModelViewer(canvas: HTMLCanvasElement): Promise<CpuViewer> {
	await ensureWasm();
	const context = canvas.getContext("2d");
	if (context === null) throw new Error("contexte 2D indisponible pour le rendu CPU");

	let model: LoadedModel | null = null;
	let yaw = 0;
	let width = canvas.width || 1;
	let height = canvas.height || 1;

	return {
		load_glb(bytes: Uint8Array) {
			model?.free();
			model = modelFromGlb(bytes);
			if (model === null) throw new Error("GLB illisible par le rastériseur");
		},
		orbit(nextYaw: number) {
			// Tangage et distance : voir la note du module. Ignorés, pas approximés.
			yaw = nextYaw;
		},
		resize(nextWidth: number, nextHeight: number) {
			width = Math.max(1, Math.floor(nextWidth));
			height = Math.max(1, Math.floor(nextHeight));
		},
		render(): boolean {
			if (model === null) return false;
			const echelle = Math.min(1, CPU_MAX_EDGE / Math.max(width, height));
			const w = Math.max(1, Math.floor(width * echelle));
			const h = Math.max(1, Math.floor(height * echelle));
			const image = model.render(yaw, w, h);
			if (w === width && h === height) {
				context.putImageData(image, 0, 0);
				return true;
			}
			// `putImageData` ne met pas à l'échelle : passer par un bitmap est ce qui permet
			// d'étirer l'image bornée jusqu'au canvas sans rasteriser à sa taille réelle.
			const intermediaire = new OffscreenCanvas(w, h);
			const dessin = intermediaire.getContext("2d");
			if (dessin === null) return false;
			dessin.putImageData(image, 0, 0);
			context.clearRect(0, 0, width, height);
			context.drawImage(intermediaire, 0, 0, width, height);
			return true;
		},
		free() {
			model?.free();
			model = null;
		},
	};
}
