//! Bindings WebAssembly pour `nie-formats`.
//!
//! Expose au navigateur les parsers portables de `nie-formats` via `wasm-bindgen`.
//! Compatible avec la toolchain `nightly-x86_64-unknown-linux-gnu` (seule à avoir
//! la std `wasm32-unknown-unknown` sur ce VPS).
//!
//! ## Génération des bindings JS
//!
//! La compilation vers wasm32 seule ne suffit pas à produire les glues JS.
//! Deux outils sont nécessaires (à installer une fois) :
//!
//! ```sh
//! # Option A — wasm-bindgen-cli (version EXACTEMENT =0.2.121)
//! cargo install wasm-bindgen-cli --version 0.2.121
//! cargo build -p nie-wasm --target wasm32-unknown-unknown --release
//! wasm-bindgen target/wasm32-unknown-unknown/release/nie_wasm.wasm \
//!     --out-dir pkg/ --target bundler
//!
//! # Option B — wasm-pack (wraps les deux étapes ci-dessus)
//! cargo install wasm-pack
//! wasm-pack build crates/nie-wasm --target bundler
//! ```
//!
//! ## Surface exposée
//!
//! En plus des parsers de formats (`nie-formats`), ce crate expose au navigateur le
//! savoir VÉRIFIÉ déjà porté dans les autres crates niers :
//!
//! - **`nie-core`** — calcul de statistiques (courbe de croissance lv1→99, ancrée sur
//!   `inagle/stat-calculator.ts`) et machine à états du match (FSM 11 états + score).
//! - **`nie-data`** — lookup skill (résolution hissatsu name/element/power), aura
//!   (sous-type + résolution du hissatsu lié) et item (catégorie + stats d'équipement),
//!   parsés depuis les dumps `*.cfg.bin.json` d'IEVR.
//!
//! Toutes les fonctions retournant une structure le font en **JSON sérialisé** (`String`),
//! que le JS désérialise via `JSON.parse`.
//!
//! ## Pattern d'import JS (ESM bundler)
//!
//! ```text
//! import init, {
//!   init_panic_hook, detect_format, crilayla_decompress, utf_table_json,
//!   calculate_stats, single_stat, rarity_to_growth_rank,
//!   match_tick, final_score,
//!   skill_lookup, aura_lookup, item_lookup,
//! } from "./pkg/nie_wasm.js";
//!
//! await init(); // charge le .wasm
//! init_panic_hook(); // redirige les panics Rust vers console.error
//!
//! const bytes = new Uint8Array(await file.arrayBuffer());
//! const format = detect_format(bytes);          // "CPK" | "CRILAYLA" | "@UTF" | …
//!
//! if (format === "CRILAYLA") {
//!   const decompressed = crilayla_decompress(bytes); // Uint8Array | throws Error
//! }
//! if (format === "@UTF") {
//!   const json = utf_table_json(bytes);              // string JSON | throws Error
//!   const table = JSON.parse(json);
//! }
//!
//! // Stats : FW rang UR (mainPosition 4, rank 5) au niveau 99.
//! const stats = JSON.parse(calculate_stats(4, 0, 0, 5, 0, 99));
//! console.log(stats.stats); // { kc, cr, tc, pr, ps, ag, it }
//!
//! // Match : transition de la FSM + score final.
//! const t = JSON.parse(match_tick("WaitTimer", false, 0)); // { next, immediate }
//! const score = final_score(2, 30); // 20030
//!
//! // Lookup data depuis un dump cfg.bin.json (string).
//! const skills = JSON.parse(skill_lookup(skillConfigJson, skillTextJson));
//! ```
//!
//! ## Sécurité
//!
//! `#![forbid(unsafe_code)]` est actif. `wasm-bindgen` génère du code unsafe dans
//! ses macros, mais ce code ne figure pas dans ce crate source — il est émis par le
//! compilateur à partir des attributs `#[wasm_bindgen]`, hors du scope de `forbid`.

#![forbid(unsafe_code)]

use nie_formats::{FileFormat, cfgbin, cpk, crilayla, detect};

// wasm-bindgen n'est importé qu'en cible wasm32.
// En cible native (rlib), le crate compile sans wasm-bindgen-sys → pas de linker wasm requis.
#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::*;

// ---------------------------------------------------------------------------
// Initialiseur de hook de panique
// ---------------------------------------------------------------------------

/// Installe le hook de panique `console_error_panic_hook`.
///
/// Appeler cette fonction UNE FOIS au démarrage (après `await init()`) pour que
/// toute panique Rust apparaisse dans la console du navigateur avec un message
/// lisible au lieu d'une erreur Wasm opaque.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn init_panic_hook() {
    #[cfg(target_arch = "wasm32")]
    console_error_panic_hook::set_once();
}

// ---------------------------------------------------------------------------
// detect_format
// ---------------------------------------------------------------------------

/// Détecte le format d'un tampon d'octets et retourne son nom court.
///
/// Retourne l'une des chaînes suivantes :
/// `"CPK"`, `"@UTF"`, `"CRILAYLA"`, `"HCA"`, `"ACB"`, `"AWB"`, `"USM"`,
/// `"cfg.bin"`, `"G4MG"`, `"G4MD"`, `"G4TX"`, `"G4SK"`, `"G4PK"`, `"G4NV"`, `"?"`.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn detect_format(bytes: &[u8]) -> String {
    // Étend la détection avec RDBN (cfg.bin) non encore couvert par nie_formats::detect.
    let fmt = detect(bytes);
    if fmt == FileFormat::Unknown && cfgbin::is_rdbn(bytes) {
        return FileFormat::CfgBin.name().to_owned();
    }
    fmt.name().to_owned()
}

// ---------------------------------------------------------------------------
// crilayla_decompress
// ---------------------------------------------------------------------------

/// Décompresse un tampon CRILAYLA.
///
/// Retourne les octets décompressés, ou lève une `Error` JS si le format est invalide.
///
/// En JS :
/// ```text
/// try {
///   const raw = crilayla_decompress(bytes); // Uint8Array
/// } catch (e) {
///   console.error("Décompression échouée :", e);
/// }
/// ```
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn crilayla_decompress(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    crilayla::decompress(bytes)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Décompresse un tampon CRILAYLA (version native, sans JsValue).
///
/// En natif, retourne `Err(String)` au lieu de `Err(JsValue)`.
/// Utiliser [`crilayla_decompress`] en cible wasm32.
#[cfg(not(target_arch = "wasm32"))]
pub fn crilayla_decompress(bytes: &[u8]) -> Result<Vec<u8>, String> {
    crilayla::decompress(bytes).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// utf_table_json
// ---------------------------------------------------------------------------

/// Parse une table `@UTF` et retourne son contenu sérialisé en JSON.
///
/// Le JSON a la structure suivante :
///
/// ```text
/// {
///   "nom": "NomDeLaTable",
///   "colonnes": [{ "nom": "ColA", "type": "U32" }, ...],
///   "lignes": [[42, "hello"], ...]
/// }
/// ```
///
/// En JS :
/// ```text
/// const json = utf_table_json(bytes);
/// const table = JSON.parse(json);
/// console.log(table.nom, table.lignes.length);
/// ```
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn utf_table_json(bytes: &[u8]) -> Result<String, JsValue> {
    serialiser_utf(bytes).map_err(|e| JsValue::from_str(&e))
}

/// Sérialise une table @UTF en JSON (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn utf_table_json(bytes: &[u8]) -> Result<String, String> {
    serialiser_utf(bytes)
}

// ---------------------------------------------------------------------------
// Logique partagée wasm32 / natif
// ---------------------------------------------------------------------------

/// Sérialise une table @UTF en JSON (logique commune aux deux targets).
fn serialiser_utf(bytes: &[u8]) -> Result<String, String> {
    let table = cpk::parse_utf(bytes).map_err(|e| e.to_string())?;

    let colonnes: Vec<serde_json::Value> = table
        .columns
        .iter()
        .map(|c| {
            serde_json::json!({
                "nom":  c.name,
                "type": format!("{:?}", c.col_type),
            })
        })
        .collect();

    let lignes: Vec<Vec<serde_json::Value>> = table
        .rows
        .iter()
        .map(|row| row.iter().map(utf_value_to_json).collect())
        .collect();

    let obj = serde_json::json!({
        "nom":     table.name,
        "colonnes": colonnes,
        "lignes":  lignes,
    });

    serde_json::to_string(&obj).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Helper : UtfValue → serde_json::Value
// ---------------------------------------------------------------------------

fn utf_value_to_json(v: &cpk::UtfValue) -> serde_json::Value {
    use cpk::UtfValue;
    match v {
        UtfValue::U8(x) => serde_json::json!(x),
        UtfValue::I8(x) => serde_json::json!(x),
        UtfValue::U16(x) => serde_json::json!(x),
        UtfValue::I16(x) => serde_json::json!(x),
        UtfValue::U32(x) => serde_json::json!(x),
        UtfValue::I32(x) => serde_json::json!(x),
        UtfValue::U64(x) => serde_json::json!(x),
        UtfValue::I64(x) => serde_json::json!(x),
        UtfValue::F32(x) => serde_json::json!(x),
        UtfValue::F64(x) => serde_json::json!(x),
        UtfValue::String(s) => serde_json::json!(s),
        UtfValue::Bytes(b) => {
            // Les blobs sont encodés en tableau d'entiers pour rester JSON-pur.
            serde_json::json!(b)
        },
    }
}

// ===========================================================================
// nie-core — calcul de statistiques (growth)
// ===========================================================================

/// Calcule le bloc de 7 statistiques d'un personnage à un niveau donné.
///
/// Combine les tables de croissance réelles IEVR embarquées (`nie-core`,
/// ancrées sur `inagle/stat-calculator.ts`) avec la résolution par fallback en
/// cascade (lv1/lv30/main) puis l'interpolation 3-segments.
///
/// Paramètres :
/// - `main_position` : 1=GK, 2=DF, 3=MF, 4=FW.
/// - `sub_position` : sous-position (0 = aucune).
/// - `growth_pattern` : pattern de croissance (0, 1, 2+).
/// - `chara_rank` : code de rareté brut (0=N, 2=R, 3=SR, 4=SSR, 5=UR, 6=LR, 7=Legend, 20=BASARA).
/// - `play_style` : style de jeu (0 par défaut).
/// - `level` : niveau 1..=99.
///
/// Retourne un JSON :
/// ```text
/// {
///   "stats": { "kc": 207, "cr": 216, "tc": 218, "pr": 235, "ps": 242, "ag": 210, "it": 261 },
///   "total": 1589
/// }
/// ```
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn calculate_stats(
    main_position: u8,
    sub_position: u8,
    growth_pattern: u8,
    chara_rank: u8,
    play_style: u8,
    level: u8,
) -> String {
    use nie_core::growth::{calculate_stats as core_calc, GrowthParams, GrowthTables};

    let tables = GrowthTables::load_embedded();
    let params = GrowthParams {
        main_position,
        sub_position,
        growth_pattern,
        chara_rank,
        play_style,
    };
    let block = core_calc(&tables, &params, level);
    serde_json::json!({
        "stats": block,
        "total": block.total(),
    })
    .to_string()
}

/// Calcule une statistique unique par interpolation 3-segments (lv1/30/50/99).
///
/// Expose directement `nie_core::stats::calculate_single_stat`. Les niveaux hors
/// plage sont clampés (lv≤1 → `stat_lv1`, lv≥99 → `stat_lv99`).
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn single_stat(
    level: u8,
    stat_lv1: u16,
    stat_lv30: u16,
    stat_lv50: u16,
    stat_lv99: u16,
) -> u16 {
    nie_core::stats::calculate_single_stat(level, stat_lv1, stat_lv30, stat_lv50, stat_lv99)
}

/// Convertit un code de rareté brut en rang de table de croissance.
///
/// Expose `nie_core::stats::rarity_to_growth_rank` (0→0, 2→2, …, 5/6/7/20→5).
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn rarity_to_growth_rank(rarity_code: u8) -> u8 {
    nie_core::stats::rarity_to_growth_rank(rarity_code)
}

// ===========================================================================
// nie-core — machine à états du match (FSM)
// ===========================================================================

/// Convertit un nom d'état (insensible à la casse) vers le `MatchState` typé.
///
/// Accepte les libellés canoniques (`"Init"`, `"WaitTimer"`, `"ResultUi"`,
/// `"CheckTelop"`, `"WaitAnim"`, `"Transition"`, `"Fade"`, `"Cleanup"`,
/// `"PostMatch"`, `"FadeOut"`, `"LoadNext"`) et les index numériques `"0".."10"`.
fn parse_match_state(state: &str) -> Option<nie_core::match_fsm::MatchState> {
    use nie_core::match_fsm::MatchState as S;
    // Index numérique direct (0-10) — réutilise le TryFrom<u8> porté.
    if let Ok(n) = state.trim().parse::<u8>() {
        return S::try_from(n).ok();
    }
    let key = state.trim().to_ascii_lowercase();
    Some(match key.as_str() {
        "init" => S::Init,
        "waittimer" => S::WaitTimer,
        "resultui" => S::ResultUi,
        "checktelop" => S::CheckTelop,
        "waitanim" => S::WaitAnim,
        "transition" => S::Transition,
        "fade" => S::Fade,
        "cleanup" => S::Cleanup,
        "postmatch" => S::PostMatch,
        "fadeout" => S::FadeOut,
        "loadnext" => S::LoadNext,
        _ => return None,
    })
}

/// Logique commune `match_tick` (wasm32 / natif) : résout l'état suivant de la FSM.
fn match_tick_impl(state: &str, is_training: bool, end_counter: i32) -> Result<String, String> {
    use nie_core::match_fsm::{tick, MatchContext};

    let s = parse_match_state(state)
        .ok_or_else(|| alloc_format_unknown_state(state))?;
    let ctx = MatchContext { is_training, end_counter };
    let t = tick(s, ctx);
    serde_json::json!({
        "next": t.next,
        "immediate": t.immediate,
    })
    .to_string()
    .pipe_ok()
}

/// Message d'erreur pour un état de match inconnu.
fn alloc_format_unknown_state(state: &str) -> String {
    format!("état de match inconnu : {state:?}")
}

/// Avance la machine à états du match d'un tick (transition nominale).
///
/// Porte la FSM 11 états de `CSceneSoccer` (`nie-core::match_fsm::tick`).
/// - `state` : nom de l'état courant (`"Init"`, `"WaitTimer"`, … ou index `"0".."10"`).
/// - `is_training` : flag entraînement (`false` = match normal).
/// - `end_counter` : compteur de fin (case 5 : 0/1 = restart, 2 = complétion).
///
/// Retourne un JSON `{ "next": "WaitTimer", "immediate": false }`, ou lève une
/// `Error` JS si l'état est inconnu.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn match_tick(state: &str, is_training: bool, end_counter: i32) -> Result<String, JsValue> {
    match_tick_impl(state, is_training, end_counter).map_err(|e| JsValue::from_str(&e))
}

/// Avance la FSM du match d'un tick (version native, sans `JsValue`).
#[cfg(not(target_arch = "wasm32"))]
pub fn match_tick(state: &str, is_training: bool, end_counter: i32) -> Result<String, String> {
    match_tick_impl(state, is_training, end_counter)
}

/// Encode le score final du match : `minutes * 10000 + secondes`.
///
/// Expose `nie_core::match_fsm::final_score` (case 7 de `FUN_1412aa4a0`).
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn final_score(minutes: u16, seconds: u16) -> u32 {
    nie_core::match_fsm::final_score(minutes, seconds)
}

// ===========================================================================
// nie-data — lookup skill / aura / item (résolution hissatsu)
// ===========================================================================

/// Logique commune `skill_lookup` : parse `skill_config` (+ `skill_text` optionnel)
/// et émet la liste des techniques avec nom/élément/catégorie/puissance résolus.
fn skill_lookup_impl(skill_config_json: &str, skill_text_json: &str) -> Result<String, String> {
    use nie_data::skill::{join_skill_text, parse_skill_config, parse_skill_text, SkillTextMaps};

    let config_root: serde_json::Value =
        serde_json::from_str(skill_config_json).map_err(|e| e.to_string())?;
    let skills = parse_skill_config(&config_root);

    // skill_text est optionnel : chaîne vide → pas de jointure nom/description.
    let maps = if skill_text_json.trim().is_empty() {
        SkillTextMaps::default()
    } else {
        let text_root: serde_json::Value =
            serde_json::from_str(skill_text_json).map_err(|e| e.to_string())?;
        parse_skill_text(&text_root)
    };

    let out: Vec<serde_json::Value> = skills
        .iter()
        .map(|s| {
            let text = join_skill_text(s, &maps);
            serde_json::json!({
                "skillId": s.skill_id.to_hex(),
                "skillIdStr": s.skill_id_str,
                "name": text.name,
                "description": text.description,
                "element": s.element(),
                "category": s.category(),
                "partnerType": s.partner_type(),
                "powerMin": s.power_min,
                "powerMax": s.power_max,
                "consumeTp": s.consume_tp,
                "recastTime": s.recast_time,
            })
        })
        .collect();

    serde_json::json!({ "count": out.len(), "skills": out })
        .to_string()
        .pipe_ok()
}

/// Parse un `skill_config.cfg.bin.json` (et un `skill_text.cfg.bin.json` optionnel)
/// et retourne les techniques résolues (nom/élément/catégorie/puissance).
///
/// - `skill_config_json` : contenu JSON du dump `skill_config_*.cfg.bin.json`.
/// - `skill_text_json` : contenu JSON du `skill_text_*.cfg.bin.json` (chaîne vide
///   pour ignorer la jointure nom/description).
///
/// Retourne un JSON `{ "count": N, "skills": [ { skillId, skillIdStr, name, element,
/// category, powerMin, powerMax, … }, … ] }`, ou lève une `Error` JS si le JSON est invalide.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn skill_lookup(skill_config_json: &str, skill_text_json: &str) -> Result<String, JsValue> {
    skill_lookup_impl(skill_config_json, skill_text_json).map_err(|e| JsValue::from_str(&e))
}

/// Parse `skill_config` (+ `skill_text` optionnel) (version native, sans `JsValue`).
#[cfg(not(target_arch = "wasm32"))]
pub fn skill_lookup(skill_config_json: &str, skill_text_json: &str) -> Result<String, String> {
    skill_lookup_impl(skill_config_json, skill_text_json)
}

/// Logique commune `aura_lookup` : parse `aura_skill_config` (+ `skill_config`
/// optionnel pour la résolution du hissatsu lié) et émet les auras.
fn aura_lookup_impl(aura_config_json: &str, skill_config_json: &str) -> Result<String, String> {
    use nie_data::aura::{build_skill_map, parse_all_aura_cmds, resolve_aura_hissatsu};
    use nie_data::skill::parse_skill_config;

    let aura_root: serde_json::Value =
        serde_json::from_str(aura_config_json).map_err(|e| e.to_string())?;
    let auras = parse_all_aura_cmds(&aura_root);

    // skill_config optionnel : permet la résolution native config.skillId1 → SkillInfo.
    let skill_map = if skill_config_json.trim().is_empty() {
        Default::default()
    } else {
        let skill_root: serde_json::Value =
            serde_json::from_str(skill_config_json).map_err(|e| e.to_string())?;
        build_skill_map(parse_skill_config(&skill_root))
    };

    let out: Vec<serde_json::Value> = auras
        .iter()
        .map(|a| {
            let hissatsu = resolve_aura_hissatsu(&a.config, &skill_map);
            serde_json::json!({
                "auraId": a.aura_id.to_hex(),
                "assetCode": a.asset_code,
                "subType": a.sub_type,
                "subTypeLabel": a.sub_type.label_fr(),
                "element": a.element(),
                "config": a.config,
                "hissatsu": hissatsu,
            })
        })
        .collect();

    serde_json::json!({ "count": out.len(), "auras": out })
        .to_string()
        .pipe_ok()
}

/// Parse un `aura_skill_config.cfg.bin.json` (et un `skill_config.cfg.bin.json`
/// optionnel pour résoudre le hissatsu lié) et retourne les auras.
///
/// - `aura_config_json` : contenu du dump `aura_skill_config_*.cfg.bin.json`.
/// - `skill_config_json` : contenu du `skill_config_*.cfg.bin.json` (chaîne vide
///   pour ignorer la résolution `config.skillId1 → SkillInfo`).
///
/// Retourne un JSON `{ "count": N, "auras": [ { auraId, assetCode, subType, element,
/// config, hissatsu }, … ] }`, ou lève une `Error` JS si le JSON est invalide.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn aura_lookup(aura_config_json: &str, skill_config_json: &str) -> Result<String, JsValue> {
    aura_lookup_impl(aura_config_json, skill_config_json).map_err(|e| JsValue::from_str(&e))
}

/// Parse `aura_skill_config` (+ `skill_config` optionnel) (version native, sans `JsValue`).
#[cfg(not(target_arch = "wasm32"))]
pub fn aura_lookup(aura_config_json: &str, skill_config_json: &str) -> Result<String, String> {
    aura_lookup_impl(aura_config_json, skill_config_json)
}

/// Logique commune `item_lookup` : parse `item_config` et émet les objets.
fn item_lookup_impl(item_config_json: &str) -> Result<String, String> {
    use nie_data::item::parse_all_items;

    let root: serde_json::Value =
        serde_json::from_str(item_config_json).map_err(|e| e.to_string())?;
    let items = parse_all_items(&root);

    let out: Vec<serde_json::Value> = items
        .iter()
        .map(|it| {
            serde_json::json!({
                "itemId": it.item_id.to_hex(),
                "category": it.category.as_str(),
                "nameId": it.name_id.to_hex(),
                "descId": it.desc_id.to_hex(),
                "price": it.price,
                "stats": it.stats,
                "internalCode": it.internal_code,
                "uniformId": it.uniform_id.map(|h| h.to_hex()),
            })
        })
        .collect();

    serde_json::json!({ "count": out.len(), "items": out })
        .to_string()
        .pipe_ok()
}

/// Parse un `item_config.cfg.bin.json` et retourne les objets (catégorie + stats).
///
/// - `item_config_json` : contenu du dump `item_config_*.cfg.bin.json`.
///
/// Retourne un JSON `{ "count": N, "items": [ { itemId, category, nameId, price,
/// stats, internalCode, … }, … ] }`, ou lève une `Error` JS si le JSON est invalide.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn item_lookup(item_config_json: &str) -> Result<String, JsValue> {
    item_lookup_impl(item_config_json).map_err(|e| JsValue::from_str(&e))
}

/// Parse `item_config` (version native, sans `JsValue`).
#[cfg(not(target_arch = "wasm32"))]
pub fn item_lookup(item_config_json: &str) -> Result<String, String> {
    item_lookup_impl(item_config_json)
}

// ---------------------------------------------------------------------------
// Petit utilitaire : `String` → `Result<String, String>` (lisibilité).
// ---------------------------------------------------------------------------

/// Trait d'extension minimal pour envelopper une valeur en `Ok(_)` de façon fluide.
trait PipeOk: Sized {
    fn pipe_ok<E>(self) -> Result<Self, E>;
}

impl PipeOk for String {
    fn pipe_ok<E>(self) -> Result<Self, E> {
        Ok(self)
    }
}

// ---------------------------------------------------------------------------
// Tests natifs
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_format_utf() {
        let magic = &[0x40u8, 0x55, 0x54, 0x46, 0x00, 0x00, 0x00, 0x08];
        assert_eq!(detect_format(magic), "@UTF");
    }

    #[test]
    fn detect_format_cpk() {
        assert_eq!(detect_format(b"CPK \x00\x00\x00\x00"), "CPK");
    }

    #[test]
    fn detect_format_crilayla() {
        assert_eq!(detect_format(b"CRILAYLA\x00\x00\x00\x00\x00\x00\x00\x00"), "CRILAYLA");
    }

    #[test]
    fn detect_format_rdbn() {
        let mut buf = vec![0u8; 0x50];
        buf[0..4].copy_from_slice(b"RDBN");
        buf[6..10].copy_from_slice(&100i32.to_le_bytes());
        buf[10..12].copy_from_slice(&0x14i16.to_le_bytes());
        assert_eq!(detect_format(&buf), "cfg.bin");
    }

    #[test]
    fn detect_format_inconnu() {
        assert_eq!(detect_format(b"GARBAGE"), "?");
    }

    #[test]
    fn init_panic_hook_ne_panique_pas() {
        // En natif, le hook est une no-op wasm ; la fonction ne doit pas paniquer.
        init_panic_hook();
    }

    #[test]
    fn crilayla_decompress_trop_court() {
        let result = crilayla_decompress(b"CRILAYLA\x00\x00");
        assert!(result.is_err());
    }

    #[test]
    fn utf_table_json_mauvais_magic() {
        let result = utf_table_json(b"NOTUTF\x00\x00\x00\x00");
        assert!(result.is_err());
    }

    #[test]
    fn utf_table_json_fixture() {
        // @UTF minimal 2 colonnes / 2 lignes.
        let string_pool: &[u8] = b"TestTable\0ColA\0ColB\0hello\0world\0";
        let schema: &[u8] = &[
            0x24, 0x00, 0x00, 0x00, 0x0A,
            0x2A, 0x00, 0x00, 0x00, 0x0F,
        ];
        let row_data: &[u8] = &[
            0x00, 0x00, 0x00, 42,
            0x00, 0x00, 0x00, 20,
            0x00, 0x00, 0x00, 99,
            0x00, 0x00, 0x00, 26,
        ];
        let mut body = Vec::new();
        body.extend_from_slice(&0x22u32.to_be_bytes());
        body.extend_from_slice(&0x32u32.to_be_bytes());
        body.extend_from_slice(&0x52u32.to_be_bytes());
        body.extend_from_slice(&0u32.to_be_bytes());
        body.extend_from_slice(&2u16.to_be_bytes());
        body.extend_from_slice(&8u16.to_be_bytes());
        body.extend_from_slice(&2u32.to_be_bytes());
        body.extend_from_slice(schema);
        body.extend_from_slice(row_data);
        body.extend_from_slice(string_pool);
        let mut data = Vec::new();
        data.extend_from_slice(&[0x40, 0x55, 0x54, 0x46]);
        data.extend_from_slice(&(body.len() as u32).to_be_bytes());
        data.extend_from_slice(&body);

        let json_str = utf_table_json(&data).expect("parse @UTF");
        let json: serde_json::Value = serde_json::from_str(&json_str).expect("JSON valide");
        assert_eq!(json["nom"], "TestTable");
        assert_eq!(json["colonnes"].as_array().unwrap().len(), 2);
        assert_eq!(json["lignes"].as_array().unwrap().len(), 2);
    }

    // -----------------------------------------------------------------------
    // nie-core — stats (growth)
    // -----------------------------------------------------------------------

    /// Golden : FW rang UR (mainPosition 4, rank 5) au niveau 99.
    /// Ancré sur `nie_core::growth` test `golden_fw_ur` (sorties RÉELLES d'inagle).
    #[test]
    fn calculate_stats_fw_ur_lv99() {
        let json: serde_json::Value =
            serde_json::from_str(&calculate_stats(4, 0, 0, 5, 0, 99)).expect("JSON valide");
        let s = &json["stats"];
        assert_eq!(s["kc"], 207);
        assert_eq!(s["cr"], 216);
        assert_eq!(s["tc"], 218);
        assert_eq!(s["pr"], 235);
        assert_eq!(s["ps"], 242);
        assert_eq!(s["ag"], 210);
        assert_eq!(s["it"], 261);
        // total = somme des 7 stats.
        assert_eq!(json["total"], 207 + 216 + 218 + 235 + 242 + 210 + 261);
    }

    /// Golden : GK rang N au niveau 1 (= valeurs de base lv1).
    #[test]
    fn calculate_stats_gk_n_lv1() {
        let json: serde_json::Value =
            serde_json::from_str(&calculate_stats(1, 0, 0, 0, 0, 1)).expect("JSON valide");
        let s = &json["stats"];
        // golden_gk_n lv1 = [12, 13, 12, 10, 11, 9, 11].
        assert_eq!(s["kc"], 12);
        assert_eq!(s["it"], 11);
    }

    /// Position inexistante → stats 0 (parité TS, pas d'invention).
    #[test]
    fn calculate_stats_position_inconnue_zero() {
        let json: serde_json::Value =
            serde_json::from_str(&calculate_stats(9, 0, 0, 0, 0, 50)).expect("JSON valide");
        assert_eq!(json["total"], 0);
    }

    #[test]
    fn single_stat_bornes() {
        // lv≤1 → stat_lv1 ; lv≥99 → stat_lv99 ; lv30 exact → stat_lv30.
        assert_eq!(single_stat(1, 10, 30, 50, 80), 10);
        assert_eq!(single_stat(99, 10, 30, 50, 80), 80);
        assert_eq!(single_stat(30, 10, 30, 50, 80), 30);
    }

    #[test]
    fn rarity_rank_mapping() {
        assert_eq!(rarity_to_growth_rank(0), 0);
        assert_eq!(rarity_to_growth_rank(5), 5);
        assert_eq!(rarity_to_growth_rank(20), 5); // BASARA → UR.
    }

    // -----------------------------------------------------------------------
    // nie-core — FSM de match
    // -----------------------------------------------------------------------

    #[test]
    fn match_tick_normal_waittimer_to_transition() {
        // Match normal : WaitTimer → Transition (état 5).
        let json: serde_json::Value =
            serde_json::from_str(&match_tick("WaitTimer", false, 0).expect("ok"))
                .expect("JSON valide");
        assert_eq!(json["next"], "Transition");
        assert_eq!(json["immediate"], false);
    }

    #[test]
    fn match_tick_training_waittimer_to_resultui() {
        // Entraînement : WaitTimer → ResultUi (état 2).
        let json: serde_json::Value =
            serde_json::from_str(&match_tick("WaitTimer", true, 0).expect("ok"))
                .expect("JSON valide");
        assert_eq!(json["next"], "ResultUi");
    }

    #[test]
    fn match_tick_training_completion_immediate() {
        // Entraînement + end_counter==2 (Transition) → LoadNext, transition immédiate.
        let json: serde_json::Value =
            serde_json::from_str(&match_tick("Transition", true, 2).expect("ok"))
                .expect("JSON valide");
        assert_eq!(json["next"], "LoadNext");
        assert_eq!(json["immediate"], true);
    }

    #[test]
    fn match_tick_accepte_index_numerique() {
        // "1" == WaitTimer.
        let json: serde_json::Value =
            serde_json::from_str(&match_tick("1", false, 0).expect("ok")).expect("JSON valide");
        assert_eq!(json["next"], "Transition");
    }

    #[test]
    fn match_tick_etat_inconnu_erreur() {
        assert!(match_tick("Pizza", false, 0).is_err());
    }

    #[test]
    fn final_score_golden() {
        // 2 min 30 s = 20030 (golden FSM).
        assert_eq!(final_score(2, 30), 20030);
        assert_eq!(final_score(0, 0), 0);
    }

    // -----------------------------------------------------------------------
    // nie-data — lookup skill / aura / item
    // -----------------------------------------------------------------------

    /// Construit un `skill_config.cfg.bin.json` minimal (`lists`) avec la 1re valeur
    /// RÉELLE vérifiée (whs00010, « Trampoline du tonnerre », skillID 0x63BDA8A4,
    /// element=1 Vent, category=1 Tir, power 70→440). Source : `nie_data::skill`.
    fn skill_config_fixture() -> String {
        serde_json::json!({
            "version": 4,
            "lists": [{
                "name": "m_skillInfoList",
                "typeName": "SkillInfo",
                "values": [{
                    "skillID": "0x63BDA8A4",
                    "skillIDStr": "whs00010",
                    "skillNameId": "0x11111111",
                    "skillDescId": "0x22222222",
                    "power_min": 70,
                    "power_max": 440,
                    "element": 1,
                    "category": 1,
                    "consumeTp": 70,
                    "recastTime": 90,
                    "partnerType": 2,
                    "partner1": "0xAB97A3D2"
                }]
            }]
        })
        .to_string()
    }

    /// `skill_text.cfg.bin.json` minimal joignant le nom via NOUN_INFO (var0=hash, var5=nom).
    fn skill_text_fixture() -> String {
        serde_json::json!({
            "entries": [{
                "name": "NOUN_INFO_BEGIN",
                "variables": [],
                "children": [{
                    "name": "NOUN_INFO_0",
                    // var0 = hash décimal (les variables CfgBin brutes sont des entiers
                    // signés, pas des chaînes hex). 286331153 == 0x11111111 == skillNameId.
                    "variables": [
                        {"type": "Int", "value": "286331153"},
                        {"type": "Int", "value": "0"},
                        {"type": "String", "value": "fallback"},
                        {"type": "Int", "value": "0"},
                        {"type": "Int", "value": "0"},
                        {"type": "String", "value": "Trampoline du tonnerre"}
                    ],
                    "children": []
                }]
            }]
        })
        .to_string()
    }

    #[test]
    fn skill_lookup_resout_nom_et_element() {
        let out = skill_lookup(&skill_config_fixture(), &skill_text_fixture()).expect("ok");
        let json: serde_json::Value = serde_json::from_str(&out).expect("JSON valide");
        assert_eq!(json["count"], 1);
        let s = &json["skills"][0];
        assert_eq!(s["skillId"], "0x63BDA8A4");
        assert_eq!(s["skillIdStr"], "whs00010");
        assert_eq!(s["name"], "Trampoline du tonnerre");
        // element=1 → Wind ; category=1 → Shoot (enums nie-data).
        assert_eq!(s["element"], "Wind");
        assert_eq!(s["category"], "Shoot");
        assert_eq!(s["powerMin"], 70);
        assert_eq!(s["powerMax"], 440);
    }

    #[test]
    fn skill_lookup_sans_text_pas_de_nom() {
        // skill_text vide → name == null (pas d'invention).
        let out = skill_lookup(&skill_config_fixture(), "").expect("ok");
        let json: serde_json::Value = serde_json::from_str(&out).expect("JSON valide");
        assert!(json["skills"][0]["name"].is_null());
    }

    #[test]
    fn skill_lookup_json_invalide_erreur() {
        assert!(skill_lookup("{pas du json", "").is_err());
    }

    /// `aura_skill_config.cfg.bin.json` minimal avec le noeud RÉEL `AURA_CMD_INFO_0`
    /// (assetCode wks00020, element var8=3 Feu, sub_type Keshin). Source : `nie_data::aura`.
    fn aura_config_fixture() -> String {
        // 19 variables, ordre du dump vérifié.
        let vars: Vec<serde_json::Value> = [
            "2037965306", "wks00020", "493403631", "-1653680409", "30", "60",
            "260858381", "-1368456794", "3", "8", "0", "1", "-1124324279",
            "0", "0", "0", "1", "0", "0",
        ]
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let ty = if i == 1 { "String" } else { "Int" };
            serde_json::json!({"type": ty, "value": v})
        })
        .collect();

        serde_json::json!({
            "entries": [{
                "name": "AURA_CMD_INFO_0",
                "variables": vars,
                "children": []
            }]
        })
        .to_string()
    }

    #[test]
    fn aura_lookup_subtype_et_element() {
        // Sans skill_config → hissatsu == null (le skillId1 ne résout vers rien, comme le TS).
        let out = aura_lookup(&aura_config_fixture(), "").expect("ok");
        let json: serde_json::Value = serde_json::from_str(&out).expect("JSON valide");
        assert_eq!(json["count"], 1);
        let a = &json["auras"][0];
        assert_eq!(a["auraId"], "0x7978E1FA");
        assert_eq!(a["assetCode"], "wks00020");
        // préfixe wks → Keshin ; element var8=3 → Fire.
        assert_eq!(a["subType"], "Keshin");
        assert_eq!(a["subTypeLabel"], "Esprit Guerrier");
        assert_eq!(a["element"], "Fire");
        assert!(a["hissatsu"].is_null());
    }

    #[test]
    fn aura_lookup_resout_hissatsu_via_skill_config() {
        // skill_config où skillID == config.skillId1 de l'aura (var6 = 260858381 = 0x0F8C620D).
        let skill_config = serde_json::json!({
            "version": 4,
            "lists": [{
                "name": "m_skillInfoList",
                "values": [{
                    "skillID": "260858381",
                    "skillIDStr": "wks00020_hit",
                    "power_min": 100,
                    "power_max": 640,
                    "element": 3,
                    "category": 1
                }]
            }]
        })
        .to_string();

        let out = aura_lookup(&aura_config_fixture(), &skill_config).expect("ok");
        let json: serde_json::Value = serde_json::from_str(&out).expect("JSON valide");
        let h = &json["auras"][0]["hissatsu"];
        assert!(!h.is_null(), "skillId1 doit résoudre vers le skill_config fourni");
        // `AuraHissatsu` est sérialisé tel quel par serde → clés snake_case.
        assert_eq!(h["skill_id_str"], "wks00020_hit");
        assert_eq!(h["element"], "Fire");
        assert_eq!(h["power"][0], 100);
        assert_eq!(h["power"][1], 640);
    }

    /// `item_config.cfg.bin.json` minimal avec le noeud RÉEL `ITEM_SHOES_INFO_0`
    /// (itemId 0x6D5D11A0, price 1401, stats 30/31, internalCode eq_sh110001).
    fn item_config_fixture() -> String {
        let raw = [
            "1834815904", "0", "1853054332", "0", "1401", "30", "31", "999",
            "0", "0", "0", "eq_sh110001", "1", "0", "0", "224", "0", "0", "961180446",
        ];
        let vars: Vec<serde_json::Value> = raw
            .iter()
            .enumerate()
            .map(|(i, v)| {
                let ty = if i == 11 { "String" } else { "Int" };
                serde_json::json!({"type": ty, "value": v})
            })
            .collect();

        serde_json::json!({
            "entries": [{
                "name": "ITEM_SHOES_INFO_0",
                "variables": vars,
                "children": []
            }]
        })
        .to_string()
    }

    #[test]
    fn item_lookup_shoes() {
        let out = item_lookup(&item_config_fixture()).expect("ok");
        let json: serde_json::Value = serde_json::from_str(&out).expect("JSON valide");
        assert_eq!(json["count"], 1);
        let it = &json["items"][0];
        assert_eq!(it["itemId"], "0x6D5D11A0");
        assert_eq!(it["category"], "shoes");
        assert_eq!(it["price"], 1401);
        assert_eq!(it["stats"]["stat1"], 30);
        assert_eq!(it["stats"]["stat2"], 31);
        assert_eq!(it["internalCode"], "eq_sh110001");
    }

    #[test]
    fn item_lookup_json_invalide_erreur() {
        assert!(item_lookup("nope").is_err());
    }
}
