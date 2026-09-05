/* tslint:disable */
/* eslint-disable */

/**
 * Machine à états d'écran interactive, rendue en WebAssembly.
 *
 * Écran-titre → menu → match simulé (`nie-runtime` : physique, 22 joueurs, ballon, buts) → mode
 * histoire, pilotée au clavier, rendue dans un framebuffer RGBA8 `W*H*4` que JS peint.
 *
 * ⚠ **Ce n'est pas le jeu.** Le rendu est un placeholder 2D : il ne ressemble pas à l'UI d'IEVR,
 * parce que le vrai menu n'est pas dans les fichiers — il est construit à l'exécution par le
 * menu-manager C++ qui pilote Lua via `funcLuaMenuCommand`, boucle non encore portée. Et le
 * modèle de but de `match_sim` reste nominal. Ne pas présenter cette surface comme un jeu
 * jouable : ce qu'elle prouve, c'est que la logique portée tourne en wasm.
 */
export class WasmGame {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Commande de menu IEVR (CMD_FCS_*, CMD_ENTER, CMD_BACK…). Le mapping clavier/souris/manette
     * → commande vit côté front ; la FSM (transitions) vit dans `nie_app::flow` (dédup Phase 5).
     */
    input(cmd: string): void;
    /**
     * Construit le jeu depuis les octets de la police (`font.cfg.bin` + `font.g4tx`, fetchés par JS).
     * Démarre sur l'écran-titre.
     */
    constructor(font_cfg: Uint8Array, font_g4tx: Uint8Array);
    /**
     * Rend l'écran courant en framebuffer RGBA8 `W*H*4`.
     */
    render(): Uint8Array;
    /**
     * Score du match en cours `[domicile, extérieur]` (zéros hors match).
     */
    score(): Uint32Array;
    /**
     * Avance le temps de `dt` s : la physique du match tourne quand un match est en cours.
     */
    update(dt: number): void;
    /**
     * Hauteur du framebuffer (px).
     */
    readonly height: number;
    /**
     * `true` si un match est en cours (pour l'overlay de score côté UI).
     */
    readonly in_match: boolean;
    /**
     * Largeur du framebuffer (px).
     */
    readonly width: number;
}

/**
 * Viewer canvas WebGPU partagé avec NIE natif. `free()` est généré par wasm-bindgen.
 */
export class WebGpuViewer {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * JSON d'identité mesurée. Le navigateur peut anonymiser nom/vendor/device.
     */
    backend_info(): string;
    /**
     * Initialise une surface WebGPU compatible avec le canvas ; échec sans fallback.
     */
    static create(canvas: HTMLCanvasElement): Promise<WebGpuViewer>;
    /**
     * Charge/remplace un modèle GLB normalisé (positions monde, textures PNG embarquées).
     */
    load_glb(bytes: Uint8Array): void;
    /**
     * Angles absolus en radians ; distance positive en rayons. NaN/infini rejetés.
     */
    orbit(yaw: number, pitch: number, distance: number): void;
    /**
     * Présente via la texture GPU partagée ; false demande de réessayer à la prochaine frame.
     */
    render(): boolean;
    /**
     * Backing store en pixels entiers strictement positifs, sans changer le CSS.
     */
    resize(width: number, height: number): void;
}

/**
 * Point d'entrée **auto-exécuté à l'instanciation** du module (attribut `start`,
 * best practice wasm-bindgen) : installe le hook de panique sans dépendre d'un
 * appel JS explicite — toute panique reste lisible même si l'hôte oublie l'init.
 */
export function __wasm_start(): void;

/**
 * Décode un audio CRI (HCA/ADX/AWB/ACB, octets bruts) en **WAV PCM16**, in-browser.
 */
export function audio_to_wav(bytes: Uint8Array): Uint8Array;

/**
 * Parse un `aura_skill_config.cfg.bin.json` (et un `skill_config.cfg.bin.json`
 * optionnel pour résoudre le hissatsu lié) et retourne les auras.
 *
 * - `aura_config_json` : contenu du dump `aura_skill_config_*.cfg.bin.json`.
 * - `skill_config_json` : contenu du `skill_config_*.cfg.bin.json` (chaîne vide
 *   pour ignorer la résolution `config.skillId1 → SkillInfo`).
 *
 * Retourne un JSON `{ "count": N, "auras": [ { auraId, assetCode, subType, element,
 * config, hissatsu }, … ] }`, ou lève une `Error` JS si le JSON est invalide.
 */
export function aura_lookup(aura_config_json: string, skill_config_json: string): string;

/**
 * Calcule le bloc de 7 statistiques d'un personnage à un niveau donné.
 *
 * Combine les tables de croissance réelles IEVR embarquées (`nie-core`,
 * ancrées sur `inagle/stat-calculator.ts`) avec la résolution par fallback en
 * cascade (lv1/lv30/main) puis l'interpolation 3-segments.
 *
 * Paramètres :
 * - `main_position` : 1=GK, 2=DF, 3=MF, 4=FW.
 * - `sub_position` : sous-position (0 = aucune).
 * - `growth_pattern` : pattern de croissance (0, 1, 2+).
 * - `chara_rank` : code de rareté brut (0=N, 2=R, 3=SR, 4=SSR, 5=UR, 6=LR, 7=Legend, 20=BASARA).
 * - `play_style` : style de jeu (0 par défaut).
 * - `level` : niveau 1..=99.
 *
 * Retourne un JSON :
 * ```text
 * {
 *   "stats": { "kc": 207, "cr": 216, "tc": 218, "pr": 235, "ps": 242, "ag": 210, "it": 261 },
 *   "total": 1589
 * }
 * ```
 */
export function calculate_stats(main_position: number, sub_position: number, growth_pattern: number, chara_rank: number, play_style: number, level: number): string;

/**
 * Parse un fichier cfg.bin (T2B) et retourne son JSON structurel.
 */
export function cfgbin_parse_json(bytes: Uint8Array): string;

/**
 * Décode un `cfg.bin` (octets bruts) en structure de jeu typée selon le nom de fichier.
 */
export function cfgbin_typed_json(bytes: Uint8Array, filename: string): string;

/**
 * Extrait et décompresse un fichier d'un CPK.
 */
export function cpk_extract_file(cpk_bytes: Uint8Array, cpk_filename: string, entry_json: string): Uint8Array;

/**
 * Parse un fichier CPK et retourne son TOC (Table of Contents) au format JSON.
 */
export function cpk_parse_entries(cpk_bytes: Uint8Array, cpk_filename: string): string;

/**
 * Décompresse un tampon CRILAYLA.
 *
 * Retourne les octets décompressés, ou lève une `Error` JS si le format est invalide.
 *
 * En JS :
 * ```text
 * try {
 *   const raw = crilayla_decompress(bytes); // Uint8Array
 * } catch (e) {
 *   console.error("Décompression échouée :", e);
 * }
 * ```
 */
export function crilayla_decompress(bytes: Uint8Array): Uint8Array;

/**
 * Détecte le format d'un tampon d'octets et retourne son nom court.
 *
 * Retourne l'une des chaînes suivantes :
 * `"CPK"`, `"@UTF"`, `"CRILAYLA"`, `"HCA"`, `"ACB"`, `"AWB"`, `"USM"`,
 * `"cfg.bin"`, `"G4MG"`, `"G4MD"`, `"G4TX"`, `"G4SK"`, `"G4PK"`, `"G4NV"`, `"?"`.
 */
export function detect_format(bytes: Uint8Array): string;

/**
 * Encode le score final du match : `minutes * 10000 + secondes`.
 *
 * Expose `nie_core::match_fsm::final_score` (case 7 de `FUN_1412aa4a0`).
 */
export function final_score(minutes: number, seconds: number): number;

/**
 * Parse un fichier G4MD et retourne son JSON descriptif.
 */
export function g4md_parse_json(bytes: Uint8Array): string;

/**
 * Extrait la géométrie d'un fichier G4MG à l'aide des métadonnées G4MD fournies au format JSON.
 */
export function g4mg_extract_json(g4mg_bytes: Uint8Array, g4md_json: string): string;

/**
 * Parse une archive `.g4pk` (en-tête + sous-fichiers) en JSON, in-browser.
 */
export function g4pk_parse_json(bytes: Uint8Array): string;

/**
 * Métadonnées d'un `.g4tx` (textures : nom, dimensions, DDS) en JSON, in-browser.
 */
export function g4tx_info_json(bytes: Uint8Array): string;

/**
 * Décode la texture nommée `nom` d'un `.g4tx` en PNG, in-browser.
 */
export function g4tx_named_to_png(bytes: Uint8Array, nom: string): Uint8Array;

/**
 * Feuille de sprites d'un atlas `.g4tx` : régions nommées avec leur rectangle, en JSON.
 *
 * `g4tx_info_json` rend la structure brute du conteneur ; celle-ci rend ce qu'une interface
 * attend — un manifeste `{nom, largeur, hauteur, sprites[{nom, classe, x, y, largeur, hauteur}]}`
 * directement consommable pour positionner une icône, avec ou sans CSS.
 */
export function g4tx_sprite_sheet_json(bytes: Uint8Array): string;

/**
 * Décode un `.g4tx` (octets bruts) en PNG (octets), in-browser.
 */
export function g4tx_to_png(bytes: Uint8Array): Uint8Array;

/**
 * Installe le hook de panique `console_error_panic_hook`.
 *
 * Appeler cette fonction UNE FOIS au démarrage (après `await init()`) pour que
 * toute panique Rust apparaisse dans la console du navigateur avec un message
 * lisible au lieu d'une erreur Wasm opaque. Conservée pour compat ; le hook est
 * désormais aussi installé automatiquement par [`__wasm_start`] (best practice).
 */
export function init_panic_hook(): void;

/**
 * Vrai si les octets commencent par la signature d'un bytecode Lua 5.2.
 */
export function is_lua_bytecode(bytes: Uint8Array): boolean;

/**
 * Parse un `item_config.cfg.bin.json` et retourne les objets (catégorie + stats).
 *
 * - `item_config_json` : contenu du dump `item_config_*.cfg.bin.json`.
 *
 * Retourne un JSON `{ "count": N, "items": [ { itemId, category, nameId, price,
 * stats, internalCode, … }, … ] }`, ou lève une `Error` JS si le JSON est invalide.
 */
export function item_lookup(item_config_json: string): string;

/**
 * Décode une piste de lip-sync `.p3lip` (visèmes datés) en JSON, in-browser.
 */
export function lip_to_json(bytes: Uint8Array): string;

/**
 * Décode un `.lua.bin` du jeu (bytecode Lua 5.2) en résumé JSON.
 */
export function lua_bytecode_json(bytes: Uint8Array): string;

/**
 * Avance la machine à états du match d'un tick (transition nominale).
 *
 * Porte la FSM 11 états de `CSceneSoccer` (`nie-core::match_fsm::tick`).
 * - `state` : nom de l'état courant (`"Init"`, `"WaitTimer"`, … ou index `"0".."10"`).
 * - `is_training` : flag entraînement (`false` = match normal).
 * - `end_counter` : compteur de fin (case 5 : 0/1 = restart, 2 = complétion).
 *
 * Retourne un JSON `{ "next": "WaitTimer", "immediate": false }`, ou lève une
 * `Error` JS si l'état est inconnu.
 */
export function match_tick(state: string, is_training: boolean, end_counter: number): string;

/**
 * Assemble une paire G4MD+G4MG (octets bruts) en GLB, in-browser.
 */
export function model_to_glb(g4md: Uint8Array, g4mg: Uint8Array): Uint8Array;

/**
 * Déchiffre et parse un fichier de sauvegarde IEVR, retourne un JSON résumé.
 *
 * La save ne quitte PAS le navigateur : tout le traitement est effectué
 * client-side dans le module WebAssembly.
 *
 * - `bytes` : contenu brut du fichier de sauvegarde (ex. `002AB8F4-USERDATALIVE`).
 * - `filename` : nom de base du fichier (sert à dériver la clé CRC32).
 *
 * Retourne un JSON avec :
 * - `slot_name`, `key` : métadonnées du conteneur.
 * - `blobs` : liste des entrées (filename, subtype, size, crc32, field8).
 * - `headersave` : champs HEADERSAVE parsés (joueur, niveau, horodatage, slots).
 * - `autosave` : layout macroscopique + scalaires + roster complet (owned_ids).
 *
 * Lève une `Error` JS (wasm32) ou retourne `Err(String)` (natif) si le fichier
 * est invalide ou la clé ne correspond pas au nom.
 */
export function parse_save_json(bytes: Uint8Array, filename: string): string;

/**
 * Convertit un code de rareté brut en rang de table de croissance.
 *
 * Expose `nie_core::stats::rarity_to_growth_rank` (0→0, 2→2, …, 5/6/7/20→5).
 */
export function rarity_to_growth_rank(rarity_code: number): number;

/**
 * Calcule une statistique unique par interpolation 3-segments (lv1/30/50/99).
 *
 * Expose directement `nie_core::stats::calculate_single_stat`. Les niveaux hors
 * plage sont clampés (lv≤1 → `stat_lv1`, lv≥99 → `stat_lv99`).
 */
export function single_stat(level: number, stat_lv1: number, stat_lv30: number, stat_lv50: number, stat_lv99: number): number;

/**
 * Parse un `skill_config.cfg.bin.json` (et un `skill_text.cfg.bin.json` optionnel)
 * et retourne les techniques résolues (nom/élément/catégorie/puissance).
 *
 * - `skill_config_json` : contenu JSON du dump `skill_config_*.cfg.bin.json`.
 * - `skill_text_json` : contenu JSON du `skill_text_*.cfg.bin.json` (chaîne vide
 *   pour ignorer la jointure nom/description).
 *
 * Retourne un JSON `{ "count": N, "skills": [ { skillId, skillIdStr, name, element,
 * category, powerMin, powerMax, … }, … ] }`, ou lève une `Error` JS si le JSON est invalide.
 */
export function skill_lookup(skill_config_json: string, skill_text_json: string): string;

/**
 * Parse une table `@UTF` et retourne son contenu sérialisé en JSON.
 *
 * Le JSON a la structure suivante :
 *
 * ```text
 * {
 *   "nom": "NomDeLaTable",
 *   "colonnes": [{ "nom": "ColA", "type": "U32" }, ...],
 *   "lignes": [[42, "hello"], ...]
 * }
 * ```
 *
 * En JS :
 * ```text
 * const json = utf_table_json(bytes);
 * const table = JSON.parse(json);
 * console.log(table.nom, table.lignes.length);
 * ```
 */
export function utf_table_json(bytes: Uint8Array): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmgame_free: (a: number, b: number) => void;
    readonly __wbg_webgpuviewer_free: (a: number, b: number) => void;
    readonly audio_to_wav: (a: number, b: number) => [number, number, number, number];
    readonly aura_lookup: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly calculate_stats: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly cfgbin_parse_json: (a: number, b: number) => [number, number, number, number];
    readonly cfgbin_typed_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly cpk_extract_file: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly cpk_parse_entries: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly crilayla_decompress: (a: number, b: number) => [number, number, number, number];
    readonly detect_format: (a: number, b: number) => [number, number];
    readonly final_score: (a: number, b: number) => number;
    readonly g4md_parse_json: (a: number, b: number) => [number, number, number, number];
    readonly g4mg_extract_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly g4pk_parse_json: (a: number, b: number) => [number, number, number, number];
    readonly g4tx_info_json: (a: number, b: number) => [number, number, number, number];
    readonly g4tx_named_to_png: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly g4tx_sprite_sheet_json: (a: number, b: number) => [number, number, number, number];
    readonly g4tx_to_png: (a: number, b: number) => [number, number, number, number];
    readonly is_lua_bytecode: (a: number, b: number) => number;
    readonly item_lookup: (a: number, b: number) => [number, number, number, number];
    readonly lip_to_json: (a: number, b: number) => [number, number, number, number];
    readonly lua_bytecode_json: (a: number, b: number) => [number, number, number, number];
    readonly match_tick: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly model_to_glb: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly parse_save_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly rarity_to_growth_rank: (a: number) => number;
    readonly single_stat: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly skill_lookup: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly utf_table_json: (a: number, b: number) => [number, number, number, number];
    readonly wasmgame_height: (a: number) => number;
    readonly wasmgame_in_match: (a: number) => number;
    readonly wasmgame_input: (a: number, b: number, c: number) => void;
    readonly wasmgame_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmgame_render: (a: number) => [number, number];
    readonly wasmgame_score: (a: number) => [number, number];
    readonly wasmgame_update: (a: number, b: number) => void;
    readonly wasmgame_width: (a: number) => number;
    readonly webgpuviewer_backend_info: (a: number) => [number, number];
    readonly webgpuviewer_create: (a: any) => any;
    readonly webgpuviewer_load_glb: (a: number, b: number, c: number) => [number, number];
    readonly webgpuviewer_orbit: (a: number, b: number, c: number, d: number) => [number, number];
    readonly webgpuviewer_render: (a: number) => [number, number, number];
    readonly webgpuviewer_resize: (a: number, b: number, c: number) => [number, number];
    readonly __wasm_start: () => void;
    readonly init_panic_hook: () => void;
    readonly wasm_bindgen_4f860109884afcf7___convert__closures_____invoke___wasm_bindgen_4f860109884afcf7___JsValue__core_fc1ee4111c772ded___result__Result_____wasm_bindgen_4f860109884afcf7___JsError___true_: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen_4f860109884afcf7___convert__closures_____invoke___js_sys_8fcf74085336d80b___Function_fn_wasm_bindgen_4f860109884afcf7___JsValue_____wasm_bindgen_4f860109884afcf7___sys__Undefined___js_sys_8fcf74085336d80b___Function_fn_wasm_bindgen_4f860109884afcf7___JsValue_____wasm_bindgen_4f860109884afcf7___sys__Undefined_______true_: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen_4f860109884afcf7___convert__closures_____invoke___wasm_bindgen_4f860109884afcf7___JsValue______true_: (a: number, b: number, c: any) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
