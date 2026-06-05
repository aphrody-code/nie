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

use std::collections::HashMap;
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
    CharacterAssemblyInput, EmbeddedTexture, MeshComponent, SeasonKey,
    assemble_armed, assemble_character_model, assemble_keshin, g4md_to_g4mg_path, load_manifest,
    resolve_crc_to_g4md_path, type_idx_to_glb_name,
};
use nie_formats::g4tx::{G4txTexture, parse as parse_g4tx};
use nie_formats::vfs::Vfs;

mod menu;

use image_dds::{ImageFormat as DdsImageFormat, Surface as DdsSurface};

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

/// Table de correspondance DXGI format → `image_dds::ImageFormat`.
fn dxgi_to_image_format(dxgi: u32) -> Option<DdsImageFormat> {
    match dxgi {
        // BC1
        71 => Some(DdsImageFormat::BC1RgbaUnorm),
        72 => Some(DdsImageFormat::BC1RgbaUnormSrgb),
        // BC2
        73 => Some(DdsImageFormat::BC2RgbaUnorm),
        74 => Some(DdsImageFormat::BC2RgbaUnormSrgb),
        // BC3
        77 => Some(DdsImageFormat::BC3RgbaUnorm),
        78 => Some(DdsImageFormat::BC3RgbaUnormSrgb),
        // BC4
        79 | 80 => Some(DdsImageFormat::BC4RUnorm),
        // BC5
        83 | 84 => Some(DdsImageFormat::BC5RgUnorm),
        // BC6H
        95 => Some(DdsImageFormat::BC6hRgbUfloat),
        96 => Some(DdsImageFormat::BC6hRgbSfloat),
        // BC7
        98 => Some(DdsImageFormat::BC7RgbaUnorm),
        99 => Some(DdsImageFormat::BC7RgbaUnormSrgb),
        _ => None,
    }
}

/// Décode une texture spécifique d'un G4TX (l'entrée ayant la plus grande résolution parmi is_dds=true).
fn decode_best_g4tx_to_png(g4tx_data: &[u8]) -> Option<Vec<u8>> {
    let g4tx = parse_g4tx(g4tx_data).ok()?;
    // Prend la texture DDS avec le plus grand nombre de pixels.
    let tex = g4tx.textures.iter()
        .filter(|t| t.is_dds)
        .max_by_key(|t| (t.width as u64) * (t.height as u64))?;
    decode_texture_to_png(g4tx_data, tex)
}

/// Variante RGBA de [`decode_best_g4tx_to_png`] : renvoie `(w, h, rgba8)` sans ré-encoder
/// en PNG (utilisé par le compositeur de menu pour blitter directement).
fn decode_best_g4tx_to_rgba(g4tx_data: &[u8]) -> Option<(u32, u32, Vec<u8>)> {
    let g4tx = parse_g4tx(g4tx_data).ok()?;
    let tex = g4tx.textures.iter()
        .filter(|t| t.is_dds)
        .max_by_key(|t| (t.width as u64) * (t.height as u64))?;
    decode_texture_to_rgba(g4tx_data, tex)
}

/// Décode une entrée `G4txTexture` (DDS BC7/BC1/BC3/BC5) en PNG via `image_dds`.
fn decode_texture_to_png(g4tx_data: &[u8], tex: &G4txTexture) -> Option<Vec<u8>> {
    let (w, h, rgba) = decode_texture_to_rgba(g4tx_data, tex)?;
    encode_rgba_to_png(&rgba, w as usize, h as usize)
}

/// Décode une entrée `G4txTexture` (DDS BC7/BC1/BC3/BC5) en RGBA8 brut `(w, h, data)`.
fn decode_texture_to_rgba(g4tx_data: &[u8], tex: &G4txTexture) -> Option<(u32, u32, Vec<u8>)> {
    if !tex.is_dds {
        debug!("texture G4TX non-DDS ignorée ({}x{})", tex.width, tex.height);
        return None;
    }

    let offset = tex.data_offset;
    const DX10_DXGI_OFFSET: usize = 4 + 124; // magic(4) + DDS_HEADER(124) = 128
    const PIXEL_OFFSET: usize = 4 + 124 + 20; // magic + DDS_HEADER + DX10_EXT = 148

    if offset + PIXEL_OFFSET > g4tx_data.len() {
        warn!("G4TX : DDS payload trop court pour {offset}+{PIXEL_OFFSET} (len={})", g4tx_data.len());
        return None;
    }

    let dds_slice = &g4tx_data[offset..];

    // Vérifie le magic DDS.
    let magic = u32::from_le_bytes(dds_slice[..4].try_into().ok()?);
    if magic != 0x2053_4444 {
        warn!("G4TX : magic DDS attendu, trouvé {:#010x}", magic);
        return None;
    }

    // Lit le DXGI format depuis le header DX10.
    let dxgi_format = u32::from_le_bytes(
        dds_slice[DX10_DXGI_OFFSET..DX10_DXGI_OFFSET + 4].try_into().ok()?,
    );

    let image_fmt = match dxgi_to_image_format(dxgi_format) {
        Some(f) => f,
        None => {
            warn!("G4TX : DXGI format {dxgi_format} non supporté");
            return None;
        }
    };

    let w = tex.width as u32;
    let h = tex.height as u32;
    if w == 0 || h == 0 {
        return None;
    }

    let pixel_data = &dds_slice[PIXEL_OFFSET..];

    // Construit une `Surface` image_dds avec mip0 seulement.
    let surface = DdsSurface {
        width: w,
        height: h,
        depth: 1,
        layers: 1,
        mipmaps: 1,
        image_format: image_fmt,
        data: pixel_data,
    };

    let rgba_surface = surface.decode_rgba8().ok()?;
    Some((w, h, rgba_surface.data))
}

/// Encode un buffer RGBA brut en PNG.
fn encode_rgba_to_png(rgba: &[u8], w: usize, h: usize) -> Option<Vec<u8>> {
    let mut out_buf: Vec<u8> = Vec::with_capacity(w * h);
    {
        let mut encoder = png::Encoder::new(std::io::Cursor::new(&mut out_buf), w as u32, h as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(rgba).ok()?;
    }
    Some(out_buf)
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

    let png = decode_best_g4tx_to_png(&g4tx_data);
    if png.is_none() {
        warn!("décodage G4TX face {code} échoué");
    }
    png
}

/// Construit le chemin VFS de la texture de **peau (corps)** depuis le type de corps.
/// La maille de corps vient d'un GLB pré-converti `base_<classe>_NN` ; sa texture partage
/// le même nom de base sous `dx11/chr/_face/20_EDIT/_base/` (vérifié sur model-crc-manifest).
fn body_g4tx_vfs_path(body_type_idx: u8) -> Option<String> {
    let name = type_idx_to_glb_name(body_type_idx)?;
    Some(format!("data/dx11/chr/_face/20_EDIT/_base/{name}.g4tx"))
}

/// Tente de charger et décoder la texture de peau (corps) en PNG.
/// Retourne `None` (→ corps en matériau `Default`, aucun changement) si la texture est
/// absente ou indécodable : aucun risque de régression vs le comportement actuel.
fn load_body_texture_png(state: &State, body_type_idx: u8) -> Option<Vec<u8>> {
    let vfs_path = body_g4tx_vfs_path(body_type_idx)?;
    debug!("chargement texture corps : {vfs_path}");

    let g4tx_data = {
        let vfs = state.vfs.lock().unwrap();
        vfs.read(&vfs_path).ok()
    }?;

    let png = decode_best_g4tx_to_png(&g4tx_data);
    if png.is_none() {
        warn!("décodage G4TX corps {vfs_path} échoué");
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

    let png = decode_best_g4tx_to_png(&g4tx_data);
    if png.is_none() {
        warn!("décodage G4TX uniforme {g4tx_vfs_path} échoué");
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

    // Tente de charger et décoder la texture de peau (corps) depuis le VFS.
    // Le corps vient d'un GLB pré-converti sans material_name → sans ça, maille blanche
    // (matériau `Default`) malgré ses UV. La peau de base vit sous `_face/20_EDIT/_base/`.
    if let Some(png_bytes) = load_body_texture_png(state, body_type_idx) {
        info!("texture corps embarquée : {} ({} B PNG)", code, png_bytes.len());
        model.embedded_textures.push(EmbeddedTexture {
            component: MeshComponent::Body,
            name: format!("{code}_body"),
            png_bytes,
        });
    } else {
        debug!("texture corps absente/non décodée pour {code} — matériau Default");
    }

    // Tente de charger et décoder la texture de face depuis le VFS.
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

    // Tente de charger et décoder la texture de l'uniforme depuis le VFS.
    if let Some(g4tx_path) = uniform_g4tx_path {
        match load_uniform_texture_png(state, &g4tx_path) {
            Some(png_bytes) => {
                info!("texture uniforme embarquée : {} ({} B PNG, {})", code, png_bytes.len(), g4tx_path);
                model.embedded_textures.push(EmbeddedTexture {
                    component: MeshComponent::Uniform,
                    name: format!("{code}_uniform"),
                    png_bytes,
                });
            }
            None => {
                debug!("texture uniforme {g4tx_path} absente/non décodée — matériau Default");
            }
        }
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

    let model = assemble_keshin(code, g4md, g4mg)
        .with_context(|| format!("assemblage keshin {code}"))?;

    Ok(model.to_glb())
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

    let model = assemble_armed(code, g4md, g4mg)
        .with_context(|| format!("assemblage armure {code}"))?;

    Ok(model.to_glb())
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

    // Drain les headers (on n'en a pas besoin).
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) | Err(_) => break,
            _ => {}
        }
        if line == "\r\n" || line == "\n" {
            break;
        }
    }

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
        match g4tx.as_deref().and_then(decode_best_g4tx_to_png) {
            Some(png) => respond(&mut stream, 200, "OK", "image/png", &png),
            None => respond_text(&mut stream, 404, "Not Found", "texture absente/non décodée"),
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
            decode_best_g4tx_to_rgba(&g4tx)
        });
        match png {
            Some(bytes) => respond(&mut stream, 200, "OK", "image/png", &bytes),
            None => respond_text(&mut stream, 500, "Internal Server Error", "rendu échoué"),
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
