/**
 * Pont navigateur vers le **JEU complet** niers (`nie-wasm`/`WasmGame`), 100 % Rust → WebAssembly.
 *
 * `WasmGame` est la machine à états interactive : écran-titre → menu principal (9 onglets réels) →
 * sélection de mode (Histoire / Chronique / Compétition / Victory Road / Stade BB) → **vrai match**
 * (moteur nie-runtime : physique, 22 joueurs, ballon, buts) / dialogues. Clavier in, framebuffer out.
 *
 * Ce module ne fait que : charger le wasm, fetcher la police réelle (gzippée same-origin), et adapter
 * input clavier + framebuffer ↔ canvas. ⚠ Navigateur uniquement — importer depuis `"use client"`.
 */
import init, { WasmGame } from "./nie-wasm-web/nie_wasm.js";

const WASM_URL = "/wasm/nie_wasm_bg.wasm";
const FONT_CFG_URL = "/assets/font/font.cfg.bin.gz";
const FONT_G4TX_URL = "/assets/font/font.g4tx.gz";

let initPromise: Promise<void> | null = null;
async function ensureWasm(): Promise<void> {
	if (initPromise === null) {
		initPromise = (async () => {
			await init({ module_or_path: fetch(WASM_URL) });
		})();
	}
	return initPromise;
}

/** Fetch d'un asset gzip + décompression streaming → octets bruts. */
async function fetchGzipped(url: string): Promise<Uint8Array> {
	const res = await fetch(url);
	if (!res.ok || res.body === null) throw new Error(`${url} → HTTP ${res.status}`);
	const stream = res.body.pipeThrough(new DecompressionStream("gzip"));
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Poignée du jeu : dimensions + entrée clavier + tick + rendu + score. */
export interface GameHandle {
	/** Largeur du framebuffer (px). */
	readonly width: number;
	/** Hauteur du framebuffer (px). */
	readonly height: number;
	/** Transmet une COMMANDE de menu IEVR réelle (CMD_ENTER, CMD_BACK, CMD_FCS_MTX_UP…) au jeu. */
	input(cmd: string): void;
	/** Avance le temps de `dt` secondes (la physique du match tourne en match). */
	update(dt: number): void;
	/** Rend l'écran courant en `ImageData` pour `putImageData`. */
	frame(): ImageData;
	/** Score courant `[domicile, extérieur]`. */
	score(): [number, number];
	/** `true` si un match est en cours. */
	inMatch(): boolean;
}

/** Charge le jeu wasm complet + la police réelle, et renvoie une poignée pilotable. */
export async function loadGame(): Promise<GameHandle> {
	await ensureWasm();
	const [cfg, g4tx] = await Promise.all([fetchGzipped(FONT_CFG_URL), fetchGzipped(FONT_G4TX_URL)]);
	const game = new WasmGame(cfg, g4tx);
	const w = game.width;
	const h = game.height;
	const toImage = (rgba: Uint8Array): ImageData => new ImageData(new Uint8ClampedArray(rgba), w, h);
	return {
		width: w,
		height: h,
		input: (cmd) => game.input(cmd),
		update: (dt) => game.update(dt),
		frame: () => toImage(game.render()),
		score: () => {
			const s = game.score();
			return [s[0] ?? 0, s[1] ?? 0];
		},
		inMatch: () => game.in_match,
	};
}
