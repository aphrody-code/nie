//! Bindings WebAssembly pour `nie-formats`.
//!
//! Expose au navigateur les parsers portables de `nie-formats` via `wasm-bindgen`. La cible
//! `wasm32-unknown-unknown` s'installe par `rustup target add wasm32-unknown-unknown` et n'a rien
//! de spécifique à une plateforme.
//!
//! ## Génération des bindings JS
//!
//! La compilation vers wasm32 seule ne suffit pas à produire les glues JS.
//!
//! **Le CLI `wasm-bindgen` doit avoir EXACTEMENT la version épinglée par le workspace**
//! (`wasm-bindgen = { version = "=…" }` dans le `Cargo.toml` racine) : un écart, même de patch,
//! fait rejeter les bindings générés. Ne pas recopier un numéro ici — il dériverait. Lire le pin,
//! puis installer le CLI correspondant :
//!
//! ```sh
//! # Option A — wasm-bindgen-cli, à la version du workspace
//! cargo install wasm-bindgen-cli --version "$(grep -oE 'wasm-bindgen = \{ version = "=[0-9.]+"' Cargo.toml | grep -oE '[0-9.]+')"
//! cargo build -p nie-wasm --target wasm32-unknown-unknown --release
//! wasm-bindgen target/wasm32-unknown-unknown/release/nie_wasm.wasm \
//!     --out-dir pkg/ --target web
//!
//! # Option B — wasm-pack (enchaîne les deux étapes)
//! cargo install wasm-pack
//! wasm-pack build crates/engine/nie-wasm --target web
//! ```
//!
//! `scripts/build-wasm.sh` fait le contrôle d'alignement avant de construire.
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
//! The generated `web` target is initialized with an explicit response by the Vite host. For a
//! direct Bun consumer, generate a separate `nodejs` target; Bun does not implement the Wasm ESM
//! integration assumed by wasm-bindgen's `bundler` target.
//!
//! ## Pattern d'import JS (ESM web)
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
#![allow(clippy::pedantic)]

pub mod native_audio;
pub use native_audio::{audio_bank_cue_to_wav, audio_bank_json, audio_cue_to_wav};

pub mod native_video;
pub use native_video::{
    usm_audio_track_wav, usm_elementary_video_bytes, usm_metadata_json, usm_video_track_bytes,
};

#[cfg(all(target_arch = "wasm32", feature = "webgpu"))]
pub mod web_viewer;

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
/// lisible au lieu d'une erreur Wasm opaque. Conservée pour compat ; le hook est
/// désormais aussi installé automatiquement par [`__wasm_start`] (best practice).
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn init_panic_hook() {
    #[cfg(target_arch = "wasm32")]
    console_error_panic_hook::set_once();
}

/// Point d'entrée **auto-exécuté à l'instanciation** du module (attribut `start`,
/// best practice wasm-bindgen) : installe le hook de panique sans dépendre d'un
/// appel JS explicite — toute panique reste lisible même si l'hôte oublie l'init.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen(start)]
pub fn __wasm_start() {
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

/// Describes one VFS entry with `nie-explore`'s shared format dispatcher.
///
/// The JSON result is versioned and always valid, including for unknown input:
/// `{ "schemaVersion": 1, "path": "...", "recognized": true, "lines": [...] }`.
/// Parsing stays entirely in WebAssembly; native filesystem search and the instrumented Lua VM
/// are excluded from this dependency edge.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn vfs_content_summary(path: &str, bytes: &[u8]) -> String {
    let summary = nie_explore::describe_content(path, bytes);
    serde_json::json!({
        "schemaVersion": 1,
        "path": path,
        "recognized": summary.is_some(),
        "lines": summary.unwrap_or_default(),
    })
    .to_string()
}

fn binary_triage_impl(bytes: &[u8], strings_limit: u32) -> Result<String, String> {
    let limit = usize::try_from(strings_limit)
        .unwrap_or(aphrody_re::STRINGS_SAMPLE_LIMIT)
        .min(256);
    let report = aphrody_re::triage_bounded(bytes, limit).map_err(|error| error.to_string())?;
    serde_json::to_string(&report).map_err(|error| error.to_string())
}

/// Inspects PE/ELF bytes with the shared pure-Rust reverse-engineering engine.
/// The string sample is capped at 256 entries to keep the browser result bounded.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn binary_triage_json(bytes: &[u8], strings_limit: u32) -> Result<String, JsValue> {
    binary_triage_impl(bytes, strings_limit).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`binary_triage_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn binary_triage_json(bytes: &[u8], strings_limit: u32) -> Result<String, String> {
    binary_triage_impl(bytes, strings_limit)
}

const MAX_ASSEMBLY_SOURCE_BYTES: usize = 16 * 1024;
const MAX_ASSEMBLY_INSTRUCTIONS: usize = 1024;
const MAX_ASSEMBLY_OUTPUT_BYTES: usize = 64 * 1024;

fn assemble_x64_impl(source: &str, virtual_address: u64) -> Result<Vec<u8>, String> {
    if source.len() > MAX_ASSEMBLY_SOURCE_BYTES {
        return Err(format!(
            "assembly source exceeds {MAX_ASSEMBLY_SOURCE_BYTES} bytes"
        ));
    }
    let instructions = nie_asm::parse_line(source).map_err(|error| error.to_string())?;
    if instructions.len() > MAX_ASSEMBLY_INSTRUCTIONS {
        return Err(format!(
            "assembly source exceeds {MAX_ASSEMBLY_INSTRUCTIONS} instructions"
        ));
    }
    let bytes = nie_asm::encode_at(&instructions, virtual_address);
    if bytes.len() > MAX_ASSEMBLY_OUTPUT_BYTES {
        return Err(format!(
            "assembly output exceeds {MAX_ASSEMBLY_OUTPUT_BYTES} bytes"
        ));
    }
    Ok(bytes)
}

/// Assembles bounded x86-64 source with `nie-asm`'s verified MSVC encoding rules.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn assemble_x64(source: &str, virtual_address: u64) -> Result<Vec<u8>, JsValue> {
    assemble_x64_impl(source, virtual_address).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`assemble_x64`].
#[cfg(not(target_arch = "wasm32"))]
pub fn assemble_x64(source: &str, virtual_address: u64) -> Result<Vec<u8>, String> {
    assemble_x64_impl(source, virtual_address)
}

/// Compares an original and rebuilt executable with `nie-pe`'s byte-exact forge metric.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn pe_byte_diff_json(reference: &[u8], rebuilt: &[u8], max_ranges: u32) -> String {
    let report = nie_pe::diff::compare(reference, rebuilt, (max_ranges as usize).min(256));
    let ranges: Vec<_> = report
        .ranges
        .iter()
        .map(|range| serde_json::json!({ "offset": range.off, "length": range.len }))
        .collect();
    serde_json::json!({
        "schemaVersion": 1,
        "referenceLength": report.len_ref,
        "rebuiltLength": report.len_got,
        "bytesDiffering": report.bytes_differing,
        "identicalRatio": report.ratio_identical(),
        "identical": report.is_identical(),
        "ranges": ranges,
        "truncated": report.truncated,
    })
    .to_string()
}

fn forge_lift_x64_impl(bytes: &[u8], virtual_address: u64) -> Result<String, String> {
    let lifted = nie_forge::lift::lift_body_text(bytes, virtual_address).map_err(|blockage| {
        serde_json::json!({
            "cause": blockage.cause,
            "sample": blockage.sample,
        })
        .to_string()
    })?;
    Ok(serde_json::json!({
        "schemaVersion": 1,
        "byteLength": lifted.byte_len,
        "instructionCount": lifted.instruction_count,
        "source": lifted.source,
    })
    .to_string())
}

/// Lifts a bounded x86-64 body to `nie-forge`'s byte-exact assembly dialect.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn forge_lift_x64_json(bytes: &[u8], virtual_address: u64) -> Result<String, JsValue> {
    forge_lift_x64_impl(bytes, virtual_address).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`forge_lift_x64_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn forge_lift_x64_json(bytes: &[u8], virtual_address: u64) -> Result<String, String> {
    forge_lift_x64_impl(bytes, virtual_address)
}

const MAX_MINIDUMP_INPUT_BYTES: usize = 128 * 1024 * 1024;

fn minidump_summary_impl(bytes: &[u8]) -> Result<String, String> {
    if bytes.len() > MAX_MINIDUMP_INPUT_BYTES {
        return Err(format!(
            "minidump input exceeds {MAX_MINIDUMP_INPUT_BYTES} bytes"
        ));
    }
    let dump = nie_dump::Minidump::from_bytes(bytes).map_err(|error| error.to_string())?;
    let summary = dump.summary();
    Ok(serde_json::json!({
        "schemaVersion": 1,
        "moduleCount": summary.module_count,
        "rangeCount": summary.range_count,
        "regionCount": summary.region_count,
        "mappedBytes": summary.mapped_bytes,
    })
    .to_string())
}

/// Parses uploaded Windows minidump bytes and returns metadata without captured memory.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn minidump_summary_json(bytes: &[u8]) -> Result<String, JsValue> {
    minidump_summary_impl(bytes).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`minidump_summary_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn minidump_summary_json(bytes: &[u8]) -> Result<String, String> {
    minidump_summary_impl(bytes)
}

fn ievr_pe_inspect_impl(bytes: &[u8]) -> Result<String, String> {
    ievr_tools::pe::inspect_bytes_json(bytes).map_err(|error| error.to_string())
}

/// Produces a bounded detailed PE report with sections, imports, and named exports.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn ievr_pe_inspect_json(bytes: &[u8]) -> Result<String, JsValue> {
    ievr_pe_inspect_impl(bytes).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`ievr_pe_inspect_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn ievr_pe_inspect_json(bytes: &[u8]) -> Result<String, String> {
    ievr_pe_inspect_impl(bytes)
}

const MAX_PDATA_INPUT_BYTES: usize = 64 * 1024 * 1024;

fn pdata_inspect_impl(bytes: &[u8], max_roots: u32) -> Result<String, String> {
    if bytes.len() > MAX_PDATA_INPUT_BYTES {
        return Err(format!("PE input exceeds {MAX_PDATA_INPUT_BYTES} bytes"));
    }
    let report = nie_re::pdata::inspect_roots(bytes, max_roots as usize)
        .map_err(|error| error.to_string())?;
    let roots: Vec<_> = report
        .sampled_roots
        .iter()
        .map(|root| {
            serde_json::json!({
                "start": format!("{:#x}", root.start),
                "end": format!("{:#x}", root.end),
            })
        })
        .collect();
    Ok(serde_json::json!({
        "schemaVersion": 1,
        "entries": report.entries,
        "rootEntries": report.root_entries,
        "chainedFragments": report.chained_fragments,
        "unreadableUnwindEntries": report.unreadable_unwind_entries,
        "invalidRootEntries": report.invalid_root_entries,
        "sampledRoots": roots,
        "sampleTruncated": report.sample_truncated,
    })
    .to_string())
}

/// Inspects a PE `.pdata` table with exact counters and a bounded root sample.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn pdata_inspect_json(bytes: &[u8], max_roots: u32) -> Result<String, JsValue> {
    pdata_inspect_impl(bytes, max_roots).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`pdata_inspect_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn pdata_inspect_json(bytes: &[u8], max_roots: u32) -> Result<String, String> {
    pdata_inspect_impl(bytes, max_roots)
}

fn aob_scan_impl(pattern: &str, bytes: &[u8], max_hits: u32) -> Result<String, String> {
    let max_hits = usize::try_from(max_hits).map_err(|error| error.to_string())?;
    let report = nie_trace::scan_bytes_bounded(pattern, bytes, max_hits)
        .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "schemaVersion": 1,
        "patternBytes": report.pattern_bytes,
        "scannedBytes": report.scanned_bytes,
        "offsets": report.offsets,
        "truncated": report.truncated,
    })
    .to_string())
}

/// Scans uploaded bytes with `nie-trace`'s bounded wildcard AOB engine.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn aob_scan_json(pattern: &str, bytes: &[u8], max_hits: u32) -> Result<String, JsValue> {
    aob_scan_impl(pattern, bytes, max_hits).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`aob_scan_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn aob_scan_json(pattern: &str, bytes: &[u8], max_hits: u32) -> Result<String, String> {
    aob_scan_impl(pattern, bytes, max_hits)
}

fn crc32_benchmark_sample_impl(byte_length: u32) -> Result<String, String> {
    let report =
        nie_bench::crc32_sample(byte_length as usize).map_err(|error| error.to_string())?;
    serde_json::to_string(&report).map_err(|error| error.to_string())
}

/// Produces the bounded deterministic CRC32 sample shared by all benchmark harnesses.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn crc32_benchmark_sample_json(byte_length: u32) -> Result<String, JsValue> {
    crc32_benchmark_sample_impl(byte_length).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`crc32_benchmark_sample_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn crc32_benchmark_sample_json(byte_length: u32) -> Result<String, String> {
    crc32_benchmark_sample_impl(byte_length)
}

fn offline_image_inspect_impl(bytes: &[u8], request_json: &str) -> Result<String, String> {
    nie_computer_use::offline_image::inspect_offline_image_json(bytes, request_json)
        .map_err(|error| error.to_string())
}

/// Resolves and hashes bounded ranges in a caller-supplied linear `nie.exe` image.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn offline_image_inspect_json(bytes: &[u8], request_json: &str) -> Result<String, JsValue> {
    offline_image_inspect_impl(bytes, request_json).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`offline_image_inspect_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn offline_image_inspect_json(bytes: &[u8], request_json: &str) -> Result<String, String> {
    offline_image_inspect_impl(bytes, request_json)
}

const MAX_KNOWLEDGE_INDEX_JSON_BYTES: usize = 16 * 1024 * 1024;

fn knowledge_search_impl(
    entries_json: &str,
    query: &str,
    max_results: u32,
) -> Result<String, String> {
    if entries_json.len() > MAX_KNOWLEDGE_INDEX_JSON_BYTES {
        return Err(format!(
            "knowledge index JSON exceeds {MAX_KNOWLEDGE_INDEX_JSON_BYTES} bytes"
        ));
    }
    let entries: Vec<nie_index::memory::KnowledgeEntry> =
        serde_json::from_str(entries_json).map_err(|error| error.to_string())?;
    let index = nie_index::memory::MemoryIndex::new(entries).map_err(|error| error.to_string())?;
    let result = index
        .search(query, max_results as usize)
        .map_err(|error| error.to_string())?;
    serde_json::to_string(&result).map_err(|error| error.to_string())
}

/// Searches bounded caller-owned `nie.exe` knowledge without SQLite, Redis, or host access.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn knowledge_search_json(
    entries_json: &str,
    query: &str,
    max_results: u32,
) -> Result<String, JsValue> {
    knowledge_search_impl(entries_json, query, max_results)
        .map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`knowledge_search_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn knowledge_search_json(
    entries_json: &str,
    query: &str,
    max_results: u32,
) -> Result<String, String> {
    knowledge_search_impl(entries_json, query, max_results)
}

fn headless_inspect_impl(bytes: &[u8]) -> Result<String, String> {
    nie_headless::inspect_bytes_json(bytes).map_err(|error| error.to_string())
}

/// Returns the detailed bounded format report shared with the `nie-headless` CLI.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn headless_inspect_json(bytes: &[u8]) -> Result<String, JsValue> {
    headless_inspect_impl(bytes).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`headless_inspect_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn headless_inspect_json(bytes: &[u8]) -> Result<String, String> {
    headless_inspect_impl(bytes)
}

fn editor_add_object_impl(project_json: &str, object_json: &str) -> Result<String, String> {
    if object_json.len() > nie_editor::MAX_PROJECT_BYTES {
        return Err(format!(
            "scene object JSON exceeds {} bytes",
            nie_editor::MAX_PROJECT_BYTES
        ));
    }
    let mut session = nie_editor::EditorSession::from_json(project_json.as_bytes())
        .map_err(|error| error.to_string())?;
    let object = serde_json::from_str(object_json).map_err(|error| error.to_string())?;
    session
        .add_object(object)
        .map_err(|error| error.to_string())?;
    let bytes = session
        .to_json_pretty()
        .map_err(|error| error.to_string())?;
    String::from_utf8(bytes).map_err(|error| error.to_string())
}

/// Adds one validated scene object through the editor's shared bounded session core.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn editor_add_object_json(project_json: &str, object_json: &str) -> Result<String, JsValue> {
    editor_add_object_impl(project_json, object_json).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`editor_add_object_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn editor_add_object_json(project_json: &str, object_json: &str) -> Result<String, String> {
    editor_add_object_impl(project_json, object_json)
}

/// Browser-owned scene editing session with bounded undo/redo history.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmEditorSession {
    inner: nie_editor::EditorSession,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmEditorSession {
    /// Opens and validates a bounded scene project.
    #[wasm_bindgen(constructor)]
    pub fn new(project_json: &str) -> Result<WasmEditorSession, JsValue> {
        let inner = nie_editor::EditorSession::from_json(project_json.as_bytes())
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(WasmEditorSession { inner })
    }

    /// Serializes the current validated scene project.
    pub fn project_json(&self) -> Result<String, JsValue> {
        let bytes = self
            .inner
            .to_json_pretty()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        String::from_utf8(bytes).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Selects an object index, or clears selection when omitted.
    pub fn select(&mut self, selected: Option<u32>) -> Result<(), JsValue> {
        self.inner
            .select(selected.map(|value| value as usize))
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Adds a validated JSON scene object and returns its index.
    pub fn add_object_json(&mut self, object_json: &str) -> Result<u32, JsValue> {
        if object_json.len() > nie_editor::MAX_PROJECT_BYTES {
            return Err(JsValue::from_str("scene object JSON exceeds project limit"));
        }
        let object = serde_json::from_str(object_json)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        let index = self
            .inner
            .add_object(object)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        u32::try_from(index).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Duplicates the selected object with a finite validated translation.
    pub fn duplicate_selected(&mut self, x: f32, y: f32, z: f32) -> Result<u32, JsValue> {
        let index = self
            .inner
            .duplicate_selected([x, y, z])
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        u32::try_from(index).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Removes the selected object and returns its JSON representation.
    pub fn remove_selected_json(&mut self) -> Result<String, JsValue> {
        let removed = self
            .inner
            .remove_selected()
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        serde_json::to_string(&removed).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Restores the previous project state.
    pub fn undo(&mut self) -> bool {
        self.inner.undo()
    }

    /// Restores the next project state after undo.
    pub fn redo(&mut self) -> bool {
        self.inner.redo()
    }

    /// Whether an undo state is available.
    #[wasm_bindgen(getter)]
    pub fn can_undo(&self) -> bool {
        self.inner.can_undo()
    }

    /// Whether a redo state is available.
    #[wasm_bindgen(getter)]
    pub fn can_redo(&self) -> bool {
        self.inner.can_redo()
    }
}

fn character_parts_catalog_impl(bytes: &[u8], source: &str) -> Result<String, String> {
    let catalog = nie_model_serve::catalog::decode_character_parts_catalog(
        bytes,
        source,
        &nie_model_serve::catalog::CatalogDecodeLimits::default(),
    )
    .map_err(|error| error.to_string())?;
    serde_json::to_string(&catalog).map_err(|error| error.to_string())
}

/// Decodes a bounded `chara_parts_*.cfg.bin` catalog supplied by the browser.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn character_parts_catalog_json(bytes: &[u8], source: &str) -> Result<String, JsValue> {
    character_parts_catalog_impl(bytes, source).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`character_parts_catalog_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn character_parts_catalog_json(bytes: &[u8], source: &str) -> Result<String, String> {
    character_parts_catalog_impl(bytes, source)
}

fn chara_model_catalog_impl(bytes: &[u8], source: &str) -> Result<String, String> {
    let catalog = nie_model_serve::catalog::decode_chara_model_catalog(
        bytes,
        source,
        &nie_model_serve::catalog::CatalogDecodeLimits::default(),
    )
    .map_err(|error| error.to_string())?;
    serde_json::to_string(&catalog).map_err(|error| error.to_string())
}

/// Decodes a bounded `chara_model_*.cfg.bin` catalog supplied by the browser.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn chara_model_catalog_json(bytes: &[u8], source: &str) -> Result<String, JsValue> {
    chara_model_catalog_impl(bytes, source).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`chara_model_catalog_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn chara_model_catalog_json(bytes: &[u8], source: &str) -> Result<String, String> {
    chara_model_catalog_impl(bytes, source)
}

fn zukan_rank_impl(
    entry_json: &str,
    candidates_json: &str,
    max_results: u32,
) -> Result<String, String> {
    nie_zukan::api::rank_json(entry_json, candidates_json, max_results)
}

/// Ranks official-encyclopedia candidates with the shared deterministic matcher.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn zukan_rank_json(
    entry_json: &str,
    candidates_json: &str,
    max_results: u32,
) -> Result<String, JsValue> {
    zukan_rank_impl(entry_json, candidates_json, max_results)
        .map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`zukan_rank_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn zukan_rank_json(
    entry_json: &str,
    candidates_json: &str,
    max_results: u32,
) -> Result<String, String> {
    zukan_rank_impl(entry_json, candidates_json, max_results)
}

fn format_catalog_validate_impl(bytes: &[u8]) -> Result<String, String> {
    let catalog = nie_seed::format_catalog::parse_format_catalog_bytes(
        bytes,
        nie_seed::format_catalog::CatalogLimits::default(),
    )
    .map_err(|error| error.to_string())?;
    serde_json::to_string(&catalog).map_err(|error| error.to_string())
}

/// Validates and canonicalizes a bounded `iecode`/IEVR format catalog in browser memory.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn format_catalog_validate_json(bytes: &[u8]) -> Result<String, JsValue> {
    format_catalog_validate_impl(bytes).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`format_catalog_validate_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn format_catalog_validate_json(bytes: &[u8]) -> Result<String, String> {
    format_catalog_validate_impl(bytes)
}

const MAX_STEAM_PLANNING_JSON_BYTES: usize = 8 * 1024 * 1024;

fn steam_select_depots_impl(depots_json: &str, selection_json: &str) -> Result<String, String> {
    if depots_json.len() > MAX_STEAM_PLANNING_JSON_BYTES
        || selection_json.len() > MAX_STEAM_PLANNING_JSON_BYTES
    {
        return Err(format!(
            "Steam planning JSON exceeds {MAX_STEAM_PLANNING_JSON_BYTES} bytes"
        ));
    }
    let depots: Vec<nie_steam::planning::DepotRecord> =
        serde_json::from_str(depots_json).map_err(|error| error.to_string())?;
    let selection: nie_steam::planning::DepotSelection =
        serde_json::from_str(selection_json).map_err(|error| error.to_string())?;
    let depot_ids = nie_steam::planning::select_depot_ids(
        &depots,
        &selection,
        nie_steam::planning::PlanningLimits::default(),
    )
    .map_err(|error| error.to_string())?;
    Ok(serde_json::json!({
        "schemaVersion": 1,
        "depotIds": depot_ids,
    })
    .to_string())
}

/// Selects Steam depots from caller-supplied metadata without credentials or host access.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn steam_select_depots_json(
    depots_json: &str,
    selection_json: &str,
) -> Result<String, JsValue> {
    steam_select_depots_impl(depots_json, selection_json).map_err(|error| JsValue::from_str(&error))
}

/// Native test surface for [`steam_select_depots_json`].
#[cfg(not(target_arch = "wasm32"))]
pub fn steam_select_depots_json(depots_json: &str, selection_json: &str) -> Result<String, String> {
    steam_select_depots_impl(depots_json, selection_json)
}

/// Browser-owned task lifecycle validated by the portable `nie-tasks` core.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmTaskPlan {
    inner: nie_tasks::TaskPlan,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmTaskPlan {
    /// Creates a queued task plan with bounded identifiers and labels.
    #[wasm_bindgen(constructor)]
    pub fn new(id: &str, label: &str, total: u64) -> Result<WasmTaskPlan, JsValue> {
        let inner = nie_tasks::TaskPlan::new(id, label, total)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(WasmTaskPlan { inner })
    }

    /// Marks the queued task as running.
    pub fn start(&mut self) -> Result<(), JsValue> {
        self.inner
            .start()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Pauses a running task at its next cooperative checkpoint.
    pub fn pause(&mut self) -> Result<(), JsValue> {
        self.inner
            .pause()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Resumes a paused task.
    pub fn resume(&mut self) -> Result<(), JsValue> {
        self.inner
            .resume()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Requests cooperative cancellation.
    pub fn request_cancel(&mut self) -> Result<(), JsValue> {
        self.inner
            .request_cancel()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Records bounded progress.
    pub fn report(
        &mut self,
        done: u64,
        total: u64,
        message: Option<String>,
    ) -> Result<(), JsValue> {
        self.inner
            .report(done, total, message)
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Marks the task as completed.
    pub fn complete(&mut self) -> Result<(), JsValue> {
        self.inner
            .complete()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Confirms that a cancellation request reached a checkpoint.
    pub fn confirm_canceled(&mut self) -> Result<(), JsValue> {
        self.inner
            .confirm_canceled()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Marks the task as failed.
    pub fn fail(&mut self) -> Result<(), JsValue> {
        self.inner
            .fail()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }

    /// Serializes the current phase, progress and available controls.
    pub fn snapshot_json(&self) -> Result<String, JsValue> {
        self.inner
            .snapshot_json()
            .map_err(|error| JsValue::from_str(&error.to_string()))
    }
}

/// Browser-owned bounded FIFO frontier backed by `nie-queue`'s portable core.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmFrontier {
    inner: nie_queue::MemoryFrontier,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmFrontier {
    /// Creates an empty frontier with explicit non-zero capacities.
    #[wasm_bindgen(constructor)]
    pub fn new(max_pending: u32, max_seen: u32, max_batch: u32) -> Result<WasmFrontier, JsValue> {
        let limits = nie_queue::FrontierLimits::new(
            max_pending as usize,
            max_seen as usize,
            max_batch as usize,
        )
        .map_err(|error| JsValue::from_str(&error.to_string()))?;
        Ok(WasmFrontier {
            inner: nie_queue::MemoryFrontier::new(limits),
        })
    }

    /// Pushes one address and returns its stable outcome name.
    pub fn push(&mut self, address: i64) -> String {
        match self.inner.push(address) {
            nie_queue::PushOutcome::Added => "added",
            nie_queue::PushOutcome::Duplicate => "duplicate",
            nie_queue::PushOutcome::PendingLimitReached => "pending_limit_reached",
            nie_queue::PushOutcome::SeenLimitReached => "seen_limit_reached",
        }
        .to_owned()
    }

    /// Pops the oldest pending address while retaining it in deduplication history.
    pub fn pop(&mut self) -> Option<i64> {
        self.inner.pop()
    }

    /// Returns a precision-safe JSON snapshot of the pending addresses and counts.
    pub fn snapshot_json(&self) -> String {
        let pending: Vec<String> = self
            .inner
            .pending()
            .map(|address| address.to_string())
            .collect();
        serde_json::json!({
            "schemaVersion": 1,
            "pending": pending,
            "pendingCount": self.inner.len(),
            "seenCount": self.inner.seen_count(),
        })
        .to_string()
    }

    /// Clears both pending work and persistent deduplication history.
    pub fn reset(&mut self) {
        self.inner.reset();
    }
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
    crilayla::decompress(bytes).map_err(|e| JsValue::from_str(&e.to_string()))
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
        }
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
    use nie_core::growth::{GrowthParams, GrowthTables, calculate_stats as core_calc};

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
    use nie_core::match_fsm::{MatchContext, tick};

    let s = parse_match_state(state).ok_or_else(|| alloc_format_unknown_state(state))?;
    let ctx = MatchContext {
        is_training,
        end_counter,
    };
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
    use nie_data::skill::{SkillTextMaps, join_skill_text, parse_skill_config, parse_skill_text};

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
// G4MD & G4MG WebGPU 3D support
// ---------------------------------------------------------------------------

/// Parse un fichier G4MD et retourne son JSON descriptif.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn g4md_parse_json(bytes: &[u8]) -> Result<String, JsValue> {
    let parsed = nie_formats::g4md::parse(bytes).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(&parsed).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Parse un fichier G4MD (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn g4md_parse_json(bytes: &[u8]) -> Result<String, String> {
    let parsed = nie_formats::g4md::parse(bytes).map_err(|e| e.to_string())?;
    serde_json::to_string(&parsed).map_err(|e| e.to_string())
}

/// Parse un fichier cfg.bin (T2B) et retourne son JSON structurel.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn cfgbin_parse_json(bytes: &[u8]) -> Result<String, JsValue> {
    let parsed =
        nie_formats::cfgbin::cfgbin_parse(bytes).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(&parsed).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Parse un fichier cfg.bin (T2B) (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn cfgbin_parse_json(bytes: &[u8]) -> Result<String, String> {
    let parsed = nie_formats::cfgbin::cfgbin_parse(bytes).map_err(|e| e.to_string())?;
    serde_json::to_string(&parsed).map_err(|e| e.to_string())
}

// ── cfg.bin -> structures de jeu TYPÉES (décodage natif in-browser) ─────────────
// Reshape vers la forme iecode (`lists`/`entries`) puis dispatch `nie_data::typed`
// (37 familles). Remplace côté navigateur la route serveur `/typed`.

/// Octets bruts en hex MAJUSCULE (identique au dump iecode `defensePos`).
fn nw_hex_upper(bytes: &[u8]) -> String {
    use core::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02X}");
    }
    s
}

/// [`nie_formats::cfgbin::RdbnValue`] -> JSON, encodage identique iecode (hash `0x..`, blob hex MAJ).
fn nw_rdbn_value_to_json(v: &nie_formats::cfgbin::RdbnValue) -> serde_json::Value {
    use nie_formats::cfgbin::RdbnValue as R;
    use serde_json::{Value, json};
    match v {
        R::Bool(b) => json!(b),
        R::Byte(n) => json!(n),
        R::Short(n) | R::ActType(n) => json!(n),
        R::Int(n) | R::Flag(n) => json!(n),
        R::Float(f) => json!(f),
        R::Hash(h) => json!(format!("0x{h:08X}")),
        R::Rates(a) | R::Position(a) => json!(a),
        R::Condition(s) => json!(s),
        R::ShortTuple(t) => json!(t),
        R::Blob(b) => json!(nw_hex_upper(b)),
        _ => Value::Null,
    }
}

/// Liste de frères T2B -> forme iecode, avec réplication du suffixe d'index `<base>_<i>`
/// d'iecode (exigé par `walk_named`) et variables `{type, value:"<string>"}`.
fn nw_t2b_siblings(siblings: &[nie_formats::cfgbin::CfgEntry]) -> Vec<serde_json::Value> {
    use nie_formats::cfgbin::Value as CfgValue;
    use serde_json::{Value, json};
    use std::collections::HashMap;
    let mut counts: HashMap<&str, usize> = HashMap::new();
    siblings
        .iter()
        .map(|e| {
            let idx = counts.entry(e.name.as_str()).or_insert(0);
            let name = format!("{}_{}", e.name, *idx);
            *idx += 1;
            let variables: Vec<Value> = e
                .variables
                .iter()
                .map(|v| match v {
                    CfgValue::String(s) => json!({ "type": "String", "value": s }),
                    CfgValue::Int(n) => json!({ "type": "Int", "value": n.to_string() }),
                    CfgValue::Float(f) => json!({ "type": "Float", "value": f.to_string() }),
                })
                .collect();
            json!({ "name": name, "variables": variables, "children": nw_t2b_siblings(&e.children) })
        })
        .collect()
}

/// Décode un `cfg.bin` vers la forme iecode adaptée (RDBN `lists` ou T2B `entries`).
fn nw_cfgbin_to_iecode(data: &[u8]) -> Option<serde_json::Value> {
    use serde_json::{Map, Value, json};
    if nie_formats::cfgbin::is_rdbn(data) {
        let rdbn = nie_formats::cfgbin::parse(data).ok()?;
        let lists = nie_formats::cfgbin::read_values(&rdbn, data);
        let lists_json: Vec<Value> = lists
            .iter()
            .map(|l| {
                let values: Vec<Value> = l
                    .rows
                    .iter()
                    .map(|row| {
                        let mut m = Map::new();
                        for (name, val) in &row.fields {
                            m.insert(name.clone(), nw_rdbn_value_to_json(val));
                        }
                        Value::Object(m)
                    })
                    .collect();
                json!({ "name": l.name, "typeName": l.type_name, "values": values })
            })
            .collect();
        Some(json!({ "lists": lists_json }))
    } else {
        let cfg = nie_formats::cfgbin::cfgbin_parse(data).ok()?;
        Some(json!({ "entries": nw_t2b_siblings(&cfg.entries) }))
    }
}

/// Impl partagée : `cfg.bin` brut + nom de fichier -> `{family, data}` (famille typée) ou
/// `{family:null, key, generic}` (RDBN/T2B brut iecode).
fn cfgbin_typed_json_impl(bytes: &[u8], filename: &str) -> Result<String, String> {
    let root = nw_cfgbin_to_iecode(bytes).ok_or("cfg.bin non décodable (ni RDBN ni T2B)")?;
    let key = nie_data::typed::family_key(filename);
    let out = match nie_data::typed::decode_by_key(&key, &root) {
        Some((family, data)) => serde_json::json!({ "family": family, "data": data }),
        None => {
            serde_json::json!({ "family": serde_json::Value::Null, "key": key, "generic": root })
        }
    };
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Décode un `*_menu_setting.cfg.bin` vers sa structure sémantique sans enveloppe de famille.
fn cfgbin_menu_setting_json_impl(bytes: &[u8]) -> Result<String, String> {
    let root = nw_cfgbin_to_iecode(bytes).ok_or("cfg.bin non décodable (ni RDBN ni T2B)")?;
    let setting = nie_data::menu_setting::parse(&root);
    serde_json::to_string(&setting).map_err(|e| e.to_string())
}

/// Décode un `cfg.bin` (octets bruts) en structure de jeu typée selon le nom de fichier.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn cfgbin_typed_json(bytes: &[u8], filename: &str) -> Result<String, JsValue> {
    cfgbin_typed_json_impl(bytes, filename).map_err(|e| JsValue::from_str(&e))
}

/// Décode un `cfg.bin` typé (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn cfgbin_typed_json(bytes: &[u8], filename: &str) -> Result<String, String> {
    cfgbin_typed_json_impl(bytes, filename)
}

/// Décode un `*_menu_setting.cfg.bin` en structure de menu directement consommable.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn cfgbin_menu_setting_json(bytes: &[u8]) -> Result<String, JsValue> {
    cfgbin_menu_setting_json_impl(bytes).map_err(|e| JsValue::from_str(&e))
}

/// Décode un `*_menu_setting.cfg.bin` en structure de menu directement consommable (natif).
#[cfg(not(target_arch = "wasm32"))]
pub fn cfgbin_menu_setting_json(bytes: &[u8]) -> Result<String, String> {
    cfgbin_menu_setting_json_impl(bytes)
}

// ── Bytecode Lua 5.2 (scripts du jeu) ──────────────────────────────────────────
// Le decodeur est celui du depot (`nie_lua::bytecode`), compile sans la VM : un `.lua.bin`
// se lit donc dans le navigateur, sans passer par un service.

fn lua_bytecode_json_impl(bytes: &[u8]) -> Result<String, String> {
    let chunk = nie_lua::bytecode::parse(bytes).map_err(|e| e.to_string())?;
    let proto = &chunk.main;
    let constantes: Vec<serde_json::Value> = proto
        .constants
        .iter()
        .map(|c| serde_json::Value::String(c.display()))
        .collect();
    let out = serde_json::json!({
        "instructions": proto.total_instructions(),
        "prototypes": proto.total_protos(),
        "params": proto.num_params,
        "constantes": constantes,
        "source": proto.source,
    });
    serde_json::to_string(&out).map_err(|e| e.to_string())
}

/// Décode un `.lua.bin` du jeu (bytecode Lua 5.2) en résumé JSON.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn lua_bytecode_json(bytes: &[u8]) -> Result<String, JsValue> {
    lua_bytecode_json_impl(bytes).map_err(|e| JsValue::from_str(&e))
}

/// Décode un `.lua.bin` du jeu (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn lua_bytecode_json(bytes: &[u8]) -> Result<String, String> {
    lua_bytecode_json_impl(bytes)
}

/// Vrai si les octets commencent par la signature d'un bytecode Lua 5.2.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
#[must_use]
pub fn is_lua_bytecode(bytes: &[u8]) -> bool {
    nie_lua::bytecode::parse(bytes).is_ok()
}

// ── G4TX -> PNG (textures décodées NATIVEMENT in-browser) ──────────────────────
// Le décodage DDS/BCn → RGBA8 → PNG est centralisé dans `nie_formats::g4tx_decode`
// (feature `textures`, source unique du workspace — Phase 1b dédup). Côté navigateur,
// `image_dds` (default-features=false) reste un décodeur pur Rust compatible wasm32.
// Bonus vs l'ancienne copie locale (DX10 seul) : support FourCC legacy + non compressé
// + sélecteur anti-dummy → corrige les textures invisibles en wasm.

/// Décode la texture principale d'un `.g4tx` en PNG (via le décodeur partagé anti-dummy).
fn g4tx_to_png_impl(bytes: &[u8]) -> Result<Vec<u8>, String> {
    // Basename vide ASSUMÉ : l'ABI wasm ne reçoit que des octets, jamais le nom du fichier
    // source. La sélection retombe donc sur « la plus grande texture non-dummy ». Pour viser
    // une texture précise d'un conteneur multi-textures, passer par `g4tx_named_to_png`.
    nie_formats::g4tx_decode::decode_best_to_png(bytes, "")
        .ok_or_else(|| "décodage G4TX → PNG échoué".to_string())
}

/// Décode une texture **nommée** d'un `.g4tx` en PNG (conteneur multi-textures ou atlas).
fn g4tx_named_to_png_impl(bytes: &[u8], nom: &str) -> Result<Vec<u8>, String> {
    nie_formats::g4tx_decode::decode_named_to_png(bytes, nom)
        .ok_or_else(|| format!("texture « {nom} » absente ou non décodable"))
}

/// Décode un `.g4tx` (octets bruts) en PNG (octets), in-browser.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn g4tx_to_png(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    g4tx_to_png_impl(bytes).map_err(|e| JsValue::from_str(&e))
}

/// Décode un `.g4tx` en PNG (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn g4tx_to_png(bytes: &[u8]) -> Result<Vec<u8>, String> {
    g4tx_to_png_impl(bytes)
}

/// Décode la texture nommée `nom` d'un `.g4tx` en PNG, in-browser.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn g4tx_named_to_png(bytes: &[u8], nom: &str) -> Result<Vec<u8>, JsValue> {
    g4tx_named_to_png_impl(bytes, nom).map_err(|e| JsValue::from_str(&e))
}

/// Décode la texture nommée `nom` d'un `.g4tx` en PNG (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn g4tx_named_to_png(bytes: &[u8], nom: &str) -> Result<Vec<u8>, String> {
    g4tx_named_to_png_impl(bytes, nom)
}

/// Métadonnées d'un `.g4tx` (textures : nom, dimensions, DDS) en JSON, in-browser.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn g4tx_info_json(bytes: &[u8]) -> Result<String, JsValue> {
    let g4tx = nie_formats::g4tx::parse(bytes).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(&g4tx).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Métadonnées d'un `.g4tx` (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn g4tx_info_json(bytes: &[u8]) -> Result<String, String> {
    let g4tx = nie_formats::g4tx::parse(bytes).map_err(|e| e.to_string())?;
    serde_json::to_string(&g4tx).map_err(|e| e.to_string())
}

// ── Static menu layer composition ───────────────────────────────────────────

fn avatar_composition_json_impl(catalog_json: &str, state_json: &str) -> Result<String, String> {
    if catalog_json.len() > 16 * 1024 * 1024 || state_json.len() > 64 * 1024 {
        return Err("Avatar input exceeds size limit".into());
    }
    let catalog = serde_json::from_str::<nie_data::avatar::AvatarCatalog>(catalog_json)
        .map_err(|e| e.to_string())?;
    let state = serde_json::from_str::<nie_data::avatar::AvatarState>(state_json)
        .map_err(|e| e.to_string())?;
    let composition =
        nie_data::avatar::resolve_avatar(&catalog, &state).map_err(|e| e.to_string())?;
    serde_json::to_string(&composition).map_err(|e| e.to_string())
}

/// Resolve avatar selections through the shared Rust data owner, without host URL logic.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn avatar_composition_json(catalog_json: &str, state_json: &str) -> Result<String, JsValue> {
    avatar_composition_json_impl(catalog_json, state_json).map_err(|e| JsValue::from_str(&e))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn avatar_composition_json(catalog_json: &str, state_json: &str) -> Result<String, String> {
    avatar_composition_json_impl(catalog_json, state_json)
}

/// Compile a measured native screen through the shared portable scene owner.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn menu_presentation_json(id: &str) -> Result<String, JsValue> {
    nie_formats::menu_presentation::scene_json(id).map_err(|e| JsValue::from_str(&e))
}

/// Native counterpart of the browser scene compiler.
#[cfg(not(target_arch = "wasm32"))]
pub fn menu_presentation_json(id: &str) -> Result<String, String> {
    nie_formats::menu_presentation::scene_json(id)
}

fn menu_animation_bindings_json_impl(bytes: &[u8]) -> Result<String, String> {
    let bindings = nie_formats::g4ra::parse(bytes).map_err(|error| error.to_string())?;
    serde_json::to_string(&serde_json::json!({
        "schemaVersion": 1,
        "bindings": bindings,
    }))
    .map_err(|error| error.to_string())
}

/// Decode G4RA state, clip and target bindings without inferring animation playback.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn menu_animation_bindings_json(bytes: &[u8]) -> Result<String, JsValue> {
    menu_animation_bindings_json_impl(bytes).map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart of the portable animation-binding decoder.
#[cfg(not(target_arch = "wasm32"))]
pub fn menu_animation_bindings_json(bytes: &[u8]) -> Result<String, String> {
    menu_animation_bindings_json_impl(bytes)
}

/// Derives one static menu layer from the exact three Level-5 assets that define it.
///
/// The browser owns asynchronous VFS acquisition. This function intentionally receives one
/// OBJBIN, one G4PKM and one G4TX buffer rather than a synthetic in-memory VFS, then applies the
/// same pure parser and placement path as the native renderer. Dynamic C++/Lua state is not
/// implied by this static bind-pose result.
fn menu_static_layer_json_impl(
    objbin_bytes: &[u8],
    g4pkm_bytes: &[u8],
    g4tx_bytes: &[u8],
    g4tx_path: &str,
) -> Result<String, String> {
    let object = nie_formats::objbin::parse(objbin_bytes).map_err(|error| error.to_string())?;
    let skeleton = nie_formats::g4pkm::parse(g4pkm_bytes).map_err(|error| error.to_string())?;
    let container = nie_formats::g4tx::parse(g4tx_bytes).map_err(|error| error.to_string())?;
    let stem = g4tx_path
        .rsplit('/')
        .next()
        .unwrap_or(g4tx_path)
        .strip_suffix(".g4tx")
        .unwrap_or(g4tx_path);
    let texture = nie_formats::g4tx::select_main_texture(&container, stem)
        .ok_or_else(|| "G4TX contains no selectable texture".to_owned())?;
    let width = u32::try_from(texture.width).map_err(|_| "G4TX texture width is negative")?;
    let height = u32::try_from(texture.height).map_err(|_| "G4TX texture height is negative")?;
    let positioned = nie_formats::menu::assemble_object(&object, &skeleton, width, height);
    let draw_type = object
        .components
        .iter()
        .find_map(|component| match component {
            nie_formats::objbin::MenuComponent::Render(render) => Some(render.draw_type),
            _ => None,
        })
        .unwrap_or_default();
    let transform = positioned.transform;
    serde_json::to_string(&serde_json::json!({
        "schemaVersion": 1,
        "name": positioned.name,
        "g4txPath": g4tx_path,
        "texture": { "name": texture.name, "width": width, "height": height },
        "drawPriority": positioned.draw_priority,
        "drawType": draw_type,
        "transform": {
            "x": transform.x_px,
            "y": transform.y_px,
            "scaleX": transform.scale_x,
            "scaleY": transform.scale_y,
            "rot": transform.rot,
        },
        "anchor": { "x": 0.5, "y": 0.5 },
    }))
    .map_err(|error| error.to_string())
}

/// Composes one static menu layer from raw OBJBIN, G4PKM and G4TX bytes in WebAssembly.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn menu_static_layer_json(
    objbin_bytes: &[u8],
    g4pkm_bytes: &[u8],
    g4tx_bytes: &[u8],
    g4tx_path: &str,
) -> Result<String, JsValue> {
    menu_static_layer_json_impl(objbin_bytes, g4pkm_bytes, g4tx_bytes, g4tx_path)
        .map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart of [`menu_static_layer_json`] used by focused Rust tests.
#[cfg(not(target_arch = "wasm32"))]
pub fn menu_static_layer_json(
    objbin_bytes: &[u8],
    g4pkm_bytes: &[u8],
    g4tx_bytes: &[u8],
    g4tx_path: &str,
) -> Result<String, String> {
    menu_static_layer_json_impl(objbin_bytes, g4pkm_bytes, g4tx_bytes, g4tx_path)
}

/// Compile an observed Lua menu state into the same lossless scene used by the native host.
/// This does not execute Lua or infer missing assets and transforms.
fn menu_runtime_scene_json_impl(state_json: &str) -> Result<String, String> {
    let state: nie_lua::MenuState =
        serde_json::from_str(state_json).map_err(|error| error.to_string())?;
    serde_json::to_string(&nie_lua::menu_scene::MenuScene::from_state(&state))
        .map_err(|error| error.to_string())
}

/// Portable scene compiler over caller-supplied, observed Lua menu state.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn menu_runtime_scene_json(state_json: &str) -> Result<String, JsValue> {
    menu_runtime_scene_json_impl(state_json).map_err(|error| JsValue::from_str(&error))
}

/// Native counterpart of the browser scene ABI for cross-surface contract tests.
#[cfg(not(target_arch = "wasm32"))]
pub fn menu_runtime_scene_json(state_json: &str) -> Result<String, String> {
    menu_runtime_scene_json_impl(state_json)
}

/// Feuille de sprites d'un atlas `.g4tx` : régions nommées avec leur rectangle, en JSON.
///
/// `g4tx_info_json` rend la structure brute du conteneur ; celle-ci rend ce qu'une interface
/// attend — un manifeste `{nom, largeur, hauteur, sprites[{nom, classe, x, y, largeur, hauteur}]}`
/// directement consommable pour positionner une icône, avec ou sans CSS.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn g4tx_sprite_sheet_json(bytes: &[u8]) -> Result<String, JsValue> {
    sprite_sheet_json(bytes).map_err(|e| JsValue::from_str(&e))
}

/// Feuille de sprites d'un atlas `.g4tx` (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn g4tx_sprite_sheet_json(bytes: &[u8]) -> Result<String, String> {
    sprite_sheet_json(bytes)
}

/// Corps commun aux deux cibles : parse l'atlas, en extrait les régions, sérialise.
fn sprite_sheet_json(bytes: &[u8]) -> Result<String, String> {
    let g4tx = nie_formats::g4tx::parse(bytes).map_err(|e| e.to_string())?;
    let feuille = nie_formats::sprite_sheet::depuis_g4tx(&g4tx, 0)
        .ok_or_else(|| "aucune texture dans ce G4TX".to_string())?;
    Ok(feuille.vers_json())
}

/// Parse une archive `.g4pk` (en-tête + sous-fichiers) en JSON, in-browser.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn g4pk_parse_json(bytes: &[u8]) -> Result<String, JsValue> {
    let g4pk = nie_formats::g4pk::parse(bytes).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(&g4pk).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Parse une archive `.g4pk` (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn g4pk_parse_json(bytes: &[u8]) -> Result<String, String> {
    let g4pk = nie_formats::g4pk::parse(bytes).map_err(|e| e.to_string())?;
    serde_json::to_string(&g4pk).map_err(|e| e.to_string())
}

/// Décode une piste de lip-sync `.p3lip` (visèmes datés) en JSON, in-browser.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn lip_to_json(bytes: &[u8]) -> Result<String, JsValue> {
    let lip = nie_formats::lip::parse(bytes).map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(&lip).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Décode une piste de lip-sync `.p3lip` (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn lip_to_json(bytes: &[u8]) -> Result<String, String> {
    let lip = nie_formats::lip::parse(bytes).map_err(|e| e.to_string())?;
    serde_json::to_string(&lip).map_err(|e| e.to_string())
}

// ── Modèle 3D g4md+g4mg -> GLB (assemblé NATIVEMENT in-browser) ────────────────

/// Assemble un modèle générique (paire G4MD + G4MG) en **GLB** (géométrie, glTF binaire).
fn model_to_glb_impl(g4md: &[u8], g4mg: &[u8]) -> Result<Vec<u8>, String> {
    use nie_formats::assemble::{GenericModelInput, MeshComponent, assemble_generic_model};
    let model = assemble_generic_model(GenericModelInput {
        code: String::new(),
        g4md: g4md.to_vec(),
        g4mg: g4mg.to_vec(),
        component: MeshComponent::Generic,
    })
    .map_err(|e| e.to_string())?;
    Ok(model.to_glb_embedded())
}

/// Assemble une paire G4MD+G4MG (octets bruts) en GLB, in-browser.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn model_to_glb(g4md: &[u8], g4mg: &[u8]) -> Result<Vec<u8>, JsValue> {
    model_to_glb_impl(g4md, g4mg).map_err(|e| JsValue::from_str(&e))
}

/// Assemble un modèle G4MD+G4MG en GLB (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn model_to_glb(g4md: &[u8], g4mg: &[u8]) -> Result<Vec<u8>, String> {
    model_to_glb_impl(g4md, g4mg)
}

// ── Audio CRI → WAV (in-browser) ──────────────────────────────────────────────
// Délègue à la SOURCE UNIQUE `nie_formats::cri_audio::decode_to_wav` (feature `audio-decode`) :
// le décode HCA chiffré IEVR + le dispatch ADX/AWB/ACB y vivent (dédup Phase 1d). Plus de copie ici.
fn audio_to_wav_impl(raw: &[u8]) -> Result<Vec<u8>, String> {
    nie_formats::cri_audio::decode_to_wav(raw)
}

/// Décode un audio CRI (HCA/ADX/AWB/ACB, octets bruts) en **WAV PCM16**, in-browser.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn audio_to_wav(bytes: &[u8]) -> Result<Vec<u8>, JsValue> {
    audio_to_wav_impl(bytes).map_err(|e| JsValue::from_str(&e))
}

/// Décode un audio CRI en WAV (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn audio_to_wav(bytes: &[u8]) -> Result<Vec<u8>, String> {
    audio_to_wav_impl(bytes)
}

/// Extrait la géométrie d'un fichier G4MG à l'aide des métadonnées G4MD fournies au format JSON.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn g4mg_extract_json(g4mg_bytes: &[u8], g4md_json: &str) -> Result<String, JsValue> {
    let g4md: nie_formats::g4md::G4md =
        serde_json::from_str(g4md_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let geom = nie_formats::g4mg::extract_geometry(g4mg_bytes, &g4md);
    serde_json::to_string(&geom).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Extrait la géométrie d'un fichier G4MG (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn g4mg_extract_json(g4mg_bytes: &[u8], g4md_json: &str) -> Result<String, String> {
    let g4md: nie_formats::g4md::G4md =
        serde_json::from_str(g4md_json).map_err(|e| e.to_string())?;
    let geom = nie_formats::g4mg::extract_geometry(g4mg_bytes, &g4md);
    serde_json::to_string(&geom).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// CPK Decryption & Extraction
// ---------------------------------------------------------------------------

/// Parse un fichier CPK et retourne son TOC (Table of Contents) au format JSON.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn cpk_parse_entries(cpk_bytes: &[u8], cpk_filename: &str) -> Result<String, JsValue> {
    let reader = nie_formats::cpk::CpkReader::new(cpk_bytes, cpk_filename)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    serde_json::to_string(&reader.entries).map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Parse un fichier CPK (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn cpk_parse_entries(cpk_bytes: &[u8], cpk_filename: &str) -> Result<String, String> {
    let reader =
        nie_formats::cpk::CpkReader::new(cpk_bytes, cpk_filename).map_err(|e| e.to_string())?;
    serde_json::to_string(&reader.entries).map_err(|e| e.to_string())
}

/// Extrait et décompresse un fichier d'un CPK.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn cpk_extract_file(
    cpk_bytes: &[u8],
    cpk_filename: &str,
    entry_json: &str,
) -> Result<Vec<u8>, JsValue> {
    let reader = nie_formats::cpk::CpkReader::new(cpk_bytes, cpk_filename)
        .map_err(|e| JsValue::from_str(&e.to_string()))?;
    let entry: nie_formats::cpk::CpkEntry =
        serde_json::from_str(entry_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    reader
        .extract(cpk_bytes, &entry)
        .map_err(|e| JsValue::from_str(&e.to_string()))
}

/// Extrait et décompresse un fichier d'un CPK (version native).
#[cfg(not(target_arch = "wasm32"))]
pub fn cpk_extract_file(
    cpk_bytes: &[u8],
    cpk_filename: &str,
    entry_json: &str,
) -> Result<Vec<u8>, String> {
    let reader =
        nie_formats::cpk::CpkReader::new(cpk_bytes, cpk_filename).map_err(|e| e.to_string())?;
    let entry: nie_formats::cpk::CpkEntry =
        serde_json::from_str(entry_json).map_err(|e| e.to_string())?;
    reader.extract(cpk_bytes, &entry).map_err(|e| e.to_string())
}

// ===========================================================================
// nie-save — parsing de saves IEVR côté navigateur (privacy-first)
// ===========================================================================

/// Résumé du conteneur Lives (champs sérialisables, sans les corps bruts).
///
/// Structure JSON retournée par [`parse_save_json`] :
///
/// ```text
/// {
///   "slot_name": "002AB8F4-USERDATALIVE",
///   "key": 1320666147,
///   "blobs": [
///     {
///       "filename": "AUTOSAVE_data.bin",
///       "subtype": "Autosave",
///       "size": 12345678,
///       "crc32": 305419896
///     },
///     ...
///   ],
///   "headersave": { ... },   // présent si blob HEADERSAVE parsé
///   "autosave": { ... }      // présent si blob AUTOSAVE parsé
/// }
/// ```
///
/// Les corps bruts (> 12 Mo pour AUTOSAVE) ne sont jamais sérialisés.
fn parse_save_impl(bytes: &[u8], filename: &str) -> Result<String, String> {
    use nie_save::{
        BlobSubtype,
        body::{
            autosave::parse_autosave_layout, autosave_roster::parse_autosave_roster,
            headersave::parse_headersave,
        },
    };

    let container = nie_save::parse(bytes, filename).map_err(|e| e.to_string())?;

    // --- Résumé des blobs (sans les corps bruts) ---
    let blobs_summary: Vec<serde_json::Value> = container
        .entries
        .iter()
        .zip(container.blobs.iter())
        .map(|(entry, blob)| {
            let subtype = match blob.header.subtype {
                BlobSubtype::System => "System",
                BlobSubtype::Autosave => "Autosave",
                BlobSubtype::Headersave => "Headersave",
                BlobSubtype::Unknown(_) => "Unknown",
            };
            serde_json::json!({
                "filename": entry.filename,
                "subtype":  subtype,
                "size":     entry.size,
                "crc32":    entry.crc32,
                "field8":   blob.header.field8,
            })
        })
        .collect();

    // --- Parse HEADERSAVE si présent ---
    let headersave_json: Option<serde_json::Value> = container
        .blob_by_subtype(BlobSubtype::Headersave)
        .and_then(|blob| {
            parse_headersave(&blob.body).ok().map(|hs| {
                let ts = &hs.save_timestamp;
                let slots: Vec<serde_json::Value> = hs
                    .slots
                    .iter()
                    .enumerate()
                    .map(|(i, s)| {
                        let dt = s.slot_datetime.as_ref().map(|d| {
                            serde_json::json!({
                                "year":   d.year,
                                "month":  d.month,
                                "day":    d.day,
                                "hour":   d.hour,
                                "minute": d.minute,
                                "second": d.second,
                            })
                        });
                        serde_json::json!({
                            "index":         i,
                            "is_active":     s.is_active,
                            "section_role":  s.section_role,
                            "slot_variant":  s.slot_variant,
                            "slot_datetime": dt,
                            "playtime_secs": s.playtime_secs,
                        })
                    })
                    .collect();
                serde_json::json!({
                    "format_version": hs.format_version,
                    "max_slots":      hs.max_slots,
                    "used_slots":     hs.used_slots,
                    "player_name":    hs.player_name,
                    "level_str":      hs.level_str,
                    "unique_id":      hs.unique_id,
                    "save_timestamp": {
                        "year":   ts.year,
                        "month":  ts.month,
                        "day":    ts.day,
                        "hour":   ts.hour,
                        "minute": ts.minute,
                        "second": ts.second,
                    },
                    "slots": slots,
                })
            })
        });

    // --- Parse AUTOSAVE (layout + roster + scalaires) si présent ---
    let autosave_json: Option<serde_json::Value> = container
        .blob_by_subtype(BlobSubtype::Autosave)
        .and_then(|blob| {
            // Layout macroscopique (sections + table CharaParam)
            let layout = parse_autosave_layout(&blob.body).ok()?;

            // Roster + scalaires (section EEFF 0x0510)
            let roster = parse_autosave_roster(&blob.body).ok()?;

            let scalars_json = roster.scalars.as_ref().map(|s| {
                let (h, m, sec) = s.playtime_hms();
                serde_json::json!({
                    "save_year":    s.save_year,
                    "save_month":   s.save_month,
                    "save_day":     s.save_day,
                    "save_hour":    s.save_hour,
                    "save_minute":  s.save_minute,
                    "save_second":  s.save_second,
                    "playtime_secs": s.playtime_secs,
                    "playtime_hms": { "h": h, "m": m, "s": sec },
                })
            });

            // Le roster complet peut être ~18 Ko de JSON (4534 ids × 12 chars) —
            // acceptable dans un contexte navigateur (la save elle-même fait 12 Mo).
            let owned_ids: Vec<u32> = roster.owned.iter().map(|c| c.raw()).collect();

            Some(serde_json::json!({
                "version":            layout.version,
                "opaque_4":           layout.opaque_4,
                "scalar_record_count": layout.scalar_record_count,
                "chara_slot_count":   layout.chara_param_slots.len(),
                "section2_range":     layout.section2_range,
                "main_data_range":    layout.main_data_range,
                "scalars":            scalars_json,
                "roster_slots":       roster.roster_slots,
                "owned_count":        roster.owned.len(),
                "owned_ids":          owned_ids,
            }))
        });

    let result = serde_json::json!({
        "slot_name":  container.slot_name,
        "key":        container.key,
        "blobs":      blobs_summary,
        "headersave": headersave_json,
        "autosave":   autosave_json,
    });

    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/// Déchiffre et parse un fichier de sauvegarde IEVR, retourne un JSON résumé.
///
/// La save ne quitte PAS le navigateur : tout le traitement est effectué
/// client-side dans le module WebAssembly.
///
/// - `bytes` : contenu brut du fichier de sauvegarde (ex. `002AB8F4-USERDATALIVE`).
/// - `filename` : nom de base du fichier (sert à dériver la clé CRC32).
///
/// Retourne un JSON avec :
/// - `slot_name`, `key` : métadonnées du conteneur.
/// - `blobs` : liste des entrées (filename, subtype, size, crc32, field8).
/// - `headersave` : champs HEADERSAVE parsés (joueur, niveau, horodatage, slots).
/// - `autosave` : layout macroscopique + scalaires + roster complet (owned_ids).
///
/// Lève une `Error` JS (wasm32) ou retourne `Err(String)` (natif) si le fichier
/// est invalide ou la clé ne correspond pas au nom.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub fn parse_save_json(bytes: &[u8], filename: &str) -> Result<String, JsValue> {
    parse_save_impl(bytes, filename).map_err(|e| JsValue::from_str(&e))
}

/// Déchiffre et parse une save IEVR (version native, sans `JsValue`).
#[cfg(not(target_arch = "wasm32"))]
pub fn parse_save_json(bytes: &[u8], filename: &str) -> Result<String, String> {
    parse_save_impl(bytes, filename)
}

// ---------------------------------------------------------------------------
// Machine à états d'écran en navigateur (nie-app : GameState + framebuffer CPU)
// ---------------------------------------------------------------------------

#[cfg(any(target_arch = "wasm32", test))]
fn parse_lines_json(lines_json: &str) -> Result<Vec<String>, String> {
    serde_json::from_str(lines_json).map_err(|error| format!("lines: {error}"))
}

#[cfg(any(target_arch = "wasm32", test))]
const MAX_UPDATE_SECONDS: f32 = 1.0 / 20.0;

#[cfg(any(target_arch = "wasm32", test))]
fn set_match_input(screen: &mut nie_app::flow::Screen, dx: f32, dy: f32, shoot: bool) {
    let finite_or_zero = |axis: f32| if axis.is_finite() { axis } else { 0.0 };
    screen.set_game_input(finite_or_zero(dx), finite_or_zero(dy), shoot);
}

#[cfg(any(target_arch = "wasm32", test))]
fn update_screen(screen: &mut nie_app::flow::Screen, dt: f32) {
    if dt.is_finite() && dt > 0.0 {
        screen.update(dt.min(MAX_UPDATE_SECONDS));
    }
}

#[cfg(any(target_arch = "wasm32", test))]
#[derive(Default)]
struct FrameBuffer {
    pixels: Vec<u8>,
}

#[cfg(any(target_arch = "wasm32", test))]
impl FrameBuffer {
    fn replace(&mut self, pixels: Vec<u8>) {
        self.pixels = pixels;
    }

    fn pointer(&self) -> usize {
        self.pixels.as_ptr() as usize
    }

    fn len(&self) -> usize {
        self.pixels.len()
    }

    #[cfg(test)]
    fn pixels(&self) -> &[u8] {
        &self.pixels
    }
}

#[cfg(any(target_arch = "wasm32", test))]
fn role_name(role: nie_runtime::Role) -> &'static str {
    match role {
        nie_runtime::Role::Goalkeeper => "goalkeeper",
        nie_runtime::Role::Defender => "defender",
        nie_runtime::Role::Midfielder => "midfielder",
        nie_runtime::Role::Forward => "forward",
    }
}

#[cfg(any(target_arch = "wasm32", test))]
fn screen_snapshot(screen: &nie_app::flow::Screen) -> Result<String, String> {
    let value = match screen {
        nie_app::flow::Screen::Title => serde_json::json!({
            "schemaVersion": 1,
            "screen": { "kind": "title" },
        }),
        nie_app::flow::Screen::Menu { sel } => serde_json::json!({
            "schemaVersion": 1,
            "screen": {
                "kind": "menu",
                "selection": sel,
                "renderOwner": "host",
                "nativeSceneRequired": true,
            },
        }),
        nie_app::flow::Screen::ModeSelect { sel } => serde_json::json!({
            "schemaVersion": 1,
            "screen": { "kind": "modeSelect", "selection": sel },
        }),
        nie_app::flow::Screen::Match { world } => {
            let players: Vec<_> = world
                .players
                .iter()
                .enumerate()
                .map(|(index, player)| {
                    serde_json::json!({
                        "index": index,
                        "team": player.team,
                        "role": role_name(player.role),
                        "position": { "x": player.pos.x, "y": player.pos.y },
                        "velocity": { "x": player.vel.x, "y": player.vel.y },
                        "home": { "x": player.home.x, "y": player.home.y },
                    })
                })
                .collect();
            serde_json::json!({
                "schemaVersion": 1,
                "screen": { "kind": "match" },
                "world": {
                    "tick": world.tick,
                    "time": world.time,
                    "score": world.score,
                    "controlledPlayer": world.controlled(),
                    "possessor": world.possessor(),
                    "input": {
                        "direction": { "x": world.input.dir.x, "y": world.input.dir.y },
                        "shoot": world.input.shoot,
                    },
                    "ball": {
                        "position": {
                            "x": world.ball.pos.x,
                            "y": world.ball.pos.y,
                            "z": world.ball.pos.z,
                        },
                        "velocity": {
                            "x": world.ball.vel.x,
                            "y": world.ball.vel.y,
                            "z": world.ball.vel.z,
                        },
                        "gravity": world.ball.gravity,
                    },
                    "players": players,
                },
            })
        }
        nie_app::flow::Screen::Story {
            idx,
            titre,
            repliques,
        } => serde_json::json!({
            "schemaVersion": 1,
            "screen": {
                "kind": "story",
                "index": idx,
                "eventId": titre,
                "lineCount": repliques.len(),
                "awaitingDialogue": repliques.is_empty(),
            },
        }),
        nie_app::flow::Screen::Info { title } => serde_json::json!({
            "schemaVersion": 1,
            "screen": { "kind": "info", "title": title },
        }),
        nie_app::flow::Screen::Liste { titre, lignes, sel } => serde_json::json!({
            "schemaVersion": 1,
            "screen": {
                "kind": "list",
                "title": titre,
                "selection": sel,
                "lineCount": lignes.len(),
            },
        }),
    };

    serde_json::to_string(&value).map_err(|error| format!("state: {error}"))
}

// ---------------------------------------------------------------------------
// Portable camera controller (nie-camera state and interpolation)
// ---------------------------------------------------------------------------

#[cfg(any(target_arch = "wasm32", test))]
#[derive(Default)]
struct CameraTimeline {
    state: nie_camera::CameraState,
    transition: Option<nie_camera::ctrl::InterPolate>,
}

#[cfg(any(target_arch = "wasm32", test))]
impl CameraTimeline {
    fn transition_to(
        &mut self,
        target: nie_camera::CameraState,
        duration: f32,
        fade_code: i32,
    ) -> Result<(), String> {
        validate_camera_state(&target)?;
        if !duration.is_finite() || duration < 0.0 {
            return Err("duration must be a finite non-negative number".to_owned());
        }

        if duration <= f32::EPSILON {
            self.state = target;
            self.transition = None;
        } else {
            self.transition = Some(nie_camera::ctrl::InterPolate::new(
                self.state,
                target,
                duration,
                nie_camera::ctrl::FadeType::from_code(fade_code),
            ));
        }
        Ok(())
    }

    fn step(&mut self, dt: f32) {
        if !dt.is_finite() || dt <= 0.0 {
            return;
        }

        if let Some(mut transition) = self.transition.take() {
            self.state = transition.step(dt);
            if transition.active() {
                self.transition = Some(transition);
            }
        }
    }

    fn active(&self) -> bool {
        self.transition.is_some()
    }

    fn state_json(&self, aspect: f32) -> Result<String, String> {
        if !aspect.is_finite() || aspect <= 0.0 {
            return Err("aspect must be a finite positive number".to_owned());
        }

        validate_camera_state(&self.state)?;

        let (distance, azimuth, altitude) = self.state.orbit();
        let view_matrix = self.state.view_matrix();
        let projection_matrix = self.state.projection_matrix(aspect);
        if ![distance, azimuth, altitude]
            .into_iter()
            .chain(view_matrix.into_iter().flatten())
            .chain(projection_matrix.into_iter().flatten())
            .all(f32::is_finite)
        {
            return Err("camera state produces non-finite derived values".to_owned());
        }
        serde_json::to_string(&serde_json::json!({
            "schemaVersion": 1,
            "active": self.active(),
            "position": self.state.pos,
            "referencePosition": self.state.ref_pos,
            "fovDegrees": self.state.fov_deg,
            "rollDegrees": self.state.roll_deg,
            "nearClip": self.state.near,
            "farClip": self.state.far,
            "orbit": {
                "distance": distance,
                "azimuthRadians": azimuth,
                "altitudeRadians": altitude,
            },
            "viewMatrix": view_matrix,
            "projectionMatrix": projection_matrix,
        }))
        .map_err(|error| format!("camera state: {error}"))
    }
}

#[cfg(any(target_arch = "wasm32", test))]
fn validate_camera_state(state: &nie_camera::CameraState) -> Result<(), String> {
    if state
        .pos
        .iter()
        .chain(state.ref_pos.iter())
        .chain([&state.fov_deg, &state.roll_deg, &state.near, &state.far])
        .any(|value| !value.is_finite())
    {
        return Err("camera values must be finite numbers".to_owned());
    }
    if !(0.0 < state.fov_deg && state.fov_deg < 180.0) {
        return Err("fovDegrees must be between 0 and 180".to_owned());
    }
    if state.near <= 0.0 || state.far <= state.near {
        return Err("clip planes must satisfy 0 < nearClip < farClip".to_owned());
    }

    let delta = [
        f64::from(state.ref_pos[0]) - f64::from(state.pos[0]),
        f64::from(state.ref_pos[1]) - f64::from(state.pos[1]),
        f64::from(state.ref_pos[2]) - f64::from(state.pos[2]),
    ];
    let distance_squared = delta.into_iter().map(|axis| axis * axis).sum::<f64>();
    if !distance_squared.is_finite()
        || distance_squared <= f64::from(f32::EPSILON).powi(2)
        || distance_squared > f64::from(f32::MAX)
    {
        return Err("camera position must define a finite, non-zero view direction".to_owned());
    }
    let horizontal_squared = delta[0] * delta[0] + delta[2] * delta[2];
    if horizontal_squared <= f64::from(f32::EPSILON).powi(2) {
        return Err("camera view direction cannot be parallel to the up axis".to_owned());
    }
    if !state
        .view_matrix()
        .into_iter()
        .flatten()
        .chain(state.projection_matrix(1.0).into_iter().flatten())
        .all(f32::is_finite)
    {
        return Err("camera state produces non-finite matrices".to_owned());
    }
    Ok(())
}

/// Browser camera backed by `nie-camera`'s portable `CameraState` and
/// `CCameraCtrlInterPolate` controller math.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
#[derive(Default)]
pub struct WasmCamera {
    timeline: CameraTimeline,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmCamera {
    /// Creates a camera with the verified `nie-camera` default state.
    #[wasm_bindgen(constructor)]
    pub fn new() -> WasmCamera {
        WasmCamera::default()
    }

    /// Starts a deterministic transition to a complete camera state.
    /// Fade codes mirror `m_FadeType`: 0 linear, 1 ease-in, 2 ease-out, and all
    /// other observed values (including 6) use the controller's smooth curve.
    #[allow(clippy::too_many_arguments)]
    pub fn transition_to(
        &mut self,
        position_x: f32,
        position_y: f32,
        position_z: f32,
        reference_x: f32,
        reference_y: f32,
        reference_z: f32,
        fov_degrees: f32,
        roll_degrees: f32,
        near_clip: f32,
        far_clip: f32,
        duration: f32,
        fade_code: i32,
    ) -> Result<(), JsValue> {
        self.timeline
            .transition_to(
                nie_camera::CameraState {
                    pos: [position_x, position_y, position_z],
                    ref_pos: [reference_x, reference_y, reference_z],
                    fov_deg: fov_degrees,
                    roll_deg: roll_degrees,
                    near: near_clip,
                    far: far_clip,
                },
                duration,
                fade_code,
            )
            .map_err(|error| JsValue::from_str(&error))
    }

    /// Advances the active transition by `dt` seconds. Invalid or non-positive
    /// deltas are ignored so host clock glitches cannot rewind the controller.
    pub fn step(&mut self, dt: f32) {
        self.timeline.step(dt);
    }

    /// Whether a transition still has time remaining.
    #[wasm_bindgen(getter)]
    pub fn active(&self) -> bool {
        self.timeline.active()
    }

    /// Serializes camera state, orbit values, and row-major view/projection matrices.
    pub fn state_json(&self, aspect: f32) -> Result<String, JsValue> {
        self.timeline
            .state_json(aspect)
            .map_err(|error| JsValue::from_str(&error))
    }
}

/// Thin bitmap-text ABI over the shared native font decoder.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmBitmapFont {
    font: nie_formats::bitmap_font::BitmapFont,
    width: u32,
    height: u32,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmBitmapFont {
    #[wasm_bindgen(constructor)]
    pub fn new(config: &[u8], texture: &[u8]) -> Result<WasmBitmapFont, JsValue> {
        Ok(Self {
            font: nie_formats::bitmap_font::BitmapFont::from_bytes(config, texture)
                .map_err(|e| JsValue::from_str(&e))?,
            width: 0,
            height: 0,
        })
    }

    /// Color is packed RGBA, independent of host endianness.
    pub fn render(&mut self, text: &str, color: u32) -> Result<Vec<u8>, JsValue> {
        let frame = self
            .font
            .render(text, color.to_be_bytes())
            .map_err(|e| JsValue::from_str(&e))?;
        self.width = frame.width;
        self.height = frame.height;
        Ok(frame.rgba)
    }

    #[wasm_bindgen(getter)]
    pub fn width(&self) -> u32 {
        self.width
    }

    #[wasm_bindgen(getter)]
    pub fn height(&self) -> u32 {
        self.height
    }
}

/// Machine à états d'écran interactive, rendue en WebAssembly.
///
/// Écran-titre → menu → match simulé (`nie-runtime` : physique, 22 joueurs, ballon, buts) → mode
/// histoire, pilotée au clavier, rendue dans un framebuffer RGBA8 `W*H*4` que JS peint.
///
/// ⚠ **Ce n'est pas le jeu.** This binding exposes a local 2D simulation, not the native IEVR
/// renderer. Main-menu pixels are intentionally host-owned while the native `nie-lua` path
/// reconstructs script state. This framebuffer stays transparent on that screen instead of
/// drawing an invented substitute or naming a capture as a runtime asset.
#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
pub struct WasmGame {
    font: nie_app::Font,
    screen: nie_app::flow::Screen,
    frame: FrameBuffer,
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen]
impl WasmGame {
    /// Construit le jeu depuis les octets de la police (`font.cfg.bin` + `font.g4tx`, fetchés par JS).
    /// Démarre sur l'écran-titre.
    #[wasm_bindgen(constructor)]
    pub fn new(font_cfg: &[u8], font_g4tx: &[u8]) -> Result<WasmGame, JsValue> {
        let font = nie_app::Font::from_bytes(font_cfg, font_g4tx)
            .map_err(|e| JsValue::from_str(&format!("font: {e}")))?;
        Ok(WasmGame {
            font,
            screen: nie_app::flow::Screen::new(),
            frame: FrameBuffer::default(),
        })
    }

    /// Largeur du framebuffer (px).
    #[wasm_bindgen(getter)]
    pub fn width(&self) -> usize {
        nie_app::W
    }

    /// Hauteur du framebuffer (px).
    #[wasm_bindgen(getter)]
    pub fn height(&self) -> usize {
        nie_app::H
    }

    /// Commande de menu IEVR (CMD_FCS_*, CMD_ENTER, CMD_BACK…). Le mapping clavier/souris/manette
    /// → commande vit côté front ; la FSM (transitions) vit dans `nie_app::flow` (dédup Phase 5).
    pub fn input(&mut self, cmd: &str) {
        self.screen.input(cmd);
    }

    /// Sets the held directional/shoot input consumed by the live `nie-runtime` match world.
    /// The call is deliberately harmless outside a match, matching `nie_app::flow::Screen`.
    pub fn set_match_input(&mut self, dx: f32, dy: f32, shoot: bool) {
        set_match_input(&mut self.screen, dx, dy, shoot);
    }

    /// Avance le temps de `dt` s : la physique du match tourne quand un match est en cours.
    pub fn update(&mut self, dt: f32) {
        update_screen(&mut self.screen, dt);
    }

    /// Score du match en cours `[domicile, extérieur]` (zéros hors match).
    pub fn score(&self) -> Vec<u32> {
        self.screen.score()
    }

    /// Index of the home player controlled by the browser, or `undefined` outside a match.
    pub fn controlled_player(&self) -> Option<u32> {
        self.screen
            .controlled_player()
            .and_then(|index| u32::try_from(index).ok())
    }

    /// Title of a data-backed screen whose rows the browser may now provide.
    pub fn info_title(&self) -> Option<String> {
        self.screen.info_title().map(str::to_owned)
    }

    /// Whether story mode is waiting for dialogue rows fetched by the browser VFS client.
    #[wasm_bindgen(getter)]
    pub fn awaiting_dialogue(&self) -> bool {
        self.screen.attend_dialogue()
    }

    /// Replaces the current information screen with real, already-resolved VFS rows.
    /// `lines_json` must be a JSON array of strings.
    pub fn provide_list(&mut self, lines_json: &str) -> Result<(), JsValue> {
        let lines = parse_lines_json(lines_json).map_err(|error| JsValue::from_str(&error))?;
        self.screen.fournir_liste(lines);
        Ok(())
    }

    /// Supplies real story dialogue resolved by the browser VFS client.
    /// `lines_json` must be a JSON array of strings.
    pub fn provide_dialogue(&mut self, event_id: &str, lines_json: &str) -> Result<(), JsValue> {
        let lines = parse_lines_json(lines_json).map_err(|error| JsValue::from_str(&error))?;
        self.screen.fournir_dialogue(event_id.to_owned(), lines);
        Ok(())
    }

    /// Serializes the complete portable screen state for browser renderers and diagnostics.
    /// Match snapshots contain the live ball, all 22 players, input, clock, score and ownership.
    pub fn state_json(&self) -> Result<String, JsValue> {
        screen_snapshot(&self.screen).map_err(|error| JsValue::from_str(&error))
    }

    /// `true` si un match est en cours (pour l'overlay de score côté UI).
    #[wasm_bindgen(getter)]
    pub fn in_match(&self) -> bool {
        self.screen.in_match()
    }

    /// `true` when the current screen must be drawn from the verified host-side menu source.
    ///
    /// The Rust framebuffer is transparent in this state so the obsolete vertical placeholder
    /// can never be exposed as the native main menu.
    #[wasm_bindgen(getter)]
    pub fn requires_host_surface(&self) -> bool {
        self.screen.requires_host_surface()
    }

    /// Rend l'écran courant en framebuffer RGBA8 `W*H*4`.
    pub fn render(&self) -> Vec<u8> {
        self.screen.render(&self.font)
    }

    /// Renders into Rust-owned WebAssembly memory without copying pixels into a JS array.
    /// Call [`WasmGame::frame_ptr`] and [`WasmGame::frame_len`] immediately afterwards.
    pub fn render_frame(&mut self) {
        self.frame.replace(self.screen.render(&self.font));
    }

    /// Byte offset of the latest shared RGBA8 frame in `WebAssembly.Memory`.
    /// The offset is invalidated by the next call to [`WasmGame::render_frame`].
    pub fn frame_ptr(&self) -> usize {
        self.frame.pointer()
    }

    /// Byte length of the latest shared RGBA8 frame.
    pub fn frame_len(&self) -> usize {
        self.frame.len()
    }
}

// ---------------------------------------------------------------------------
// Tests natifs
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn menu_runtime_scene_matches_native_compiler_without_losing_layer_state() {
        let mut state = nie_lua::MenuState::default();
        let object = state.layer(10).obj(20);
        object.visible = false;
        object.active = false;
        object.scale = Some(1.25);
        object.sprite_cell_id = Some(7);
        object.use_save_button = Some(true);
        object.native_field_0x124_by_index.insert(3, 99);
        object.sub_item(0).params.insert(15, 25);
        state.layer(11).obj(20).text = Some("Separate layer".into());
        state.groups.insert(30, false);
        let expected = nie_lua::menu_scene::MenuScene::from_state(&state);
        let input = serde_json::to_string(&state).unwrap();
        let output = menu_runtime_scene_json(&input).unwrap();
        let actual: nie_lua::menu_scene::MenuScene = serde_json::from_str(&output).unwrap();
        assert_eq!(actual, expected);
        assert_eq!(actual.layers.len(), 2);
        assert_eq!(
            actual.layers[&10].objects[&20].sub_items[&0].params[&15],
            25
        );
        assert!(actual.layers[&11].objects[&20].visible);
        assert_eq!(serde_json::to_string(&expected).unwrap(), output);
    }

    #[test]
    fn menu_runtime_scene_rejects_missing_or_invalid_observed_state() {
        assert!(menu_runtime_scene_json("{}").is_err());
        assert!(menu_runtime_scene_json("null").is_err());
        assert!(menu_runtime_scene_json("invalid").is_err());
    }

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
        assert_eq!(
            detect_format(b"CRILAYLA\x00\x00\x00\x00\x00\x00\x00\x00"),
            "CRILAYLA"
        );
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
    fn menu_static_layer_json_rejects_invalid_objbin_before_composition() {
        let error = menu_static_layer_json(b"invalid", b"invalid", b"invalid", "layer.g4tx")
            .expect_err("invalid OBJBIN must never yield a static layer");
        assert!(error.contains("objbin"));
    }

    #[test]
    fn menu_static_layer_json_rejects_each_invalid_asset_kind() {
        let objbin = synthetic_menu_objbin();
        let g4pkm = synthetic_menu_g4pkm();
        let g4tx = synthetic_menu_g4tx();

        let g4pkm_error = menu_static_layer_json(&objbin, b"invalid", &g4tx, "layer.g4tx")
            .expect_err("invalid G4PKM must never yield a static layer");
        assert!(
            !g4pkm_error.is_empty(),
            "the G4PKM parser must return a diagnostic"
        );

        let g4tx_error = menu_static_layer_json(&objbin, &g4pkm, b"invalid", "layer.g4tx")
            .expect_err("invalid G4TX must never yield a static layer");
        assert!(
            !g4tx_error.is_empty(),
            "the G4TX parser must return a diagnostic"
        );
    }

    #[test]
    fn menu_static_layer_json_composes_a_synthetic_level5_layer() {
        let json: serde_json::Value = serde_json::from_str(
            &menu_static_layer_json(
                &synthetic_menu_objbin(),
                &synthetic_menu_g4pkm(),
                &synthetic_menu_g4tx(),
                "data/dx11/menu/layer.g4tx",
            )
            .expect("synthetic Level-5 layer should compose"),
        )
        .expect("static layer contract must be JSON");

        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["name"], "synthetic_layer");
        assert_eq!(json["g4txPath"], "data/dx11/menu/layer.g4tx");
        assert_eq!(json["texture"]["name"], "layer");
        assert_eq!(json["texture"]["width"], 4);
        assert_eq!(json["texture"]["height"], 2);
        assert_eq!(json["drawPriority"], 300);
        assert_eq!(json["drawType"], 1);
        assert_eq!(json["transform"]["x"], 640.0);
        assert_eq!(json["transform"]["y"], 360.0);
        assert!((json["transform"]["scaleX"].as_f64().unwrap() - 4.0 / 6.0).abs() < 1e-6);
        assert!((json["transform"]["scaleY"].as_f64().unwrap() - 2.0 / 3.0).abs() < 1e-6);
        assert_eq!(json["anchor"], serde_json::json!({ "x": 0.5, "y": 0.5 }));
    }

    /// Builds a minimal valid OBJBIN with one render component. The test owns the raw format
    /// fixture so the WebAssembly boundary is exercised rather than bypassed with `MenuObject`.
    fn synthetic_menu_objbin() -> Vec<u8> {
        #[derive(Clone, Copy)]
        enum Value<'a> {
            Text(&'a str),
            Integer(i32),
        }

        fn append_entry(
            bytes: &mut Vec<u8>,
            crc: u32,
            values: &[Value<'_>],
            offsets: &[(&str, i32)],
        ) {
            bytes.extend_from_slice(&crc.to_le_bytes());
            bytes.push(u8::try_from(values.len()).expect("test fixture parameter count"));
            let mut type_byte = 0u8;
            for (index, value) in values.iter().enumerate() {
                if matches!(value, Value::Integer(_)) {
                    type_byte |= 1 << (index * 2);
                }
            }
            bytes.push(type_byte);
            while !bytes.len().is_multiple_of(4) {
                bytes.push(0);
            }
            for value in values {
                let raw = match value {
                    Value::Text(value) => offsets
                        .iter()
                        .find_map(|(text, offset)| (*text == *value).then_some(*offset))
                        .expect("string offset for synthetic OBJBIN"),
                    Value::Integer(value) => *value,
                };
                bytes.extend_from_slice(&raw.to_le_bytes());
            }
        }

        let strings = [
            "synthetic_layer",
            "gmdMenuObj",
            "SkeletonAnime",
            "data/dx11/menu/layer.g4pkm",
            "Texture",
            "data/dx11/menu/layer.g4tx",
            "CMenuRenderComponent",
            "m_drawPriority",
            "m_drawType",
        ];
        let mut string_table = Vec::new();
        let offsets: Vec<_> = strings
            .iter()
            .map(|text| {
                let offset = i32::try_from(string_table.len()).expect("small test string table");
                string_table.extend_from_slice(text.as_bytes());
                string_table.push(0);
                (*text, offset)
            })
            .collect();
        let crc = nie_formats::cfgbin::crc32;
        let mut entries = Vec::new();
        append_entry(
            &mut entries,
            crc(b"OBJ_BGN"),
            &[Value::Text("synthetic_layer")],
            &offsets,
        );
        append_entry(
            &mut entries,
            crc(b"SETUP_BGN"),
            &[Value::Text("gmdMenuObj")],
            &offsets,
        );
        append_entry(
            &mut entries,
            crc(b"SETUP_PARAM"),
            &[
                Value::Text("SkeletonAnime"),
                Value::Text("data/dx11/menu/layer.g4pkm"),
            ],
            &offsets,
        );
        append_entry(
            &mut entries,
            crc(b"SETUP_PARAM"),
            &[
                Value::Text("Texture"),
                Value::Text("data/dx11/menu/layer.g4tx"),
            ],
            &offsets,
        );
        append_entry(&mut entries, crc(b"SETUP_END"), &[], &offsets);
        append_entry(
            &mut entries,
            crc(b"PROP_INFO_BGN"),
            &[Value::Text("CMenuRenderComponent")],
            &offsets,
        );
        append_entry(
            &mut entries,
            crc(b"PROP_PARAM"),
            &[Value::Text("m_drawPriority"), Value::Integer(300)],
            &offsets,
        );
        append_entry(
            &mut entries,
            crc(b"PROP_PARAM"),
            &[Value::Text("m_drawType"), Value::Integer(1)],
            &offsets,
        );
        append_entry(&mut entries, crc(b"PROP_INFO_END"), &[], &offsets);
        append_entry(&mut entries, crc(b"OBJ_END"), &[], &offsets);

        let string_table_offset = 16 + entries.len();
        let mut bytes = Vec::with_capacity(string_table_offset + string_table.len() + 4);
        bytes.extend_from_slice(&10_i32.to_le_bytes());
        bytes.extend_from_slice(&(string_table_offset as i32).to_le_bytes());
        bytes.extend_from_slice(&(string_table.len() as i32).to_le_bytes());
        bytes.extend_from_slice(&0_i32.to_le_bytes());
        bytes.extend_from_slice(&entries);
        bytes.extend_from_slice(&string_table);
        // cfg.bin trailer required by `objbin::is_objb`; it is outside the declared string table.
        bytes.extend_from_slice(&[0x01, b't', b'2', b'b']);
        bytes
    }

    /// Builds a single-bone G4SK wrapped in a minimal G4PKM container.
    fn synthetic_menu_g4pkm() -> Vec<u8> {
        const HEADER_SIZE: usize = 0x40;
        const G4SK_OFFSET: usize = 0x50;
        let mut g4sk = vec![0u8; 0x80];
        g4sk[..4].copy_from_slice(b"G4SK");
        g4sk[0x20..0x22].copy_from_slice(&1_u16.to_le_bytes());
        // Parent table at 0x70; name table at 0x74, both addressed from 0x40 in dwords.
        g4sk[0x2a..0x2c].copy_from_slice(&12_u16.to_le_bytes());
        g4sk[0x32..0x34].copy_from_slice(&13_u16.to_le_bytes());
        g4sk[0x40..0x44].copy_from_slice(&4_f32.to_le_bytes());
        g4sk[0x54..0x58].copy_from_slice(&2_f32.to_le_bytes());
        g4sk[0x70..0x72].copy_from_slice(&(-1_i16).to_le_bytes());
        g4sk[0x74..0x76].copy_from_slice(&2_u16.to_le_bytes());
        g4sk[0x76..0x7b].copy_from_slice(b"root\0");

        let mut container = vec![0u8; G4SK_OFFSET + g4sk.len()];
        container[..4].copy_from_slice(b"G4PK");
        container[4..6].copy_from_slice(&(HEADER_SIZE as u16).to_le_bytes());
        container[0x20..0x24].copy_from_slice(&1_i32.to_le_bytes());
        container[HEADER_SIZE..HEADER_SIZE + 4]
            .copy_from_slice(&((G4SK_OFFSET - HEADER_SIZE) as i32 / 4).to_le_bytes());
        container[HEADER_SIZE + 4..HEADER_SIZE + 8]
            .copy_from_slice(&(g4sk.len() as i32).to_le_bytes());
        container[G4SK_OFFSET..].copy_from_slice(&g4sk);
        container
    }

    /// Uses the public encoder so the fixture drives the real G4TX/DDS selection path.
    fn synthetic_menu_g4tx() -> Vec<u8> {
        let rgba = [255_u8, 0, 0, 255].repeat(8);
        let dds = nie_formats::g4tx_encode::encode_dds_bgra8(4, 2, &rgba)
            .expect("valid synthetic BGRA DDS");
        nie_formats::g4tx_encode::encode_g4tx_single_texture("layer", 1, 4, 2, &dds)
    }

    #[test]
    fn vfs_content_summary_uses_shared_explorer_dispatch() {
        let json: serde_json::Value =
            serde_json::from_str(&vfs_content_summary("data/sound/voice.awb", b"AFS2"))
                .expect("VFS summary should be valid JSON");

        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["path"], "data/sound/voice.awb");
        assert_eq!(json["recognized"], true);
        assert_eq!(
            json["lines"][0],
            "format      AWB/AFS2 (banque audio Criware)"
        );
    }

    #[test]
    fn vfs_content_summary_has_an_explicit_unknown_result() {
        let json: serde_json::Value =
            serde_json::from_str(&vfs_content_summary("data/unknown.bin", b"unknown"))
                .expect("unknown VFS summary should still be valid JSON");

        assert_eq!(json["recognized"], false);
        assert_eq!(json["lines"], serde_json::json!([]));
    }

    #[test]
    fn binary_triage_json_exposes_bounded_shared_report() {
        let bytes = b"not an executable but contains BROWSER_STRING";
        let json: serde_json::Value = serde_json::from_str(
            &binary_triage_json(bytes, u32::MAX).expect("unknown bytes should still triage"),
        )
        .expect("triage report should be valid JSON");

        assert_eq!(json["format"], "unknown");
        assert_eq!(json["size"], bytes.len());
        assert_eq!(json["sha256"].as_str().map(str::len), Some(64));
        assert!(
            json["strings_sample"]
                .as_array()
                .is_some_and(|rows| rows.len() <= 256)
        );
    }

    #[test]
    fn assemble_x64_uses_msvc_encoding_and_rejects_unbounded_input() {
        assert_eq!(
            assemble_x64("mov al, 1 ; ret", 0x1400_0000).expect("valid assembly should encode"),
            [0xB0, 0x01, 0xC3]
        );
        assert!(assemble_x64("not_an_instruction", 0).is_err());
        assert!(assemble_x64(&" ".repeat(MAX_ASSEMBLY_SOURCE_BYTES + 1), 0).is_err());
    }

    #[test]
    fn pe_byte_diff_json_uses_bounded_forge_report() {
        let json: serde_json::Value =
            serde_json::from_str(&pe_byte_diff_json(&[1, 2, 3, 4, 5], &[1, 9, 8, 4], 1))
                .expect("PE diff should serialize");
        assert_eq!(json["bytesDiffering"], 3);
        assert_eq!(json["identical"], false);
        assert_eq!(
            json["ranges"],
            serde_json::json!([{ "offset": 1, "length": 2 }])
        );
    }

    #[test]
    fn forge_lift_x64_json_exposes_byte_exact_source_and_blockers() {
        let json: serde_json::Value = serde_json::from_str(
            &forge_lift_x64_json(&[0xB0, 0x01, 0xC3], 0x1_4004_d750)
                .expect("supported body should lift"),
        )
        .expect("lift report should be valid JSON");
        assert_eq!(json["byteLength"], 3);
        assert_eq!(json["instructionCount"], 2);
        assert_eq!(json["source"], "mov al, 0x1 ; ret");

        let blocker = forge_lift_x64_json(&[0x66, 0x0F, 0x38, 0xDC, 0xC1, 0xC3], 0x1_4000_0000)
            .expect_err("unsupported dialect instruction should be reported");
        let blocker: serde_json::Value =
            serde_json::from_str(&blocker).expect("blocker should be structured JSON");
        assert_eq!(blocker["cause"], "aesenc");
    }

    #[test]
    fn minidump_summary_json_rejects_untrusted_non_dump_bytes() {
        let error = minidump_summary_json(b"not a dump")
            .expect_err("non-minidump bytes must not produce metadata");
        assert!(error.contains("minidump") || error.contains("MDMP"));
    }

    #[test]
    fn ievr_pe_inspect_json_returns_a_bounded_detailed_report() {
        let pe_offset = 0x80usize;
        let optional_header_size = 240usize;
        let headers_size = 0x200usize;
        let mut bytes = vec![0u8; headers_size + 0x200];
        bytes[0..2].copy_from_slice(b"MZ");
        bytes[0x3c..0x40].copy_from_slice(&(pe_offset as u32).to_le_bytes());
        bytes[pe_offset..pe_offset + 4].copy_from_slice(b"PE\0\0");
        let coff = pe_offset + 4;
        bytes[coff..coff + 2].copy_from_slice(&0x8664u16.to_le_bytes());
        bytes[coff + 2..coff + 4].copy_from_slice(&1u16.to_le_bytes());
        bytes[coff + 16..coff + 18].copy_from_slice(&(optional_header_size as u16).to_le_bytes());
        let optional = coff + 20;
        bytes[optional..optional + 2].copy_from_slice(&0x020bu16.to_le_bytes());
        bytes[optional + 24..optional + 32].copy_from_slice(&0x1_4000_0000u64.to_le_bytes());
        bytes[optional + 32..optional + 36].copy_from_slice(&0x1000u32.to_le_bytes());
        bytes[optional + 36..optional + 40].copy_from_slice(&0x200u32.to_le_bytes());
        bytes[optional + 60..optional + 64].copy_from_slice(&(headers_size as u32).to_le_bytes());
        bytes[optional + 68..optional + 70].copy_from_slice(&2u16.to_le_bytes());
        bytes[optional + 108..optional + 112].copy_from_slice(&16u32.to_le_bytes());
        let section = optional + optional_header_size;
        bytes[section..section + 5].copy_from_slice(b".text");
        bytes[section + 8..section + 12].copy_from_slice(&0x180u32.to_le_bytes());
        bytes[section + 12..section + 16].copy_from_slice(&0x1000u32.to_le_bytes());
        bytes[section + 16..section + 20].copy_from_slice(&0x200u32.to_le_bytes());
        bytes[section + 20..section + 24].copy_from_slice(&(headers_size as u32).to_le_bytes());
        bytes[section + 36..section + 40].copy_from_slice(&0x6000_0020u32.to_le_bytes());

        let json: serde_json::Value = serde_json::from_str(
            &ievr_pe_inspect_json(&bytes).expect("synthetic PE should inspect"),
        )
        .expect("PE report should be valid JSON");
        assert_eq!(json["machine"], "AMD64");
        assert_eq!(json["is64Bit"], true);
        assert_eq!(json["sections"][0]["name"], ".text");
    }

    #[test]
    fn pdata_inspect_json_rejects_a_pe_without_pdata() {
        let error = pdata_inspect_json(b"not a PE", 16)
            .expect_err("invalid PE bytes must not produce roots");
        assert!(error.contains("PE") || error.contains("goblin"));
    }

    #[test]
    fn aob_scan_json_reports_overlapping_hits_and_truncation() {
        let json: serde_json::Value = serde_json::from_str(
            &aob_scan_json("AA ??", &[0xAA, 1, 0xAA, 2, 0xAA, 3], 2)
                .expect("bounded AOB scan should succeed"),
        )
        .expect("AOB report should be valid JSON");
        assert_eq!(json["patternBytes"], 2);
        assert_eq!(json["offsets"], serde_json::json!([0, 2]));
        assert_eq!(json["truncated"], true);
    }

    #[test]
    fn crc32_benchmark_sample_json_uses_the_shared_bounded_generator() {
        let json: serde_json::Value = serde_json::from_str(
            &crc32_benchmark_sample_json(64).expect("small benchmark sample should succeed"),
        )
        .expect("benchmark sample should be valid JSON");
        assert_eq!(json["byteLength"], 64);
        assert_eq!(json["seedHex"], "0x2545f4914f6cdd1d");
        assert_eq!(json["checksumHex"].as_str().map(str::len), Some(10));
        assert!(crc32_benchmark_sample_json(u32::MAX).is_err());
    }

    #[test]
    fn offline_image_inspect_json_preserves_full_width_addresses() {
        let json: serde_json::Value = serde_json::from_str(
            &offline_image_inspect_json(
                &[0, 1, 2, 3, 4, 5, 6, 7],
                r#"{"imageBase":"0x140000000","ranges":[{"space":"va","address":"0x140000002","length":3}]}"#,
            )
            .expect("bounded offline range should inspect"),
        )
        .expect("offline image report should be valid JSON");
        assert_eq!(json["imageBase"], "0x140000000");
        assert_eq!(json["ranges"][0]["fileOffset"], "0x2");
        assert_eq!(json["ranges"][0]["va"], "0x140000002");
        assert_eq!(json["ranges"][0]["hex"], "020304");
    }

    #[test]
    fn knowledge_search_json_keeps_vfs_and_executable_stems_exact() {
        let entries = serde_json::json!([
            {
                "address": "0x140001000",
                "name": "funcLuaMenuCommand",
                "subsystem": "mainmenu01",
                "role": "dispatch G4TX",
                "anchors": ["data/dx11/menu/mainmenu01.g4tx"],
                "confidence": 1.0
            },
            {
                "address": "0xffffffffffffffff",
                "name": "other",
                "subsystem": "unrelated",
                "role": null,
                "anchors": [],
                "confidence": 0.5
            }
        ]);
        let json: serde_json::Value = serde_json::from_str(
            &knowledge_search_json(&entries.to_string(), "mainmenu01 G4TX", 8)
                .expect("bounded knowledge search should succeed"),
        )
        .expect("knowledge search should be valid JSON");
        assert_eq!(json["totalMatches"], 1);
        assert_eq!(json["hits"][0]["entry"]["name"], "funcLuaMenuCommand");
        assert_eq!(json["hits"][0]["entry"]["address"], "0x140001000");
    }

    #[test]
    fn headless_inspect_json_uses_the_extracted_canonical_detector() {
        let mut rdbn = vec![0_u8; 0x50];
        rdbn[0..4].copy_from_slice(b"RDBN");
        rdbn[4..6].copy_from_slice(&0x50_i16.to_le_bytes());
        rdbn[6..10].copy_from_slice(&100_i32.to_le_bytes());
        rdbn[10..12].copy_from_slice(&0x14_i16.to_le_bytes());
        let json: serde_json::Value = serde_json::from_str(
            &headless_inspect_json(&rdbn).expect("minimal cfg.bin should inspect"),
        )
        .expect("headless inspection should be valid JSON");
        assert_eq!(json["format"], "cfg.bin");
        assert_eq!(json["byteLength"], 0x50);
        assert_eq!(json["detail"]["typeCount"], 0);
    }

    #[test]
    fn editor_add_object_json_reuses_the_validated_editor_session() {
        let project = r#"{"version":1,"objects":[]}"#;
        let object = serde_json::json!({
            "name": "mainmenu01-preview",
            "asset": "data/common/gamedata/menu/obj/mainmenu01_00_background.glb",
            "position": [0.0, 0.0, 0.0],
            "yaw": 0.0,
            "scale": [1.0, 1.0, 1.0],
            "visible": true
        });
        let json: serde_json::Value = serde_json::from_str(
            &editor_add_object_json(project, &object.to_string())
                .expect("valid object should be added"),
        )
        .expect("edited project should be valid JSON");
        assert_eq!(json["version"], 1);
        assert_eq!(json["objects"][0]["name"], "mainmenu01-preview");
        assert_eq!(
            json["objects"][0]["asset"],
            "data/common/gamedata/menu/obj/mainmenu01_00_background.glb"
        );
    }

    #[test]
    fn chara_model_catalog_json_decodes_the_shared_t2b_catalog() {
        use nie_formats::cfgbin::{CfgEntry, Value};

        let body = CfgEntry {
            name: "CHARA_BODY_INFO".to_owned(),
            variables: vec![
                Value::Int(7),
                Value::String("_common/c000101/c000101.objbin".to_owned()),
                Value::Int(0),
                Value::Int(8),
                Value::Int(1),
                Value::Int(0),
                Value::Int(2),
            ],
            children: Vec::new(),
        };
        let entries = [CfgEntry {
            name: "CHARA_BODY_INFO_LIST_BEG".to_owned(),
            variables: vec![Value::Int(1)],
            children: vec![body],
        }];
        let encoded = nie_formats::cfgbin::encode_t2b(&entries);
        let json: serde_json::Value = serde_json::from_str(
            &chara_model_catalog_json(&encoded, "chara_model_0.07.22.cfg.bin")
                .expect("bounded model catalog should decode"),
        )
        .expect("model catalog should be valid JSON");
        assert_eq!(json["source"], "chara_model_0.07.22.cfg.bin");
        assert_eq!(json["bodies"]["7"]["type_idx"], 1);
        assert_eq!(
            json["bodies"]["7"]["objbin"],
            "_common/c000101/c000101.objbin"
        );
    }

    #[test]
    fn zukan_rank_json_uses_the_shared_stable_matcher() {
        let entry = serde_json::json!({
            "name": "Mark",
            "position": "GK",
            "element": "Wind",
            "game": "Inazuma Eleven",
        });
        let candidates = serde_json::json!([
            {
                "id": "later",
                "nameEn": "Mark",
                "position": "GK",
                "element": "Wind",
                "rarityLabel": "Normal",
                "series": "Inazuma Eleven 2",
            },
            {
                "id": "best",
                "nameEn": "Mark",
                "position": "GK",
                "element": "Wind",
                "rarityLabel": "Normal",
                "series": "Inazuma Eleven",
            },
        ]);
        let json: serde_json::Value = serde_json::from_str(
            &zukan_rank_json(&entry.to_string(), &candidates.to_string(), 2)
                .expect("matching input should rank"),
        )
        .expect("ranking should be valid JSON");
        assert_eq!(json["results"][0]["candidateId"], "best");
        assert_eq!(json["results"][1]["candidateId"], "later");
    }

    #[test]
    fn format_catalog_validate_json_reuses_the_bounded_seed_parser() {
        let source = serde_json::json!({
            "schema_version": 1,
            "generator": "iecode",
            "game": "Inazuma Eleven: Victory Road",
            "format_count": 1,
            "formats": [{
                "name": "G4TX",
                "extensions": ["g4tx"],
                "magic": "G4TX",
                "header_size": 96,
                "fields": [{"offset": 0, "size": 4, "type": "magic", "name": "Magic"}],
            }],
        });
        let json: serde_json::Value = serde_json::from_str(
            &format_catalog_validate_json(source.to_string().as_bytes())
                .expect("bounded catalog should validate"),
        )
        .expect("catalog should serialize as JSON");
        assert_eq!(json["schema_version"], 1);
        assert_eq!(json["formats"][0]["name"], "G4TX");
        assert_eq!(json["formats"][0]["fields"][0]["type"], "magic");
    }

    #[test]
    fn steam_select_depots_json_uses_portable_platform_policy() {
        let depots = serde_json::json!([
            {
                "depotId": 100,
                "hasContent": true,
                "operatingSystems": ["windows"],
                "architecture": "64",
                "language": "english",
                "hasManifestSection": true,
            },
            {
                "depotId": 200,
                "hasContent": true,
                "operatingSystems": ["linux"],
                "architecture": "64",
                "language": "english",
                "hasManifestSection": true,
            },
        ]);
        let selection = serde_json::json!({
            "explicitDepots": [],
            "allPlatforms": false,
            "operatingSystem": "windows",
            "architecture": "64",
            "language": "english",
        });
        let json: serde_json::Value = serde_json::from_str(
            &steam_select_depots_json(&depots.to_string(), &selection.to_string())
                .expect("portable depot selection should succeed"),
        )
        .expect("depot selection should be valid JSON");
        assert_eq!(json["depotIds"], serde_json::json!([100]));
    }

    #[test]
    fn init_panic_hook_ne_panique_pas() {
        // En natif, le hook est une no-op wasm ; la fonction ne doit pas paniquer.
        init_panic_hook();
    }

    #[test]
    fn camera_snapshot_exposes_verified_state_orbit_and_matrices() {
        let camera = CameraTimeline::default();
        let json: serde_json::Value = serde_json::from_str(
            &camera
                .state_json(16.0 / 9.0)
                .expect("default camera should serialize"),
        )
        .expect("camera state should be valid JSON");

        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["active"], false);
        assert_eq!(json["position"], serde_json::json!([0.0, 2.5, 10.0]));
        assert_eq!(
            json["referencePosition"],
            serde_json::json!([0.0, 0.0, 0.0])
        );
        assert_eq!(json["fovDegrees"], 45.0);
        assert_eq!(json["orbit"]["distance"], camera.state.length());
        let assert_matrix = |actual: &serde_json::Value, expected: [[f32; 4]; 4]| {
            let rows = actual.as_array().expect("matrix should be an array");
            assert_eq!(rows.len(), 4);
            for (actual_row, expected_row) in rows.iter().zip(expected) {
                let values = actual_row
                    .as_array()
                    .expect("matrix row should be an array");
                assert_eq!(values.len(), 4);
                for (actual_value, expected_value) in values.iter().zip(expected_row) {
                    let difference = (actual_value
                        .as_f64()
                        .expect("matrix value should be numeric")
                        - f64::from(expected_value))
                    .abs();
                    assert!(difference < 1e-6, "matrix value differs by {difference}");
                }
            }
        };
        assert_matrix(&json["viewMatrix"], camera.state.view_matrix());
        assert_matrix(
            &json["projectionMatrix"],
            camera.state.projection_matrix(16.0 / 9.0),
        );
        assert!(camera.state_json(0.0).is_err());
        assert!(camera.state_json(f32::NAN).is_err());
    }

    #[test]
    fn camera_timeline_uses_deterministic_linear_controller_steps() {
        let mut camera = CameraTimeline::default();
        let target = nie_camera::CameraState {
            pos: [8.0, 6.0, 2.0],
            ref_pos: [4.0, 2.0, 0.0],
            fov_deg: 65.0,
            roll_deg: 20.0,
            near: 0.2,
            far: 800.0,
        };
        camera
            .transition_to(target, 2.0, 0)
            .expect("valid transition should start");

        camera.step(f32::NAN);
        camera.step(-1.0);
        assert_eq!(camera.state, nie_camera::CameraState::default());
        assert!(camera.active());

        camera.step(0.5);
        assert_eq!(camera.state.pos, [2.0, 3.375, 8.0]);
        assert_eq!(camera.state.ref_pos, [1.0, 0.5, 0.0]);
        assert_eq!(camera.state.fov_deg, 50.0);
        assert_eq!(camera.state.roll_deg, 5.0);
        assert!(camera.active());

        camera.step(1.5);
        assert_eq!(camera.state, target);
        assert!(!camera.active());
        camera.step(1.0);
        assert_eq!(camera.state, target);
    }

    #[test]
    fn camera_timeline_maps_observed_fade_and_rejects_invalid_states() {
        let mut camera = CameraTimeline::default();
        let target = nie_camera::CameraState {
            pos: [10.0, 2.5, 10.0],
            ..nie_camera::CameraState::default()
        };
        camera
            .transition_to(target, 4.0, 6)
            .expect("observed fade code should start");
        camera.step(1.0);
        assert_eq!(camera.state.pos[0], 1.5625);

        camera
            .transition_to(target, 0.0, 0)
            .expect("zero duration should snap");
        assert_eq!(camera.state, target);
        assert!(!camera.active());

        let invalid_fov = nie_camera::CameraState {
            fov_deg: 180.0,
            ..target
        };
        assert!(camera.transition_to(invalid_fov, 1.0, 0).is_err());
        let invalid_clip = nie_camera::CameraState {
            near: 2.0,
            far: 1.0,
            ..target
        };
        assert!(camera.transition_to(invalid_clip, 1.0, 0).is_err());
        let coincident = nie_camera::CameraState {
            ref_pos: target.pos,
            ..target
        };
        assert!(camera.transition_to(coincident, 1.0, 0).is_err());
        let overflow = nie_camera::CameraState {
            pos: [3.0e38, 3.0e38, 3.0e38],
            ..target
        };
        assert!(camera.transition_to(overflow, 1.0, 0).is_err());
        let vertical = nie_camera::CameraState {
            pos: [0.0, 10.0, 0.0],
            ref_pos: [0.0, 0.0, 0.0],
            ..target
        };
        assert!(camera.transition_to(vertical, 1.0, 0).is_err());
        assert!(camera.transition_to(target, f32::INFINITY, 0).is_err());
    }

    #[test]
    fn screen_snapshot_starts_with_versioned_title_state() {
        let screen = nie_app::flow::Screen::new();
        let json: serde_json::Value = serde_json::from_str(
            &screen_snapshot(&screen).expect("screen snapshot should serialize"),
        )
        .expect("screen snapshot should be valid JSON");

        assert_eq!(json["schemaVersion"], 1);
        assert_eq!(json["screen"]["kind"], "title");
        assert!(json.get("world").is_none());
    }

    #[test]
    fn main_menu_snapshot_requires_a_native_scene_without_naming_a_capture() {
        let mut screen = nie_app::flow::Screen::new();
        screen.input("CMD_ENTER");
        let json: serde_json::Value = serde_json::from_str(
            &screen_snapshot(&screen).expect("menu snapshot should serialize"),
        )
        .expect("menu snapshot should be valid JSON");

        assert_eq!(json["screen"]["kind"], "menu");
        assert_eq!(json["screen"]["renderOwner"], "host");
        assert_eq!(json["screen"]["nativeSceneRequired"], true);
        assert!(json["screen"].get("referenceCapture").is_none());
    }

    #[test]
    fn shared_frame_buffer_keeps_the_rendered_bytes_in_place() {
        let mut frame = FrameBuffer::default();
        assert_eq!(frame.len(), 0);

        frame.replace(vec![0, 64, 128, 255]);
        assert_ne!(frame.pointer(), 0);
        assert_eq!(frame.len(), 4);
        assert_eq!(frame.pixels(), [0, 64, 128, 255]);

        frame.replace(vec![9, 8]);
        assert_eq!(frame.len(), 2);
        assert_eq!(frame.pixels(), [9, 8]);
    }

    #[test]
    fn screen_bridge_accepts_real_list_and_dialogue_rows() {
        let lines = parse_lines_json(r#"["Alpha","Beta"]"#).expect("valid line array");
        assert_eq!(lines, ["Alpha", "Beta"]);
        assert!(parse_lines_json(r#"{"line":"not an array"}"#).is_err());

        let mut list_screen = nie_app::flow::Screen::new();
        list_screen.input("CMD_ENTER");
        list_screen.input("CMD_ENTER");
        assert!(list_screen.info_title().is_some());
        list_screen.fournir_liste(lines);
        let list_json: serde_json::Value = serde_json::from_str(
            &screen_snapshot(&list_screen).expect("list snapshot should serialize"),
        )
        .expect("list snapshot should be valid JSON");
        assert_eq!(list_json["screen"]["kind"], "list");
        assert_eq!(list_json["screen"]["lineCount"], 2);

        let mut story_screen = nie_app::flow::Screen::new();
        story_screen.input("CMD_ENTER");
        for _ in 0..5 {
            story_screen.input("CMD_FCS_NEXT");
        }
        story_screen.input("CMD_ENTER");
        story_screen.input("CMD_ENTER");
        assert!(story_screen.attend_dialogue());
        story_screen.fournir_dialogue("event_001".into(), vec!["A real line".into()]);
        let story_json: serde_json::Value = serde_json::from_str(
            &screen_snapshot(&story_screen).expect("story snapshot should serialize"),
        )
        .expect("story snapshot should be valid JSON");
        assert_eq!(story_json["screen"]["kind"], "story");
        assert_eq!(story_json["screen"]["eventId"], "event_001");
        assert_eq!(story_json["screen"]["lineCount"], 1);
        assert_eq!(story_json["screen"]["awaitingDialogue"], false);
    }

    #[test]
    fn match_snapshot_exposes_the_live_runtime_world() {
        let mut screen = nie_app::flow::Screen::new();
        screen.input("CMD_ENTER");
        for _ in 0..5 {
            screen.input("CMD_FCS_NEXT");
        }
        screen.input("CMD_ENTER");
        screen.input("CMD_FCS_NEXT");
        screen.input("CMD_ENTER");
        assert!(screen.in_match());

        set_match_input(&mut screen, f32::NAN, f32::INFINITY, false);
        update_screen(&mut screen, f32::NAN);
        let invalid_json: serde_json::Value = serde_json::from_str(
            &screen_snapshot(&screen).expect("invalid input snapshot should serialize"),
        )
        .expect("invalid input snapshot should be valid JSON");
        assert_eq!(invalid_json["world"]["tick"], 0);
        assert_eq!(invalid_json["world"]["input"]["direction"]["x"], 0.0);
        assert_eq!(invalid_json["world"]["input"]["direction"]["y"], 0.0);

        set_match_input(&mut screen, 3.0, 4.0, true);
        update_screen(&mut screen, 0.125);
        let json: serde_json::Value = serde_json::from_str(
            &screen_snapshot(&screen).expect("match snapshot should serialize"),
        )
        .expect("match snapshot should be valid JSON");

        assert_eq!(json["screen"]["kind"], "match");
        assert_eq!(json["world"]["tick"], 1);
        assert_eq!(json["world"]["time"], MAX_UPDATE_SECONDS);
        assert_eq!(json["world"]["score"], serde_json::json!([0, 0]));
        assert_eq!(json["world"]["input"]["direction"]["x"], 3.0);
        assert_eq!(json["world"]["input"]["direction"]["y"], 4.0);
        assert_eq!(json["world"]["input"]["shoot"], true);
        assert!(json["world"]["controlledPlayer"].is_number());
        let players = json["world"]["players"]
            .as_array()
            .expect("players should be an array");
        assert_eq!(players.len(), 22);
        assert_eq!(
            players
                .iter()
                .filter(|player| player["role"] == "goalkeeper")
                .count(),
            2
        );
        assert!(json["world"]["ball"]["position"]["z"].is_number());
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
        let schema: &[u8] = &[0x24, 0x00, 0x00, 0x00, 0x0A, 0x2A, 0x00, 0x00, 0x00, 0x0F];
        let row_data: &[u8] = &[
            0x00, 0x00, 0x00, 42, 0x00, 0x00, 0x00, 20, 0x00, 0x00, 0x00, 99, 0x00, 0x00, 0x00, 26,
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

    #[test]
    fn cfgbin_menu_setting_json_t2b_fixture() {
        use nie_formats::cfgbin::{CfgEntry, Value, encode_t2b};

        let entries = vec![CfgEntry {
            name: "MENU_LAYER_INFO_LIST_BEG".into(),
            variables: vec![Value::Int(1)],
            children: vec![CfgEntry {
                name: "MENU_LAYER_INFO_0".into(),
                variables: vec![
                    Value::Int(367_379_312),
                    Value::String("mainmenu90_00_background".into()),
                    Value::String(
                        "common/gamedata/menu/obj/mainmenu90_00_background.objbin".into(),
                    ),
                    Value::Int(1),
                ],
                children: Vec::new(),
            }],
        }];
        let bytes = encode_t2b(&entries);
        let json: serde_json::Value =
            serde_json::from_str(&cfgbin_menu_setting_json(&bytes).expect("menu JSON"))
                .expect("JSON valide");
        assert_eq!(json["layers"].as_array().unwrap().len(), 1);
        assert_eq!(json["layers"][0]["layer_id"], 367_379_312u32);
        assert_eq!(json["layers"][0]["name"], "mainmenu90_00_background");
        assert_eq!(json["layers"][0]["params"][0], 1);
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
            "2037965306",
            "wks00020",
            "493403631",
            "-1653680409",
            "30",
            "60",
            "260858381",
            "-1368456794",
            "3",
            "8",
            "0",
            "1",
            "-1124324279",
            "0",
            "0",
            "0",
            "1",
            "0",
            "0",
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
        assert!(
            !h.is_null(),
            "skillId1 doit résoudre vers le skill_config fourni"
        );
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
            "1834815904",
            "0",
            "1853054332",
            "0",
            "1401",
            "30",
            "31",
            "999",
            "0",
            "0",
            "0",
            "eq_sh110001",
            "1",
            "0",
            "0",
            "224",
            "0",
            "0",
            "961180446",
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

    // -----------------------------------------------------------------------
    // nie-save — parse_save_json
    // -----------------------------------------------------------------------

    /// Construit un conteneur Lives synthétique minimal (1 blob HEADERSAVE),
    /// chiffre avec la clé CRC32 du nom, puis vérifie que parse_save_json
    /// retourne le bon slot_name et les bonnes métadonnées de blob.
    #[test]
    fn parse_save_json_conteneur_minimal() {
        use nie_save::{
            BLOB_MAGIC, BLOB_SUBTYPE_HEADERSAVE, Blob, BlobHeader, BlobSubtype, DATA_START,
            DIR_OFFSET, LIVES_CONST2, LIVES_MAGIC, crc32_of_pub, decrypt_block, key_from_filename,
        };

        let slot = "DEADBEEF-USERDATALIVE";

        // Corps minimal du blob HEADERSAVE (1 octet pour passer les bornes)
        let body = vec![0u8; 4];
        let blob = Blob {
            header: BlobHeader {
                subtype: BlobSubtype::Headersave,
                payload_size: body.len() as u32,
                field8: 0xABCD_1234,
            },
            body,
        };
        let blob_bytes = {
            let mut v = Vec::new();
            v.extend_from_slice(&BLOB_MAGIC.to_be_bytes());
            v.extend_from_slice(&BLOB_SUBTYPE_HEADERSAVE.to_be_bytes());
            v.extend_from_slice(&(blob.body.len() as u32).to_le_bytes());
            v.extend_from_slice(&blob.header.field8.to_le_bytes());
            v.extend_from_slice(&blob.body);
            v
        };
        let blob_crc = crc32_of_pub(&blob_bytes);

        // Construire le header plaintext (0x800)
        let mut hdr = vec![0u8; DATA_START];
        hdr[8..12].copy_from_slice(&LIVES_CONST2.to_le_bytes());
        let sn = slot.as_bytes();
        hdr[0x10..0x10 + sn.len()].copy_from_slice(sn);
        hdr[DIR_OFFSET..DIR_OFFSET + 4].copy_from_slice(&blob_crc.to_le_bytes());
        hdr[DIR_OFFSET + 4..DIR_OFFSET + 8]
            .copy_from_slice(&(blob_bytes.len() as u32).to_le_bytes());
        hdr[DIR_OFFSET + 8..DIR_OFFSET + 12].copy_from_slice(&0u32.to_le_bytes());
        let fname = b"HEADERSAVE_data.bin";
        hdr[DIR_OFFSET + 12..DIR_OFFSET + 12 + fname.len()].copy_from_slice(fname);
        let hdr_crc = crc32_of_pub(&hdr[8..DATA_START]);
        hdr[4..8].copy_from_slice(&hdr_crc.to_le_bytes());
        hdr[0..4].copy_from_slice(&LIVES_MAGIC.to_le_bytes());

        let mut plain = hdr;
        plain.extend_from_slice(&blob_bytes);

        let key = key_from_filename(slot);
        let mut enc = plain.clone();
        decrypt_block(&mut enc, 0, key);

        let json_str = parse_save_json(&enc, slot).expect("parse_save_json ne doit pas échouer");
        let json: serde_json::Value = serde_json::from_str(&json_str).expect("JSON valide");

        assert_eq!(json["slot_name"], slot);
        assert_eq!(json["key"], key);

        let blobs = json["blobs"].as_array().expect("blobs est un tableau");
        assert_eq!(blobs.len(), 1);
        assert_eq!(blobs[0]["filename"], "HEADERSAVE_data.bin");
        assert_eq!(blobs[0]["subtype"], "Headersave");
        assert_eq!(blobs[0]["field8"], 0xABCD_1234u32);

        // Le blob HEADERSAVE body fait 4 octets (trop court pour parse_headersave) →
        // headersave doit être null (pas d'erreur fatale).
        assert!(
            json["headersave"].is_null(),
            "headersave null sur body trop court"
        );
        // Pas de blob AUTOSAVE → autosave null.
        assert!(json["autosave"].is_null());
    }

    /// Vérifie que parse_save_json retourne une erreur sur un fichier vide.
    #[test]
    fn parse_save_json_tampon_vide_erreur() {
        assert!(parse_save_json(&[], "TEST-LIVE").is_err());
    }

    /// Vérifie que parse_save_json retourne une erreur sur une mauvaise clé.
    #[test]
    fn parse_save_json_mauvaise_cle_erreur() {
        // On encode avec "DEADBEEF-USERDATALIVE" mais on parse avec un autre nom.
        use nie_save::{
            DATA_START, LIVES_CONST2, LIVES_MAGIC, crc32_of_pub, decrypt_block, key_from_filename,
        };
        let slot = "DEADBEEF-USERDATALIVE";
        let mut hdr = vec![0u8; DATA_START];
        hdr[8..12].copy_from_slice(&LIVES_CONST2.to_le_bytes());
        let hdr_crc = crc32_of_pub(&hdr[8..DATA_START]);
        hdr[4..8].copy_from_slice(&hdr_crc.to_le_bytes());
        hdr[0..4].copy_from_slice(&LIVES_MAGIC.to_le_bytes());
        let key = key_from_filename(slot);
        let mut enc = hdr;
        decrypt_block(&mut enc, 0, key);
        // Parser avec un nom différent → mauvaise clé → BadMagic.
        assert!(parse_save_json(&enc, "CAFEBABE-LIVE").is_err());
    }
}

#[cfg(all(test, not(target_arch = "wasm32")))]
mod tests_sprite_sheet {
    /// Golden VFS : la feuille de sprites d'un atlas réel du jeu doit sortir de la FFI wasm avec
    /// ses régions et leurs rectangles — c'est ce que l'explorateur et le web consomment.
    #[test]
    fn feuille_de_sprites_d_un_atlas_reel() {
        use std::path::Path;

        let dir = nie_formats::vfs::resolve_game_dir()
            .to_string_lossy()
            .into_owned();
        let data_dir = Path::new(&dir).join("data");
        let mut vfs = nie_formats::vfs::Vfs::new();
        if vfs.init(&data_dir).is_err() {
            eprintln!(
                "skip feuille_de_sprites : jeu absent à {}",
                data_dir.display()
            );
            return;
        }
        let Some(chemin) = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .find(|p| p.ends_with("font/gaiji_game.g4tx"))
        else {
            eprintln!("skip feuille_de_sprites : gaiji_game.g4tx absent du VFS");
            return;
        };
        let data = vfs.read(&chemin).expect("lecture de l'atlas");

        let json = super::g4tx_sprite_sheet_json(&data).expect("feuille de sprites");
        let v: serde_json::Value = serde_json::from_str(&json).expect("JSON valide");
        let sprites = v["sprites"].as_array().expect("tableau de sprites");
        eprintln!("{chemin} : {} régions", sprites.len());

        assert!(
            sprites.len() > 100,
            "atlas d'icônes attendu, {} régions",
            sprites.len()
        );
        assert!(v["largeur"].as_i64().unwrap_or(0) > 0);
        // Chaque région porte un rectangle exploitable : c'est ce que `g4tx_info_json` ne donne pas.
        for s in sprites {
            assert!(!s["nom"].as_str().unwrap_or("").is_empty());
            assert!(
                s["largeur"].as_i64().unwrap_or(0) > 0,
                "region sans largeur : {s}"
            );
        }
    }
}
