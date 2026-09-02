/**
 * Pont navigateur vers le parseur de sauvegardes IEVR (wasm `nie-wasm`).
 *
 * La save NE quitte JAMAIS le navigateur : tout le déchiffrement (conteneur
 * « Lives » CRC32-keyed XOR) et le parsing (HEADERSAVE / AUTOSAVE) sont
 * effectués client-side dans le module WebAssembly. Aucun octet n'est envoyé
 * au serveur.
 *
 * Le module wasm est vendoré (`lib/nie-wasm-web/`, build `wasm-pack --target web`)
 * et son binaire est servi depuis `/wasm/nie_wasm_bg.wasm` (public/). On l'instancie
 * une seule fois (singleton process-local) en passant les octets explicitement à
 * `init` — on n'utilise pas le chemin `new URL(import.meta.url)` par défaut du glue,
 * pour rester robuste au bundler et au CSP (fetch same-origin).
 */

// Le glue ESM `--target web` est browser-safe (pas de `require('fs')`).
import init, { init_panic_hook, parse_save_json } from "./nie-wasm-web/nie_wasm.js";

// ---------------------------------------------------------------------------
// Types du résumé (miroir de la sortie JSON de `parse_save_json`)
// ---------------------------------------------------------------------------

/** Horodatage natif IEVR décodé (champs bruts, sans validation calendaire). */
export interface SaveDateTime {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

/** Résumé d'un blob interne du conteneur (sans le corps brut). */
export interface SaveBlobSummary {
	filename: string;
	subtype: "System" | "Autosave" | "Headersave" | "Unknown";
	size: number;
	crc32: number;
	field8: number;
}

/** Métadonnées d'un slot de sauvegarde (depuis HEADERSAVE). */
export interface SaveSlotMeta {
	index: number;
	is_active: boolean;
	section_role: number;
	slot_variant: number;
	slot_datetime: SaveDateTime | null;
	playtime_secs: number | null;
}

/** Champs HEADERSAVE parsés (joueur, niveau, horodatage, slots). */
export interface SaveHeader {
	format_version: number;
	max_slots: number;
	used_slots: number;
	player_name: string;
	level_str: string;
	unique_id: string;
	save_timestamp: SaveDateTime;
	slots: SaveSlotMeta[];
}

/** Scalaires AUTOSAVE (datetime de sauvegarde + temps de jeu). */
export interface SaveScalars {
	save_year: number;
	save_month: number;
	save_day: number;
	save_hour: number;
	save_minute: number;
	save_second: number;
	playtime_secs: number;
	playtime_hms: { h: number; m: number; s: number };
}

/** Layout + roster AUTOSAVE. */
export interface SaveAutosave {
	version: number;
	opaque_4: number;
	scalar_record_count: number;
	chara_slot_count: number;
	section2_range: [number, number];
	main_data_range: [number, number];
	scalars: SaveScalars | null;
	roster_slots: number;
	owned_count: number;
	owned_ids: number[];
}

/** Résumé complet d'une sauvegarde IEVR. */
export interface SaveSummary {
	slot_name: string;
	key: number;
	blobs: SaveBlobSummary[];
	headersave: SaveHeader | null;
	autosave: SaveAutosave | null;
}

// ---------------------------------------------------------------------------
// Initialisation wasm (singleton)
// ---------------------------------------------------------------------------

/** URL same-origin du binaire wasm (servi depuis `public/wasm/`). */
const WASM_URL = "/wasm/nie_wasm_bg.wasm";

let initPromise: Promise<void> | null = null;

/** Instancie le module wasm une seule fois (idempotent). */
async function ensureWasm(): Promise<void> {
	if (initPromise === null) {
		initPromise = (async () => {
			// On passe les octets explicitement : le glue par défaut résout
			// `new URL('nie_wasm_bg.wasm', import.meta.url)` qui n'existe pas tel quel
			// dans le bundle Next — fetch same-origin est plus robuste.
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

// ---------------------------------------------------------------------------
// API publique
// ---------------------------------------------------------------------------

/**
 * Déchiffre et parse une sauvegarde IEVR côté navigateur.
 *
 * @param bytes contenu brut du fichier de sauvegarde.
 * @param filename nom de base du fichier (sert à dériver la clé CRC32, ex.
 *   `002AB8F4-USERDATALIVE`). La clé dépend EXACTEMENT de ce nom.
 * @returns le résumé parsé.
 * @throws si le module wasm échoue à charger, ou si le fichier n'est pas une
 *   save IEVR valide (mauvais magic / mauvaise clé dérivée du nom / CRC32 KO).
 */
export async function parseSave(bytes: Uint8Array, filename: string): Promise<SaveSummary> {
	await ensureWasm();
	const json = parse_save_json(bytes, filename);
	return JSON.parse(json) as SaveSummary;
}
