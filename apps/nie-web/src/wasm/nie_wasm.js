/* @ts-self-types="./nie_wasm.d.ts" */

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
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WasmGameFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_wasmgame_free(ptr, 0);
    }
    /**
     * Hauteur du framebuffer (px).
     * @returns {number}
     */
    get height() {
        const ret = wasm.wasmgame_height(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * `true` si un match est en cours (pour l'overlay de score côté UI).
     * @returns {boolean}
     */
    get in_match() {
        const ret = wasm.wasmgame_in_match(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * Commande de menu IEVR (CMD_FCS_*, CMD_ENTER, CMD_BACK…). Le mapping clavier/souris/manette
     * → commande vit côté front ; la FSM (transitions) vit dans `nie_app::flow` (dédup Phase 5).
     * @param {string} cmd
     */
    input(cmd) {
        const ptr0 = passStringToWasm0(cmd, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        wasm.wasmgame_input(this.__wbg_ptr, ptr0, len0);
    }
    /**
     * Construit le jeu depuis les octets de la police (`font.cfg.bin` + `font.g4tx`, fetchés par JS).
     * Démarre sur l'écran-titre.
     * @param {Uint8Array} font_cfg
     * @param {Uint8Array} font_g4tx
     */
    constructor(font_cfg, font_g4tx) {
        const ptr0 = passArray8ToWasm0(font_cfg, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(font_g4tx, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.wasmgame_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WasmGameFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Rend l'écran courant en framebuffer RGBA8 `W*H*4`.
     * @returns {Uint8Array}
     */
    render() {
        const ret = wasm.wasmgame_render(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * Score du match en cours `[domicile, extérieur]` (zéros hors match).
     * @returns {Uint32Array}
     */
    score() {
        const ret = wasm.wasmgame_score(this.__wbg_ptr);
        var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
    /**
     * Avance le temps de `dt` s : la physique du match tourne quand un match est en cours.
     * @param {number} dt
     */
    update(dt) {
        wasm.wasmgame_update(this.__wbg_ptr, dt);
    }
    /**
     * Largeur du framebuffer (px).
     * @returns {number}
     */
    get width() {
        const ret = wasm.wasmgame_width(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) WasmGame.prototype[Symbol.dispose] = WasmGame.prototype.free;

/**
 * Point d'entrée **auto-exécuté à l'instanciation** du module (attribut `start`,
 * best practice wasm-bindgen) : installe le hook de panique sans dépendre d'un
 * appel JS explicite — toute panique reste lisible même si l'hôte oublie l'init.
 */
export function __wasm_start() {
    wasm.__wasm_start();
}

/**
 * Décode un audio CRI (HCA/ADX/AWB/ACB, octets bruts) en **WAV PCM16**, in-browser.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function audio_to_wav(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.audio_to_wav(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

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
 * @param {string} aura_config_json
 * @param {string} skill_config_json
 * @returns {string}
 */
export function aura_lookup(aura_config_json, skill_config_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(aura_config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(skill_config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.aura_lookup(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

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
 * @param {number} main_position
 * @param {number} sub_position
 * @param {number} growth_pattern
 * @param {number} chara_rank
 * @param {number} play_style
 * @param {number} level
 * @returns {string}
 */
export function calculate_stats(main_position, sub_position, growth_pattern, chara_rank, play_style, level) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.calculate_stats(main_position, sub_position, growth_pattern, chara_rank, play_style, level);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * Parse un fichier cfg.bin (T2B) et retourne son JSON structurel.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function cfgbin_parse_json(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.cfgbin_parse_json(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Décode un `cfg.bin` (octets bruts) en structure de jeu typée selon le nom de fichier.
 * @param {Uint8Array} bytes
 * @param {string} filename
 * @returns {string}
 */
export function cfgbin_typed_json(bytes, filename) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(filename, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.cfgbin_typed_json(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Extrait et décompresse un fichier d'un CPK.
 * @param {Uint8Array} cpk_bytes
 * @param {string} cpk_filename
 * @param {string} entry_json
 * @returns {Uint8Array}
 */
export function cpk_extract_file(cpk_bytes, cpk_filename, entry_json) {
    const ptr0 = passArray8ToWasm0(cpk_bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(cpk_filename, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(entry_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.cpk_extract_file(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v4 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v4;
}

/**
 * Parse un fichier CPK et retourne son TOC (Table of Contents) au format JSON.
 * @param {Uint8Array} cpk_bytes
 * @param {string} cpk_filename
 * @returns {string}
 */
export function cpk_parse_entries(cpk_bytes, cpk_filename) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArray8ToWasm0(cpk_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(cpk_filename, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.cpk_parse_entries(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

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
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function crilayla_decompress(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.crilayla_decompress(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Détecte le format d'un tampon d'octets et retourne son nom court.
 *
 * Retourne l'une des chaînes suivantes :
 * `"CPK"`, `"@UTF"`, `"CRILAYLA"`, `"HCA"`, `"ACB"`, `"AWB"`, `"USM"`,
 * `"cfg.bin"`, `"G4MG"`, `"G4MD"`, `"G4TX"`, `"G4SK"`, `"G4PK"`, `"G4NV"`, `"?"`.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function detect_format(bytes) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.detect_format(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * Encode le score final du match : `minutes * 10000 + secondes`.
 *
 * Expose `nie_core::match_fsm::final_score` (case 7 de `FUN_1412aa4a0`).
 * @param {number} minutes
 * @param {number} seconds
 * @returns {number}
 */
export function final_score(minutes, seconds) {
    const ret = wasm.final_score(minutes, seconds);
    return ret >>> 0;
}

/**
 * Parse un fichier G4MD et retourne son JSON descriptif.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function g4md_parse_json(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.g4md_parse_json(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Extrait la géométrie d'un fichier G4MG à l'aide des métadonnées G4MD fournies au format JSON.
 * @param {Uint8Array} g4mg_bytes
 * @param {string} g4md_json
 * @returns {string}
 */
export function g4mg_extract_json(g4mg_bytes, g4md_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArray8ToWasm0(g4mg_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(g4md_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.g4mg_extract_json(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Parse une archive `.g4pk` (en-tête + sous-fichiers) en JSON, in-browser.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function g4pk_parse_json(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.g4pk_parse_json(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Métadonnées d'un `.g4tx` (textures : nom, dimensions, DDS) en JSON, in-browser.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function g4tx_info_json(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.g4tx_info_json(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Décode la texture nommée `nom` d'un `.g4tx` en PNG, in-browser.
 * @param {Uint8Array} bytes
 * @param {string} nom
 * @returns {Uint8Array}
 */
export function g4tx_named_to_png(bytes, nom) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(nom, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.g4tx_named_to_png(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * Feuille de sprites d'un atlas `.g4tx` : régions nommées avec leur rectangle, en JSON.
 *
 * `g4tx_info_json` rend la structure brute du conteneur ; celle-ci rend ce qu'une interface
 * attend — un manifeste `{nom, largeur, hauteur, sprites[{nom, classe, x, y, largeur, hauteur}]}`
 * directement consommable pour positionner une icône, avec ou sans CSS.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function g4tx_sprite_sheet_json(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.g4tx_sprite_sheet_json(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Décode un `.g4tx` (octets bruts) en PNG (octets), in-browser.
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function g4tx_to_png(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.g4tx_to_png(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Installe le hook de panique `console_error_panic_hook`.
 *
 * Appeler cette fonction UNE FOIS au démarrage (après `await init()`) pour que
 * toute panique Rust apparaisse dans la console du navigateur avec un message
 * lisible au lieu d'une erreur Wasm opaque. Conservée pour compat ; le hook est
 * désormais aussi installé automatiquement par [`__wasm_start`] (best practice).
 */
export function init_panic_hook() {
    wasm.init_panic_hook();
}

/**
 * Vrai si les octets commencent par la signature d'un bytecode Lua 5.2.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function is_lua_bytecode(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.is_lua_bytecode(ptr0, len0);
    return ret !== 0;
}

/**
 * Parse un `item_config.cfg.bin.json` et retourne les objets (catégorie + stats).
 *
 * - `item_config_json` : contenu du dump `item_config_*.cfg.bin.json`.
 *
 * Retourne un JSON `{ "count": N, "items": [ { itemId, category, nameId, price,
 * stats, internalCode, … }, … ] }`, ou lève une `Error` JS si le JSON est invalide.
 * @param {string} item_config_json
 * @returns {string}
 */
export function item_lookup(item_config_json) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(item_config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.item_lookup(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Décode une piste de lip-sync `.p3lip` (visèmes datés) en JSON, in-browser.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function lip_to_json(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lip_to_json(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Décode un `.lua.bin` du jeu (bytecode Lua 5.2) en résumé JSON.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function lua_bytecode_json(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.lua_bytecode_json(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

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
 * @param {string} state
 * @param {boolean} is_training
 * @param {number} end_counter
 * @returns {string}
 */
export function match_tick(state, is_training, end_counter) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(state, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.match_tick(ptr0, len0, is_training, end_counter);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * Assemble une paire G4MD+G4MG (octets bruts) en GLB, in-browser.
 * @param {Uint8Array} g4md
 * @param {Uint8Array} g4mg
 * @returns {Uint8Array}
 */
export function model_to_glb(g4md, g4mg) {
    const ptr0 = passArray8ToWasm0(g4md, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(g4mg, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.model_to_glb(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

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
 * @param {Uint8Array} bytes
 * @param {string} filename
 * @returns {string}
 */
export function parse_save_json(bytes, filename) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(filename, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.parse_save_json(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Convertit un code de rareté brut en rang de table de croissance.
 *
 * Expose `nie_core::stats::rarity_to_growth_rank` (0→0, 2→2, …, 5/6/7/20→5).
 * @param {number} rarity_code
 * @returns {number}
 */
export function rarity_to_growth_rank(rarity_code) {
    const ret = wasm.rarity_to_growth_rank(rarity_code);
    return ret;
}

/**
 * Calcule une statistique unique par interpolation 3-segments (lv1/30/50/99).
 *
 * Expose directement `nie_core::stats::calculate_single_stat`. Les niveaux hors
 * plage sont clampés (lv≤1 → `stat_lv1`, lv≥99 → `stat_lv99`).
 * @param {number} level
 * @param {number} stat_lv1
 * @param {number} stat_lv30
 * @param {number} stat_lv50
 * @param {number} stat_lv99
 * @returns {number}
 */
export function single_stat(level, stat_lv1, stat_lv30, stat_lv50, stat_lv99) {
    const ret = wasm.single_stat(level, stat_lv1, stat_lv30, stat_lv50, stat_lv99);
    return ret;
}

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
 * @param {string} skill_config_json
 * @param {string} skill_text_json
 * @returns {string}
 */
export function skill_lookup(skill_config_json, skill_text_json) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(skill_config_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(skill_text_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.skill_lookup(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

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
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function utf_table_json(bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.utf_table_json(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_throw_ea4887a5f8f9a9db: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_error_a6fa202b58aa1cd3: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_free(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return ret;
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = arg1.stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./nie_wasm_bg.js": import0,
    };
}

const WasmGameFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_wasmgame_free(ptr, 1));

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        throw new Error("nie-wasm: module_or_path requis");
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
