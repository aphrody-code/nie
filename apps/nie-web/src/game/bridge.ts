/**
 * Le pont navigateur vers le jeu — `nie-wasm`/`WasmGame`, 100 % Rust compilé en WebAssembly.
 *
 * `WasmGame` est une machine à états : écran-titre → menu principal → sélection de mode →
 * match (moteur `nie-runtime` : physique, 22 joueurs, ballon, buts) ou dialogue. Commandes de
 * menu en entrée, framebuffer RGBA8 en sortie. Ce module ne fait que trois choses : charger le
 * wasm, chercher la vraie police du jeu, et adapter clavier ↔ commande et framebuffer ↔ canevas.
 *
 * ## Ce que cette surface est, et ce qu'elle n'est pas
 *
 * `crates/engine/nie-wasm/src/lib.rs` le dit sans détour : le rendu est un **placeholder 2D**,
 * il ne reproduit pas l'interface d'IEVR, parce que le vrai menu n'existe dans aucun fichier —
 * il est construit à l'exécution par le menu-manager C++ qui pilote Lua via
 * `funcLuaMenuCommand`, boucle non portée à ce jour. Le modèle de but de `match_sim` reste
 * nominal. Ce que cette page prouve, c'est que la logique portée tourne dans un navigateur ;
 * elle ne prouve pas une fidélité au jeu, et rien ici ne doit l'affirmer.
 *
 * ## Pourquoi les octets viennent de `/static/game/`, et pas de `/assets/`
 *
 * `nie-site` route `/assets/*` vers le proxy de décodage : y poser des fichiers du bundle les
 * enverrait à `nie-model-serve`, qui n'en sait rien. `/static/` est servi par le bundle
 * lui-même, avec sa pré-compression et son cache — c'est là qu'ils vivent.
 */
import type { NativeMenuScene } from "@niers/inacord-ui/shell/native-title-menu";
import init, { WasmGame, menu_presentation_json } from "../wasm/nie_wasm.js";

const WASM_URL = "/static/game/nie_wasm_bg.wasm";
const FONT_CFG_URL = "/static/game/font.cfg.bin.gz";
const FONT_G4TX_URL = "/static/game/font.g4tx.gz";

let initPromise: Promise<void> | null = null;
let wasmMemory: WebAssembly.Memory | null = null;

/** Compile the immutable Wasm code off the UI thread when module workers are available. */
export function compileWasmInWorker(url: string): Promise<WebAssembly.Module | null> {
	if (typeof Worker !== "function") return Promise.resolve(null);
	return new Promise((resolve) => {
		let worker: Worker;
		try {
			worker = new Worker(new URL("./wasm-compiler.worker.ts", import.meta.url), { type: "module" });
		} catch {
			resolve(null);
			return;
		}
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		const finish = (module: WebAssembly.Module | null) => {
			if (settled) return;
			settled = true;
			if (timeout !== undefined) clearTimeout(timeout);
			worker.terminate();
			resolve(module);
		};
		timeout = setTimeout(() => finish(null), 30_000);
		worker.onmessage = (event: MessageEvent<{ module?: WebAssembly.Module; error?: string }>) => {
			finish(event.data.module instanceof WebAssembly.Module ? event.data.module : null);
		};
		worker.onerror = () => finish(null);
		worker.postMessage({ url });
	});
}

/** Charge le module wasm une seule fois, même si deux écrans le demandent en même temps. */
export async function ensureWasm(): Promise<void> {
	if (initPromise === null) {
		initPromise = (async () => {
			// This public file is not content-hashed. Force ETag revalidation so an immutable
			// response from an older deployment cannot be paired with newer JavaScript glue.
			const compiled = await compileWasmInWorker(WASM_URL);
			const moduleOrResponse = compiled ?? fetch(WASM_URL, { cache: "no-cache" });
			const exports = await init({ module_or_path: moduleOrResponse });
			wasmMemory = exports.memory;
		})();
	}
	const pending = initPromise;
	try {
		await pending;
	} catch (error) {
		// A failed request must not poison every later mount in the same SPA session.
		if (initPromise === pending) initPromise = null;
		throw error;
	}
}

/** The engine owns screen identity and geometry; the browser supplies only the host. */
export async function loadMenuPresentation(id: "loading" | "start" | "autosave" | "title-menu" | "options-row" | "avatar-top" | "avatar-style" | "avatar-hair" | "avatar-clothes" | "avatar-stats" | "avatar-name"): Promise<NativeMenuScene> {
	await ensureWasm();
	return JSON.parse(menu_presentation_json(id)) as NativeMenuScene;
}

/**
 * Récupère un asset gzippé et le décompresse en flux.
 *
 * La texture de police fait 42 MiB en clair (5,5 MiB gzip) : la servir compressée n'est pas une
 * optimisation, c'est ce qui rend le premier chargement supportable. `DecompressionStream` est
 * natif sur les navigateurs ciblés, donc aucune bibliothèque n'entre ici.
 */
async function loadGzip(url: string): Promise<Uint8Array> {
	// Like the wasm binary, these stable names require validation across deployments.
	const res = await fetch(url, { cache: "no-cache" });
	if (!res.ok || res.body === null) throw new Error(`${url} → HTTP ${res.status}`);
	const flux = res.body.pipeThrough(new DecompressionStream("gzip"));
	return new Uint8Array(await new Response(flux).arrayBuffer());
}

let fontPromise: Promise<readonly [Uint8Array, Uint8Array]> | null = null;

/** Shares only an in-flight font load; decoded 42 MiB buffers are released after construction. */
function loadFont(): Promise<readonly [Uint8Array, Uint8Array]> {
	if (fontPromise === null) {
		fontPromise = (async () => {
			try {
				return await Promise.all([loadGzip(FONT_CFG_URL), loadGzip(FONT_G4TX_URL)]);
			} finally {
				fontPromise = null;
			}
		})();
	}
	return fontPromise;
}

/** La poignée du jeu : dimensions, entrée, temps, image, score. */
export interface GameHandle {
	/** Largeur du framebuffer, en pixels du jeu. */
	readonly width: number;
	/** Hauteur du framebuffer, en pixels du jeu. */
	readonly height: number;
	/** Transmet une commande de menu IEVR (`CMD_ENTER`, `CMD_BACK`, `CMD_FCS_MTX_UP`…). */
	input(cmd: string): void;
	/** Transmet l'état maintenu du clavier au monde `nie-runtime`. */
	setMatchInput(dx: number, dy: number, shoot: boolean): void;
	/** Avance le temps de `dt` secondes — la physique du match tourne pendant un match. */
	update(dt: number): void;
	/** Rend l'écran courant, prêt pour `putImageData`. */
	frame(): ImageData;
	/** Score courant `[domicile, extérieur]` ; des zéros hors match. */
	score(): [number, number];
	/** Vrai si un match est en cours. */
	isMatch(): boolean;
	/** Snapshot JSON versionné du moteur Rust, utile aux renderers et aux diagnostics. */
	stateJson(): string;
	/** Libère immédiatement l'instance Rust et sa mémoire. Cet appel est idempotent. */
	dispose(): void;
}

/** Optional ABI added after the original copying `render()` method. */
export interface SharedFrameAccess {
	render_frame(): void;
	frame_ptr(): number;
	frame_len(): number;
}

function hasSharedFrameAccess(game: WasmGame): game is WasmGame & SharedFrameAccess {
	const candidate = game as unknown as Partial<SharedFrameAccess>;
	return (
		typeof candidate.render_frame === "function" &&
		typeof candidate.frame_ptr === "function" &&
		typeof candidate.frame_len === "function"
	);
}

/**
 * Renders and returns a clamped view directly over Rust-owned WebAssembly memory.
 * The view must be consumed before the next `render_frame()`, which may move the allocation.
 */
export function sharedFrameView(
	frame: SharedFrameAccess,
	memory: WebAssembly.Memory,
	expectedLength: number,
): Uint8ClampedArray<ArrayBuffer> {
	frame.render_frame();
	const pointer = frame.frame_ptr();
	const length = frame.frame_len();
	if (
		!Number.isSafeInteger(pointer) ||
		pointer < 0 ||
		!Number.isSafeInteger(length) ||
		length !== expectedLength ||
		pointer + length > memory.buffer.byteLength
	) {
		throw new Error(`invalid shared frame: offset=${pointer} length=${length}`);
	}
	return new Uint8ClampedArray(memory.buffer as ArrayBuffer, pointer, length);
}

/** Charge le jeu et sa police, et rend une poignée pilotable. */
export async function loadGame(): Promise<GameHandle> {
	await ensureWasm();
	const [cfg, g4tx] = await loadFont();
	const game = new WasmGame(cfg, g4tx);
	const width = game.width;
	const height = game.height;
	const sharedFrame = hasSharedFrameAccess(game) ? game : null;
	const memory = wasmMemory;
	let disposed = false;
	return {
		width,
		height,
		input: (cmd) => game.input(cmd),
		setMatchInput: (dx, dy, shoot) => game.set_match_input(dx, dy, shoot),
		update: (dt) => game.update(dt),
		frame: () => {
			if (sharedFrame !== null && memory !== null) {
				return new ImageData(sharedFrameView(sharedFrame, memory, width * height * 4), width, height);
			}
			// Compatibility with an older generated wrapper/binary pair.
			return new ImageData(new Uint8ClampedArray(game.render()), width, height);
		},
		score: () => {
			const s = game.score();
			return [s[0] ?? 0, s[1] ?? 0];
		},
		isMatch: () => game.in_match,
		stateJson: () => game.state_json(),
		dispose: () => {
			if (disposed) return;
			disposed = true;
			game.free();
		},
	};
}

/** Fixed simulation step shared by every display refresh rate. */
export const FIXED_TIME_STEP = 1 / 60;
/** Maximum wall-clock time accepted from one animation frame. */
export const MAX_FRAME_DELTA = 1 / 20;

export interface SimulationTiming {
	readonly steps: number;
	readonly remainder: number;
}

/** Converts variable animation timing into deterministic 60 Hz simulation steps. */
export function simulationTiming(accumulator: number, elapsed: number): SimulationTiming {
	const safeAccumulator = Number.isFinite(accumulator) && accumulator > 0 ? accumulator : 0;
	const safeElapsed = Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, MAX_FRAME_DELTA)) : 0;
	const total = safeAccumulator + safeElapsed;
	const steps = Math.floor((total + FIXED_TIME_STEP * 1e-9) / FIXED_TIME_STEP);
	return {
		steps,
		remainder: Math.max(0, total - steps * FIXED_TIME_STEP),
	};
}

export interface DisplaySize {
	readonly width: number;
	readonly height: number;
}

/** Uses the largest integer upscale that fits, with proportional downscaling on small screens. */
export function canvasDisplaySize(
	sourceWidth: number,
	sourceHeight: number,
	availableWidth: number,
	availableHeight: number,
): DisplaySize {
	if (
		![sourceWidth, sourceHeight, availableWidth, availableHeight].every(
			(value) => Number.isFinite(value) && value > 0,
		)
	) {
		return { width: sourceWidth, height: sourceHeight };
	}
	const fit = Math.min(availableWidth / sourceWidth, availableHeight / sourceHeight);
	const scale = fit >= 1 ? Math.floor(fit) : fit;
	return { width: sourceWidth * scale, height: sourceHeight * scale };
}

/**
 * Le clavier, traduit en commandes de menu du jeu.
 *
 * Les noms sont ceux du jeu (`CMD_FCS_MTX_*` pour le déplacement dans une matrice de focus,
 * `CMD_ENTER`/`CMD_BACK` pour valider et revenir), pas une convention inventée ici : la FSM de
 * `nie_app::flow` les attend mot pour mot, et un nom approché ne produirait pas d'erreur — il
 * ne ferait simplement rien.
 *
 * Les deux jeux de touches coexistent délibérément : les flèches pour qui arrive au clavier,
 * ZQSD/WASD pour qui joue. `Entrée` et `Espace` valident, `Échap` et `Retour arrière` reviennent.
 */
const KEY_COMMANDS: Readonly<Record<string, string>> = {
	ArrowUp: "CMD_FCS_MTX_UP",
	ArrowDown: "CMD_FCS_MTX_DOWN",
	ArrowLeft: "CMD_FCS_MTX_LEFT",
	ArrowRight: "CMD_FCS_MTX_RIGHT",
	w: "CMD_FCS_MTX_UP",
	z: "CMD_FCS_MTX_UP",
	s: "CMD_FCS_MTX_DOWN",
	a: "CMD_FCS_MTX_LEFT",
	q: "CMD_FCS_MTX_LEFT",
	d: "CMD_FCS_MTX_RIGHT",
	Enter: "CMD_ENTER",
	" ": "CMD_ENTER",
	Escape: "CMD_BACK",
	Backspace: "CMD_BACK",
	Tab: "CMD_FCS_NEXT",
	i: "CMD_INFO",
};

/** La commande que déclenche une touche, ou `null` si cette touche ne fait rien. */
export function commandForKey(key: string): string | null {
	return KEY_COMMANDS[key] ?? KEY_COMMANDS[key.toLowerCase()] ?? null;
}
