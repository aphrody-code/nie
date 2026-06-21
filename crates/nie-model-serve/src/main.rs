//! `nie-model-serve` — serveur HTTP live d'assemblage GLB IEVR.
//!
//! Assemble corps+face+uniforme (+ keshin/armures) à la volée depuis les CPK chiffrés.
//! Cache les GLB assemblés sur disque pour ne parser qu'une fois par code.
//!
//! ## Endpoints
//!
//! - `GET /model-full/<code>.glb`  — personnage (ex. `c01000010`)
//! - `GET /model-full/<code>.glb`  — keshin  (ex. `k000010`)
//! - `GET /model-full/<code>.glb`  — armure  (ex. `ka001901`)
//! - `GET /health`                 — `200 OK`
//!
//! ## Résolution uniforme
//!
//! Pour les personnages, l'uniforme est résolu via :
//! 1. `inagle_characters` (miroir SQLite) → `series` + `teams[0].id`
//! 2. `inagle_teams` → `data.kits.<season_key>` → `kit_id`
//! 3. `inagle_uniforms` (name_id=kit_id) → `models[0].uniformFielderModelIdCrc`
//! 4. `var/model-crc-manifest.ndjson` → CRC → chemin G4MD dans CPK
//! 5. VFS → g4md + g4mg bruts → primitives uniforme
//!
//! ## Body type
//!
//! Résolu depuis `var/body-type-manifest.ndjson` (généré par `niers body-map`).
//! Fallback : `type_idx=0` (base_normal_00) si le code est absent.
//!
//! ## Cache
//!
//! `<cache_dir>/<code>.glb` (défaut `var/model-cache/`). Le cache est un simple fichier
//! disque. `Cache-Control: public, max-age=31536000, immutable` (assets immuables pour
//! un buildid Steam). Purger le cache si le jeu est mis à jour.
//!
//! ## Usage
//!
//! ```text
//! nie-model-serve --game-dir /home/ubuntu/.local/share/Steam/iecode/inazuma \
//!                 --glb-dir  /home/ubuntu/.local/share/Steam/iecode/inazuma/data/dx11/model \
//!                 --db       /path/to/mirror.sqlite \
//!                 --port     8790
//! ```

#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::{BufRead, BufReader, Write as IoWrite};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::thread;

use anyhow::{Context, Result, bail};
use clap::Parser;
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use tracing::{debug, error, info, warn};

use nie_formats::assemble::{
    CharacterAssemblyInput, EmbeddedTexture, GenericModelInput, MeshComponent, SeasonKey,
    assemble_armed, assemble_character_model, assemble_generic_model, assemble_keshin,
    g4md_to_g4mg_path, load_manifest, resolve_crc_to_g4md_path,
};
use nie_formats::g4tx::parse as parse_g4tx;
use nie_formats::g4tx_decode;
use nie_formats::cfgbin;
use nie_formats::vfs::Vfs;
use nie_formats::cri_audio::{
    Awb, acb_parse, adx_decode, is_adx, is_hca,
    encode_pcm16_wav, usm_demux, VideoCodec,
};

mod menu;

// ── CLI ───────────────────────────────────────────────────────────────────────

/// Serveur HTTP live d'assemblage GLB IEVR (corps+face+uniforme, keshin, armures).
#[derive(Parser)]
#[command(name = "nie-model-serve", version, about)]
struct Cli {
    /// Répertoire racine du jeu (contient `data/cpk_list.cfg.bin`).
    #[arg(long, default_value = "/home/ubuntu/.local/share/Steam/iecode/inazuma")]
    game_dir: PathBuf,

    /// Répertoire des GLB pré-convertis (dx11/model/).
    #[arg(long, default_value = "/home/ubuntu/.local/share/Steam/iecode/inazuma/data/dx11/model")]
    glb_dir: PathBuf,

    /// Miroir SQLite (inagle_*). Résolution automatique si absent.
    #[arg(long)]
    db: Option<PathBuf>,

    /// Manifeste CRC32→chemin G4MD (var/model-crc-manifest.ndjson).
    #[arg(long, default_value = "/home/ubuntu/niers/var/model-crc-manifest.ndjson")]
    crc_manifest: PathBuf,

    /// Manifeste uniforme CRC32→G4MD+G4TX (var/uniform-model-map.ndjson, généré depuis chara_parts).
    #[arg(long, default_value = "/home/ubuntu/niers/var/uniform-model-map.ndjson")]
    uniform_map: PathBuf,

    /// Index global `[chemin, cpk]` (NDJSON, .gz accepté) des fichiers de TOUS les CPK,
    /// y compris ceux hors `cpk_list.cfg.bin` (films, sound_asset…). Alimente l'index
    /// supplémentaire du VFS pour les rendre lisibles. Vide/absent = ignoré.
    #[arg(long, default_value = "/home/ubuntu/rg/apps/azalee/data/cpk-index.ndjson.gz")]
    cpk_file_index: PathBuf,

    /// Manifeste body_type_idx (var/body-type-manifest.ndjson, optionnel — fallback type_idx=0).
    #[arg(long, default_value = "/home/ubuntu/niers/var/body-type-manifest.ndjson")]
    body_manifest: PathBuf,

    /// Répertoire de cache GLB assemblés.
    #[arg(long, default_value = "/home/ubuntu/niers/var/model-cache")]
    cache_dir: PathBuf,

    /// Répertoire des layouts de menu (`<screen>.json`) pour le rendu serveur `/menu-render/`.
    #[arg(long, default_value = "/home/ubuntu/rg/apps/azalee/app/menu/_layouts")]
    layout_dir: PathBuf,

    /// Port d'écoute (localhost uniquement).
    #[arg(long, default_value_t = 8790)]
    port: u16,

    /// Nombre de threads de travail.
    #[arg(long, default_value_t = 4)]
    threads: usize,

    /// Précharge TOUS les modèles servables (persos/keshin/armures/génériques) dans le cache
    /// GLB au démarrage, en arrière-plan (le serveur sert immédiatement pendant le warm).
    /// Idempotent et borné par l'espace disque.
    #[arg(long)]
    preload: bool,
}

// ── État partagé ──────────────────────────────────────────────────────────────

/// Entrée du manifeste uniforme CRC→G4MD+G4TX (var/uniform-model-map.ndjson).
///
/// Chaque ligne : `{"crc":2636889360,"crc_hex":"0x9D2BBD10","code":"u010101_10",
///                  "g4md":"data/common/chr/_uniform/u000101/u000101.g4md",
///                  "g4tx":"data/dx11/chr/_uniform/u000101/u010101_10.g4tx"}`
struct UniformMapEntry {
    g4md: String,
    g4tx: String,
}

/// État partagé entre les threads (derrière Arc).
struct State {
    vfs: std::sync::Mutex<Vfs>,
    glb_dir: PathBuf,
    crc_manifest: Vec<nie_formats::assemble::ManifestEntry>,
    /// CRC uniforme → chemins G4MD+G4TX (depuis var/uniform-model-map.ndjson).
    uniform_map: HashMap<u32, UniformMapEntry>,
    /// internal_code → body_type_idx (depuis var/body-type-manifest.ndjson).
    body_map: HashMap<String, u8>,
    cache_dir: PathBuf,
    /// SQLite mirror : résolution uniforme via inagle_*.
    db_path: Option<PathBuf>,
    /// Répertoire des layouts de menu (`<screen>.json`).
    layout_dir: PathBuf,
}

impl State {
    /// Charge le manifeste CRC→chemin depuis le fichier NDJSON.
    fn load_crc_manifest(path: &Path) -> Result<Vec<nie_formats::assemble::ManifestEntry>> {
        if !path.exists() {
            warn!("manifeste CRC absent : {}", path.display());
            return Ok(Vec::new());
        }
        let s = fs::read_to_string(path)
            .with_context(|| format!("lecture manifeste CRC {}", path.display()))?;
        let entries = load_manifest(&s);
        info!("manifeste CRC : {} entrées", entries.len());
        Ok(entries)
    }

    /// Charge le manifeste uniforme CRC→G4MD+G4TX depuis le fichier NDJSON.
    fn load_uniform_map(path: &Path) -> HashMap<u32, UniformMapEntry> {
        if !path.exists() {
            warn!("manifeste uniforme absent : {} (uniforme non disponible)", path.display());
            return HashMap::new();
        }
        let Ok(content) = fs::read_to_string(path) else {
            warn!("impossible de lire uniform-model-map : {}", path.display());
            return HashMap::new();
        };
        let mut map = HashMap::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() { continue; }
            let Ok(v): std::result::Result<Value, _> = serde_json::from_str(line) else { continue };
            let Some(crc) = v["crc"].as_u64().map(|c| c as u32) else { continue };
            let Some(g4md) = v["g4md"].as_str().map(str::to_string) else { continue };
            let Some(g4tx) = v["g4tx"].as_str().map(str::to_string) else { continue };
            map.insert(crc, UniformMapEntry { g4md, g4tx });
        }
        info!("uniform-model-map : {} entrées", map.len());
        map
    }

    /// Charge le manifeste body_type_idx depuis le fichier NDJSON.
    /// Format : `{"code":"c01000010","body_type_idx":0}` (une ligne par code).
    fn load_body_map(path: &Path) -> HashMap<String, u8> {
        if !path.exists() {
            debug!("manifeste body_type absent : {} (fallback type_idx=0)", path.display());
            return HashMap::new();
        }
        let Ok(content) = fs::read_to_string(path) else {
            warn!("impossible de lire body-type-manifest : {}", path.display());
            return HashMap::new();
        };
        let mut map = HashMap::new();
        for line in content.lines() {
            let line = line.trim();
            if line.is_empty() {
                continue;
            }
            let Ok(v): std::result::Result<Value, _> = serde_json::from_str(line) else {
                continue;
            };
            let Some(code) = v["code"].as_str() else { continue };
            let Some(idx) = v["body_type_idx"].as_u64() else { continue };
            map.insert(code.to_string(), idx as u8);
        }
        info!("body-type-manifest : {} entrées", map.len());
        map
    }

    /// Résout body_type_idx depuis le manifeste, fallback 0.
    fn body_type_idx(&self, internal_code: &str) -> u8 {
        // Essai exact
        if let Some(&idx) = self.body_map.get(internal_code) {
            return idx;
        }
        // Essai sans suffixe de variante (_5000/_5100…)
        let base = if let Some(pos) = internal_code.rfind('_') {
            let suffix = &internal_code[pos + 1..];
            if suffix.chars().all(|c| c.is_ascii_digit()) {
                &internal_code[..pos]
            } else {
                internal_code
            }
        } else {
            internal_code
        };
        *self.body_map.get(base).unwrap_or(&0)
    }
}

// ── Résolution uniforme depuis SQLite ─────────────────────────────────────────

/// Résolution de l'uniforme par défaut d'un personnage (fielder CRC).
///
/// Chaîne : series → season_key → inagle_teams.kits → kit_id → inagle_uniforms → CRC.
fn resolve_uniform_crc(db_path: &Path, internal_code: &str) -> Option<u32> {
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .ok()?;
    conn.pragma_update(None, "journal_mode", "WAL").ok();

    // 1. Récupère series + team ID principal du personnage.
    let (series_str, team_id): (String, Option<String>) = conn
        .query_row(
            "SELECT series, substr(data,1,2000) FROM inagle_characters \
             WHERE internal_code=?1 ORDER BY is_primary DESC NULLS LAST, rowid ASC LIMIT 1",
            [internal_code],
            |row| {
                let series: String = row.get(0).unwrap_or_default();
                let data_raw: String = row.get(1).unwrap_or_default();
                // Extrait le premier team ID depuis data.teams[0].id
                let team_id = serde_json::from_str::<Value>(&data_raw)
                    .ok()
                    .and_then(|v| {
                        v["teams"]
                            .as_array()
                            .and_then(|arr| arr.first())
                            .and_then(|t| t["id"].as_str().map(str::to_string))
                    });
                Ok((series, team_id))
            },
        )
        .ok()?;

    let team_id = team_id?;
    let season = SeasonKey::from_series(&series_str);

    // 2. Récupère le kit_id depuis inagle_teams.
    let kit_id: String = conn
        .query_row(
            "SELECT data FROM inagle_teams WHERE id=?1 LIMIT 1",
            [&team_id],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|data_raw| {
            serde_json::from_str::<Value>(&data_raw)
                .ok()
                .and_then(|v| {
                    v["kits"][season.as_str()]
                        .as_str()
                        .map(str::to_string)
                })
        })?;

    // 3. Récupère le CRC fielder depuis inagle_uniforms (name_id = kit_id).
    let fielder_crc_str: String = conn
        .query_row(
            "SELECT models FROM inagle_uniforms WHERE name_id=?1 ORDER BY type_id ASC LIMIT 1",
            [&kit_id],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|models_raw| {
            serde_json::from_str::<Value>(&models_raw)
                .ok()
                .and_then(|v| {
                    // Cherche typeId=0 en premier, sinon prend le premier élément
                    let arr = v.as_array()?;
                    let entry = arr
                        .iter()
                        .find(|e| e["typeId"].as_u64() == Some(0))
                        .or_else(|| arr.first())?;
                    entry["uniformFielderModelIdCrc"]
                        .as_str()
                        .map(str::to_string)
                })
        })?;

    // Parse le CRC hex "0xXXXXXXXX"
    let hex = fielder_crc_str.strip_prefix("0x").unwrap_or(&fielder_crc_str);
    u32::from_str_radix(hex, 16).ok()
}

// ── Décodage G4TX → PNG ───────────────────────────────────────────────────────
// Le décodeur DDS/BCn est centralisé dans `nie_formats::g4tx_decode` (feature `textures`,
// source unique du workspace — Phase 1b dédup). Ici, on n'expose que les helpers spécifiques
// au serveur (résolution VFS, fallback de noms), qui appellent ce module partagé.

/// Décode un `cfg.bin`/`objbin`/`fxbin`/`mevbin` RDBN en JSON exploitable :
/// `{ format, lists: [ { name, type, count, rows: [ { champ: valeur } ] } ] }`.
/// Les noms de listes/types/champs sont résolus depuis la table de chaînes (lisible).
fn cfgbin_to_json(data: &[u8]) -> Option<serde_json::Value> {
    use serde_json::{json, Map, Value};
    if !cfgbin::is_rdbn(data) {
        // Format T2B (cfg.bin Level-5 classique, le cas réel sur IEVR) : arbre
        // hiérarchique {name, variables, children} — sérialisé directement.
        let cfg = cfgbin::cfgbin_parse(data).ok()?;
        return serde_json::to_value(&cfg).ok();
    }
    let rdbn = cfgbin::parse(data).ok()?;
    let lists = cfgbin::read_values(&rdbn, data);
    let lists_json: Vec<Value> = lists
        .iter()
        .map(|l| {
            let rows: Vec<Value> = l
                .rows
                .iter()
                .map(|row| {
                    let mut m = Map::new();
                    for (name, val) in &row.fields {
                        m.insert(name.clone(), rdbn_value_to_json(val));
                    }
                    Value::Object(m)
                })
                .collect();
            json!({ "name": l.name, "type": l.type_name, "count": rows.len(), "rows": rows })
        })
        .collect();
    Some(json!({ "format": "rdbn", "lists": lists_json }))
}

/// Encode des octets bruts en hex MAJUSCULE sans séparateur (ex. `"000000008FC2753F"`),
/// identique au dump iecode des champs `position`/`blob`.
fn hex_upper(bytes: &[u8]) -> String {
    use core::fmt::Write;
    let mut s = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        let _ = write!(s, "{b:02X}");
    }
    s
}

/// Convertit une [`cfgbin::RdbnValue`] en JSON, encodage **identique au dump iecode**
/// (`hash` -> `"0x........"`, `blob`/`position` -> hex MAJUSCULE), donc directement
/// consommable par les parseurs typés de `nie-data` (cf. `nie_data::typed::decode_by_key`).
fn rdbn_value_to_json(v: &cfgbin::RdbnValue) -> serde_json::Value {
    use cfgbin::RdbnValue as R;
    use serde_json::{json, Value};
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
        // Octets bruts en hex MAJUSCULE (identique iecode `defensePos` =
        // "000000008FC2753F") au lieu de l'ancien `"blob[8o]"` qui jetait la donnee.
        R::Blob(b) => json!(hex_upper(b)),
        _ => Value::Null,
    }
}

/// Décode un `cfg.bin` RDBN vers la forme **canonique iecode** attendue par les
/// parseurs typés de `nie-data` : `{ "version", "lists": [ { "name", "typeName",
/// "values": [ { champ: valeur } ] } ] }`. `None` si le fichier n'est pas du RDBN à
/// listes (T2B/`entries` non couvert ici).
fn cfgbin_to_iecode_root(data: &[u8]) -> Option<serde_json::Value> {
    use serde_json::{json, Map, Value};
    if !cfgbin::is_rdbn(data) {
        return None;
    }
    let rdbn = cfgbin::parse(data).ok()?;
    let lists = cfgbin::read_values(&rdbn, data);
    let lists_json: Vec<Value> = lists
        .iter()
        .map(|l| {
            let values: Vec<Value> = l
                .rows
                .iter()
                .map(|row| {
                    let mut m = Map::new();
                    for (name, val) in &row.fields {
                        m.insert(name.clone(), rdbn_value_to_json(val));
                    }
                    Value::Object(m)
                })
                .collect();
            json!({ "name": l.name, "typeName": l.type_name, "values": values })
        })
        .collect();
    Some(json!({ "lists": lists_json }))
}

/// Convertit une liste de frères T2B [`cfgbin::CfgEntry`] vers la forme **iecode**
/// attendue par les parseurs `entries` de `nie-data`, en répliquant le suffixe
/// d'index d'iecode : chaque nœud est renommé `<base>_<i>` où `i` est son rang
/// d'occurrence parmi les frères de même nom (`MISSION_CONFIG_INFO` -> `..._0`,
/// `ITEM_CONSUME_INFO` -> `..._0`, `_1`, `_2`…). Indispensable car les parseurs
/// matchent un préfixe **avec underscore final** (`"MISSION_CONFIG_INFO_"`).
/// `value` est toujours une chaîne (les parseurs la re-parsent ; `type` indicatif).
fn t2b_siblings_to_iecode(siblings: &[cfgbin::CfgEntry]) -> Vec<serde_json::Value> {
    use serde_json::{json, Value};
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
                    cfgbin::Value::String(s) => json!({ "type": "String", "value": s }),
                    cfgbin::Value::Int(n) => json!({ "type": "Int", "value": n.to_string() }),
                    cfgbin::Value::Float(f) => json!({ "type": "Float", "value": f.to_string() }),
                })
                .collect();
            let children = t2b_siblings_to_iecode(&e.children);
            json!({ "name": name, "variables": variables, "children": children })
        })
        .collect()
}

/// Décode un `cfg.bin` **T2B** (`entries`) vers la forme iecode `{ "entries": [...] }`
/// consommable par les parseurs `entries` de `nie-data` (music_app, record, item…).
/// `None` si le fichier est du RDBN (utiliser [`cfgbin_to_iecode_root`]).
fn cfgbin_to_t2b_iecode_root(data: &[u8]) -> Option<serde_json::Value> {
    use serde_json::json;
    if cfgbin::is_rdbn(data) {
        return None;
    }
    let cfg = cfgbin::cfgbin_parse(data).ok()?;
    Some(json!({ "entries": t2b_siblings_to_iecode(&cfg.entries) }))
}

/// Décode un `cfg.bin` vers la forme iecode adaptée à son format (RDBN `lists` ou
/// T2B `entries`) : aiguille vers [`cfgbin_to_iecode_root`] ou [`cfgbin_to_t2b_iecode_root`].
fn cfgbin_to_typed_root(data: &[u8]) -> Option<serde_json::Value> {
    if cfgbin::is_rdbn(data) {
        cfgbin_to_iecode_root(data)
    } else {
        cfgbin_to_t2b_iecode_root(data)
    }
}

/// Compose une **scène de dialogue de mode histoire** (fond + boîte + onglet locuteur + texte wrappé)
/// en PNG 1280×720, rendue dans la VRAIE police du jeu via `font::LatinAtlas` (edge-scan).
/// `font_cfg`/`font_g4tx` = octets de `font.cfg.bin` / `font.g4tx`.
/// Translittère les accents français vers l'ASCII de base (`é→e`, `ê→e`, `ç→c`, `«»→"`…).
/// FALLBACK honnête en attendant l'extension de `LatinAtlas` à la rangée Latin-1 de l'atlas :
/// `LatinAtlas` ne couvre que l'ASCII 0x21-0x7E, donc les accents tomberaient sinon (« arrête »→
/// « arr te »). Translittéré = lisible, PAS fidèle (le jeu affiche les vrais accents).
fn fr_accents_to_ascii(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' | 'ã' => 'a',
            'À' | 'Â' | 'Ä' => 'A',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'É' | 'È' | 'Ê' | 'Ë' => 'E',
            'î' | 'ï' | 'í' | 'ì' => 'i',
            'Î' | 'Ï' => 'I',
            'ô' | 'ö' | 'ó' | 'ò' | 'õ' => 'o',
            'Ô' | 'Ö' => 'O',
            'û' | 'ü' | 'ú' | 'ù' => 'u',
            'Û' | 'Ü' => 'U',
            'ç' => 'c',
            'Ç' => 'C',
            'ñ' => 'n',
            '«' | '»' | '“' | '”' => '"',
            '’' | '‘' => '\'',
            '–' | '—' => '-',
            '…' => '.',
            other => other,
        })
        .collect()
}

fn compose_story_png(font_cfg: &[u8], font_g4tx: &[u8], speaker: &str, text: &str) -> Option<Vec<u8>> {
    use nie_formats::{cfgbin, font, g4tx};
    const W: usize = 1280;
    const H: usize = 720;
    let speaker = fr_accents_to_ascii(speaker);
    let speaker = speaker.as_str();
    let text = fr_accents_to_ascii(text);
    let text = text.as_str();

    let cfg = cfgbin::parse_t2b(font_cfg).ok()?;
    let metrics = font::parse_metrics(&cfg);
    let tx = g4tx::parse(font_g4tx).ok()?;
    let t = tx.textures.first()?;
    let dds = font_g4tx.get(t.data_offset..)?;
    let px_off = if dds.len() >= 88 && &dds[84..88] == b"DX10" { 148 } else { 128 };
    let atlas = dds.get(px_off..)?;
    let (aw, ah) = (t.width as usize, t.height as usize);
    let cell_h = metrics.dims.cell_height;
    let la = font::LatinAtlas::from_atlas(atlas, aw, ah, 946, cell_h);

    // Fond dégradé bleu nuit (placeholder du rendu de scène 3D).
    let mut buf = vec![0u8; W * H * 4];
    for y in 0..H {
        let tt = y as f32 / H as f32;
        let (r, g, b) =
            ((18.0 + 30.0 * tt) as u8, (24.0 + 36.0 * tt) as u8, (44.0 + 60.0 * (1.0 - tt)) as u8);
        for x in 0..W {
            let o = (y * W + x) * 4;
            buf[o..o + 4].copy_from_slice(&[r, g, b, 255]);
        }
    }
    let fill = |buf: &mut [u8], x0: i32, y0: i32, x1: i32, y1: i32, c: [u8; 4]| {
        let a = f32::from(c[3]) / 255.0;
        for y in y0.max(0)..y1.min(H as i32) {
            for x in x0.max(0)..x1.min(W as i32) {
                let o = (y as usize * W + x as usize) * 4;
                for k in 0..3 {
                    buf[o + k] = (f32::from(c[k]) * a + f32::from(buf[o + k]) * (1.0 - a)) as u8;
                }
                buf[o + 3] = 255;
            }
        }
    };

    // Wrap du texte par mots (gère `\n` littéral et réel).
    let (bx0, bx1) = (60i32, W as i32 - 60);
    let line_h = i32::from(cell_h) + 4;
    let max_w = (bx1 - bx0 - 80) as u32;
    let mut lines: Vec<String> = Vec::new();
    for para in text.split('\n').flat_map(|p| p.split("\\n")) {
        let mut cur = String::new();
        for word in para.split_whitespace() {
            let trial =
                if cur.is_empty() { word.to_string() } else { format!("{cur} {word}") };
            if la.measure(&trial) <= max_w {
                cur = trial;
            } else {
                if !cur.is_empty() {
                    lines.push(std::mem::take(&mut cur));
                }
                cur = word.to_string();
            }
        }
        lines.push(cur);
    }
    if lines.is_empty() {
        lines.push(String::new());
    }

    let by1 = H as i32 - 28;
    let by0 = by1 - (lines.len() as i32 * line_h + 36);
    fill(&mut buf, bx0, by0, bx1, by1, [10, 14, 28, 220]);
    fill(&mut buf, bx0, by0, bx1, by0 + 3, [90, 200, 255, 255]);
    let name_w = (la.measure(speaker) as i32 + 40).min(440);
    fill(&mut buf, bx0 + 20, by0 - 40, bx0 + 20 + name_w, by0 + 2, [30, 60, 110, 235]);
    fill(&mut buf, bx0 + 20, by0 - 40, bx0 + 20 + name_w, by0 - 37, [120, 220, 255, 255]);
    la.blit_line(atlas, aw, &mut buf, W, bx0 + 38, by0 - 32, speaker, [200, 235, 255, 255]);
    for (i, line) in lines.iter().enumerate() {
        la.blit_line(atlas, aw, &mut buf, W, bx0 + 40, by0 + 22 + i as i32 * line_h, line, [240, 244, 250, 255]);
    }
    fill(&mut buf, bx1 - 36, by1 - 24, bx1 - 20, by1 - 8, [120, 220, 255, 255]);

    g4tx_decode::encode_rgba_to_png(&buf, W, H)
}

/// Construit le chemin VFS d'un G4TX de face depuis le code personnage.
/// Le dossier de série est déduit directement du code interne (préfixe c01/c02…)
/// pour éviter de dépendre du libellé en base qui peut varier.
fn face_g4tx_vfs_path(code: &str) -> String {
    let series_dir = series_dir_from_code_upper(code).unwrap_or("01_IE1");
    format!("data/dx11/chr/_face/{series_dir}/{code}/{code}.g4tx")
}

/// Résout le dossier de série (casse exacte des CPK, ex. `"01_IE1"`) depuis un code interne.
/// Ces valeurs correspondent aux vrais noms de dossiers VFS extraits de `model-crc-manifest.ndjson`.
fn series_dir_from_code_upper(code: &str) -> Option<&'static str> {
    // Préfixe = les 3 premiers caractères après 'c' : c01… → "01"
    let prefix = code.get(1..3)?;
    match prefix {
        "01" => Some("01_IE1"),
        "02" => Some("02_IE2"),
        "03" => Some("03_IE3"),
        "04" => Some("04_GO1"),
        "05" => Some("05_GO2"),
        "06" => Some("06_GO3"),
        "07" => Some("07_ARES"),
        "08" => Some("08_ORION"),
        "11" => Some("11_VICTORY"),
        "20" => Some("20_EDIT"),
        "21" => Some("21_MANNEQUIN"),
        "22" => Some("22_COMBO"),
        _ => None,
    }
}


/// Tente de charger et décoder la texture de face d'un personnage en PNG.
/// Retourne `None` si le G4TX est absent ou le décodage échoue.
fn load_face_texture_png(state: &State, code: &str) -> Option<Vec<u8>> {
    let vfs_path = face_g4tx_vfs_path(code);
    debug!("chargement texture face : {vfs_path}");

    let g4tx_data = {
        let vfs = state.vfs.lock().unwrap();
        vfs.read(&vfs_path).ok()
    }?;

    let png = g4tx_decode::decode_best_to_png(&g4tx_data);
    if png.is_none() {
        warn!("décodage G4TX face {code} échoué");
    }
    png
}


/// Tente de charger et décoder la texture d'uniforme depuis un chemin VFS G4TX.
/// Retourne `None` si le G4TX est absent ou le décodage échoue.
fn load_uniform_texture_png(state: &State, g4tx_vfs_path: &str) -> Option<Vec<u8>> {
    debug!("chargement texture uniforme : {g4tx_vfs_path}");

    let g4tx_data = {
        let vfs = state.vfs.lock().unwrap();
        vfs.read(g4tx_vfs_path).ok()
    }?;

    let png = g4tx_decode::decode_best_to_png(&g4tx_data);
    if png.is_none() {
        warn!("décodage G4TX uniforme {g4tx_vfs_path} échoué");
    }
    png
}

/// Tente de charger et décoder la texture de keshin en PNG.
fn load_keshin_texture_png(state: &State, code: &str) -> Option<Vec<u8>> {
    let path = format!("data/dx11/chr/_keshin/{code}/{code}.g4tx");
    debug!("chargement texture keshin : {path}");

    let g4tx_data = {
        let vfs = state.vfs.lock().unwrap();
        vfs.read(&path).ok()
    }?;

    let png = g4tx_decode::decode_best_to_png(&g4tx_data);
    if png.is_none() {
        warn!("décodage G4TX keshin {code} échoué");
    }
    png
}

/// Tente de charger et décoder la texture d'armure en PNG.
fn load_armed_texture_png(state: &State, code: &str) -> Option<Vec<u8>> {
    let dir_name = &code[..code.len().min(8)];
    let path = format!("data/dx11/chr/_armd/{dir_name}/{code}_10.g4tx");
    debug!("chargement texture armure : {path}");

    let g4tx_data = {
        let vfs = state.vfs.lock().unwrap();
        vfs.read(&path).ok()
    };

    // Fallback si la texture n'a pas "_10"
    let g4tx_data = match g4tx_data {
        Some(d) => Some(d),
        None => {
            let path_fallback = format!("data/dx11/chr/_armd/{dir_name}/{code}.g4tx");
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&path_fallback).ok()
        }
    }?;

    let png = g4tx_decode::decode_best_to_png(&g4tx_data);
    if png.is_none() {
        warn!("décodage G4TX armure {code} échoué");
    }
    png
}

// ── Assemblage du modèle ──────────────────────────────────────────────────────

/// Résultat de l'assemblage : bytes GLB.
type GlbBytes = Vec<u8>;

/// Assemble un personnage (code `cXXXXXXXX`).
fn assemble_chara(state: &State, code: &str) -> Result<GlbBytes> {
    let body_type_idx = state.body_type_idx(code);

    // Résolution de l'uniforme via SQLite.
    let uniform_crc = state
        .db_path
        .as_deref()
        .and_then(|db| resolve_uniform_crc(db, code))
        .unwrap_or(0);

    // Tentative de chargement des données G4MD/G4MG+G4TX de l'uniforme depuis le VFS.
    let (uniform_g4md, uniform_g4mg, uniform_g4tx_path) = if uniform_crc != 0 {
        match load_uniform_from_vfs(state, uniform_crc) {
            Ok(ud) => (Some(ud.g4md), Some(ud.g4mg), ud.g4tx_path),
            Err(e) => {
                debug!("uniforme {:#010x} non chargé depuis VFS : {e}", uniform_crc);
                (None, None, None)
            }
        }
    } else {
        (None, None, None)
    };

    let input = CharacterAssemblyInput {
        internal_code: code.to_string(),
        body_type_idx,
        glb_dir: state.glb_dir.clone(),
        uniform_model_crc: uniform_crc,
        uniform_g4md,
        uniform_g4mg,
        uniform_glb_path: None,
    };

    let mut model = assemble_character_model(&input)
        .with_context(|| format!("assemblage personnage {code}"))?;

    // Charge la texture d'UNIFORME une seule fois. Elle habille à la fois le maillage d'uniforme
    // ET le corps de base : le corps VISIBLE du perso EST l'uniforme (réf. art officielle —
    // tunique + ceinture), pas une « peau de base ». L'ancien placeholder
    // `_face/20_EDIT/_base/{type}.g4tx` (32×32) donnait un corps jaune uni cassé.
    let uniform_png = uniform_g4tx_path
        .as_deref()
        .and_then(|path| load_uniform_texture_png(state, path));

    // Corps de base → texture d'uniforme (au lieu du placeholder de peau 32×32).
    if let Some(png_bytes) = uniform_png.clone() {
        info!("texture corps (uniforme) embarquée : {} ({} B PNG)", code, png_bytes.len());
        model.embedded_textures.push(EmbeddedTexture {
            component: MeshComponent::Body,
            name: format!("{code}_body"),
            png_bytes,
        });
    } else {
        debug!("uniforme indisponible pour le corps de {code} — matériau Default");
    }

    // Visage : atlas de visage (inchangé).
    if let Some(png_bytes) = load_face_texture_png(state, code) {
        info!("texture face embarquée : {} ({} B PNG)", code, png_bytes.len());
        model.embedded_textures.push(EmbeddedTexture {
            component: MeshComponent::Face,
            name: format!("{code}_face"),
            png_bytes,
        });
    } else {
        debug!("texture face absente/non décodée pour {code} — matériau Default");
    }

    // Uniforme : même texture que le corps.
    if let Some(png_bytes) = uniform_png {
        info!("texture uniforme embarquée : {} ({} B PNG)", code, png_bytes.len());
        model.embedded_textures.push(EmbeddedTexture {
            component: MeshComponent::Uniform,
            name: format!("{code}_uniform"),
            png_bytes,
        });
    } else {
        debug!("texture uniforme absente/non décodée pour {code} — matériau Default");
    }

    Ok(model.to_glb_embedded())
}

/// Résultat du chargement d'un uniforme depuis le VFS.
struct UniformData {
    g4md: Vec<u8>,
    g4mg: Vec<u8>,
    /// Chemin VFS du G4TX de texture (pour chargement séparé).
    g4tx_path: Option<String>,
}

/// Charge les données G4MD+G4MG d'un uniforme depuis le VFS.
///
/// Priorité 1 : `uniform-model-map.ndjson` (CRC = crc32_std du code logique, couvre IE1/GO/VR).
/// Priorité 2 : `model-crc-manifest.ndjson` (CRC = crc32_nie du stem fichier, couvre VR uniquement).
fn load_uniform_from_vfs(state: &State, crc: u32) -> Result<UniformData> {
    // Priorité 1 : manifeste uniforme (chara_parts).
    if let Some(entry) = state.uniform_map.get(&crc) {
        let g4md_path = &entry.g4md;
        let g4mg_path = g4md_to_g4mg_path(g4md_path);
        let g4tx_path = entry.g4tx.clone();

        let vfs = state.vfs.lock().unwrap();
        let g4md = vfs.read(g4md_path.as_str())
            .with_context(|| format!("lecture G4MD uniforme {g4md_path}"))?;
        let g4mg = vfs.read(&g4mg_path)
            .with_context(|| format!("lecture G4MG uniforme {g4mg_path}"))?;

        return Ok(UniformData { g4md, g4mg, g4tx_path: Some(g4tx_path) });
    }

    // Priorité 2 : manifeste CRC (fallback pour VR — espace CRC différent).
    let g4md_path = resolve_crc_to_g4md_path(&state.crc_manifest, crc)
        .ok_or_else(|| anyhow::anyhow!("CRC uniforme {:#010x} absent des deux manifestes", crc))?;
    let g4mg_path = g4md_to_g4mg_path(g4md_path);

    let vfs = state.vfs.lock().unwrap();
    let g4md = vfs.read(g4md_path)
        .with_context(|| format!("lecture G4MD {g4md_path}"))?;
    let g4mg = vfs.read(&g4mg_path)
        .with_context(|| format!("lecture G4MG {g4mg_path}"))?;

    Ok(UniformData { g4md, g4mg, g4tx_path: None })
}

/// Assemble un keshin (code `kXXXXXX`).
fn assemble_keshin_code(state: &State, code: &str) -> Result<GlbBytes> {
    let g4md_path = format!("data/common/chr/_keshin/{code}/{code}.g4md");
    let g4mg_path = format!("data/common/chr/_keshin/{code}/{code}.g4mg");

    let (g4md, g4mg) = {
        let vfs = state.vfs.lock().unwrap();
        let g4md = vfs.read(&g4md_path)
            .with_context(|| format!("G4MD keshin {g4md_path}"))?;
        let g4mg = vfs.read(&g4mg_path)
            .with_context(|| format!("G4MG keshin {g4mg_path}"))?;
        (g4md, g4mg)
    };

    let mut model = assemble_keshin(code, g4md, g4mg)
        .with_context(|| format!("assemblage keshin {code}"))?;

    if let Some(png_bytes) = load_keshin_texture_png(state, code) {
        info!("texture keshin embarquée : {} ({} B PNG)", code, png_bytes.len());
        model.embedded_textures.push(EmbeddedTexture {
            component: MeshComponent::Keshin,
            name: format!("{code}_keshin"),
            png_bytes,
        });
    }

    Ok(model.to_glb_embedded())
}

/// Assemble une armure (code `kaXXXXXX`).
fn assemble_armed_code(state: &State, code: &str) -> Result<GlbBytes> {
    // Le répertoire armure = les 7 premiers chars du code (ka + 6 chiffres de répertoire)
    let dir_name = &code[..code.len().min(8)]; // ex. "ka001901"
    let g4md_path = format!("data/common/chr/_armd/{dir_name}/{code}.g4md");
    let g4mg_path = format!("data/common/chr/_armd/{dir_name}/{code}.g4mg");

    let (g4md, g4mg) = {
        let vfs = state.vfs.lock().unwrap();
        let g4md = vfs.read(&g4md_path)
            .with_context(|| format!("G4MD armd {g4md_path}"))?;
        let g4mg = vfs.read(&g4mg_path)
            .with_context(|| format!("G4MG armd {g4mg_path}"))?;
        (g4md, g4mg)
    };

    let mut model = assemble_armed(code, g4md, g4mg)
        .with_context(|| format!("assemblage armure {code}"))?;

    if let Some(png_bytes) = load_armed_texture_png(state, code) {
        info!("texture armure embarquée : {} ({} B PNG)", code, png_bytes.len());
        model.embedded_textures.push(EmbeddedTexture {
            component: MeshComponent::Armed,
            name: format!("{code}_armed"),
            png_bytes,
        });
    }

    Ok(model.to_glb_embedded())
}

/// Point d'entrée d'assemblage : dispatch selon le code.
fn assemble_code(state: &State, code: &str) -> Result<GlbBytes> {
    if code.starts_with("ka") {
        assemble_armed_code(state, code)
    } else if code.starts_with('k') {
        assemble_keshin_code(state, code)
    } else if code.starts_with('c') {
        assemble_chara(state, code)
    } else {
        bail!("code non reconnu (pas c/k/ka) : {code}")
    }
}

/// Sous-domaines `common/chr/_<sub>/` servables comme modèles génériques (g4md+g4mg).
/// Liste fermée pour interdire toute traversée arbitraire du VFS via le nom de sous-dossier.
const CHR_GENERIC_SUBS: &[&str] = &["waza", "item", "animal", "armd", "keshin"];

/// Assemble un modèle générique d'un sous-domaine `common/chr/_<sub>/<code>/<code>.g4md|.g4mg`.
///
/// Couvre les modèles non liés à un personnage : techniques (`_waza`), objets 3D (`_item`),
/// animaux (`_animal`). Le **G4MD peut être absent en fichier libre** : pour les modèles de
/// cut-in (`_waza`), il est empaqueté dans le `.g4pkm` voisin — on l'en extrait alors. La
/// **texture** `dx11/chr/_<sub>/<code>/<code>.g4tx` est embarquée si présente (rendu texturé).
/// Échoue (404 côté HTTP) si le G4MG ou le G4MD restent introuvables.
fn assemble_chr_generic(state: &State, sub: &str, code: &str) -> Result<GlbBytes> {
    if !CHR_GENERIC_SUBS.contains(&sub) {
        bail!("sous-domaine chr non servable : {sub}");
    }
    let g4md_path = format!("data/common/chr/_{sub}/{code}/{code}.g4md");
    let g4mg_path = format!("data/common/chr/_{sub}/{code}/{code}.g4mg");
    let g4pkm_path = format!("data/common/chr/_{sub}/{code}/{code}.g4pkm");

    let (g4md, g4mg) = {
        let vfs = state.vfs.lock().unwrap();
        let g4mg = vfs
            .read(&g4mg_path)
            .with_context(|| format!("G4MG {g4mg_path}"))?;
        // G4MD libre, sinon extrait du g4pkm (cas des modèles waza).
        let g4md = match vfs.read(&g4md_path) {
            Ok(b) => b,
            Err(_) => {
                let pkm = vfs
                    .read(&g4pkm_path)
                    .with_context(|| format!("ni G4MD libre ni g4pkm pour {sub}/{code}"))?;
                extract_g4md_from_g4pkm(&pkm)
                    .with_context(|| format!("G4MD absent du g4pkm {g4pkm_path}"))?
            }
        };
        (g4md, g4mg)
    };

    let mut model = assemble_generic_model(GenericModelInput {
        code: code.to_string(),
        g4md,
        g4mg,
        component: MeshComponent::Generic,
    })
    .with_context(|| format!("assemblage {sub}/{code}"))?;

    // Texture du cut-in (dx11/chr/_<sub>/<code>/<code>.g4tx) → embarquée.
    let g4tx_path = format!("data/dx11/chr/_{sub}/{code}/{code}.g4tx");
    let g4tx = {
        let vfs = state.vfs.lock().unwrap();
        vfs.read(&g4tx_path).ok()
    };
    if let Some(png_bytes) = g4tx.as_deref().and_then(g4tx_decode::decode_best_to_png) {
        model.embedded_textures.push(EmbeddedTexture {
            component: MeshComponent::Generic,
            name: format!("{code}_{sub}"),
            png_bytes,
        });
        return Ok(model.to_glb_embedded());
    }

    Ok(model.to_glb())
}

/// Assemble un modèle de **map/stage** : `data/common/map/<rel>/<base>.{g4mg,g4pkm}` où
/// `base` = dernier composant de `rel`. Comme les maps n'ont pas de G4MD libre, il est **extrait
/// du `.g4pkm`** voisin (même mécanique que les modèles waza) ; le G4MG porte la géométrie monde.
/// Texture embarquée si un `.g4tx` voisin (dx11 ou common) est trouvé. C'est le **monde 3D** du jeu.
fn assemble_map(state: &State, rel: &str) -> Result<GlbBytes> {
    let base = rel.rsplit('/').next().unwrap_or(rel);
    let g4mg_path = format!("data/common/map/{rel}/{base}.g4mg");
    let g4md_path = format!("data/common/map/{rel}/{base}.g4md");
    let g4pkm_path = format!("data/common/map/{rel}/{base}.g4pkm");

    let (g4md, g4mg) = {
        let vfs = state.vfs.lock().unwrap();
        let g4mg = vfs.read(&g4mg_path).with_context(|| format!("G4MG {g4mg_path}"))?;
        let g4md = match vfs.read(&g4md_path) {
            Ok(b) => b,
            Err(_) => {
                let pkm = vfs
                    .read(&g4pkm_path)
                    .with_context(|| format!("ni G4MD libre ni g4pkm pour map {rel}"))?;
                extract_g4md_from_g4pkm(&pkm)
                    .with_context(|| format!("G4MD absent du g4pkm {g4pkm_path}"))?
            }
        };
        (g4md, g4mg)
    };

    // Binding matériau (RE) AVANT de consommer g4md : nom de texture par matériau (table d'offsets)
    // + material_index PAR SUBMESH (@+0x43 du record, propre aux maps ; @+0x33 vaut 0 partout).
    let md_parsed = nie_formats::g4md::parse(&g4md).ok();
    let mat_names = md_parsed.as_ref().map_or_else(Vec::new, |m| {
        nie_formats::g4md::extract_map_material_names(&g4md, m.header.material_count as usize)
    });
    let submesh_mat: Vec<usize> = md_parsed.as_ref().map_or_else(Vec::new, |m| {
        let si = m.header.submesh_info as usize;
        (0..m.submeshes.len())
            .map(|i| usize::from(*g4md.get(si + i * 0x50 + 0x43).unwrap_or(&0)))
            .collect()
    });

    let mut model = assemble_generic_model(GenericModelInput {
        code: base.to_string(),
        g4md,
        g4mg,
        component: MeshComponent::Generic,
    })
    .with_context(|| format!("assemblage map {rel}"))?;

    // Affecte à chaque primitive (= submesh) son nom de matériau (cœur, sans `_` final).
    if !mat_names.is_empty() && !submesh_mat.is_empty() {
        for (i, prim) in model.primitives.iter_mut().enumerate() {
            if let Some(&mi) = submesh_mat.get(i)
                && let Some(name) = mat_names.get(mi)
            {
                prim.material_name = name.trim_end_matches('_').to_string();
            }
        }
    }

    // Textures PAR MATÉRIAU depuis le g4tx du STAGE (`<stage>g.g4tx`, 32 textures nommées). Pour
    // chaque matériau distinct, on embarque la texture dont le nom (`<core>.1` base color) matche
    // le `material_name` de la primitive ; `to_glb_embedded` lie alors par nom.
    let stage_dir = rel.rsplit_once('/').map_or(rel, |(d, _)| d);
    let group = base.trim_end_matches(|c: char| c.is_ascii_digit());
    let stage_g4tx = {
        let vfs = state.vfs.lock().unwrap();
        vfs.read(&format!("data/dx11/map/{stage_dir}/{group}.g4tx")).ok()
    };
    if let Some(bytes) = &stage_g4tx
        && let Ok(g4tx) = parse_g4tx(bytes)
    {
        // Base color `.1` d'une texture : nom sans le suffixe `.N`.
        let tex_base = |t: &nie_formats::g4tx::G4txTexture| -> String {
            t.name.rsplit_once('.').map_or(t.name.clone(), |(b, _)| b.to_string())
        };
        let mut seen = std::collections::HashSet::new();
        for core in model.primitives.iter().map(|p| p.material_name.clone()).collect::<Vec<_>>() {
            if core.is_empty() || !seen.insert(core.clone()) {
                continue;
            }
            // Texture base-color dont le base est un préfixe du nom de matériau (gère les noms
            // concaténés du g4md, ex. ground02_re_…grass01 → ground02_re.1).
            let pick = g4tx
                .textures
                .iter()
                .filter(|t| t.is_dds && t.name.ends_with(".1"))
                .find(|t| core.starts_with(&tex_base(t)));
            if let Some(tex) = pick
                && let Some(png_bytes) = g4tx_decode::decode_texture_rgba(bytes, tex)
                .and_then(|(w, h, rgba)| g4tx_decode::encode_rgba_to_png(&rgba, w as usize, h as usize))
            {
                model.embedded_textures.push(EmbeddedTexture {
                    component: MeshComponent::Generic,
                    name: core.clone(),
                    png_bytes,
                });
            }
        }
        if !model.embedded_textures.is_empty() {
            return Ok(model.to_glb_embedded());
        }
        // Repli : texture de sol dominante si aucun binding par matériau n'a abouti.
        if let Some(tex) = g4tx
            .textures
            .iter()
            .filter(|t| t.is_dds && t.name.ends_with(".1"))
            .find(|t| t.name.contains("ground") || t.name.contains("grass"))
            && let Some(png_bytes) = g4tx_decode::decode_texture_rgba(bytes, tex)
                .and_then(|(w, h, rgba)| g4tx_decode::encode_rgba_to_png(&rgba, w as usize, h as usize))
        {
            model.embedded_textures.push(EmbeddedTexture {
                component: MeshComponent::Generic,
                name: format!("{base}_map"),
                png_bytes,
            });
            return Ok(model.to_glb_embedded());
        }
    }
    Ok(model.to_glb())
}

/// Cache disque pour un modèle de map (`map_<rel-sécurisé>.glb`).
fn get_or_build_map_glb(state: &State, rel: &str) -> Result<GlbBytes> {
    let cache_path = state.cache_dir.join(format!("map_{}.glb", rel.replace('/', "_")));
    if cache_path.exists() {
        debug!("cache hit : map {rel}");
        return fs::read(&cache_path)
            .with_context(|| format!("lecture cache {}", cache_path.display()));
    }
    info!("assemblage live : map {rel}");
    let glb = assemble_map(state, rel)?;
    if let Err(e) = fs::write(&cache_path, &glb) {
        warn!("écriture cache map {rel} échouée : {e}");
    }
    Ok(glb)
}

/// Extrait les octets du premier fichier `.g4md` d'une archive `.g4pkm` (paquet de modèle waza).
fn extract_g4md_from_g4pkm(pkm: &[u8]) -> Result<Vec<u8>> {
    let pk = nie_formats::g4pk::parse(pkm).context("parse g4pkm")?;
    let f = pk
        .files
        .iter()
        .find(|f| f.name.ends_with(".g4md"))
        .context("aucun .g4md dans le g4pkm")?;
    let end = f.offset + f.size;
    if end > pkm.len() {
        bail!("entrée g4md hors limites du g4pkm");
    }
    Ok(pkm[f.offset..end].to_vec())
}

// ── Décodage audio ─────────────────────────────────────────────────────────────

/// Clé de déchiffrement HCA IEVR (fixe pour tout le jeu).
///
/// Source : `public const ulong DecryptionKey = 59278503195307634` dans
/// `SoundPlayManager.cs` extrait du dump il2cpp IEVR
/// (`data/cross-apk/work/laneA-il2cpp/dump/cs/.../Soccer/Sound/SoundPlayManager.cs`).
/// Valeur hex : `0x00D2997C0DC5EE72`.
const IEVR_HCA_KEY: u64 = 59_278_503_195_307_634;

/// Décode un fichier HCA Criware chiffré (ciph_type=56) en PCM 16-bit via `cridecoder`.
///
/// `cridecoder::HcaDecoder` implémente l'algorithme HCA complet (MDCT + overlap-add +
/// scale factors + intensity stereo + cipher type 0/1/56 conforme vgmstream).
///
/// La clé principale `IEVR_HCA_KEY` est fixe ; `subkey` est la sous-clé AWB lue à
/// l'offset `0x0E` de l'en-tête AFS2 (voir [`Awb::subkey`]). Passer `subkey=0` pour
/// les HCA hors AWB (flux direct, ACB embarqué sans AFS2).
///
/// **Important** : `set_encryption_key` doit être appelé AVANT la première trame —
/// avec `keycode==0` cridecoder traite le fichier comme `ciph_type=0` (aucun
/// déchiffrement), produisant du bruit silencieux sur les HCA IEVR.
fn hca_decode_to_pcm16(raw: &[u8], subkey: u16) -> anyhow::Result<(Vec<i16>, u32, u32)> {
    use cridecoder::{HcaDecoder, HcaDecoderError};
    use std::io::Cursor;

    let cursor = Cursor::new(raw);
    let mut decoder = HcaDecoder::from_reader(cursor)
        .map_err(|e| anyhow::anyhow!("HCA init: {e}"))?;

    // Déchiffrement HCA IEVR (ciph_type=56) : DOIT être posé avant toute trame.
    // La formule de combinaison clé+sous-clé (vgmstream) :
    //   combined = keycode * ((subkey << 16) | (!subkey_u16 + 2))   si subkey != 0
    //   combined = keycode                                            si subkey == 0
    decoder.set_encryption_key(IEVR_HCA_KEY, u64::from(subkey));

    let info = decoder.info().clone();
    let channels = info.channel_count;
    let sample_rate = info.sampling_rate;
    let frame_samples = info.samples_per_block * info.channel_count as usize;
    let mut pcm_buf = vec![0i16; frame_samples];
    let mut all_samples: Vec<i16> = Vec::with_capacity(
        info.block_count as usize * frame_samples
    );

    loop {
        match decoder.decode_frame_i16(&mut pcm_buf) {
            Ok(0) => {} // trame delay (encoder delay initial)
            Ok(n) => {
                // n = nombre de sample-frames, pcm_buf est déjà entrelacé
                let count = n * channels as usize;
                all_samples.extend_from_slice(&pcm_buf[..count]);
            }
            Err(HcaDecoderError::Eof) => break,
            Err(e) => return Err(anyhow::anyhow!("HCA frame: {e}")),
        }
    }

    Ok((all_samples, channels, sample_rate))
}

/// Décode n'importe quel format audio Criware en WAV PCM 16-bit.
///
/// Dispatch selon le magic détecté dans `raw` et l'extension de `vfs_path` :
///   - HCA direct (`HCA\0`) → `hca_decode_to_pcm16` (cridecoder)
///   - ADX direct (`0x8000`) → `adx_decode`
///   - AWB (`AFS2`) → `Awb::parse`, première entrée HCA/ADX
///   - ACB (`@UTF`) → `acb_parse`, AWB embarqué, première entrée HCA/ADX
fn decode_audio_to_wav(raw: &[u8], vfs_path: &str) -> anyhow::Result<Vec<u8>> {
    // Identifie le format par le magic
    if is_hca(raw) {
        // HCA direct (hors AWB) — sous-clé 0 car pas d'en-tête AFS2.
        let (samples, channels, sample_rate) = hca_decode_to_pcm16(raw, 0)
            .map_err(|e| anyhow::anyhow!("HCA decode: {e}"))?;
        return Ok(encode_pcm16_wav(&samples, channels, sample_rate));
    }

    if is_adx(raw) {
        // ADX direct
        let pcm = adx_decode(raw)
            .map_err(|e| anyhow::anyhow!("ADX decode: {e}"))?;
        return Ok(encode_pcm16_wav(&pcm.samples, pcm.channels, pcm.sample_rate));
    }

    if raw.starts_with(b"AFS2") {
        // AWB → extrait la première entrée HCA/ADX
        return decode_awb_first_entry(raw, vfs_path);
    }

    if raw.starts_with(b"@UTF") {
        // ACB → extrait le AWB embarqué, puis première entrée
        let acb = acb_parse(raw)
            .map_err(|e| anyhow::anyhow!("ACB parse: {e}"))?;
        if !acb.embedded_awb.is_empty() {
            return decode_awb_first_entry(&acb.embedded_awb, vfs_path);
        }
        // AWB externe : signalé par nom sans données embarquées — signaler à l'appelant
        anyhow::bail!("ACB sans AWB");
    }

    anyhow::bail!("format audio non reconnu (magic: {:02x?})", &raw[..raw.len().min(4)])
}

/// Extrait et décode la première entrée HCA/ADX d'un AWB AFS2.
///
/// La sous-clé AWB (`awb.subkey`, u16 LE à l'offset `0x0E` de l'en-tête AFS2)
/// est propagée à `hca_decode_to_pcm16` pour le déchiffrement IEVR (`ciph_type=56`).
fn decode_awb_first_entry(data: &[u8], vfs_path: &str) -> anyhow::Result<Vec<u8>> {
    decode_awb_entry(data, vfs_path, None)
}

/// Décode **une** entrée d'un AWB en WAV. `which` = index d'entrée (`?cue=N`) ; par défaut
/// (`None`), choisit l'entrée la **plus volumineuse** — pour une banque de voix, la première
/// entrée est souvent un court grognement, alors que la plus grosse est une vraie réplique.
fn decode_awb_entry(data: &[u8], vfs_path: &str, which: Option<usize>) -> anyhow::Result<Vec<u8>> {
    let awb = Awb::parse(data).map_err(|e| anyhow::anyhow!("AWB parse: {e}"))?;
    if awb.entries.is_empty() {
        anyhow::bail!("AWB {vfs_path} sans entrée");
    }
    let subkey = awb.subkey;

    // Ordre d'essai : l'index demandé en premier, sinon par taille décroissante.
    let mut order: Vec<usize> = (0..awb.entries.len()).collect();
    match which {
        Some(i) if i < awb.entries.len() => {
            order.retain(|&k| k != i);
            order.insert(0, i);
        }
        Some(i) => anyhow::bail!("cue {i} hors limites ({} entrées)", awb.entries.len()),
        None => order.sort_by_key(|&k| {
            core::cmp::Reverse(awb.entry_bytes(data, &awb.entries[k]).len())
        }),
    }

    for k in order {
        let entry = &awb.entries[k];
        let entry_data = awb.entry_bytes(data, entry);
        if entry_data.is_empty() {
            continue;
        }
        if is_hca(entry_data) {
            let (samples, channels, sample_rate) = hca_decode_to_pcm16(entry_data, subkey)
                .map_err(|e| anyhow::anyhow!("HCA decode entrée cue={}: {e}", entry.cue_id))?;
            return Ok(encode_pcm16_wav(&samples, channels, sample_rate));
        }
        if is_adx(entry_data) {
            let pcm = adx_decode(entry_data)
                .map_err(|e| anyhow::anyhow!("ADX decode entrée cue={}: {e}", entry.cue_id))?;
            return Ok(encode_pcm16_wav(&pcm.samples, pcm.channels, pcm.sample_rate));
        }
        // Si une cue précise a été demandée et n'est pas décodable, on n'essaie pas les autres.
        if which.is_some() {
            anyhow::bail!("cue {k} non décodable (ni HCA ni ADX)");
        }
    }

    anyhow::bail!("AWB {vfs_path} : aucune entrée HCA/ADX valide trouvée")
}

/// Réencapsule un flux H.264 Annex-B brut en MP4 fragmenté (lisible directement
/// par un `<video>` navigateur) via ffmpeg en remux sans réencodage (`-c copy`).
///
/// Le H.264 brut sorti du démux USM n'a ni conteneur ni timing -> on lui impose
/// 60 fps (cadence réelle des films IEVR) et on produit un MP4 `frag_keyframe`
/// (sortie séquentielle compatible pipe). Renvoie `None` si ffmpeg est absent ou
/// échoue -> l'appelant retombe alors sur le H.264 brut (téléchargement).
fn mux_h264_to_mp4(h264: &[u8]) -> Option<Vec<u8>> {
    use std::process::{Command, Stdio};
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);

    // Fichier d'entrée temporaire (évite le deadlock écriture-stdin/lecture-stdout).
    let n = SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = std::env::temp_dir().join(format!("nms-h264-{}-{}.264", std::process::id(), n));
    std::fs::write(&tmp, h264).ok()?;

    let out = Command::new("ffmpeg")
        .args(["-loglevel", "error", "-r", "60", "-i"])
        .arg(&tmp)
        .args([
            "-c:v",
            "copy",
            "-an",
            "-f",
            "mp4",
            "-movflags",
            "frag_keyframe+empty_moov+default_base_moof",
            "pipe:1",
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output();
    let _ = std::fs::remove_file(&tmp);

    let out = out.ok()?;
    if out.status.success() && !out.stdout.is_empty() {
        Some(out.stdout)
    } else {
        None
    }
}

/// Retourne les bytes du GLB : depuis le cache disque ou assemblage live + mise en cache.
fn get_or_build_glb(state: &State, code: &str) -> Result<GlbBytes> {
    let cache_path = state.cache_dir.join(format!("{code}.glb"));

    // Cache hit.
    if cache_path.exists() {
        debug!("cache hit : {code}");
        return fs::read(&cache_path)
            .with_context(|| format!("lecture cache {}", cache_path.display()));
    }

    // Assemblage live.
    info!("assemblage live : {code}");
    let glb = assemble_code(state, code)?;

    // Écriture dans le cache (best-effort — on ne bloque pas si ça échoue).
    if let Err(e) = fs::write(&cache_path, &glb) {
        warn!("écriture cache {code} échouée : {e}");
    } else {
        debug!("cache écrit : {code} ({}B)", glb.len());
    }

    Ok(glb)
}

/// Variante sous-domaine chr : cache préfixé `chr_<sub>_<code>.glb` (évite la collision
/// d'espace de noms avec `/model-full/<code>`).
fn get_or_build_chr_glb(state: &State, sub: &str, code: &str) -> Result<GlbBytes> {
    let cache_path = state.cache_dir.join(format!("chr_{sub}_{code}.glb"));

    if cache_path.exists() {
        debug!("cache hit : chr_{sub}_{code}");
        return fs::read(&cache_path)
            .with_context(|| format!("lecture cache {}", cache_path.display()));
    }

    info!("assemblage live : chr_{sub}_{code}");
    let glb = assemble_chr_generic(state, sub, code)?;

    if let Err(e) = fs::write(&cache_path, &glb) {
        warn!("écriture cache chr_{sub}_{code} échouée : {e}");
    } else {
        debug!("cache écrit : chr_{sub}_{code} ({}B)", glb.len());
    }

    Ok(glb)
}

// ── Préchargement du cache (warm) ───────────────────────────────────────────────

/// Une unité de préchargement : un modèle servable à assembler dans le cache.
enum WarmJob {
    /// `/model-full/<code>` — personnage (`c…`), keshin (`k…`) ou armure (`ka…`).
    Full(String),
    /// `/model-chr/<sub>/<code>` — modèle générique (waza/item/animal).
    Chr(String, String),
}

/// Extrait le code d'un chemin VFS de la forme `…<marker>…/<code>/<code><ext>` (dossier == fichier).
/// Renvoie `None` si le motif ne correspond pas.
fn code_of_dir_pair(path: &str, marker: &str, ext: &str) -> Option<String> {
    if !path.contains(marker) || !path.ends_with(ext) {
        return None;
    }
    let file = path.rsplit('/').next()?;
    let code = file.strip_suffix(ext)?;
    let parent_path = &path[..path.len() - file.len() - 1];
    let parent = parent_path.rsplit('/').next()?;
    (parent == code).then(|| code.to_string())
}

/// Énumère tous les modèles servables du VFS (persos, keshin, armures, génériques), dédupliqués.
/// Base du préchargement exhaustif : chaque entrée mappe 1:1 sur une route `/model-full`
/// ou `/model-chr` et donc sur un appel `get_or_build_*`.
fn enumerate_servable_codes(vfs: &Vfs) -> Vec<WarmJob> {
    let mut full: BTreeSet<String> = BTreeSet::new();
    let mut chr: BTreeSet<(String, String)> = BTreeSet::new();
    for (path, _) in vfs.iter() {
        // Personnages : dx11/chr/_face/<série>/<code>/<code>.g4tx (code = c + chiffres).
        if let Some(code) = code_of_dir_pair(path, "/_face/", ".g4tx")
            && code.starts_with('c')
            && code.len() > 1
            && code[1..].bytes().all(|b| b.is_ascii_digit())
        {
            full.insert(code);
            continue;
        }
        // Keshin : common/chr/_keshin/<code>/<code>.g4md (code = k + chiffres, pas `ka`).
        if let Some(code) = code_of_dir_pair(path, "/_keshin/", ".g4md")
            && code.starts_with('k')
            && code.as_bytes().get(1).is_some_and(u8::is_ascii_digit)
        {
            full.insert(code);
            continue;
        }
        // Armures : common/chr/_armd/<dir>/<code>.g4md (dossier ≠ code → pas de paire stricte).
        if path.contains("/_armd/")
            && path.ends_with(".g4md")
            && let Some(code) = path.rsplit('/').next().and_then(|f| f.strip_suffix(".g4md"))
            && code.starts_with("ka")
        {
            full.insert(code.to_string());
            continue;
        }
        // Génériques waza/item/animal : common/chr/_<sub>/<code>/<code>.g4mg.
        for sub in CHR_GENERIC_SUBS {
            if *sub == "keshin" || *sub == "armd" {
                continue; // déjà couverts par /model-full
            }
            if let Some(code) = code_of_dir_pair(path, &format!("/_{sub}/"), ".g4mg") {
                chr.insert(((*sub).to_string(), code));
                break;
            }
        }
    }
    full.into_iter()
        .map(WarmJob::Full)
        .chain(chr.into_iter().map(|(s, c)| WarmJob::Chr(s, c)))
        .collect()
}

/// Octets disponibles sur le FS contenant `path` (via `df`). `None` si indéterminé.
fn free_bytes(path: &Path) -> Option<u64> {
    let out = std::process::Command::new("df")
        .arg("-B1")
        .arg("--output=avail")
        .arg(path)
        .output()
        .ok()?;
    String::from_utf8_lossy(&out.stdout).lines().nth(1)?.trim().parse::<u64>().ok()
}

/// Seuil d'arrêt du préchargement : on stoppe si l'espace libre passe sous 3 Gio.
const PRELOAD_MIN_FREE_BYTES: u64 = 3 * 1024 * 1024 * 1024;

/// Lance le préchargement en arrière-plan : assemble TOUS les modèles servables dans le cache.
/// Le serveur reste disponible pendant le warm. Idempotent (cache hit = saut), multi-thread
/// (`workers`), arrêté si le disque devient critique.
fn spawn_preload(state: Arc<State>, workers: usize) {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering::Relaxed};
    thread::spawn(move || {
        let jobs = {
            let vfs = state.vfs.lock().unwrap();
            enumerate_servable_codes(&vfs)
        };
        let total = jobs.len();
        info!("préchargement : {total} modèles servables énumérés — warm du cache en cours…");
        let jobs = Arc::new(jobs);
        let next = Arc::new(AtomicUsize::new(0));
        let done = Arc::new(AtomicUsize::new(0));
        let stop = Arc::new(AtomicBool::new(false));
        let mut handles = Vec::new();
        for _ in 0..workers.max(1) {
            let (jobs, next, done, stop, state) =
                (jobs.clone(), next.clone(), done.clone(), stop.clone(), state.clone());
            handles.push(thread::spawn(move || loop {
                if stop.load(Relaxed) {
                    break;
                }
                let i = next.fetch_add(1, Relaxed);
                if i >= jobs.len() {
                    break;
                }
                let res = match &jobs[i] {
                    WarmJob::Full(code) => get_or_build_glb(&state, code).map(|_| ()),
                    WarmJob::Chr(sub, code) => get_or_build_chr_glb(&state, sub, code).map(|_| ()),
                };
                if let Err(e) = res {
                    debug!("préchargement : entrée {i} non assemblable : {e}");
                }
                let n = done.fetch_add(1, Relaxed) + 1;
                if n.is_multiple_of(200) {
                    if free_bytes(&state.cache_dir).is_some_and(|f| f < PRELOAD_MIN_FREE_BYTES) {
                        warn!("préchargement : espace disque < 3 Gio — arrêt à {n}/{total}");
                        stop.store(true, Relaxed);
                        break;
                    }
                    info!("préchargement : {n}/{total} modèles traités");
                }
            }));
        }
        for h in handles {
            let _ = h.join();
        }
        info!("préchargement terminé : {}/{total} modèles dans le cache", done.load(Relaxed));
    });
}

// ── Serveur HTTP minimal ──────────────────────────────────────────────────────

/// Réponse HTTP.
fn respond(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
) {
    let headers = format!(
        "HTTP/1.1 {status} {reason}\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Cache-Control: public, max-age=31536000, immutable\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cross-Origin-Resource-Policy: cross-origin\r\n\
         X-Content-Type-Options: nosniff\r\n\
         Connection: close\r\n\
         \r\n",
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.write_all(body);
}

fn respond_text(stream: &mut TcpStream, status: u16, reason: &str, body: &str) {
    respond(stream, status, reason, "text/plain; charset=utf-8", body.as_bytes());
}

/// Parse `Range: bytes=START-END` (END optionnel) → `(start, end_inclus)` borné à `total`.
fn parse_range(header: &str, total: usize) -> Option<(usize, usize)> {
    let spec = header.trim().strip_prefix("bytes=")?;
    // On ne gère que la 1re plage (cas navigateur courant), pas le multipart.
    let spec = spec.split(',').next()?.trim();
    let (a, b) = spec.split_once('-')?;
    if total == 0 {
        return None;
    }
    let last = total - 1;
    let (start, end) = if a.is_empty() {
        // suffixe `-N` : les N derniers octets.
        let n: usize = b.trim().parse().ok()?;
        (total.saturating_sub(n), last)
    } else {
        let start: usize = a.trim().parse().ok()?;
        let end = if b.is_empty() { last } else { b.trim().parse::<usize>().ok()?.min(last) };
        (start, end)
    };
    if start > end || start > last {
        return None;
    }
    Some((start, end))
}

/// Réponse honorant `Range` : `206 Partial Content` + `Content-Range` si une plage valide est
/// demandée, sinon `200` complet. Toujours `Accept-Ranges: bytes` (le navigateur peut seek).
/// Le corps étant déjà en mémoire (WAV/MP4 décodé), le slice est immédiat.
fn respond_ranged(stream: &mut TcpStream, content_type: &str, body: &[u8], range: Option<&str>) {
    if let Some((start, end)) = range.and_then(|r| parse_range(r, body.len())) {
        let slice = &body[start..=end];
        let headers = format!(
            "HTTP/1.1 206 Partial Content\r\n\
             Content-Type: {content_type}\r\n\
             Content-Length: {}\r\n\
             Content-Range: bytes {start}-{end}/{}\r\n\
             Accept-Ranges: bytes\r\n\
             Cache-Control: public, max-age=31536000, immutable\r\n\
             Access-Control-Allow-Origin: *\r\n\
             Cross-Origin-Resource-Policy: cross-origin\r\n\
             Connection: close\r\n\
             \r\n",
            slice.len(),
            body.len(),
        );
        let _ = stream.write_all(headers.as_bytes());
        let _ = stream.write_all(slice);
        return;
    }
    let headers = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Accept-Ranges: bytes\r\n\
         Cache-Control: public, max-age=31536000, immutable\r\n\
         Access-Control-Allow-Origin: *\r\n\
         Cross-Origin-Resource-Policy: cross-origin\r\n\
         X-Content-Type-Options: nosniff\r\n\
         Connection: close\r\n\
         \r\n",
        body.len(),
    );
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.write_all(body);
}

/// Parse la méthode + le chemin depuis la première ligne de la requête HTTP.
fn parse_request_line(line: &str) -> Option<(&str, &str)> {
    let mut parts = line.splitn(3, ' ');
    let method = parts.next()?;
    let path = parts.next()?;
    Some((method, path))
}

/// Gère une connexion : lit la requête, route, renvoie la réponse.
fn handle_connection(mut stream: TcpStream, state: Arc<State>) {
    let mut reader = BufReader::new(stream.try_clone().expect("clone stream"));
    let mut first_line = String::new();

    if reader.read_line(&mut first_line).is_err() {
        return;
    }
    let first_line = first_line.trim_end_matches(['\r', '\n']);

    let Some((method, path)) = parse_request_line(first_line) else {
        respond_text(&mut stream, 400, "Bad Request", "mauvaise requête");
        return;
    };

    if method != "GET" {
        respond_text(&mut stream, 405, "Method Not Allowed", "GET uniquement");
        return;
    }

    // Lit les headers ; on ne capture que `Range` (seek audio/vidéo).
    let mut range_header: Option<String> = None;
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            _ => {}
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
        if let Some(v) = line.trim_end().strip_prefix("Range:").or_else(|| line.trim_end().strip_prefix("range:")) {
            range_header = Some(v.trim().to_string());
        }
    }
    let range_header = range_header.as_deref();

    // Strippe la query string (`?v=3` cache-bust d'azalee) : le code modèle vit dans le
    // path seul. Sans ça, `strip_suffix(".glb")` échoue sur `c….glb?v=3` -> "code invalide".
    let path = path.split('?').next().unwrap_or(path);

    // Routing.
    if path == "/health" {
        respond_text(&mut stream, 200, "OK", "ok");
        return;
    }

    // `/tex/<vfs-path>.png` — décode N'IMPORTE QUEL G4TX du VFS en PNG. Les textures
    // perso (face/uniforme/corps sous `dx11/chr/`) sont absentes du dump ET non servies
    // par le décodeur menu live (:8788) ; seul ce service a le décodeur nie-formats. La
    // source est `<path>.g4tx` (l'URL en `.png` est mappée dessus). Anti-traversal strict.
    if let Some(rest) = path.strip_prefix("/tex/") {
        let g4tx_rel = rest
            .strip_suffix(".png")
            .map(|s| format!("{s}.g4tx"))
            .unwrap_or_else(|| rest.to_string());
        let vfs_path = if g4tx_rel.starts_with("data/") {
            g4tx_rel
        } else {
            format!("data/{g4tx_rel}")
        };
        if vfs_path.contains("..") || !vfs_path.ends_with(".g4tx") {
            respond_text(&mut stream, 400, "Bad Request", "chemin invalide (.g4tx/.png attendu)");
            return;
        }
        let g4tx = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        match g4tx.as_deref().and_then(g4tx_decode::decode_best_to_png) {
            Some(png) => respond(&mut stream, 200, "OK", "image/png", &png),
            None => respond_text(&mut stream, 404, "Not Found", "texture absente/non décodée"),
        }
        return;
    }

    // `/cfg/<vfs-path>.json` — décode un cfg.bin/objbin/fxbin/mevbin RDBN en JSON natif.
    if let Some(rest) = path.strip_prefix("/cfg/") {
        let rel = rest.strip_suffix(".json").unwrap_or(rest);
        let vfs_path = if rel.starts_with("data/") {
            rel.to_string()
        } else {
            format!("data/{rel}")
        };
        if vfs_path.contains("..") {
            respond_text(&mut stream, 400, "Bad Request", "chemin invalide");
            return;
        }
        let bytes = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        match bytes.as_deref().and_then(cfgbin_to_json) {
            Some(json) => {
                let body = serde_json::to_vec(&json).unwrap_or_default();
                respond(&mut stream, 200, "OK", "application/json; charset=utf-8", &body);
            }
            None => respond_text(&mut stream, 404, "Not Found", "cfg.bin absent ou non-RDBN"),
        }
        return;
    }

    // `/typed/<vfs-path>.json` — décode un cfg.bin en STRUCTURE DE JEU typée `nie-data`
    // (formation, skill, item…) au lieu du RDBN brut. Renvoie `{family, data}` ; repli
    // `{family:null, key, generic:<rdbn iecode>}` si la famille n'a pas de parseur typé.
    if let Some(rest) = path.strip_prefix("/typed/") {
        let rel = rest.strip_suffix(".json").unwrap_or(rest);
        let vfs_path = if rel.starts_with("data/") {
            rel.to_string()
        } else {
            format!("data/{rel}")
        };
        if vfs_path.contains("..") {
            respond_text(&mut stream, 400, "Bad Request", "chemin invalide");
            return;
        }
        let bytes = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        match bytes.as_deref().and_then(cfgbin_to_typed_root) {
            Some(root) => {
                let key = nie_data::typed::family_key(&vfs_path);
                let out = match nie_data::typed::decode_by_key(&key, &root) {
                    Some((family, data)) => serde_json::json!({ "family": family, "data": data }),
                    None => {
                        serde_json::json!({ "family": serde_json::Value::Null, "key": key, "generic": root })
                    }
                };
                let body = serde_json::to_vec(&out).unwrap_or_default();
                respond(&mut stream, 200, "OK", "application/json; charset=utf-8", &body);
            }
            None => respond_text(&mut stream, 404, "Not Found", "cfg.bin absent ou non-RDBN a listes"),
        }
        return;
    }

    // `/lip/<vfs-path>.json` — décode une piste de lip-sync `.p3lip` en visèmes datés
    // (`{duration_s, frames:[{time_s, viseme, channel, param}]}`) à jouer en synchro voix.
    if let Some(rest) = path.strip_prefix("/lip/") {
        let rel = rest.strip_suffix(".json").unwrap_or(rest);
        let vfs_path =
            if rel.starts_with("data/") { rel.to_string() } else { format!("data/{rel}") };
        if vfs_path.contains("..") {
            respond_text(&mut stream, 400, "Bad Request", "chemin invalide");
            return;
        }
        let bytes = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        match bytes.as_deref().map(nie_formats::lip::parse) {
            Some(Ok(lip)) => {
                let body = serde_json::to_vec(&lip).unwrap_or_default();
                respond(&mut stream, 200, "OK", "application/json; charset=utf-8", &body);
            }
            Some(Err(e)) => {
                respond_text(&mut stream, 422, "Unprocessable Entity", &format!("p3lip invalide : {e}"));
            }
            None => respond_text(&mut stream, 404, "Not Found", "fichier absent du VFS"),
        }
        return;
    }

    // `/raw/<vfs-path>` — bytes décompressés/déchiffrés bruts du CPK (texte, download).
    if let Some(rest) = path.strip_prefix("/raw/") {
        let vfs_path = if rest.starts_with("data/") {
            rest.to_string()
        } else {
            format!("data/{rest}")
        };
        if vfs_path.contains("..") {
            respond_text(&mut stream, 400, "Bad Request", "chemin invalide");
            return;
        }
        let bytes = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        match bytes {
            Some(b) => {
                let ct = if std::str::from_utf8(&b).is_ok() {
                    "text/plain; charset=utf-8"
                } else {
                    "application/octet-stream"
                };
                respond(&mut stream, 200, "OK", ct, &b);
            }
            None => respond_text(&mut stream, 404, "Not Found", "fichier absent du VFS"),
        }
        return;
    }

    // `/menu-render/<screen>.png` — rend un layout de menu (sprites) en PNG côté serveur.
    // Remplace le renderer WebGPU navigateur (fragile). Déterministe + identique partout.
    if let Some(rest) = path.strip_prefix("/menu-render/") {
        let screen = rest.strip_suffix(".png").unwrap_or(rest);
        if screen.is_empty()
            || screen.len() > 64
            || !screen.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            respond_text(&mut stream, 400, "Bad Request", "écran invalide");
            return;
        }
        let layout_path = state.layout_dir.join(format!("{screen}.json"));
        let Ok(txt) = fs::read_to_string(&layout_path) else {
            respond_text(&mut stream, 404, "Not Found", "layout introuvable");
            return;
        };
        let layout: menu::Layout = match serde_json::from_str(&txt) {
            Ok(l) => l,
            Err(e) => {
                warn!("layout {screen} invalide : {e}");
                respond_text(&mut stream, 500, "Internal Server Error", "layout illisible");
                return;
            }
        };
        let png = menu::render_menu(&layout, |logical_path| {
            let vfs_path = if logical_path.starts_with("data/") {
                logical_path.to_string()
            } else {
                format!("data/{logical_path}")
            };
            let g4tx = {
                let vfs = state.vfs.lock().unwrap();
                vfs.read(&vfs_path).ok()
            }?;
            g4tx_decode::decode_best_to_rgba(&g4tx)
        });
        match png {
            Some(bytes) => respond(&mut stream, 200, "OK", "image/png", &bytes),
            None => respond_text(&mut stream, 500, "Internal Server Error", "rendu échoué"),
        }
        return;
    }

    // `/story-scene[/<n>].png` — scène de dialogue du MODE HISTOIRE : un vrai dialogue
    // (`inagle_event_subtitles`) rendu dans la VRAIE police + boîte + onglet locuteur. `<n>` =
    // offset de ligne déterministe (défaut 0). Sert le mode histoire à azalee, sans dump.
    if let Some(rest) = path.strip_prefix("/story-scene") {
        let sel = rest.trim_start_matches('/').strip_suffix(".png").unwrap_or("").trim();
        let offset: i64 = sel.parse().unwrap_or(0).max(0);
        let Some(db) = state.db_path.clone() else {
            respond_text(&mut stream, 503, "Service Unavailable", "miroir SQLite absent");
            return;
        };
        let dialogue = Connection::open_with_flags(&db, OpenFlags::SQLITE_OPEN_READ_ONLY)
            .ok()
            .and_then(|conn| {
                let n: i64 = conn
                    .query_row(
                        "SELECT COUNT(*) FROM inagle_event_subtitles \
                         WHERE text_en IS NOT NULL AND length(text_en)>5",
                        [],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                if n == 0 {
                    return None;
                }
                conn.query_row(
                    "SELECT COALESCE(line_label,'???'), COALESCE(text_fr, text_en) \
                     FROM inagle_event_subtitles WHERE text_en IS NOT NULL AND length(text_en)>5 \
                     ORDER BY event_id, line_index LIMIT 1 OFFSET ?1",
                    [offset % n],
                    |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                )
                .ok()
            });
        let Some((speaker, text)) = dialogue else {
            respond_text(&mut stream, 404, "Not Found", "dialogue introuvable (table inagle absente ?)");
            return;
        };
        let (cfg, g4tx) = {
            let vfs = state.vfs.lock().unwrap();
            (
                vfs.read("data/common/font/font/font_def/font.cfg.bin").ok(),
                vfs.read("data/dx11/font/font_def/font.g4tx").ok(),
            )
        };
        let (Some(cfg), Some(g4tx)) = (cfg, g4tx) else {
            respond_text(&mut stream, 500, "Internal Server Error", "police absente du VFS");
            return;
        };
        match compose_story_png(&cfg, &g4tx, &speaker, &text) {
            Some(png) => respond(&mut stream, 200, "OK", "image/png", &png),
            None => respond_text(&mut stream, 500, "Internal Server Error", "composition échouée"),
        }
        return;
    }

    // `/model-chr/<sub>/<code>.glb` — modèle générique d'un sous-domaine `common/chr/_<sub>/`
    // (techniques `waza`, objets `item`, animaux `animal`). Maillage g4md+g4mg, sans texture
    // embarquée. Sous-domaines whitelistés (anti-traversal).
    if let Some(rest) = path.strip_prefix("/model-chr/") {
        let body = rest.strip_suffix(".glb").unwrap_or(rest);
        let mut parts = body.splitn(2, '/');
        let sub = parts.next().unwrap_or("");
        let code = parts.next().unwrap_or("");
        let valid = |s: &str| {
            !s.is_empty() && s.len() <= 32 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        };
        if !valid(sub) || !valid(code) {
            respond_text(&mut stream, 400, "Bad Request", "sous-domaine/code invalide");
            return;
        }
        match get_or_build_chr_glb(&state, sub, code) {
            Ok(glb) => respond(&mut stream, 200, "OK", "model/gltf-binary", &glb),
            Err(e) => {
                debug!("assemblage chr {sub}/{code} échoué : {e}");
                respond_text(
                    &mut stream,
                    404,
                    "Not Found",
                    &format!("modèle {sub}/{code} non disponible : {e}"),
                );
            }
        }
        return;
    }

    // `/model-map/<rel>.glb` — modèle de map/stage (géométrie du monde 3D, ex.
    // `s/s02g001/s02g001g02`). Composants alphanum/_ uniquement (anti-traversal, pas de `..`).
    if let Some(rest) = path.strip_prefix("/model-map/") {
        let rel = rest.strip_suffix(".glb").unwrap_or(rest);
        let valid = !rel.is_empty()
            && rel.len() <= 96
            && rel.split('/').all(|s| {
                !s.is_empty() && s.len() <= 32 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            });
        if !valid {
            respond_text(&mut stream, 400, "Bad Request", "chemin map invalide");
            return;
        }
        match get_or_build_map_glb(&state, rel) {
            Ok(glb) => respond(&mut stream, 200, "OK", "model/gltf-binary", &glb),
            Err(e) => {
                debug!("assemblage map {rel} échoué : {e}");
                respond_text(&mut stream, 404, "Not Found", &format!("map {rel} non disponible : {e}"));
            }
        }
        return;
    }

    // `/model-full/<code>.glb`
    if let Some(rest) = path.strip_prefix("/model-full/") {
        let code = rest.strip_suffix(".glb").unwrap_or(rest);
        // Validation minimale : alphanumérique + _-
        if code.is_empty()
            || code.len() > 32
            || !code.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            respond_text(&mut stream, 400, "Bad Request", "code invalide");
            return;
        }

        match get_or_build_glb(&state, code) {
            Ok(glb) => {
                respond(
                    &mut stream,
                    200,
                    "OK",
                    "model/gltf-binary",
                    &glb,
                );
            }
            Err(e) => {
                warn!("assemblage {code} échoué : {e}");
                respond_text(&mut stream, 404, "Not Found", &format!("modèle {code} non disponible : {e}"));
            }
        }
        return;
    }

    // `/audio/<vfs-path>` — décode HCA/ADX depuis le VFS en WAV PCM 16-bit.
    // Sources possibles :
    //   - `.hca` : décode directement.
    //   - `.adx` : décode directement.
    //   - `.acb` : extrait le AWB embarqué puis décode la première piste HCA/ADX.
    //   - `.awb` : extrait et décode la première entrée HCA/ADX.
    // Paramètre optionnel `?cue=N` pour sélectionner une entrée spécifique dans un AWB/ACB.
    if let Some(rest) = path.strip_prefix("/audio/") {
        let vfs_path = if rest.starts_with("data/") {
            rest.to_string()
        } else {
            format!("data/{rest}")
        };
        if vfs_path.contains("..") {
            respond_text(&mut stream, 400, "Bad Request", "chemin invalide");
            return;
        }
        let bytes = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        match bytes {
            None => {
                respond_text(&mut stream, 404, "Not Found", "fichier audio absent du VFS");
            }
            Some(raw) => {
                // Tente le décodage direct ; si l'ACB signale "sans AWB", cherche le .awb externe
                let result = decode_audio_to_wav(&raw, &vfs_path).or_else(|e| {
                    let msg = e.to_string();
                    if msg.contains("ACB sans AWB") {
                        // AWB externe : même chemin, extension .awb
                        let awb_path = if vfs_path.ends_with(".acb") {
                            format!("{}.awb", &vfs_path[..vfs_path.len() - 4])
                        } else {
                            return Err(e);
                        };
                        let vfs_guard = state.vfs.lock().unwrap();
                        let awb_bytes = vfs_guard.read(&awb_path)
                            .map_err(|_| anyhow::anyhow!("AWB externe {awb_path} absent du VFS"))?;
                        drop(vfs_guard);
                        decode_awb_first_entry(&awb_bytes, &awb_path)
                    } else {
                        Err(e)
                    }
                });
                match result {
                    Ok(wav) => respond_ranged(&mut stream, "audio/wav", &wav, range_header),
                    Err(e) => {
                        warn!("décodage audio {vfs_path} échoué : {e}");
                        respond_text(&mut stream, 500, "Internal Server Error",
                            &format!("décodage audio échoué : {e}"));
                    }
                }
            }
        }
        return;
    }

    // `/video/<vfs-path>` — démultiplexe un USM Sofdec2 depuis le VFS.
    // Résultat : flux vidéo H.264 brut (`.264`) ou VP9 (`.ivf`), piste audio WAV si présente.
    // Par défaut, renvoie la vidéo (Content-Type: video/mp4 pour H.264, video/webm pour VP9).
    // Le WAV audio peut être récupéré en suffixant `?track=audio`.
    if let Some(rest) = path.strip_prefix("/video/") {
        let vfs_path = if rest.starts_with("data/") {
            rest.to_string()
        } else {
            format!("data/{rest}")
        };
        if vfs_path.contains("..") {
            respond_text(&mut stream, 400, "Bad Request", "chemin invalide");
            return;
        }
        let bytes = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        match bytes {
            None => {
                respond_text(&mut stream, 404, "Not Found", "fichier vidéo absent du VFS");
            }
            Some(raw) => {
                match usm_demux(&raw) {
                    Err(e) => {
                        warn!("démux USM {vfs_path} échoué : {e}");
                        respond_text(&mut stream, 500, "Internal Server Error",
                            &format!("démux USM échoué : {e}"));
                    }
                    Ok(result) => {
                        if result.video_data.is_empty() {
                            respond_text(&mut stream, 404, "Not Found",
                                "USM sans piste vidéo");
                            return;
                        }
                        let (ct, body) = match result.video_codec {
                            // H.264 brut -> remux MP4 fragmenté (lisible <video>) ;
                            // repli sur le flux brut si ffmpeg indisponible.
                            VideoCodec::H264 => match mux_h264_to_mp4(&result.video_data) {
                                Some(mp4) => ("video/mp4", mp4),
                                None => ("video/h264", result.video_data),
                            },
                            VideoCodec::Vp9  => ("video/webm", result.video_data),
                            VideoCodec::Unknown => ("application/octet-stream", result.video_data),
                        };
                        info!("USM {} démuxé : {} frames, {}B",
                            vfs_path, result.frame_count, body.len());
                        respond_ranged(&mut stream, ct, &body, range_header);
                    }
                }
            }
        }
        return;
    }

    respond_text(&mut stream, 404, "Not Found", "non trouvé");
}

// ── Résolution du miroir SQLite ───────────────────────────────────────────────

fn resolve_db(db_override: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = db_override {
        if p.exists() {
            return Some(p.to_path_buf());
        }
        warn!("DB spécifiée introuvable : {}", p.display());
        return None;
    }

    // Variables d'environnement.
    for var in &["NIE_WIKI_DB", "SQLITE_DB_PATH"] {
        if let Ok(v) = std::env::var(var) {
            let p = PathBuf::from(&v);
            if p.exists() {
                return Some(p);
            }
        }
    }

    // Répertoire de backups niers.
    let backups = PathBuf::from("/home/ubuntu/niers/data/backups");
    if backups.is_dir() {
        let mut candidates: Vec<PathBuf> = fs::read_dir(&backups)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.extension().map(|e| e == "sqlite").unwrap_or(false)
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.starts_with("supabase-"))
                        .unwrap_or(false)
            })
            .collect();
        candidates.sort();
        if let Some(p) = candidates.last() {
            return Some(p.clone());
        }
    }

    // Fallback : miroir azalee.
    let azalee_backups = PathBuf::from("/home/ubuntu/rg/apps/azalee/data/backups");
    if azalee_backups.is_dir() {
        let mut candidates: Vec<PathBuf> = fs::read_dir(&azalee_backups)
            .into_iter()
            .flatten()
            .flatten()
            .map(|e| e.path())
            .filter(|p| {
                p.extension().map(|e| e == "sqlite").unwrap_or(false)
                    && p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|s| s.starts_with("supabase-"))
                        .unwrap_or(false)
            })
            .collect();
        candidates.sort();
        if let Some(p) = candidates.last() {
            return Some(p.clone());
        }
    }

    warn!("aucun miroir SQLite trouvé — résolution uniforme désactivée");
    None
}

/// Charge l'index global `[chemin, cpk]` (NDJSON, gzip si extension `.gz`) en paires
/// `(chemin_interne, nom_cpk)` pour l'index supplémentaire du VFS. Le `.gz` est décompressé
/// via `zcat` (pas de dépendance flate2). Chemin absent → `Ok(vec![])`.
fn load_cpk_file_index(path: &std::path::Path) -> Result<Vec<(String, String)>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw: Vec<u8> = if path.extension().and_then(|e| e.to_str()) == Some("gz") {
        let out = std::process::Command::new("zcat")
            .arg(path)
            .output()
            .with_context(|| format!("zcat {}", path.display()))?;
        if !out.status.success() {
            anyhow::bail!("zcat a échoué pour {}", path.display());
        }
        out.stdout
    } else {
        std::fs::read(path).with_context(|| format!("lecture {}", path.display()))?
    };
    let text = String::from_utf8_lossy(&raw);
    let mut entries = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        // Chaque ligne : `["data/.../x.usm","<hash>.cpk"]`.
        if let Ok(serde_json::Value::Array(arr)) = serde_json::from_str::<serde_json::Value>(line)
            && let (Some(p), Some(c)) = (
                arr.first().and_then(serde_json::Value::as_str),
                arr.get(1).and_then(serde_json::Value::as_str),
            )
        {
            entries.push((p.to_string(), c.to_string()));
        }
    }
    Ok(entries)
}

// ── Main ──────────────────────────────────────────────────────────────────────

fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();

    // Prépare le répertoire de cache.
    fs::create_dir_all(&cli.cache_dir)
        .with_context(|| format!("création cache_dir {}", cli.cache_dir.display()))?;

    // Initialise le VFS.
    let mut vfs = Vfs::new();
    let game_data = cli.game_dir.join("data");
    vfs.init(&game_data)
        .with_context(|| format!("init VFS depuis {}", game_data.display()))?;
    info!("VFS initialisé ({} fichiers indexés)", vfs.asset_count());

    // Index supplémentaire : rend lisibles les fichiers des CPK hors cpk_list.cfg.bin
    // (films .usm, sound_asset .acb…) via l'index global [chemin, cpk].
    match load_cpk_file_index(&cli.cpk_file_index) {
        Ok(entries) if !entries.is_empty() => {
            let added = vfs.add_extra_index(entries);
            info!("index VFS supplémentaire : +{added} fichiers (CPK hors cpk_list)");
        }
        Ok(_) => {}
        Err(e) => warn!("index VFS supplémentaire ignoré ({}): {e}", cli.cpk_file_index.display()),
    }

    // Charge les manifestes.
    let crc_manifest = State::load_crc_manifest(&cli.crc_manifest)?;
    let uniform_map = State::load_uniform_map(&cli.uniform_map);
    let body_map = State::load_body_map(&cli.body_manifest);

    // Résout le miroir SQLite.
    let db_path = resolve_db(cli.db.as_deref());
    if let Some(ref p) = db_path {
        info!("miroir SQLite : {}", p.display());
    }

    let state = Arc::new(State {
        vfs: std::sync::Mutex::new(vfs),
        glb_dir: cli.glb_dir.clone(),
        crc_manifest,
        uniform_map,
        body_map,
        cache_dir: cli.cache_dir.clone(),
        db_path,
        layout_dir: cli.layout_dir.clone(),
    });

    // Bind du serveur TCP.
    let addr = format!("127.0.0.1:{}", cli.port);
    let listener = TcpListener::bind(&addr)
        .with_context(|| format!("bind {addr}"))?;
    info!("nie-model-serve en écoute sur http://{addr}");

    // Préchargement optionnel : warm exhaustif du cache GLB en arrière-plan.
    if cli.preload {
        spawn_preload(state.clone(), cli.threads);
    }

    // Pool de threads simple (accepte les connexions dans le thread principal,
    // les traite dans des threads indépendants).
    for stream in listener.incoming() {
        match stream {
            Ok(s) => {
                let state_clone = state.clone();
                thread::spawn(move || {
                    handle_connection(s, state_clone);
                });
            }
            Err(e) => {
                error!("connexion entrante échouée : {e}");
            }
        }
    }

    Ok(())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // Les tests de résolution de format DDS (DX10 / FourCC legacy / non compressé) ont migré
    // avec le décodeur dans `nie_formats::g4tx_decode` (feature `textures`, source unique).

    /// Garde le câblage `/typed` des familles golden sorties du vase clos : sur le .json de
    /// référence, `typed_decode` doit renvoyer le bon label + un payload non vide. **Drift-résistant**
    /// (PAS de compte en dur — cf. la dérive des golden corrigée ce cycle). Game-gated (skip si dump
    /// absent). Couvre les 2 vagues (uniform/players_universe/nfc + search_word/passive/ai/input).
    #[test]
    fn typed_decode_cable_les_familles_golden() {
        const G: &str = "/home/ubuntu/niers/data/common/gamedata";
        let cases: [(&str, &str, String); 20] = [
            ("uniform_config", "uniform", format!("{G}/character/uniform_config_1.03.52.00.cfg.bin.json")),
            ("players_universe_config", "players_universe", format!("{G}/players_universe/players_universe_config_1.03.59.00.cfg.bin.json")),
            ("players_universe_event_config", "players_universe_event", format!("{G}/players_universe/players_universe_event_config.cfg.bin.json")),
            ("nfc_lottery_config", "nfc_lottery", format!("{G}/nfc/nfc_lottery_config.cfg.bin.json")),
            ("search_word_config", "search_word", format!("{G}/search_word/search_word_config.cfg.bin.json")),
            ("passive_skill_config", "passive", format!("{G}/skill/passive_skill_config_0.08.86.cfg.bin.json")),
            ("soccer_ai_cmd_config", "soccer_ai_cmd", format!("{G}/ai/soccer_ai_cmd_config_0.05.91.cfg.bin.json")),
            ("soccer_user_ai_config", "soccer_user_ai", format!("{G}/ai/soccer_user_ai_config_1.01.50.cfg.bin.json")),
            ("strategy_ai_config", "strategy_ai", format!("{G}/ai/strategy_ai_config_1.01.50.cfg.bin.json")),
            ("tactics_ai_config", "tactics_ai", format!("{G}/ai/tactics_ai_config_0.06.44.cfg.bin.json")),
            ("adaptive_trigger_def", "adaptive_trigger", format!("{G}/input/adaptive_trigger_def_0.00.00.cfg.bin.json")),
            ("haptic_feedback_def", "haptic_feedback", format!("{G}/input/haptic_feedback_def_0.00.00.cfg.bin.json")),
            ("vibration_def", "vibration", format!("{G}/input/vibration_def_0.00.09.cfg.bin.json")),
            // Échantillon de la 3e vague (workflow d'analyse 31 familles).
            ("basara_chara_config", "basara_chara", format!("{G}/character/basara_chara_config_0.00.00.00.cfg.bin.json")),
            ("belong_team_config", "belong_team", format!("{G}/character/belong_team_config_0.00.00.cfg.bin.json")),
            ("capsule_config", "capsule", format!("{G}/capsule/capsule_config_0.00.00.cfg.bin.json")),
            ("chara_base", "chara_base", format!("{G}/character/chara_base_1.03.98.00.cfg.bin.json")),
            ("shop_config", "shop", format!("{G}/shop/shop_config_3.00.22.cfg.bin.json")),
            ("quest_config", "quest", format!("{G}/quest/quest_config_1.04.11.00.cfg.bin.json")),
            ("real_skill_config", "real_skill", format!("{G}/skill/real_skill_config_1.03.74.00.cfg.bin.json")),
        ];
        for (key, label, path) in &cases {
            let (key, label): (&str, &str) = (key, label);
            if !std::path::Path::new(path).exists() {
                eprintln!("dump absent, skip {key}");
                continue;
            }
            let txt = std::fs::read_to_string(path).expect("lire json");
            let root: serde_json::Value = serde_json::from_str(&txt).expect("json valide");
            let (got_label, value) =
                nie_data::typed::decode_by_key(key, &root)
                    .unwrap_or_else(|| panic!("{key} : decode_by_key → Some"));
            assert_eq!(got_label, label, "{key} : label de famille");
            let non_empty = match &value {
                serde_json::Value::Array(a) => !a.is_empty(),
                serde_json::Value::Object(o) => !o.is_empty(),
                _ => false,
            };
            assert!(non_empty, "{key} : payload non vide");
        }
    }

    #[test]
    fn preload_code_of_dir_pair() {
        // Personnage : dossier == stem du fichier → code extrait.
        assert_eq!(
            code_of_dir_pair("data/dx11/chr/_face/01_IE1/c01000010/c01000010.g4tx", "/_face/", ".g4tx")
                .as_deref(),
            Some("c01000010")
        );
        // Keshin.
        assert_eq!(
            code_of_dir_pair("data/common/chr/_keshin/k000010/k000010.g4md", "/_keshin/", ".g4md")
                .as_deref(),
            Some("k000010")
        );
        // Dossier ≠ fichier (texture de partie, pas un modèle) → rejeté.
        assert_eq!(
            code_of_dir_pair("data/dx11/chr/_face/01_IE1/c01000010/base_normal_00.g4tx", "/_face/", ".g4tx"),
            None
        );
        // Marqueur absent → rejeté.
        assert_eq!(code_of_dir_pair("data/x/y/z.g4tx", "/_face/", ".g4tx"), None);
    }

    /// Valide le déchiffrement HCA réel depuis le premier AWB IEVR.
    ///
    /// Gated derrière la feature `real-audio` (même convention que `real-saves`/
    /// `real-fixtures`) car le fichier AWB n'est pas distribué avec le repo.
    ///
    /// Asserte :
    /// - décodage `Ok` — pas de `SyncError`/`ChecksumFailed` → clé correcte
    /// - `sample_rate == 48000` Hz
    /// - `channels == 1` (mono)
    /// - signal non silencieux (au moins un sample i16 non nul → RMS > 0)
    #[cfg(feature = "real-audio")]
    #[test]
    fn hca_ievr_dechiffrement_cle_correcte() {
        const AWB_PATH: &str =
            "/home/ubuntu/niers/data/cross-apk/work/laneE-audio/staging/c00001001.awb";

        let data = std::fs::read(AWB_PATH).expect(
            "fichier AWB absent — lancer avec `--features real-audio` sur le VPS IEVR",
        );

        let awb = Awb::parse(&data).expect("AWB parse échoué");
        assert!(!awb.entries.is_empty(), "AWB sans entrée");

        // Trouve la première entrée HCA.
        let entry_data = awb
            .entries
            .iter()
            .map(|e| awb.entry_bytes(&data, e))
            .find(|d| is_hca(d))
            .expect("aucune entrée HCA dans l'AWB de test");

        // Sous-clé AFS2 : 0xC62A pour c00001001.awb (vérifié sur le fichier réel).
        assert_eq!(awb.subkey, 0xC62A, "sous-clé AWB inattendue");

        let (samples, channels, sample_rate) =
            hca_decode_to_pcm16(entry_data, awb.subkey)
                .expect("décodage HCA IEVR échoué — clé ou format incorrect");

        assert_eq!(sample_rate, 48_000, "sample_rate attendu : 48000 Hz");
        assert_eq!(channels, 1, "canal attendu : mono (1)");
        assert!(!samples.is_empty(), "aucun sample décodé — encoder_delay absorbe tout ?");

        // Signal non silencieux : avec la bonne clé, les samples doivent être non nuls.
        // Sans la clé (keycode=0), le déchiffrement est l'identité → bruit bas/nul.
        let non_zero = samples.iter().any(|&s| s != 0);
        assert!(
            non_zero,
            "tous les samples sont nuls — vérifier que set_encryption_key est bien appliqué"
        );
    }

    /// Répertoire du jeu IEVR pour les tests adossés au VFS réel : `NIE_GAME_DIR` sinon
    /// l'install Steam par défaut. `None` ⇒ le test se SKIP proprement (CI sans jeu).
    fn game_dir_for_test() -> Option<std::path::PathBuf> {
        let candidates = [
            std::env::var("NIE_GAME_DIR").ok(),
            Some(
                "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road"
                    .to_string(),
            ),
        ];
        candidates
            .into_iter()
            .flatten()
            .map(std::path::PathBuf::from)
            .find(|p| p.join("data").is_dir())
    }

    /// A2 (généralisation) — le déchiffrement+décodage HCA IEVR est VALIDÉ sur **≥3 AWB réels
    /// distincts** tirés du VFS du jeu (pas seulement `c00001001.awb`). Pour chacun : `Awb::parse`
    /// → 1ʳᵉ entrée HCA → `hca_decode_to_pcm16(subkey)` ⇒ décodage `Ok`, samples non vides,
    /// **signal non silencieux** (clé correcte), `sample_rate`/`channels` plausibles. Se SKIP si le
    /// jeu est absent (CI). Ferme le « reste » A2 du ROADMAP (« généraliser la validation à ≥3 AWB »).
    #[test]
    fn hca_decode_generalise_sur_plusieurs_awb_reels() {
        let Some(game) = game_dir_for_test() else {
            eprintln!("skip hca_decode_generalise : jeu IEVR absent (NIE_GAME_DIR non posé)");
            return;
        };
        let mut vfs = Vfs::new();
        vfs.init(game.join("data").as_path()).expect("init VFS");

        // Liste TRIÉE et déterministe des AWB → reproductibilité run-à-run. On exclut les **banques
        // de streaming** (`anime_stream`/`bevent_stream`/`bgm`… = archives de plusieurs centaines de
        // Mo, des dizaines de minutes d'audio) au profit des banques **par-cue** (voix `c*`/`ev*`/
        // `sc*`) : lecture+parse rapides, même chemin de déchiffrement HCA.
        let mut awb_paths: Vec<String> = vfs
            .iter()
            .map(|(p, _)| p.to_string())
            .filter(|p| p.ends_with(".awb"))
            .filter(|p| {
                let base = p.rsplit('/').next().unwrap_or(p);
                !base.contains("stream") && !base.starts_with("bgm")
            })
            .collect();
        awb_paths.sort_unstable();
        assert!(awb_paths.len() >= 3, "moins de 3 AWB dans le VFS ({})", awb_paths.len());

        const TARGET: usize = 3;
        let mut ok: Vec<(String, u32, u32, usize)> = Vec::new(); // (path, sr, ch, samples)
        // Borne le nombre de tentatives pour garder le test rapide et déterministe.
        for path in awb_paths.iter().take(40) {
            if ok.len() >= TARGET {
                break;
            }
            let Ok(data) = vfs.read(path) else { continue };
            let Ok(awb) = Awb::parse(&data) else { continue };
            // 1ʳᵉ entrée HCA (certains AWB peuvent être ADX — on les saute) ; on borne la taille
            // brute (≤ 1 Mo) pour éviter les gros streams (`anime_stream`/`bgm` = dizaines de min
            // de stéréo) → test rapide tout en validant du décodage réel sur de vrais fichiers.
            let Some(entry_data) = awb
                .entries
                .iter()
                .map(|e| awb.entry_bytes(&data, e))
                .find(|d| is_hca(d) && d.len() <= 1_000_000)
            else {
                continue;
            };
            let Ok((samples, channels, sample_rate)) = hca_decode_to_pcm16(entry_data, awb.subkey)
            else {
                continue;
            };
            // Validations : signal réel, paramètres plausibles.
            assert!(!samples.is_empty(), "{path} : 0 sample décodé");
            assert!(
                samples.iter().any(|&s| s != 0),
                "{path} : signal entièrement nul (clé/subkey incorrecte ?)"
            );
            assert!(
                (8_000..=48_000).contains(&sample_rate),
                "{path} : sample_rate {sample_rate} hors plage plausible"
            );
            assert!((1..=2).contains(&channels), "{path} : channels {channels} inattendu");
            ok.push((path.clone(), sample_rate, channels, samples.len()));
        }

        for (p, sr, ch, n) in &ok {
            eprintln!("  HCA OK: {p}  {sr} Hz  {ch} ch  {n} samples");
        }
        assert!(
            ok.len() >= TARGET,
            "A2 : seulement {}/{TARGET} AWB HCA décodés+validés sur les 40 premiers",
            ok.len()
        );
    }
}
