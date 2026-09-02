/**
 * Pont navigateur vers les **parseurs natifs** de fichiers de jeu IEVR (wasm `nie-wasm`).
 *
 * Décode les `cfg.bin` (RDBN + T2B) en structures de jeu TYPÉES **côté client**, sans
 * dépendre de la route serveur `/typed` de nie-model-serve : on télécharge les octets
 * bruts (`/raw`) puis on parse dans le module WebAssembly (mêmes parseurs Rust que le jeu).
 *
 * Module wasm vendoré (`lib/nie-wasm-web/`, build `wasm-bindgen --target web`), binaire
 * servi same-origin depuis `/wasm/nie_wasm_bg.wasm` (`public/`). Instancié une fois.
 */
import init, {
	audio_to_wav,
	cfgbin_typed_json,
	g4pk_parse_json,
	g4tx_to_png,
	is_lua_bytecode,
	lua_bytecode_json,
	init_panic_hook,
	model_to_glb,
} from "./nie-wasm-web/nie_wasm.js";

/** URL same-origin du binaire wasm. */
const WASM_URL = "/wasm/nie_wasm_bg.wasm";

let initPromise: Promise<void> | null = null;

/** Instancie le module wasm une seule fois (idempotent). */
async function ensureWasm(): Promise<void> {
	if (initPromise === null) {
		initPromise = (async () => {
			await init({ module_or_path: fetch(WASM_URL) });
			init_panic_hook();
		})().catch((cause: unknown) => {
			// Sans ce reset, un échec ponctuel (réseau coupé, binaire non encore
			// déployé) empoisonnait la promesse pour toute la durée de vie de
			// l'onglet : chaque appel ultérieur rejouait la MÊME erreur, sans
			// jamais retenter le chargement.
			initPromise = null;
			throw new Error(`Chargement du module wasm impossible (${WASM_URL}).`, { cause });
		});
	}
	return initPromise;
}

/** Réponse du décodage typé d'un `cfg.bin` (forme identique à la route serveur `/typed`). */
export interface CpkTypedDecoded {
	/** Famille de jeu reconnue (`"formation"`, `"item"`…) ou `null` si non typée. */
	family: string | null;
	/** Données typées de la famille (si `family` non nul). */
	data?: unknown;
	/** Clé de fichier dérivée (si `family` nul). */
	key?: string;
	/** RDBN/T2B brut (forme iecode) si aucune famille typée. */
	generic?: unknown;
}

/**
 * Décode un `cfg.bin` (octets bruts) en structure de jeu typée, **dans le navigateur**.
 *
 * @param bytes octets bruts du `cfg.bin` (décompressés du CPK, ex. via `/raw`).
 * @param filename nom de fichier (dérive la clé de famille, ex. `formation_config_0.02.16.cfg.bin`).
 * @throws si le module wasm échoue à charger, ou si les octets ne sont ni RDBN ni T2B.
 */
export async function cfgbinTyped(bytes: Uint8Array, filename: string): Promise<CpkTypedDecoded> {
	await ensureWasm();
	const json = cfgbin_typed_json(bytes, filename);
	return JSON.parse(json) as CpkTypedDecoded;
}

/**
 * Décode une texture `.g4tx` (octets bruts) en **PNG**, dans le navigateur (DDS
 * BC1/BC3/BC5/BC7 → RGBA → PNG via wasm). Renvoie les octets PNG.
 *
 * @param bytes octets bruts du `.g4tx` (décompressés du CPK, ex. via `/raw`).
 * @throws si le wasm échoue, ou si le `.g4tx` n'a pas de texture DDS décodable.
 */
export async function g4txToPng(bytes: Uint8Array): Promise<Uint8Array> {
	await ensureWasm();
	return g4tx_to_png(bytes);
}

/**
 * Décode un audio CRI (HCA/ADX/AWB/ACB, octets bruts) en **WAV** PCM16, in-browser.
 *
 * @param bytes octets bruts de l'audio (ex. `/raw` ; pour un `.acb` sans AWB embarqué,
 *   passer plutôt les octets du `.awb` sibling — la résolution se fait côté appelant).
 * @throws si le wasm échoue, ou si le format n'est pas un audio CRI décodable.
 */
export async function audioToWav(bytes: Uint8Array): Promise<Uint8Array> {
	await ensureWasm();
	return audio_to_wav(bytes);
}

/** Un sous-fichier d'une archive `.g4pk`. */
export interface G4pkFile {
	name: string;
	offset: number;
	size: number;
	hash: number;
}
/** Archive `.g4pk` parsée (en-tête + sous-fichiers). */
export interface G4pkParsed {
	header: { file_count: number; version: number; kind: string };
	files: G4pkFile[];
}

/** Parse une archive `.g4pk` (octets bruts) en-tête + sous-fichiers, in-browser. */
export async function g4pkParse(bytes: Uint8Array): Promise<G4pkParsed> {
	await ensureWasm();
	return JSON.parse(g4pk_parse_json(bytes)) as G4pkParsed;
}

/**
 * Assemble une paire **G4MD + G4MG** (octets bruts) en **GLB** (modèle 3D glTF binaire),
 * dans le navigateur (géométrie). Renvoie les octets GLB (à servir via blob URL à `<model-viewer>`).
 *
 * @throws si le wasm échoue, ou si la paire n'est pas un modèle valide.
 */
export async function modelToGlb(g4md: Uint8Array, g4mg: Uint8Array): Promise<Uint8Array> {
	await ensureWasm();
	return model_to_glb(g4md, g4mg);
}

/** Résumé d'un script `.lua.bin` du jeu, décodé dans le navigateur. */
export type LuaBytecodeResume = {
	instructions: number;
	prototypes: number;
	params: number;
	constantes: string[];
	source: string;
};

/**
 * Décode un `.lua.bin` du jeu (bytecode Lua 5.2) sans quitter le navigateur.
 *
 * C'est le décodeur du dépôt (`nie_lua::bytecode`), compilé **sans la VM** : `mlua` embarque Lua
 * en C, qui ne se construit pas pour wasm32, alors que le décodeur est du Rust pur.
 */
export async function luaBytecode(bytes: Uint8Array): Promise<LuaBytecodeResume> {
	await ensureWasm();
	return JSON.parse(lua_bytecode_json(bytes)) as LuaBytecodeResume;
}

/** Vrai si ces octets sont un bytecode Lua 5.2 du jeu. */
export async function estLuaBytecode(bytes: Uint8Array): Promise<boolean> {
	await ensureWasm();
	return is_lua_bytecode(bytes);
}
