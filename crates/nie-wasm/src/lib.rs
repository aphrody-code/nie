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
//! ## Pattern d'import JS (ESM bundler)
//!
//! ```text
//! import init, { init_panic_hook, detect_format, crilayla_decompress, utf_table_json }
//!   from "./pkg/nie_wasm.js";
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
}
