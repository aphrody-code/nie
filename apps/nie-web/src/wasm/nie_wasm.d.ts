/* tslint:disable */
/* eslint-disable */

/**
 * Browser camera backed by `nie-camera`'s portable `CameraState` and
 * `CCameraCtrlInterPolate` controller math.
 */
export class WasmCamera {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Creates a camera with the verified `nie-camera` default state.
     */
    constructor();
    /**
     * Serializes camera state, orbit values, and row-major view/projection matrices.
     */
    state_json(aspect: number): string;
    /**
     * Advances the active transition by `dt` seconds. Invalid or non-positive
     * deltas are ignored so host clock glitches cannot rewind the controller.
     */
    step(dt: number): void;
    /**
     * Starts a deterministic transition to a complete camera state.
     * Fade codes mirror `m_FadeType`: 0 linear, 1 ease-in, 2 ease-out, and all
     * other observed values (including 6) use the controller's smooth curve.
     */
    transition_to(position_x: number, position_y: number, position_z: number, reference_x: number, reference_y: number, reference_z: number, fov_degrees: number, roll_degrees: number, near_clip: number, far_clip: number, duration: number, fade_code: number): void;
    /**
     * Whether a transition still has time remaining.
     */
    readonly active: boolean;
}

/**
 * Browser-owned scene editing session with bounded undo/redo history.
 */
export class WasmEditorSession {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Adds a validated JSON scene object and returns its index.
     */
    add_object_json(object_json: string): number;
    /**
     * Duplicates the selected object with a finite validated translation.
     */
    duplicate_selected(x: number, y: number, z: number): number;
    /**
     * Opens and validates a bounded scene project.
     */
    constructor(project_json: string);
    /**
     * Serializes the current validated scene project.
     */
    project_json(): string;
    /**
     * Restores the next project state after undo.
     */
    redo(): boolean;
    /**
     * Removes the selected object and returns its JSON representation.
     */
    remove_selected_json(): string;
    /**
     * Selects an object index, or clears selection when omitted.
     */
    select(selected?: number | null): void;
    /**
     * Restores the previous project state.
     */
    undo(): boolean;
    /**
     * Whether a redo state is available.
     */
    readonly can_redo: boolean;
    /**
     * Whether an undo state is available.
     */
    readonly can_undo: boolean;
}

/**
 * Browser-owned bounded FIFO frontier backed by `nie-queue`'s portable core.
 */
export class WasmFrontier {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Creates an empty frontier with explicit non-zero capacities.
     */
    constructor(max_pending: number, max_seen: number, max_batch: number);
    /**
     * Pops the oldest pending address while retaining it in deduplication history.
     */
    pop(): bigint | undefined;
    /**
     * Pushes one address and returns its stable outcome name.
     */
    push(address: bigint): string;
    /**
     * Clears both pending work and persistent deduplication history.
     */
    reset(): void;
    /**
     * Returns a precision-safe JSON snapshot of the pending addresses and counts.
     */
    snapshot_json(): string;
}

/**
 * Machine à états d'écran interactive, rendue en WebAssembly.
 *
 * Écran-titre → menu → match simulé (`nie-runtime` : physique, 22 joueurs, ballon, buts) → mode
 * histoire, pilotée au clavier, rendue dans un framebuffer RGBA8 `W*H*4` que JS peint.
 *
 * ⚠ **Ce n'est pas le jeu.** This binding exposes a local 2D simulation, not the native IEVR
 * renderer. Main-menu pixels are intentionally host-owned while the native `nie-lua` path
 * reconstructs script state. This framebuffer stays transparent on that screen instead of
 * drawing an invented substitute or naming a capture as a runtime asset.
 */
export class WasmGame {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Index of the home player controlled by the browser, or `undefined` outside a match.
     */
    controlled_player(): number | undefined;
    /**
     * Byte length of the latest shared RGBA8 frame.
     */
    frame_len(): number;
    /**
     * Byte offset of the latest shared RGBA8 frame in `WebAssembly.Memory`.
     * The offset is invalidated by the next call to [`WasmGame::render_frame`].
     */
    frame_ptr(): number;
    /**
     * Title of a data-backed screen whose rows the browser may now provide.
     */
    info_title(): string | undefined;
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
     * Supplies real story dialogue resolved by the browser VFS client.
     * `lines_json` must be a JSON array of strings.
     */
    provide_dialogue(event_id: string, lines_json: string): void;
    /**
     * Replaces the current information screen with real, already-resolved VFS rows.
     * `lines_json` must be a JSON array of strings.
     */
    provide_list(lines_json: string): void;
    /**
     * Rend l'écran courant en framebuffer RGBA8 `W*H*4`.
     */
    render(): Uint8Array;
    /**
     * Renders into Rust-owned WebAssembly memory without copying pixels into a JS array.
     * Call [`WasmGame::frame_ptr`] and [`WasmGame::frame_len`] immediately afterwards.
     */
    render_frame(): void;
    /**
     * Score du match en cours `[domicile, extérieur]` (zéros hors match).
     */
    score(): Uint32Array;
    /**
     * Sets the held directional/shoot input consumed by the live `nie-runtime` match world.
     * The call is deliberately harmless outside a match, matching `nie_app::flow::Screen`.
     */
    set_match_input(dx: number, dy: number, shoot: boolean): void;
    /**
     * Serializes the complete portable screen state for browser renderers and diagnostics.
     * Match snapshots contain the live ball, all 22 players, input, clock, score and ownership.
     */
    state_json(): string;
    /**
     * Avance le temps de `dt` s : la physique du match tourne quand un match est en cours.
     */
    update(dt: number): void;
    /**
     * Whether story mode is waiting for dialogue rows fetched by the browser VFS client.
     */
    readonly awaiting_dialogue: boolean;
    /**
     * Hauteur du framebuffer (px).
     */
    readonly height: number;
    /**
     * `true` si un match est en cours (pour l'overlay de score côté UI).
     */
    readonly in_match: boolean;
    /**
     * `true` when the current screen must be drawn from the verified host-side menu source.
     *
     * The Rust framebuffer is transparent in this state so the obsolete vertical placeholder
     * can never be exposed as the native main menu.
     */
    readonly requires_host_surface: boolean;
    /**
     * Largeur du framebuffer (px).
     */
    readonly width: number;
}

/**
 * Browser-owned task lifecycle validated by the portable `nie-tasks` core.
 */
export class WasmTaskPlan {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Marks the task as completed.
     */
    complete(): void;
    /**
     * Confirms that a cancellation request reached a checkpoint.
     */
    confirm_canceled(): void;
    /**
     * Marks the task as failed.
     */
    fail(): void;
    /**
     * Creates a queued task plan with bounded identifiers and labels.
     */
    constructor(id: string, label: string, total: bigint);
    /**
     * Pauses a running task at its next cooperative checkpoint.
     */
    pause(): void;
    /**
     * Records bounded progress.
     */
    report(done: bigint, total: bigint, message?: string | null): void;
    /**
     * Requests cooperative cancellation.
     */
    request_cancel(): void;
    /**
     * Resumes a paused task.
     */
    resume(): void;
    /**
     * Serializes the current phase, progress and available controls.
     */
    snapshot_json(): string;
    /**
     * Marks the queued task as running.
     */
    start(): void;
}

/**
 * Point d'entrée **auto-exécuté à l'instanciation** du module (attribut `start`,
 * best practice wasm-bindgen) : installe le hook de panique sans dépendre d'un
 * appel JS explicite — toute panique reste lisible même si l'hôte oublie l'init.
 */
export function __wasm_start(): void;

/**
 * Scans uploaded bytes with `nie-trace`'s bounded wildcard AOB engine.
 */
export function aob_scan_json(pattern: string, bytes: Uint8Array, max_hits: number): string;

/**
 * Assembles bounded x86-64 source with `nie-asm`'s verified MSVC encoding rules.
 */
export function assemble_x64(source: string, virtual_address: bigint): Uint8Array;

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
 * Inspects PE/ELF bytes with the shared pure-Rust reverse-engineering engine.
 * The string sample is capped at 256 entries to keep the browser result bounded.
 */
export function binary_triage_json(bytes: Uint8Array, strings_limit: number): string;

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
 * Décode un `*_menu_setting.cfg.bin` en structure de menu directement consommable.
 */
export function cfgbin_menu_setting_json(bytes: Uint8Array): string;

/**
 * Parse un fichier cfg.bin (T2B) et retourne son JSON structurel.
 */
export function cfgbin_parse_json(bytes: Uint8Array): string;

/**
 * Décode un `cfg.bin` (octets bruts) en structure de jeu typée selon le nom de fichier.
 */
export function cfgbin_typed_json(bytes: Uint8Array, filename: string): string;

/**
 * Decodes a bounded `chara_model_*.cfg.bin` catalog supplied by the browser.
 */
export function chara_model_catalog_json(bytes: Uint8Array, source: string): string;

/**
 * Decodes a bounded `chara_parts_*.cfg.bin` catalog supplied by the browser.
 */
export function character_parts_catalog_json(bytes: Uint8Array, source: string): string;

/**
 * Extrait et décompresse un fichier d'un CPK.
 */
export function cpk_extract_file(cpk_bytes: Uint8Array, cpk_filename: string, entry_json: string): Uint8Array;

/**
 * Parse un fichier CPK et retourne son TOC (Table of Contents) au format JSON.
 */
export function cpk_parse_entries(cpk_bytes: Uint8Array, cpk_filename: string): string;

/**
 * Produces the bounded deterministic CRC32 sample shared by all benchmark harnesses.
 */
export function crc32_benchmark_sample_json(byte_length: number): string;

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
 * Adds one validated scene object through the editor's shared bounded session core.
 */
export function editor_add_object_json(project_json: string, object_json: string): string;

/**
 * Encode le score final du match : `minutes * 10000 + secondes`.
 *
 * Expose `nie_core::match_fsm::final_score` (case 7 de `FUN_1412aa4a0`).
 */
export function final_score(minutes: number, seconds: number): number;

/**
 * Lifts a bounded x86-64 body to `nie-forge`'s byte-exact assembly dialect.
 */
export function forge_lift_x64_json(bytes: Uint8Array, virtual_address: bigint): string;

/**
 * Validates and canonicalizes a bounded `iecode`/IEVR format catalog in browser memory.
 */
export function format_catalog_validate_json(bytes: Uint8Array): string;

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
 * Returns the detailed bounded format report shared with the `nie-headless` CLI.
 */
export function headless_inspect_json(bytes: Uint8Array): string;

/**
 * Produces a bounded detailed PE report with sections, imports, and named exports.
 */
export function ievr_pe_inspect_json(bytes: Uint8Array): string;

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
 * Searches bounded caller-owned `nie.exe` knowledge without SQLite, Redis, or host access.
 */
export function knowledge_search_json(entries_json: string, query: string, max_results: number): string;

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
 * Portable scene compiler over caller-supplied, observed Lua menu state.
 */
export function menu_runtime_scene_json(state_json: string): string;

/**
 * Composes one static menu layer from raw OBJBIN, G4PKM and G4TX bytes in WebAssembly.
 */
export function menu_static_layer_json(objbin_bytes: Uint8Array, g4pkm_bytes: Uint8Array, g4tx_bytes: Uint8Array, g4tx_path: string): string;

/**
 * Parses uploaded Windows minidump bytes and returns metadata without captured memory.
 */
export function minidump_summary_json(bytes: Uint8Array): string;

/**
 * Assemble une paire G4MD+G4MG (octets bruts) en GLB, in-browser.
 */
export function model_to_glb(g4md: Uint8Array, g4mg: Uint8Array): Uint8Array;

/**
 * Resolves and hashes bounded ranges in a caller-supplied linear `nie.exe` image.
 */
export function offline_image_inspect_json(bytes: Uint8Array, request_json: string): string;

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
 * Inspects a PE `.pdata` table with exact counters and a bounded root sample.
 */
export function pdata_inspect_json(bytes: Uint8Array, max_roots: number): string;

/**
 * Compares an original and rebuilt executable with `nie-pe`'s byte-exact forge metric.
 */
export function pe_byte_diff_json(reference: Uint8Array, rebuilt: Uint8Array, max_ranges: number): string;

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
 * Selects Steam depots from caller-supplied metadata without credentials or host access.
 */
export function steam_select_depots_json(depots_json: string, selection_json: string): string;

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

/**
 * Describes one VFS entry with `nie-explore`'s shared format dispatcher.
 *
 * The JSON result is versioned and always valid, including for unknown input:
 * `{ "schemaVersion": 1, "path": "...", "recognized": true, "lines": [...] }`.
 * Parsing stays entirely in WebAssembly; native filesystem search and the instrumented Lua VM
 * are excluded from this dependency edge.
 */
export function vfs_content_summary(path: string, bytes: Uint8Array): string;

/**
 * Ranks official-encyclopedia candidates with the shared deterministic matcher.
 */
export function zukan_rank_json(entry_json: string, candidates_json: string, max_results: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_wasmcamera_free: (a: number, b: number) => void;
    readonly __wbg_wasmeditorsession_free: (a: number, b: number) => void;
    readonly __wbg_wasmfrontier_free: (a: number, b: number) => void;
    readonly __wbg_wasmgame_free: (a: number, b: number) => void;
    readonly __wbg_wasmtaskplan_free: (a: number, b: number) => void;
    readonly aob_scan_json: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly assemble_x64: (a: number, b: number, c: bigint) => [number, number, number, number];
    readonly audio_to_wav: (a: number, b: number) => [number, number, number, number];
    readonly aura_lookup: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly binary_triage_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly calculate_stats: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly cfgbin_menu_setting_json: (a: number, b: number) => [number, number, number, number];
    readonly cfgbin_parse_json: (a: number, b: number) => [number, number, number, number];
    readonly cfgbin_typed_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly chara_model_catalog_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly character_parts_catalog_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly cpk_extract_file: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly cpk_parse_entries: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly crc32_benchmark_sample_json: (a: number) => [number, number, number, number];
    readonly crilayla_decompress: (a: number, b: number) => [number, number, number, number];
    readonly detect_format: (a: number, b: number) => [number, number];
    readonly editor_add_object_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly final_score: (a: number, b: number) => number;
    readonly forge_lift_x64_json: (a: number, b: number, c: bigint) => [number, number, number, number];
    readonly format_catalog_validate_json: (a: number, b: number) => [number, number, number, number];
    readonly g4md_parse_json: (a: number, b: number) => [number, number, number, number];
    readonly g4mg_extract_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly g4pk_parse_json: (a: number, b: number) => [number, number, number, number];
    readonly g4tx_info_json: (a: number, b: number) => [number, number, number, number];
    readonly g4tx_named_to_png: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly g4tx_sprite_sheet_json: (a: number, b: number) => [number, number, number, number];
    readonly g4tx_to_png: (a: number, b: number) => [number, number, number, number];
    readonly headless_inspect_json: (a: number, b: number) => [number, number, number, number];
    readonly ievr_pe_inspect_json: (a: number, b: number) => [number, number, number, number];
    readonly is_lua_bytecode: (a: number, b: number) => number;
    readonly item_lookup: (a: number, b: number) => [number, number, number, number];
    readonly knowledge_search_json: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly lip_to_json: (a: number, b: number) => [number, number, number, number];
    readonly lua_bytecode_json: (a: number, b: number) => [number, number, number, number];
    readonly match_tick: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly menu_runtime_scene_json: (a: number, b: number) => [number, number, number, number];
    readonly menu_static_layer_json: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number, number];
    readonly minidump_summary_json: (a: number, b: number) => [number, number, number, number];
    readonly model_to_glb: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly offline_image_inspect_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly parse_save_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly pdata_inspect_json: (a: number, b: number, c: number) => [number, number, number, number];
    readonly pe_byte_diff_json: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly rarity_to_growth_rank: (a: number) => number;
    readonly single_stat: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly skill_lookup: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly steam_select_depots_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly utf_table_json: (a: number, b: number) => [number, number, number, number];
    readonly vfs_content_summary: (a: number, b: number, c: number, d: number) => [number, number];
    readonly wasmcamera_active: (a: number) => number;
    readonly wasmcamera_new: () => number;
    readonly wasmcamera_state_json: (a: number, b: number) => [number, number, number, number];
    readonly wasmcamera_step: (a: number, b: number) => void;
    readonly wasmcamera_transition_to: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number];
    readonly wasmeditorsession_add_object_json: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmeditorsession_can_redo: (a: number) => number;
    readonly wasmeditorsession_can_undo: (a: number) => number;
    readonly wasmeditorsession_duplicate_selected: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmeditorsession_new: (a: number, b: number) => [number, number, number];
    readonly wasmeditorsession_project_json: (a: number) => [number, number, number, number];
    readonly wasmeditorsession_redo: (a: number) => number;
    readonly wasmeditorsession_remove_selected_json: (a: number) => [number, number, number, number];
    readonly wasmeditorsession_select: (a: number, b: number) => [number, number];
    readonly wasmeditorsession_undo: (a: number) => number;
    readonly wasmfrontier_new: (a: number, b: number, c: number) => [number, number, number];
    readonly wasmfrontier_pop: (a: number) => [number, bigint];
    readonly wasmfrontier_push: (a: number, b: bigint) => [number, number];
    readonly wasmfrontier_reset: (a: number) => void;
    readonly wasmfrontier_snapshot_json: (a: number) => [number, number];
    readonly wasmgame_awaiting_dialogue: (a: number) => number;
    readonly wasmgame_controlled_player: (a: number) => number;
    readonly wasmgame_frame_len: (a: number) => number;
    readonly wasmgame_frame_ptr: (a: number) => number;
    readonly wasmgame_height: (a: number) => number;
    readonly wasmgame_in_match: (a: number) => number;
    readonly wasmgame_info_title: (a: number) => [number, number];
    readonly wasmgame_input: (a: number, b: number, c: number) => void;
    readonly wasmgame_new: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly wasmgame_provide_dialogue: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly wasmgame_provide_list: (a: number, b: number, c: number) => [number, number];
    readonly wasmgame_render: (a: number) => [number, number];
    readonly wasmgame_render_frame: (a: number) => void;
    readonly wasmgame_requires_host_surface: (a: number) => number;
    readonly wasmgame_score: (a: number) => [number, number];
    readonly wasmgame_set_match_input: (a: number, b: number, c: number, d: number) => void;
    readonly wasmgame_state_json: (a: number) => [number, number, number, number];
    readonly wasmgame_update: (a: number, b: number) => void;
    readonly wasmgame_width: (a: number) => number;
    readonly wasmtaskplan_complete: (a: number) => [number, number];
    readonly wasmtaskplan_confirm_canceled: (a: number) => [number, number];
    readonly wasmtaskplan_fail: (a: number) => [number, number];
    readonly wasmtaskplan_new: (a: number, b: number, c: number, d: number, e: bigint) => [number, number, number];
    readonly wasmtaskplan_pause: (a: number) => [number, number];
    readonly wasmtaskplan_report: (a: number, b: bigint, c: bigint, d: number, e: number) => [number, number];
    readonly wasmtaskplan_request_cancel: (a: number) => [number, number];
    readonly wasmtaskplan_resume: (a: number) => [number, number];
    readonly wasmtaskplan_snapshot_json: (a: number) => [number, number, number, number];
    readonly wasmtaskplan_start: (a: number) => [number, number];
    readonly zukan_rank_json: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly __wasm_start: () => void;
    readonly init_panic_hook: () => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
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
