/**
 * Composer un écran de menu avec le compositeur du jeu, DANS la page.
 *
 * ## Ce que ce fichier remplace
 *
 * Les layouts de menu étaient dessinés en DOM (`@niers/inacord-ui/shell/layout-render`) : un
 * `<img>` par objet, positionné par un `transform` CSS. Cette voie ne sait faire aucune des
 * quatre opérations que le jeu applique — échantillonnage bilinéaire, rotation autour d'une
 * ancre, teinte, mélange additif — et elle n'avait aucun moyen de les apprendre : le navigateur
 * ne compose pas des sprites, il empile des boîtes.
 *
 * Ici, c'est `nie_formats::menu_layout`, compilé en WebAssembly : le MÊME code que
 * `nie-game --compose-layout` et que `/api/v1/menu/render/{screen}`. Une implémentation pour les
 * trois surfaces, et le rendu du navigateur cesse d'être une approximation du rendu natif.
 *
 * ## Le protocole, et pourquoi il est en trois temps
 *
 * Le compositeur est synchrone et ne connaît pas le réseau. On lui demande donc d'abord ce qu'il
 * lui faut (`required_assets`), on va le chercher, on le lui donne, puis on compose. Les pixels
 * ne traversent jamais la frontière JS : `render()` rend le rapport, et l'image se lit dans la
 * mémoire WebAssembly sans copie.
 */
import { ensureWasm, loadFont, moduleMemory } from "./bridge";
import { MenuComposer } from "../wasm/nie_wasm.js";

/** L'espace de fichiers du VFS servi par `nie-site` : `/f/data/<chemin logique>`. */
const VFS_SPACE = "/f/data/";

/** Ce que la composition a réellement dessiné — des comptes, pas une appréciation. */
export interface ComposeReport {
	drawn: number;
	sprites: number;
	regions: number;
	regionHashes: number;
	texts: number;
	/** Objets visibles sans aucune source de pixels : sautés, jamais remplacés. */
	skipped: number;
	width: number;
	height: number;
}

/** Une image composée, prête pour un `<canvas>`, et ce qu'il a fallu pour l'obtenir. */
export interface ComposedScreen {
	image: ImageData;
	report: ComposeReport;
}

/**
 * Compose un layout de menu en image.
 *
 * @param layout le layout tel que `nie-site` le sert (`/api/v1/menu/layout/{screen}`) ou tel que
 * l'écran l'a déjà chargé — il est sérialisé tel quel, aucune clé n'est réinterprétée ici.
 * @param assumeUnknownVisible politique de visibilité. Le layout statique de `nie-site` n'exécute
 * aucun script : il pose `visible: null` et l'annonce. Composé sous la règle de l'export runtime,
 * il rendrait une image vide — d'où ce choix, qui appartient à l'appelant et se nomme.
 * @param canvas dimensions du canevas, en pixels du jeu.
 */
export async function composeMenuScreen(
	layout: unknown,
	assumeUnknownVisible: boolean,
	canvas: { width: number; height: number } = { width: 1280, height: 720 },
): Promise<ComposedScreen> {
	await ensureWasm();
	const composer = new MenuComposer(JSON.stringify(layout), assumeUnknownVisible);
	try {
		// Les textures d'abord, en parallèle : une absente n'arrête rien, l'objet qui la nomme
		// sera simplement compté `skipped`.
		await Promise.all(
			composer.required_assets().map(async (key) => {
				const response = await fetch(`${VFS_SPACE}${key}`).catch(() => null);
				if (!response?.ok) return;
				composer.provide_asset(key, new Uint8Array(await response.arrayBuffer()));
			}),
		);
		// La police ne descend que si un libellé RÉSOLU va s'en servir : son atlas pèse 42 MiB.
		if (composer.needs_font) {
			const [metrics, atlas] = await loadFont();
			composer.provide_font(atlas, metrics);
		}
		const report = JSON.parse(composer.render(canvas.width, canvas.height)) as ComposeReport;
		const memory = moduleMemory();
		if (memory === null) throw new Error("module WebAssembly sans mémoire exposée");
		const pointer = composer.frame_ptr();
		const length = composer.frame_len();
		if (length !== canvas.width * canvas.height * 4 || pointer + length > memory.buffer.byteLength) {
			throw new Error(`image composée invalide : offset=${pointer} length=${length}`);
		}
		// Copie UNE fois, vers l'`ImageData` : la vue partagée cesse d'être valide dès que le
		// compositeur est libéré, et un écran garde son image tant qu'il est monté.
		const pixels = new Uint8ClampedArray(memory.buffer as ArrayBuffer, pointer, length);
		return {
			image: new ImageData(new Uint8ClampedArray(pixels), canvas.width, canvas.height),
			report,
		};
	} finally {
		composer.free();
	}
}
