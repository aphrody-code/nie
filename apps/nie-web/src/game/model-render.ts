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
 *   /f/…/c05024700.g4md  ┐
 *   /f/…/c05024700.g4mg  ┴→ model_to_glb (wasm) → ModelRenderer (wasm) → <canvas>
 * ```
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
import { ModelRenderer, model_to_glb } from "../wasm/nie_wasm.js";

/** L'espace de fichiers du VFS servi par `nie-site`. */
const VFS_SPACE = "/f/";

/** Ce qu'un modèle chargé permet de faire, et ce qu'il contient. */
export interface LoadedModel {
	/** Rend une image à `angle` radians autour de l'axe vertical. */
	render(angle: number, width: number, height: number): ImageData;
	/** Nombre de primitives réellement rasterisées. */
	readonly primitives: number;
	/** Nombre de textures décodées que le modèle porte. */
	readonly textures: number;
	/** Libère la mémoire du module. Après cet appel, `render` n'est plus utilisable. */
	free(): void;
}

/** Les octets d'un chemin du VFS, ou `null` quand le site ne le rend pas. */
async function vfsBytes(path: string): Promise<Uint8Array | null> {
	const response = await fetch(`${VFS_SPACE}${path}`).catch(() => null);
	if (!response?.ok) return null;
	return new Uint8Array(await response.arrayBuffer());
}

/**
 * Charge un modèle du jeu par ses deux chemins VFS et rend un objet prêt à dessiner.
 *
 * Les deux fichiers sont indissociables : `.g4md` porte la description, `.g4mg` la géométrie.
 * L'un sans l'autre n'est pas un modèle dégradé, c'est pas de modèle — d'où le `null`.
 */
export async function loadGameModel(g4mdPath: string, g4mgPath: string): Promise<LoadedModel | null> {
	await ensureWasm();
	const [g4md, g4mg] = await Promise.all([vfsBytes(g4mdPath), vfsBytes(g4mgPath)]);
	if (g4md === null || g4mg === null) return null;

	try {
		return modelFromGlb(model_to_glb(g4md, g4mg));
	} catch {
		return null;
	}
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

/**
 * Charge un modèle depuis un GLB déjà assemblé, à l'URL que l'appelant a résolue.
 *
 * C'est la même URL que le viewport WebGPU consomme (`rust-model-viewport`), ce qui fait de ce
 * rendu un repli exact plutôt qu'une seconde source de modèles.
 *
 * Aucun chemin n'est deviné ici. Le VFS ne range PAS un personnage sous
 * `chr/{code}/{code}.g4md` : `c05024700` vit sous `data/common/chr/_face/05_GO2/c05024700/`
 * (mesuré le 2026-09-12, `niers vfs find`), et la catégorie ne se déduit pas du code. Un
 * appelant qui a les deux chemins passe par [`loadGameModel`] ; les autres passent par une URL
 * qu'un catalogue a mesurée.
 */
export async function loadGameModelFromGlb(url: string, signal?: AbortSignal): Promise<LoadedModel | null> {
	await ensureWasm();
	const response = await fetch(url, { signal }).catch(() => null);
	if (!response?.ok) return null;
	return modelFromGlb(new Uint8Array(await response.arrayBuffer()));
}

/**
 * Le rastériseur CPU présenté comme un viewer de `RustModelViewport`.
 *
 * ## Sa place dans la chaîne
 *
 * `native-viewer.ts` essaie WebGPU, puis WebGL 2. Le second est une SECONDE implémentation,
 * écrite en TypeScript (`apps/nie-web/src/avatar/webgl-viewer`) : elle marche, mais elle dérive
 * du rendu natif par construction, puisqu'elle ne partage aucune ligne avec lui. Ce viewer-ci
 * est le seul des trois qui appelle `nie_render3d::render` — la fonction dont les golden natifs
 * figent la sortie — donc le seul dont on puisse dire qu'il rend comme le renderer du dépôt.
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
