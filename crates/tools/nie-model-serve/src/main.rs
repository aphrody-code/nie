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
//! - `GET /tex/<chemin>.png`       — texture principale d'un `.g4tx` du VFS
//! - `GET /tex/<chemin>.g4tx/<nom>.png` — texture **nommée** de ce conteneur (ex.
//!   `/tex/dx11/menu/200_icon/02_icon_item/icon_item05.g4tx/eq_ac0100101.png`)
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
use nie_formats::cfgbin;
#[cfg(test)]
use nie_formats::cri_audio::{Awb, is_hca};
use nie_formats::cri_audio::{VideoCodec, usm_demux};
use nie_formats::g4tx::parse as parse_g4tx;
use nie_formats::g4tx_decode;
use nie_formats::vfs::Vfs;

mod menu;

// ── CLI ───────────────────────────────────────────────────────────────────────

/// Serveur HTTP live d'assemblage GLB IEVR (corps+face+uniforme, keshin, armures).
#[derive(Parser)]
#[command(name = "nie-model-serve", version, about)]
struct Cli {
    /// Répertoire racine du jeu (contient `data/cpk_list.cfg.bin`). Résolu automatiquement
    /// s'il est absent (`NIE_GAME_DIR`, sinon le répertoire courant ou un ancêtre).
    #[arg(long)]
    game_dir: Option<PathBuf>,

    /// Répertoire des GLB pré-convertis. Défaut : `<game-dir>/data/dx11/model`.
    #[arg(long)]
    glb_dir: Option<PathBuf>,

    /// Miroir SQLite (inagle_*). Résolution automatique si absent.
    #[arg(long)]
    db: Option<PathBuf>,

    /// Manifeste CRC32→chemin G4MD (var/model-crc-manifest.ndjson).
    #[arg(long)]
    crc_manifest: Option<PathBuf>,

    /// Manifeste uniforme CRC32→G4MD+G4TX (var/uniform-model-map.ndjson, généré depuis chara_parts).
    #[arg(long)]
    uniform_map: Option<PathBuf>,

    /// Index global `[chemin, cpk]` (NDJSON, .gz accepté) des fichiers de TOUS les CPK,
    /// y compris ceux hors `cpk_list.cfg.bin` (films, sound_asset…). Alimente l'index
    /// supplémentaire du VFS pour les rendre lisibles. Vide/absent = ignoré.
    #[arg(long)]
    cpk_file_index: Option<PathBuf>,

    /// Manifeste body_type_idx (var/body-type-manifest.ndjson, optionnel — fallback type_idx=0).
    #[arg(long)]
    body_manifest: Option<PathBuf>,

    /// Répertoire de cache GLB assemblés.
    #[arg(long)]
    cache_dir: Option<PathBuf>,

    /// Répertoire des layouts de menu (`<screen>.json`) pour le rendu serveur `/menu-render/`.
    /// Vit dans le dépôt azalee : aucun défaut ne peut être juste, la route est inactive sans lui.
    #[arg(long)]
    layout_dir: Option<PathBuf>,

    /// Répertoire des `*_menu_setting.cfg.bin.json` (un par écran) pour l'arbre `/menu-tree.json`.
    #[arg(long)]
    menu_cfg_dir: Option<PathBuf>,

    /// `data/asset-cross-reference.json` (nom de texture → data de jeu qui la référence :
    /// `entries/*.json` + chaînes Lua). Alimente le champ `role` de `/tex-info`.
    #[arg(long)]
    asset_cross_ref: Option<PathBuf>,

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
    /// Répertoire des `*_menu_setting.cfg.bin.json` (arbre d'écrans `/menu-tree.json`).
    menu_cfg_dir: PathBuf,
    /// Nom de texture (basename sans extension) → sources qui la référencent (`entries/*.json`,
    /// chaînes Lua), depuis `data/asset-cross-reference.json`. Alimente `/tex-info` `role`.
    asset_roles: HashMap<String, Vec<AssetSource>>,
}

/// Une source qui référence un asset, telle qu'écrite par
/// `rg/scripts/inagle/pipeline/build-asset-cross-reference.ts`.
#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
struct AssetSource {
    #[serde(rename = "entryFile")]
    entry_file: String,
    #[serde(rename = "entryId", skip_serializing_if = "Option::is_none")]
    entry_id: Option<String>,
    field: String,
    value: String,
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
            warn!(
                "manifeste uniforme absent : {} (uniforme non disponible)",
                path.display()
            );
            return HashMap::new();
        }
        let Ok(content) = fs::read_to_string(path) else {
            warn!("impossible de lire uniform-model-map : {}", path.display());
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
            let Some(crc) = v["crc"].as_u64().map(|c| c as u32) else {
                continue;
            };
            let Some(g4md) = v["g4md"].as_str().map(str::to_string) else {
                continue;
            };
            let Some(g4tx) = v["g4tx"].as_str().map(str::to_string) else {
                continue;
            };
            map.insert(crc, UniformMapEntry { g4md, g4tx });
        }
        info!("uniform-model-map : {} entrées", map.len());
        map
    }

    /// Charge le manifeste body_type_idx depuis le fichier NDJSON.
    /// Format : `{"code":"c01000010","body_type_idx":0}` (une ligne par code).
    fn load_body_map(path: &Path) -> HashMap<String, u8> {
        if !path.exists() {
            debug!(
                "manifeste body_type absent : {} (fallback type_idx=0)",
                path.display()
            );
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
            let Some(code) = v["code"].as_str() else {
                continue;
            };
            let Some(idx) = v["body_type_idx"].as_u64() else {
                continue;
            };
            map.insert(code.to_string(), idx as u8);
        }
        info!("body-type-manifest : {} entrées", map.len());
        map
    }

    /// Charge `data/asset-cross-reference.json` (`rg/scripts/inagle/pipeline/
    /// build-asset-cross-reference.ts`) : indexe par nom de texture (basename SANS extension) —
    /// c'est ce qui s'aligne sur `G4txTexture::name`/`G4txSubTexture::name` (`abl_000001`, pas
    /// `200_icon/02_icon_item/abl_000001.webp`). Un même basename peut apparaître sous plusieurs
    /// `assetPath` (dossiers différents) : les sources de TOUS s'accumulent sous la même clé,
    /// `/tex-info` reste correct même en cas d'ambiguïté (il montre tout, ne devine pas).
    fn load_asset_roles(path: &Path) -> HashMap<String, Vec<AssetSource>> {
        if !path.exists() {
            debug!(
                "asset-cross-reference absent : {} (rôle de texture non disponible)",
                path.display()
            );
            return HashMap::new();
        }
        let Ok(content) = fs::read_to_string(path) else {
            warn!("impossible de lire asset-cross-reference : {}", path.display());
            return HashMap::new();
        };
        #[derive(serde::Deserialize)]
        struct Asset {
            #[serde(rename = "assetPath")]
            asset_path: String,
            sources: Vec<AssetSource>,
        }
        #[derive(serde::Deserialize)]
        struct CrossRef {
            assets: Vec<Asset>,
        }
        let Ok(cr) = serde_json::from_str::<CrossRef>(&content) else {
            warn!("asset-cross-reference illisible : {}", path.display());
            return HashMap::new();
        };
        let mut map: HashMap<String, Vec<AssetSource>> = HashMap::new();
        for a in cr.assets {
            let Some(base) = a.asset_path.rsplit('/').next() else { continue };
            let base = base.rsplit_once('.').map_or(base, |(stem, _)| stem);
            if base.is_empty() {
                continue;
            }
            map.entry(base.to_string()).or_default().extend(a.sources);
        }
        info!("asset-cross-reference : {} noms de texture indexés", map.len());
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
                let team_id = serde_json::from_str::<Value>(&data_raw).ok().and_then(|v| {
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
                .and_then(|v| v["kits"][season.as_str()].as_str().map(str::to_string))
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
    let hex = fielder_crc_str
        .strip_prefix("0x")
        .unwrap_or(&fielder_crc_str);
    u32::from_str_radix(hex, 16).ok()
}

// ── Décodage G4TX → PNG ───────────────────────────────────────────────────────
// Le décodeur DDS/BCn est centralisé dans `nie_formats::g4tx_decode` (feature `textures`,
// source unique du workspace — Phase 1b dédup). Ici, on n'expose que les helpers spécifiques
// au serveur (résolution VFS, fallback de noms), qui appellent ce module partagé.

/// Construit l'entrée JSON d'un écran de menu depuis son `*_menu_setting.cfg.bin.json` (dump
/// T2B). `stem` = nom logique de l'écran (sans `_setting.cfg.bin.json`) ; la **nav-hash** de
/// l'écran (ce que le manager `0x14109D190` / le Lua utilisent pour l'ouvrir) = `CRC32(stem)`.
/// Chaque layer porte `hash == CRC32(name)` (invariant byte-exact, cf. `nie_data::menu_setting`).
/// `None` si le fichier est illisible.
fn menu_screen_entry(path: &Path, stem: &str) -> Option<serde_json::Value> {
    use serde_json::json;
    let txt = fs::read_to_string(path).ok()?;
    let root: serde_json::Value = serde_json::from_str(&txt).ok()?;
    let ms = nie_data::menu_setting::parse(&root);
    let nav = nie_data::unlock_condition::crc32_str(stem);
    let layers: Vec<serde_json::Value> = ms
        .layers
        .iter()
        .map(|l| {
            json!({
                "hash": l.layer_id.0,
                "hashHex": format!("{:#010X}", l.layer_id.0),
                "name": l.name,
                "objbin": l.objbin_path,
            })
        })
        .collect();
    let commands: Vec<serde_json::Value> = ms
        .commands
        .iter()
        .map(|c| json!({ "layerHash": c.layer_id.0, "commandHash": c.command_hash.0, "name": c.name }))
        .collect();
    let resources: Vec<serde_json::Value> = ms
        .resources
        .iter()
        .map(|r| json!({ "path": r.logical_path, "kind": r.kind }))
        .collect();
    Some(json!({
        "screen": stem,
        "crc32": nav,
        "crc32Hex": format!("{nav:#010X}"),
        "layerCount": ms.layers.len(),
        "consistent": ms.layer_hashes_consistent(),
        "layers": layers,
        "resources": resources,
        "commands": commands,
    }))
}

/// Décode un `cfg.bin`/`objbin`/`fxbin`/`mevbin` RDBN en JSON exploitable :
/// `{ format, lists: [ { name, type, count, rows: [ { champ: valeur } ] } ] }`.
/// Les noms de listes/types/champs sont résolus depuis la table de chaînes (lisible).
fn cfgbin_to_json(data: &[u8]) -> Option<serde_json::Value> {
    use serde_json::{Map, Value, json};
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
    use serde_json::{Map, Value, json};
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

/// Rend `texte` dans la police latine du jeu, sur fond transparent, en PNG.
///
/// Même chemin que la scène de dialogue : métriques depuis `font.cfg.bin`, glyphes depuis l'atlas
/// DDS du `font.g4tx`, `LatinAtlas` pour l'edge-scan des colonnes de glyphes. La toile est
/// dimensionnée par `measure()` — pas de marge devinée — avec deux pixels de garde pour ne pas
/// rogner les jambages.
fn render_text_png(font_cfg: &[u8], font_g4tx: &[u8], texte: &str, fg: [u8; 4]) -> Option<Vec<u8>> {
    use nie_formats::{cfgbin, font, g4tx};

    // L'atlas latin ne porte pas les accents : les translittérer vaut mieux qu'afficher un trou.
    let texte = fr_accents_to_ascii(texte);
    let texte = texte.as_str();

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

    let largeur = la.measure(texte) as usize + 4;
    let hauteur = usize::from(cell_h) + 4;
    let mut buf = vec![0u8; largeur * hauteur * 4];
    la.blit_line(atlas, aw, &mut buf, largeur, 2, 2, texte, fg);
    let _ = ah;
    nie_formats::g4tx_decode::encode_rgba_to_png(&buf, largeur, hauteur)
}

fn compose_story_png(
    font_cfg: &[u8],
    font_g4tx: &[u8],
    speaker: &str,
    text: &str,
) -> Option<Vec<u8>> {
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
    let px_off = if dds.len() >= 88 && &dds[84..88] == b"DX10" {
        148
    } else {
        128
    };
    let atlas = dds.get(px_off..)?;
    let (aw, ah) = (t.width as usize, t.height as usize);
    let cell_h = metrics.dims.cell_height;
    let la = font::LatinAtlas::from_atlas(atlas, aw, ah, 946, cell_h);

    // Fond dégradé bleu nuit (placeholder du rendu de scène 3D).
    let mut buf = vec![0u8; W * H * 4];
    for y in 0..H {
        let tt = y as f32 / H as f32;
        let (r, g, b) = (
            (18.0 + 30.0 * tt) as u8,
            (24.0 + 36.0 * tt) as u8,
            (44.0 + 60.0 * (1.0 - tt)) as u8,
        );
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
            let trial = if cur.is_empty() {
                word.to_string()
            } else {
                format!("{cur} {word}")
            };
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
    fill(
        &mut buf,
        bx0 + 20,
        by0 - 40,
        bx0 + 20 + name_w,
        by0 + 2,
        [30, 60, 110, 235],
    );
    fill(
        &mut buf,
        bx0 + 20,
        by0 - 40,
        bx0 + 20 + name_w,
        by0 - 37,
        [120, 220, 255, 255],
    );
    la.blit_line(
        atlas,
        aw,
        &mut buf,
        W,
        bx0 + 38,
        by0 - 32,
        speaker,
        [200, 235, 255, 255],
    );
    for (i, line) in lines.iter().enumerate() {
        la.blit_line(
            atlas,
            aw,
            &mut buf,
            W,
            bx0 + 40,
            by0 + 22 + i as i32 * line_h,
            line,
            [240, 244, 250, 255],
        );
    }
    fill(
        &mut buf,
        bx1 - 36,
        by1 - 24,
        bx1 - 20,
        by1 - 8,
        [120, 220, 255, 255],
    );

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

    let png = g4tx_decode::decode_best_to_png(&g4tx_data, g4tx_decode::basename_of(&vfs_path));
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

    let png = g4tx_decode::decode_best_to_png(&g4tx_data, g4tx_decode::basename_of(g4tx_vfs_path));
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

    let png = g4tx_decode::decode_best_to_png(&g4tx_data, code);
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

    // Le conteneur d'armure s'appelle `<code>_10.g4tx` ou `<code>.g4tx` selon le repli
    // emprunté : les deux noms sont tentés comme basename, le premier qui nomme une texture gagne.
    let png = g4tx_decode::decode_best_to_png(&g4tx_data, &format!("{code}_10"))
        .or_else(|| g4tx_decode::decode_best_to_png(&g4tx_data, code));
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
        info!(
            "texture corps (uniforme) embarquée : {} ({} B PNG)",
            code,
            png_bytes.len()
        );
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
        info!(
            "texture face embarquée : {} ({} B PNG)",
            code,
            png_bytes.len()
        );
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
        info!(
            "texture uniforme embarquée : {} ({} B PNG)",
            code,
            png_bytes.len()
        );
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
        let g4md = vfs
            .read(g4md_path.as_str())
            .with_context(|| format!("lecture G4MD uniforme {g4md_path}"))?;
        let g4mg = vfs
            .read(&g4mg_path)
            .with_context(|| format!("lecture G4MG uniforme {g4mg_path}"))?;

        return Ok(UniformData {
            g4md,
            g4mg,
            g4tx_path: Some(g4tx_path),
        });
    }

    // Priorité 2 : manifeste CRC (fallback pour VR — espace CRC différent).
    let g4md_path = resolve_crc_to_g4md_path(&state.crc_manifest, crc)
        .ok_or_else(|| anyhow::anyhow!("CRC uniforme {:#010x} absent des deux manifestes", crc))?;
    let g4mg_path = g4md_to_g4mg_path(g4md_path);

    let vfs = state.vfs.lock().unwrap();
    let g4md = vfs
        .read(g4md_path)
        .with_context(|| format!("lecture G4MD {g4md_path}"))?;
    let g4mg = vfs
        .read(&g4mg_path)
        .with_context(|| format!("lecture G4MG {g4mg_path}"))?;

    Ok(UniformData {
        g4md,
        g4mg,
        g4tx_path: None,
    })
}

/// Assemble un keshin (code `kXXXXXX`).
fn assemble_keshin_code(state: &State, code: &str) -> Result<GlbBytes> {
    let g4md_path = format!("data/common/chr/_keshin/{code}/{code}.g4md");
    let g4mg_path = format!("data/common/chr/_keshin/{code}/{code}.g4mg");

    let (g4md, g4mg) = {
        let vfs = state.vfs.lock().unwrap();
        let g4md = vfs
            .read(&g4md_path)
            .with_context(|| format!("G4MD keshin {g4md_path}"))?;
        let g4mg = vfs
            .read(&g4mg_path)
            .with_context(|| format!("G4MG keshin {g4mg_path}"))?;
        (g4md, g4mg)
    };

    let mut model =
        assemble_keshin(code, g4md, g4mg).with_context(|| format!("assemblage keshin {code}"))?;

    if let Some(png_bytes) = load_keshin_texture_png(state, code) {
        info!(
            "texture keshin embarquée : {} ({} B PNG)",
            code,
            png_bytes.len()
        );
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
        let g4md = vfs
            .read(&g4md_path)
            .with_context(|| format!("G4MD armd {g4md_path}"))?;
        let g4mg = vfs
            .read(&g4mg_path)
            .with_context(|| format!("G4MG armd {g4mg_path}"))?;
        (g4md, g4mg)
    };

    let mut model =
        assemble_armed(code, g4md, g4mg).with_context(|| format!("assemblage armure {code}"))?;

    if let Some(png_bytes) = load_armed_texture_png(state, code) {
        info!(
            "texture armure embarquée : {} ({} B PNG)",
            code,
            png_bytes.len()
        );
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
    if let Some(png_bytes) = g4tx.as_deref().and_then(|d| g4tx_decode::decode_best_to_png(d, code)) {
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
        let g4mg = vfs
            .read(&g4mg_path)
            .with_context(|| format!("G4MG {g4mg_path}"))?;
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
        vfs.read(&format!("data/dx11/map/{stage_dir}/{group}.g4tx"))
            .ok()
    };
    if let Some(bytes) = &stage_g4tx
        && let Ok(g4tx) = parse_g4tx(bytes)
    {
        // Base color `.1` d'une texture : nom sans le suffixe `.N`.
        let tex_base = |t: &nie_formats::g4tx::G4txTexture| -> String {
            t.name
                .rsplit_once('.')
                .map_or(t.name.clone(), |(b, _)| b.to_string())
        };
        let mut seen = std::collections::HashSet::new();
        for core in model
            .primitives
            .iter()
            .map(|p| p.material_name.clone())
            .collect::<Vec<_>>()
        {
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
                && let Some(png_bytes) =
                    g4tx_decode::decode_texture_rgba(bytes, tex).and_then(|(w, h, rgba)| {
                        g4tx_decode::encode_rgba_to_png(&rgba, w as usize, h as usize)
                    })
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
            && let Some(png_bytes) =
                g4tx_decode::decode_texture_rgba(bytes, tex).and_then(|(w, h, rgba)| {
                    g4tx_decode::encode_rgba_to_png(&rgba, w as usize, h as usize)
                })
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
    let cache_path = state
        .cache_dir
        .join(format!("map_{}.glb", rel.replace('/', "_")));
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
// SOURCE UNIQUE : le décode HCA chiffré IEVR + dispatch ADX/AWB/ACB → WAV vivent dans
// `nie_formats::cri_audio` (feature `audio-decode`, dédup Phase 1d). Ici = wrappers minces
// qui ajoutent le contexte `vfs_path` aux erreurs.

/// Décode n'importe quel audio Criware (HCA/ADX/AWB/ACB) en WAV PCM16.
fn decode_audio_to_wav(raw: &[u8], vfs_path: &str) -> anyhow::Result<Vec<u8>> {
    nie_formats::cri_audio::decode_to_wav(raw).map_err(|e| anyhow::anyhow!("{vfs_path}: {e}"))
}

/// Décode la première entrée HCA/ADX d'un AWB AFS2 (la plus volumineuse) en WAV.
fn decode_awb_first_entry(data: &[u8], vfs_path: &str) -> anyhow::Result<Vec<u8>> {
    decode_awb_entry(data, vfs_path, None)
}

/// Décode **une** entrée d'un AWB en WAV. `which` = index (`?cue=N`) ; `None` = la plus volumineuse.
fn decode_awb_entry(data: &[u8], vfs_path: &str, which: Option<usize>) -> anyhow::Result<Vec<u8>> {
    nie_formats::cri_audio::decode_awb_entry(data, which)
        .map_err(|e| anyhow::anyhow!("AWB {vfs_path}: {e}"))
}

/// Variante jumelle d'une vidéo : `data/dx11/movie/X` ↔ `data/common/movie/X`.
///
/// Le jeu livre chaque cinématique en double, sous deux racines. Ce ne sont pas des doublons :
/// `dx11` est la variante PC, à débit nettement supérieur (16,1 Gio contre 3,7 Gio à l'échelle
/// des 96 films, même définition 1920×1080). Mais l'une des deux peut manquer du disque ou ne
/// pas être décodable, auquel cas l'autre sauve la lecture.
fn variante_jumelle(vfs_path: &str) -> Option<String> {
    if let Some(reste) = vfs_path.strip_prefix("data/dx11/movie/") {
        return Some(format!("data/common/movie/{reste}"));
    }
    vfs_path
        .strip_prefix("data/common/movie/")
        .map(|reste| format!("data/dx11/movie/{reste}"))
}

/// Chemin du AWB frère d'un ACB : même chemin, extension `.awb`.
fn awb_frere(vfs_path: &str) -> Option<String> {
    vfs_path
        .strip_suffix(".acb")
        .map(|base| format!("{base}.awb"))
}

/// Résout les octets AWB d'un conteneur audio : embarqué dans l'ACB, ou fichier `.awb` frère.
///
/// Renvoie `(octets, provenance)` où la provenance est `"embedded"` ou `"external:<chemin>"`.
/// Un `.awb` passé directement est sa propre source (`"self"`).
fn resoudre_awb(state: &State, vfs_path: &str, raw: &[u8]) -> Option<(Vec<u8>, String)> {
    if raw.starts_with(b"AFS2") {
        return Some((raw.to_vec(), "self".to_string()));
    }
    let info = nie_formats::cri_audio::acb_parse(raw).ok()?;
    if !info.embedded_awb.is_empty() {
        return Some((info.embedded_awb, "embedded".to_string()));
    }
    // AWB externe : l'ACB ne porte que le hash du nom, mais dans IEVR le fichier frère
    // porte systématiquement le même basename — c'est déjà l'hypothèse de la route `/audio`.
    let frere = awb_frere(vfs_path)?;
    let vfs = state.vfs.lock().unwrap();
    let bytes = vfs.read(&frere).ok()?;
    Some((bytes, format!("external:{frere}")))
}

/// Nom du fichier téléchargé pour **un cue précis** d'une banque ACB.
///
/// Le nom proposé par défaut est celui de la BANQUE : cinq cues tirés de `waza_stream.acb`
/// descendraient tous sous `waza_stream.wav`, chacun recouvrant le précédent. La banque nomme
/// pourtant ses cues (`ev28_04262_me`) — c'est ce nom-là qui désigne le fichier.
///
/// À défaut d'un nom, on rend au moins un nom **distinct** : le radical de la banque suivi de
/// l'identifiant. Le paramètre `cue` désigne un rang dans l'AWB, pas une ligne du catalogue :
/// il ne se relie pas à un nom de façon fiable, et on ne le devine pas.
fn nom_de_cue(acb: &[u8], vfs_path: &str, awb_id: Option<u16>, rang: Option<usize>) -> String {
    let nomme = awb_id.and_then(|id| {
        let cues = nie_formats::cri_audio::acb_cues(acb).ok()?;
        let c = cues.into_iter().find(|c| c.awb_id == Some(id))?;
        (!c.name.is_empty()).then_some(c.name)
    });
    let base = nomme.unwrap_or_else(|| {
        let radical = vfs_path
            .rsplit('/')
            .next()
            .and_then(|n| n.split('.').next())
            .unwrap_or("audio");
        let n = awb_id.map(u32::from).or(rang.map(|r| r as u32)).unwrap_or(0);
        format!("{radical}_{n}")
    });
    // Un nom de cue vient du jeu, pas de l'utilisateur ; il est tout de même restreint à ce qui
    // traverse sans dommage un en-tête HTTP et un système de fichiers.
    let sain: String = base
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    format!("{sain}.wav")
}

/// Nom lisible d'un `EncodeType` de `WaveformTable`.
fn codec_acb(encode_type: Option<u8>) -> &'static str {
    match encode_type {
        Some(2) => "hca",
        Some(0 | 3) => "adx",
        Some(_) => "autre",
        None => "inconnu",
    }
}

/// Index des cues d'un conteneur audio, en JSON — le catalogue que sert la galerie audio.
///
/// Un `.acb` est une **banque** : `waza_stream.acb` porte 1 512 cues, dont `/audio` ne décodait
/// que la plus volumineuse — les 1 511 autres étaient inatteignables. Chaque cue listé ici se
/// joue par `/audio/<chemin>?id=<awbId>`.
///
/// Le catalogue est bâti sur l'ACB SEUL, jamais sur l'AWB : les 5 403 banques du jeu pèsent
/// 0,10 Gio d'ACB contre 7,49 Gio d'AWB, dont un fichier de 1,25 Gio. Lire l'AWB pour apprendre
/// ce qu'il contient coûterait deux ordres de grandeur de plus et ne dirait pas mieux — l'ACB
/// porte déjà les noms, les durées, le codec, la fréquence et les canaux.
fn audio_info_json(vfs_path: &str, raw: &[u8]) -> serde_json::Value {
    use nie_formats::cri_audio::{Awb, is_adx, is_hca};

    // HCA/ADX nu : une seule piste, pas de banque.
    if is_hca(raw) || is_adx(raw) {
        let codec = if is_hca(raw) { "hca" } else { "adx" };
        return serde_json::json!({
            "path": vfs_path,
            "container": codec,
            "cueCount": 1,
            "cues": [{ "index": 0, "name": null, "codec": codec, "awbId": 0 }],
        });
    }

    let info = nie_formats::cri_audio::acb_parse(raw).ok();
    let cues = nie_formats::cri_audio::acb_cues(raw).unwrap_or_default();

    // Rang d'entrée AWB par cue-id, résolu depuis l'en-tête AFS2 recopié dans l'ACB — donc sans
    // ouvrir l'AWB. Absent sur les banques à AWB embarqué : `awbIndex` sera alors `null` et le
    // client jouera par `?id=`, que `/audio` sait résoudre lui-même.
    let awb_entete = nie_formats::cri_audio::acb_stream_awb_header(raw)
        .as_deref()
        .and_then(|h| Awb::parse(h).ok());

    let liste: Vec<serde_json::Value> = cues
        .iter()
        .map(|c| {
            serde_json::json!({
                "index": c.cue_index,
                "cueId": c.cue_id,
                "name": (!c.name.is_empty()).then(|| c.name.clone()),
                "codec": codec_acb(c.encode_type),
                "channels": c.channels,
                "sampleRate": c.sample_rate,
                "numSamples": c.num_samples,
                // Durée en secondes : `numSamples/sampleRate` quand les deux sont connus,
                // sinon le `Length` de la banque (millisecondes, arrondi).
                "durationSec": match (c.num_samples, c.sample_rate) {
                    (Some(n), Some(sr)) if sr > 0 => f64::from(n) / f64::from(sr),
                    _ => f64::from(c.length_ms) / 1000.0,
                },
                "looped": c.looped,
                "streaming": c.streaming,
                "awbId": c.awb_id,
                "awbIndex": c
                    .awb_id
                    .and_then(|id| awb_entete.as_ref().and_then(|a| a.index_of_id(id))),
            })
        })
        .collect();

    serde_json::json!({
        "path": vfs_path,
        "container": "acb",
        "name": info.as_ref().map(|a| a.name.clone()),
        "version": info.as_ref().map(|a| a.version),
        "cueCount": liste.len(),
        "awbEntryCount": awb_entete.as_ref().map(|a| a.entries.len()),
        "embeddedAwb": info.as_ref().is_some_and(|a| !a.embedded_awb.is_empty()),
        "externalAwb": awb_frere(vfs_path),
        "cues": liste,
    })
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

/// Assemble (ou relit du cache) un modèle de l'éditeur d'avatar.
///
/// Voir la route `/model-edit/` pour la convention de chemins, qui diffère de celle des autres
/// modèles : pas de sous-dossier par code, et une texture nommée soit `<nom>.g4tx`, soit
/// `<nom>M.g4tx` pour les coiffures.
fn get_or_build_edit_glb(state: &State, dossier: &str, nom: &str) -> Result<GlbBytes> {
    let cache_path = state.cache_dir.join(format!("edit_{dossier}_{nom}.glb"));
    if cache_path.exists() {
        debug!("cache hit : edit_{dossier}_{nom}");
        return fs::read(&cache_path)
            .with_context(|| format!("lecture cache {}", cache_path.display()));
    }

    info!("assemblage live : edit_{dossier}_{nom}");
    let base = format!("data/common/chr/_face/20_EDIT/{dossier}/{nom}");
    let (g4md, g4mg, g4tx) = {
        let vfs = state.vfs.lock().unwrap();
        let g4md = vfs
            .read(&format!("{base}.g4md"))
            .with_context(|| format!("G4MD {base}.g4md"))?;
        let g4mg = vfs
            .read(&format!("{base}.g4mg"))
            .with_context(|| format!("G4MG {base}.g4mg"))?;
        let tex_base = format!("data/dx11/chr/_face/20_EDIT/{dossier}/{nom}");
        let g4tx = vfs
            .read(&format!("{tex_base}.g4tx"))
            .or_else(|_| vfs.read(&format!("{tex_base}M.g4tx")))
            .ok();
        (g4md, g4mg, g4tx)
    };

    let mut model = assemble_generic_model(GenericModelInput {
        code: nom.to_string(),
        g4md,
        g4mg,
        component: MeshComponent::Generic,
    })
    .with_context(|| format!("assemblage {dossier}/{nom}"))?;

    let glb = match g4tx.as_deref().and_then(|d| g4tx_decode::decode_best_to_png(d, nom)) {
        Some(png_bytes) => {
            model.embedded_textures.push(EmbeddedTexture {
                component: MeshComponent::Generic,
                name: format!("{nom}_{dossier}"),
                png_bytes,
            });
            model.to_glb_embedded()
        }
        None => model.to_glb(),
    };

    if let Err(e) = fs::write(&cache_path, &glb) {
        warn!("écriture cache edit_{dossier}_{nom} échouée : {e}");
    }
    Ok(glb)
}

/// La tenue dont l'éditeur d'avatar habille TOUJOURS son personnage.
///
/// Lue dans les 32 recettes `common/chr/_test/default/mdl_edit_avatar*.cfg.bin` et
/// `mdl_editpreview_avatar*.cfg.bin` : toutes portent, sans exception, le slot 1 = `u117401_10`
/// (haut et short) et le slot 2 = `s117401_10` (chaussures et chaussettes). Ce sont des noms de
/// TENUE, pas de modèle : les mailles correspondantes sont `_uniform/u000101/u000101` et
/// `_uniform/s000201/s000201`, et le conteneur de texture d'un haut est
/// `dx11/chr/_uniform/u000101/u117401_10.g4tx`.
const TENUE_HAUT: &str = "u117401_10";
/// Cf. [`TENUE_HAUT`] — la moitié « chaussures » de la même tenue.
const TENUE_CHAUSSURES: &str = "s117401_10";

/// L'os auquel le visage, la coiffure et les oreilles de l'éditeur sont attachés.
///
/// Présent dans les quatre squelettes `_bodySK/c000X01_edit.g4sk` de l'éditeur.
const OS_ATTACHE_TETE: &str = "c_head_1_0";

/// Côté maximal d'une texture embarquée dans un GLB d'avatar.
///
/// Les planches d'uniforme sont en 2048×2048 BC7 : deux d'entre elles suffisaient à faire
/// dépasser le délai de 30 s du proxy. 1024 reste au-delà de ce qu'un visualiseur web affiche.
const AVATAR_TEX_MAX: u32 = 1024;

/// Vrai si ce dossier de pièce désigne un modèle d'uniforme et non une pièce de `20_EDIT`.
///
/// Les dossiers de l'éditeur commencent tous par un souligné (`_facebase`, `_hairF`, `_base`…),
/// ceux d'uniforme sont des identifiants (`u000101`, `s000201`).
/// Une planche décodée : largeur, hauteur, pixels RGBA.
type PlancheRgba = (u32, u32, Vec<u8>);

/// Version de la logique d'assemblage d'avatar, incluse dans la clé de cache.
///
/// À incrémenter dès que l'assemblage change ce qu'il produit pour une même requête — ajout du
/// corps déduit du squelette, attache à l'os de tête, composition de la texture de visage… Sans
/// elle, un GLB produit par l'ancienne logique reste servi indéfiniment et le correctif paraît
/// sans effet : c'est exactement ce qui est arrivé lors de l'ajout du corps automatique.
const AVATAR_CACHE_VERSION: u32 = 5;

/// Nom de fichier de cache court et stable pour une clé d'assemblage.
///
/// Un avatar complet cite une quinzaine de pièces et de couches : la clé littérale dépasse la
/// longueur de nom de fichier admise. Le condensat garde l'unicité sans la longueur.
fn cle_courte(cle: &str) -> String {
    format!("{:08x}_{}", nie_formats::cfgbin::crc32(cle.as_bytes()), cle.len())
}

fn est_uniforme(dossier: &str) -> bool {
    !dossier.starts_with('_')
}

/// Assemble l'avatar de l'éditeur depuis ses pièces, textures comprises, et le met en cache.
///
/// Chaque pièce apporte sa propre texture : le conteneur `.g4tx` se résout par le CHEMIN de la
/// pièce (arbre `dx11` parallèle à `common`), jamais par le nom de son matériau — `hairF001M.g4tx`
/// porte une texture nommée `hair_10` alors que le matériau du G4MD s'appelle `hairF_10`. Le nom
/// de la texture à décoder est donc cherché en deux temps : d'abord celui que le matériau désigne
/// une fois son suffixe de niveau de détail retiré (ce qui vaut pour les tenues, `u000101_30_LOD1`
/// → `u000101_30`), puis, en repli, la couleur de base du conteneur.
///
/// Le liage au matériau glTF se fait par `EmbeddedTexture::name` == `material_name` exact, seule
/// clé que `build_glb_embedded` consulte avant son repli par composant — lequel ne retient qu'une
/// texture par composant et ne peut donc pas servir un empilement de pièces.
fn get_or_build_avatar_glb(
    state: &State,
    specs: &[(String, String)],
    couches_visage: &[String],
) -> Result<GlbBytes> {
    let cle: String = specs
        .iter()
        .map(|(d, n)| format!("{d}-{n}"))
        .chain(couches_visage.iter().map(|c| c.replace('/', "-")))
        .collect::<Vec<_>>()
        .join("_");
    let cache_path = state
        .cache_dir
        .join(format!("avatar_v{AVATAR_CACHE_VERSION}_{}.glb", cle_courte(&cle)));
    if cache_path.exists() {
        debug!("cache hit : avatar_{cle}");
        return fs::read(&cache_path)
            .with_context(|| format!("lecture cache {}", cache_path.display()));
    }
    info!("assemblage live : avatar_{cle}");

    let mut pieces: Vec<nie_formats::assemble::AvatarPiece> = Vec::new();
    let mut textures: Vec<EmbeddedTexture> = Vec::new();
    {
        let vfs = state.vfs.lock().unwrap();

        // Le squelette d'attache, s'il est demandé. Une pièce `_bodySK/<code>` n'apporte aucune
        // maille — son objbin n'en référence d'ailleurs aucune, ses 15 slots `Mesh` sont vides —
        // mais elle fixe le repère dans lequel les pièces de `20_EDIT` doivent être replacées.
        let squelette = specs.iter().find(|(d, _)| d == "_bodySK").map(|(_, n)| n.clone());
        let attache = specs
            .iter()
            .find(|(d, _)| d == "_bodySK")
            .and_then(|(_, nom)| {
                let chemin =
                    format!("data/common/chr/_face/20_EDIT/_bodySK/{nom}/{nom}.g4sk");
                vfs.read(&chemin).ok()
            })
            .and_then(|g4sk| {
                nie_formats::assemble::bone_rest_world(&g4sk, OS_ATTACHE_TETE)
            });
        if attache.is_none() && specs.iter().any(|(d, _)| d == "_bodySK") {
            warn!("squelette d'attache illisible : les pièces de tête resteront à l'origine");
        }

        // La texture de visage est COMPOSÉE, pas choisie : le jeu ne stocke pas une planche par
        // combinaison. Chaque rubrique (peau, yeux, pupilles, reflets, sourcils, bouche) désigne
        // une planche de `_facetex/` partageant le même dépliage UV, et l'avatar porte leur
        // empilement. C'est ce qui fait réagir le modèle aux choix : la maille de tête, elle, ne
        // dépend que de la morphologie et du nez.
        // Les planches de visage ne partagent PAS toutes le même dépliage : la peau, les pupilles
        // et les reflets sont en 512×512, les yeux, les sourcils et la bouche en 2048×1024. Les
        // ramener de force à une seule toile revenait à en jeter la moitié — dont les pupilles,
        // la seule planche à porter un dessin. On compose donc UN visage PAR DÉPLIAGE, et chaque
        // matériau de la tête en reçoit un : le modèle en déclare précisément deux ou trois.
        let mut groupes: std::collections::BTreeMap<(u32, u32), Vec<PlancheRgba>> =
            std::collections::BTreeMap::new();
        for rel in couches_visage {
            let chemin =
                format!("{}/_facetex/{rel}.g4tx", nie_formats::assemble::AVATAR_TEX_ROOT);
            let Ok(brut) = vfs.read(&chemin) else {
                warn!("couche de visage illisible, ignorée : {chemin}");
                continue;
            };
            for planche in nie_formats::image_out::decoder_planches(&brut) {
                groupes.entry((planche.0, planche.1)).or_default().push(planche);
            }
        }
        // Du plus grand dépliage au plus petit : le premier matériau reçoit le plus détaillé.
        let visages_composes: Vec<Vec<u8>> = groupes
            .into_iter()
            .rev()
            .filter_map(|((w, h), couches)| {
                let n = couches.len();
                let png = nie_formats::image_out::composer_couches(&couches).and_then(
                    |(cw, ch, rgba)| {
                        let (rw, rh, petit) =
                            nie_formats::image_out::reduire_rgba(&rgba, cw, ch, AVATAR_TEX_MAX)
                                .ok()?;
                        nie_formats::image_out::encoder_rgba(
                            &petit,
                            rw,
                            rh,
                            nie_formats::image_out::ImageOut::Png,
                        )
                        .ok()
                    },
                );
                if png.is_none() {
                    warn!("dépliage {w}x{h} : {n} planche(s) non composables");
                }
                png
            })
            .collect();
        if !couches_visage.is_empty() {
            debug!(
                "visage : {} couche(s) demandée(s) -> {} dépliage(s) composé(s)",
                couches_visage.len(),
                visages_composes.len()
            );
        }

        // Le corps suit le squelette. L'appelant n'a pas à savoir quelle variante `u0001NN` va
        // avec quel `c000X01_edit` : c'est un appariement mesuré, qui vit dans nie-formats. Si
        // l'appelant fournit lui-même une pièce d'uniforme, on ne touche à rien.
        let mut effectifs: Vec<(String, String)> = specs.to_vec();
        if let Some(sk) = squelette.as_deref().filter(|_| !specs.iter().any(|(d, _)| est_uniforme(d)))
        {
            if let Some(corps) = nie_formats::assemble::avatar_bodies_for_skeleton(sk).first() {
                effectifs.push((
                    nie_formats::assemble::AVATAR_BODY_DIR.to_string(),
                    (*corps).to_string(),
                ));
                effectifs.push((
                    nie_formats::assemble::AVATAR_SHOES_DIR.to_string(),
                    nie_formats::assemble::AVATAR_SHOES.to_string(),
                ));
            } else {
                warn!("squelette {sk} sans corps apparié : l'avatar sortira sans corps");
            }
        }

        let mut idx_materiau_visage = 0usize;
        for (dossier, nom) in &effectifs {
            if dossier == "_bodySK" {
                continue;
            }
            let uniforme = est_uniforme(dossier);
            let base = if uniforme {
                format!("data/common/chr/_uniform/{dossier}/{nom}")
            } else {
                format!("data/common/chr/_face/20_EDIT/{dossier}/{nom}")
            };
            let (Ok(g4md), Ok(g4mg)) =
                (vfs.read(&format!("{base}.g4md")), vfs.read(&format!("{base}.g4mg")))
            else {
                debug!("pièce d'avatar illisible : {base}");
                continue;
            };

            let candidats = if uniforme {
                let tenue =
                    if dossier.starts_with('s') { TENUE_CHAUSSURES } else { TENUE_HAUT };
                vec![nie_formats::assemble::uniform_texture_vfs_path(dossier, tenue)]
            } else {
                nie_formats::assemble::avatar_texture_candidates(dossier, nom)
            };
            let g4tx = candidats.iter().find_map(|c| vfs.read(c).ok());

            let component = match dossier.as_ref() {
                "_facebase" => MeshComponent::Face,
                "_base" => MeshComponent::Body,
                _ if uniforme => MeshComponent::Uniform,
                _ => MeshComponent::Generic,
            };

            if let (Some(tx), Ok(md)) = (g4tx.as_deref(), nie_formats::g4md::parse(&g4md)) {
                let repli = nie_formats::g4tx::base_color_texture_name(tx);
                for mat in &md.material_base_names {
                    if textures.iter().any(|t| &t.name == mat) {
                        continue;
                    }
                    let vise = nie_formats::assemble::avatar_texture_name(mat);
                    let png = nie_formats::image_out::g4tx_vignette_nommee(
                        tx,
                        vise,
                        AVATAR_TEX_MAX,
                        nie_formats::image_out::ImageOut::Png,
                    )
                    .ok()
                    .or_else(|| {
                        repli.as_deref().and_then(|r| {
                            nie_formats::image_out::g4tx_vignette_nommee(
                                tx,
                                r,
                                AVATAR_TEX_MAX,
                                nie_formats::image_out::ImageOut::Png,
                            )
                            .ok()
                        })
                    });
                    // Le conteneur `_facebase.g4tx` ne porte que des vignettes 32×32 : quand des
                    // compositions sont disponibles, ce sont elles qui habillent le visage. Le
                    // n-ième matériau reçoit le n-ième dépliage ; s'il y a moins de compositions
                    // que de matériaux, la dernière sert aux suivants.
                    let png = if dossier == "_facebase" && !visages_composes.is_empty() {
                        let i = idx_materiau_visage.min(visages_composes.len() - 1);
                        idx_materiau_visage += 1;
                        Some(visages_composes[i].clone())
                    } else {
                        png
                    };
                    if let Some(png_bytes) = png {
                        textures.push(EmbeddedTexture {
                            component,
                            name: mat.clone(),
                            png_bytes,
                        });
                    }
                }
            }

            // Seules les pièces de `20_EDIT` vivent dans le repère de leur os ; les mailles
            // d'uniforme sont déjà en espace monde et ne doivent surtout pas être transformées.
            let attach = if uniforme { None } else { attache };
            pieces.push(nie_formats::assemble::AvatarPiece { component, g4md, g4mg, attach });
        }
    }

    if pieces.is_empty() {
        anyhow::bail!("aucune pièce lisible");
    }
    let mut model = nie_formats::assemble::assemble_avatar_model(&cle, &pieces)
        .with_context(|| format!("assemblage avatar {cle}"))?;
    let nb_tex = textures.len();
    model.embedded_textures = textures;
    let glb = if nb_tex > 0 { model.to_glb_embedded() } else { model.to_glb() };
    debug!("avatar {cle} : {} pièce(s), {nb_tex} texture(s)", pieces.len());

    if let Err(e) = fs::write(&cache_path, &glb) {
        warn!("écriture cache avatar_{cle} échouée : {e}");
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
            && let Some(code) = path
                .rsplit('/')
                .next()
                .and_then(|f| f.strip_suffix(".g4md"))
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
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .nth(1)?
        .trim()
        .parse::<u64>()
        .ok()
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
            let (jobs, next, done, stop, state) = (
                jobs.clone(),
                next.clone(),
                done.clone(),
                stop.clone(),
                state.clone(),
            );
            handles.push(thread::spawn(move || {
                loop {
                    if stop.load(Relaxed) {
                        break;
                    }
                    let i = next.fetch_add(1, Relaxed);
                    if i >= jobs.len() {
                        break;
                    }
                    let res = match &jobs[i] {
                        WarmJob::Full(code) => get_or_build_glb(&state, code).map(|_| ()),
                        WarmJob::Chr(sub, code) => {
                            get_or_build_chr_glb(&state, sub, code).map(|_| ())
                        }
                    };
                    if let Err(e) = res {
                        debug!("préchargement : entrée {i} non assemblable : {e}");
                    }
                    let n = done.fetch_add(1, Relaxed) + 1;
                    if n.is_multiple_of(200) {
                        if free_bytes(&state.cache_dir).is_some_and(|f| f < PRELOAD_MIN_FREE_BYTES)
                        {
                            warn!("préchargement : espace disque < 3 Gio — arrêt à {n}/{total}");
                            stop.store(true, Relaxed);
                            break;
                        }
                        info!("préchargement : {n}/{total} modèles traités");
                    }
                }
            }));
        }
        for h in handles {
            let _ = h.join();
        }
        info!(
            "préchargement terminé : {}/{total} modèles dans le cache",
            done.load(Relaxed)
        );
    });
}

// ── Serveur HTTP minimal ──────────────────────────────────────────────────────

/// Réponse HTTP.
fn respond(stream: &mut TcpStream, status: u16, reason: &str, content_type: &str, body: &[u8]) {
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
    respond(
        stream,
        status,
        reason,
        "text/plain; charset=utf-8",
        body.as_bytes(),
    );
}

// ── Query string (routes `/vfs/…`) ────────────────────────────────────────────

/// Décode le percent-encoding d'une valeur de query : `%2F` → `/`, `+` → espace.
///
/// Les chemins internes du VFS contiennent des `/`, que le navigateur encode. Un octet `%XX`
/// mal formé est laissé tel quel plutôt que perdu : mieux vaut un chemin qui ne matche pas
/// qu'un chemin silencieusement mutilé. Le résultat est reconstruit octet par octet puis
/// validé UTF-8 (un `%C3%A9` isolé ne doit pas produire deux caractères de remplacement).
fn percent_decode(s: &str) -> String {
    let src = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(src.len());
    let mut i = 0;
    while i < src.len() {
        match src[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < src.len() => {
                let hex = std::str::from_utf8(&src[i + 1..i + 3]).ok();
                match hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                    Some(b) => {
                        out.push(b);
                        i += 3;
                    }
                    None => {
                        out.push(b'%');
                        i += 1;
                    }
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Valeur d'un paramètre de query, percent-décodée. `None` si la clé est absente.
///
/// Une clé présente mais vide (`?ext=`) renvoie `Some("")` : c'est au routeur de décider si
/// « présent et vide » vaut « absent ».
fn param(query: &str, key: &str) -> Option<String> {
    query.split('&').find_map(|couple| {
        let (k, v) = couple.split_once('=').unwrap_or((couple, ""));
        (k == key).then(|| percent_decode(v))
    })
}

/// Paramètre entier de query, `defaut` si absent ou illisible.
fn param_usize(query: &str, key: &str, defaut: usize) -> usize {
    param(query, key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(defaut)
}

/// Sérialise une entrée de listing.
///
/// Les noms de champs sont ceux que consomme déjà l'explorateur web (`CpkFile` d'azalée) :
/// c'est ce qui permet de rebrancher le front sur ce pont sans toucher aux composants.
fn entree_json(e: &nie_explore::listing::FileEntry) -> serde_json::Value {
    serde_json::json!({
        "name": e.name,
        "ext": e.ext,
        "path": e.path,
        "size": e.size,
        "cpk": e.cpk,
    })
}

/// Réponse de TÉLÉCHARGEMENT : même corps qu'une réponse normale, plus le nom de fichier.
///
/// Sans `Content-Disposition`, le navigateur nomme le fichier d'après l'URL — donc
/// `icon_item01.g4tx` pour un PNG, ou pire, le nom de la route. Le nom proposé vient de
/// `nie_explore::export::nom_propose`, la même règle que celle de l'app desktop (`x.cfg.bin`
/// donne `x.json`, pas `x.cfg.json`).
fn respond_download(stream: &mut TcpStream, content_type: &str, nom: &str, body: &[u8]) {
    // Le nom est contraint à l'ASCII sûr : il vient d'un chemin du VFS, mais un en-tête HTTP ne
    // tolère ni guillemet ni saut de ligne.
    let nom: String = nom
        .chars()
        .map(|c| if c.is_ascii_graphic() && c != '"' { c } else { '_' })
        .collect();
    let headers = format!(
        "HTTP/1.1 200 OK\r\n\
         Content-Type: {content_type}\r\n\
         Content-Length: {}\r\n\
         Content-Disposition: attachment; filename=\"{nom}\"\r\n\
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

/// Type MIME d'un format d'export.
fn mime_du_format(format: &str, ext: &str) -> &'static str {
    match format {
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "jpg" => "image/jpeg",
        "bmp" => "image/bmp",
        "tga" => "image/x-tga",
        "tiff" => "image/tiff",
        "qoi" => "image/qoi",
        "json" => "application/json",
        "wav" => "audio/wav",
        "mp4" => "video/mp4",
        "glb" => "model/gltf-binary",
        // `raw` garde le type de l'extension d'origine quand on le connaît.
        _ => match ext {
            "usm" => "video/mp4",
            "acb" | "awb" | "hca" | "adx" => "audio/wav",
            _ => "application/octet-stream",
        },
    }
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
        let end = if b.is_empty() {
            last
        } else {
            b.trim().parse::<usize>().ok()?.min(last)
        };
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
        if let Some(v) = line
            .trim_end()
            .strip_prefix("Range:")
            .or_else(|| line.trim_end().strip_prefix("range:"))
        {
            range_header = Some(v.trim().to_string());
        }
    }
    let range_header = range_header.as_deref();

    // Strippe la query string (`?v=3` cache-bust d'azalee) : le code modèle vit dans le
    // path seul. Sans ça, `strip_suffix(".glb")` échoue sur `c….glb?v=3` -> "code invalide".
    // La query est capturée AVANT, pour les routes `/vfs/…` qui, elles, en vivent.
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");
    let path = path.split('?').next().unwrap_or(path);

    // Routing.
    if path == "/health" {
        respond_text(&mut stream, 200, "OK", "ok");
        return;
    }

    // `/vfs/…` — pont de LISTING du VFS réel, en JSON.
    //
    // L'explorateur web d'azalée (`/cpk`) parcourait un index SQLite matérialisé depuis un
    // NDJSON figé : une photo du VFS, à régénérer à la main, muette sur le rôle des dossiers et
    // sur ce qu'un fichier sait produire. Ces trois routes servent la même vue que l'app desktop,
    // depuis `nie_explore::listing` — une seule implémentation pour les deux explorateurs.
    //
    //   /vfs/ls?path=<dir>&limit=&offset=   vue dossier paginée + rôle catalogué
    //   /vfs/find?q=<txt>&ext=&limit=       recherche par sous-chaîne
    //   /vfs/stat?path=<fichier>            métadonnées + formats d'export + description
    if let Some(route) = path.strip_prefix("/vfs/") {
        let vfs = state.vfs.lock().unwrap();
        let body = match route {
            "ls" => {
                let dir = param(query, "path").unwrap_or_default();
                // Même plafond que `find` : `sound_asset/ja` porte 9 078 fichiers directs, que
                // 5 000 tronquaient en silence.
                let limit = param_usize(query, "limit", 1000).min(20_000);
                let offset = param_usize(query, "offset", 0);
                let l = nie_explore::listing::ls_paged(&vfs, &dir, limit, offset);
                serde_json::json!({
                    "dir": l.dir,
                    "dirs": l.dirs.iter().map(|d| serde_json::json!({ "name": d.name, "count": d.count })).collect::<Vec<_>>(),
                    "files": l.files.iter().map(entree_json).collect::<Vec<_>>(),
                    "fileTotal": l.file_total,
                    "fileOffset": l.file_offset,
                    "role": l.role.map(|r| serde_json::json!({ "role": r.role, "status": r.status })),
                })
            }
            "find" => {
                let q = param(query, "q").unwrap_or_default();
                let ext = param(query, "ext").filter(|e| !e.is_empty());
                // Plafond haut : une galerie qui veut être complète énumère des dizaines de
                // milliers d'entrées (24 000 g4tx, 5 400 banques audio). À ~120 o par entrée
                // JSON, 20 000 tiennent en ~2,4 Mo — le client pagine s'il veut moins.
                let limit = param_usize(query, "limit", 200).min(20_000);
                let offset = param_usize(query, "offset", 0);
                let r = nie_explore::listing::find_paged(&vfs, &q, ext.as_deref(), limit, offset);
                serde_json::json!({
                    "query": q,
                    // `count` = la taille de CETTE page ; `total` = le corpus entier. Les deux,
                    // parce que « 2 000 trouvés » et « 2 000 renvoyés » ne sont pas la même chose.
                    "count": r.files.len(),
                    "total": r.total,
                    "offset": r.offset,
                    "files": r.files.iter().map(entree_json).collect::<Vec<_>>(),
                })
            }
            "stat" => {
                let p = param(query, "path").unwrap_or_default();
                match nie_explore::listing::stat(&vfs, &p) {
                    None => {
                        drop(vfs);
                        respond_text(&mut stream, 404, "Not Found", "chemin absent du VFS");
                        return;
                    }
                    Some(e) => {
                        // La description lit réellement les octets : réservée à `stat`, jamais
                        // au listing, qui parcourt des milliers d'entrées.
                        let describe = vfs
                            .read(&p)
                            .ok()
                            .and_then(|data| nie_explore::describe_content(&p, &data));
                        let mut j = entree_json(&e);
                        // Être dans l'index ne veut pas dire servable : `cpk_list.cfg.bin`
                        // déclare des fichiers « loose » absents de cette installation.
                        // Sans ce champ, `stat` annonçait des fichiers que `/raw` refuse.
                        j["readable"] = serde_json::json!(vfs.is_readable(&p));
                        j["formats"] = serde_json::json!(
                            nie_explore::export::formats_pour(&p)
                                .iter()
                                .map(|f| serde_json::json!({
                                    "id": f.id,
                                    "ext": f.ext,
                                    "label": f.label,
                                    "brut": f.brut,
                                    "sansPerte": f.sans_perte,
                                }))
                                .collect::<Vec<_>>()
                        );
                        j["describe"] = serde_json::json!(describe);
                        j
                    }
                }
            }
            "stats" => serde_json::json!({
                "total": vfs.asset_count(),
                "cpkCount": vfs.cpk_count(),
                "extraCount": vfs.extra_count(),
                "looseCount": vfs.loose_count(),
            }),
            _ => {
                drop(vfs);
                respond_text(&mut stream, 404, "Not Found", "route /vfs inconnue");
                return;
            }
        };
        drop(vfs);
        let bytes = serde_json::to_vec(&body).unwrap_or_default();
        respond(&mut stream, 200, "OK", "application/json", &bytes);
        return;
    }

    // `/export/<vfs-path>?format=<id>` — le fichier converti AU FORMAT VOULU, en téléchargement.
    //
    // Même table de formats et même règle de nommage que l'app desktop
    // (`nie_explore::export::{formats_pour, nom_propose, produire}`) : une texture s'exporte en
    // png/webp/gif/jpg/bmp/tga/tiff/qoi/json, un audio en wav, un film en mp4, un modèle en glb.
    // Le web n'avait droit qu'au PNG, alors que le convertisseur en produit neuf.
    //
    // Les deux formats « à contexte » (cf. `necessite_contexte`) sont traités ici, comme le fait
    // le backend Tauri : `glb` passe par l'assemblage de ce service, `mp4` par le démux + ffmpeg.
    if let Some(rest) = path.strip_prefix("/export/") {
        let vfs_path = if rest.starts_with("data/") {
            rest.to_string()
        } else {
            format!("data/{rest}")
        };
        if vfs_path.contains("..") {
            respond_text(&mut stream, 400, "Bad Request", "chemin invalide");
            return;
        }
        let format = param(query, "format").unwrap_or_else(|| "raw".to_string());

        // Un format hors table pour CE fichier est refusé tout de suite : mieux vaut le dire que
        // laisser le convertisseur échouer sur un message obscur.
        let table = nie_explore::export::formats_pour(&vfs_path);
        if !table.iter().any(|f| f.id == format) {
            respond_text(
                &mut stream,
                400,
                "Bad Request",
                &format!(
                    "format « {format} » indisponible pour ce fichier (proposés : {})",
                    table
                        .iter()
                        .map(|f| f.id.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                ),
            );
            return;
        }

        let bytes = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        let Some(data) = bytes else {
            respond_text(&mut stream, 404, "Not Found", "fichier absent du VFS");
            return;
        };

        let ext = vfs_path.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
        // Nom imposé au téléchargement quand le fichier produit ne désigne PAS le fichier
        // source — un cue d'une banque, par exemple. `None` laisse la règle de nommage
        // commune (`nom_propose`) s'appliquer.
        let mut nom_force: Option<String> = None;
        let produit: Result<Vec<u8>, String> = match format.as_str() {
            "mp4" => nie_formats::cri_audio::usm_demux(&data)
                .map_err(|e| e.to_string())
                .and_then(|r| {
                    mux_h264_to_mp4(&r.video_data).ok_or_else(|| "remux ffmpeg indisponible".into())
                }),
            "glb" => {
                // Le code d'assemblage est le radical du fichier — même convention que
                // `/model-full/<code>.glb`.
                let code = vfs_path
                    .rsplit('/')
                    .next()
                    .and_then(|n| n.split('.').next())
                    .unwrap_or_default()
                    .to_string();
                get_or_build_glb(&state, &code).map_err(|e| e.to_string())
            }
            // `wav` demande le VFS autant que `glb` : une banque ACB porte souvent son AWB
            // DEHORS, et `nie_explore::export::produire` ne voit que les octets du fichier
            // demandé — il échoue alors sur « ACB sans AWB embarqué ». `?id=`/`?cue=` exportent
            // un cue précis, comme sur `/audio`.
            "wav" => {
                let awb_id: Option<u16> = param(query, "id").and_then(|v| v.parse().ok());
                let cue: Option<usize> = param(query, "cue").and_then(|v| v.parse().ok());
                if awb_id.is_none() && cue.is_none() {
                    decode_audio_to_wav(&data, &vfs_path)
                        .or_else(|_| match resoudre_awb(&state, &vfs_path, &data) {
                            Some((awb, _)) => decode_awb_first_entry(&awb, &vfs_path),
                            None => Err(anyhow::anyhow!("aucune banque AWB résolue")),
                        })
                        .map_err(|e| e.to_string())
                } else {
                    nom_force = Some(nom_de_cue(&data, &vfs_path, awb_id, cue));
                    match resoudre_awb(&state, &vfs_path, &data) {
                        None => Err("aucune banque AWB résolue".to_string()),
                        Some((awb, _)) => {
                            let rang = match awb_id {
                                None => cue,
                                Some(id) => nie_formats::cri_audio::Awb::parse(&awb)
                                    .ok()
                                    .and_then(|a| a.index_of_id(id)),
                            };
                            decode_awb_entry(&awb, &vfs_path, rang).map_err(|e| e.to_string())
                        }
                    }
                }
            }
            autre => nie_explore::export::produire(&vfs_path, data, autre),
        };

        match produit {
            Ok(body) => respond_download(
                &mut stream,
                mime_du_format(&format, &ext),
                &nom_force.unwrap_or_else(|| nie_explore::export::nom_propose(&vfs_path, &format)),
                &body,
            ),
            Err(e) => {
                warn!("export {vfs_path} en {format} échoué : {e}");
                respond_text(
                    &mut stream,
                    500,
                    "Internal Server Error",
                    &format!("conversion échouée : {e}"),
                );
            }
        }
        return;
    }

    // `/tex-info/<chemin>.g4tx` — CATALOGUE des textures d'un conteneur, en JSON.
    //
    // Un G4TX n'est pas une image : c'est un conteneur. `icon_item01.g4tx` porte 45 payloads DDS
    // nommés, `icon_item05.g4tx` en porte 80. La forme nommée de `/tex` sait déjà en adresser
    // une par son nom — mais rien ne permettait d'en obtenir la LISTE, donc une galerie ne
    // pouvait montrer qu'une image par fichier et laissait le reste invisible.
    //
    // Même rôle que `/audio-info` pour les banques ACB : l'index qui rend le contenu atteignable.
    if let Some(rest) = path.strip_prefix("/tex-info/") {
        let rel = rest.strip_suffix(".g4tx").unwrap_or(rest);
        let vfs_path = format!("data/{rel}.g4tx");
        if vfs_path.contains("..") {
            respond_text(&mut stream, 400, "Bad Request", "chemin invalide");
            return;
        }
        let bytes = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        let Some(raw) = bytes else {
            respond_text(&mut stream, 404, "Not Found", "conteneur absent du VFS");
            return;
        };
        match nie_formats::g4tx::parse(&raw) {
            Err(e) => respond_text(
                &mut stream,
                500,
                "Internal Server Error",
                &format!("G4TX illisible : {e}"),
            ),
            Ok(g4tx) => {
                // `css=1` : plutôt que le catalogue JSON, rend directement la feuille CSS de la
                // PREMIÈRE texture (celle qu'adresse `/tex/<rel>.png` en forme 1:1) — mêmes
                // rectangles, recopiés du conteneur comme `nie_formats::sprite_sheet`
                // (`niers convert --to css`), mais sans ré-encoder l'atlas : le CSS pointe sur
                // la route `/tex/<rel>.png` déjà servie, pas d'image dupliquée à générer/cacher.
                if param(query, "css").as_deref() == Some("1") {
                    let Some(feuille) = nie_formats::sprite_sheet::depuis_g4tx(&g4tx, 0) else {
                        respond_text(&mut stream, 404, "Not Found", "aucune région d'atlas");
                        return;
                    };
                    let masque = param(query, "mode").as_deref() == Some("masque");
                    let mode = if masque {
                        nie_formats::sprite_sheet::ModeCss::Masque
                    } else {
                        nie_formats::sprite_sheet::ModeCss::Image
                    };
                    let css = feuille.vers_css_mode(&format!("/tex/{rel}.png"), mode);
                    respond(&mut stream, 200, "OK", "text/css; charset=utf-8", css.as_bytes());
                    return;
                }
                let textures: Vec<serde_json::Value> = g4tx
                    .textures
                    .iter()
                    .map(|t| {
                        // Rectangles des régions (recopiés du conteneur, jamais recalculés) :
                        // ce qui manquait pour construire un sprite-sheet CSS/SVG côté client
                        // sans repasser par un export CLI hors-ligne (`niers convert --to css`).
                        // Rôle sémantique : `data/asset-cross-reference.json` (build-asset-
                        // cross-reference.ts) associe un nom de texture aux entrées cfgbin/Lua
                        // qui la référencent (`entries/items.json` champ `imageUrl`, id
                        // `0x02601663`, …). Absent si le nom n'a pas de source connue — pas
                        // d'erreur, juste rien à montrer (la texture peut être légitimement
                        // non référencée, ex. une variante non utilisée).
                        let regions: Vec<serde_json::Value> = t
                            .sub_textures
                            .iter()
                            .map(|r| {
                                serde_json::json!({
                                    "name": r.name,
                                    "x": r.x, "y": r.y, "width": r.width, "height": r.height,
                                    "role": state.asset_roles.get(&r.name),
                                })
                            })
                            .collect();
                        serde_json::json!({
                            "id": t.id,
                            "name": t.name,
                            "width": t.width,
                            "height": t.height,
                            "dds": t.is_dds,
                            "size": t.data_size,
                            // Chemin RELATIF au CDN : le client préfixe son origine. C'est la
                            // forme nommée de `/tex`, la seule qui adresse une texture précise.
                            "path": format!("/tex/{rel}.g4tx/{}.png", t.name),
                            "regions": t.sub_textures.len(),
                            "regionsDetail": regions,
                            "role": state.asset_roles.get(&t.name),
                        })
                    })
                    .collect();
                let j = serde_json::json!({
                    "path": vfs_path,
                    "count": textures.len(),
                    "textures": textures,
                    "cssUrl": format!("/tex-info/{rel}.g4tx?css=1"),
                });
                let body = serde_json::to_vec(&j).unwrap_or_default();
                respond(&mut stream, 200, "OK", "application/json", &body);
            }
        }
        return;
    }

    // `/tex/…` — décode N'IMPORTE QUEL G4TX du VFS en PNG. Les textures perso (face/uniforme/
    // corps sous `dx11/chr/`) sont absentes du dump ET non servies par le décodeur menu live
    // (:8788) ; seul ce service a le décodeur nie-formats. Deux formes, toutes deux servies
    // telles quelles par nginx (`cdn.rosegriffon.fr/dx11/… -> /tex/dx11/…`) :
    //
    //   1:1     `/tex/<chemin>.png`                    → `data/<chemin>.g4tx`, texture principale
    //   nommée  `/tex/<chemin>.g4tx/<nom>.png`         → texture `<nom>` DANS ce conteneur
    //
    // La forme nommée est la seule façon d'adresser un conteneur multi-textures : les icônes
    // d'objets vivent à 80 par fichier (`icon_item05.g4tx` = 80 payloads DDS nommés
    // `eq_ac0100101`…), et les atlas spatiaux portent des régions nommées à rogner. Elle passe
    // par le PATH et non par une query (`?tex=`) : la query est strippée en amont du routage.
    // La forme 1:1 est INCHANGÉE, si ce n'est qu'elle transmet enfin le basename au sélecteur.
    // Anti-traversal strict sur le chemin comme sur le nom de texture.
    if let Some(rest) = path.strip_prefix("/tex/") {
        // Découpe la forme nommée sur le premier `.g4tx/` : ce qui précède est le conteneur,
        // ce qui suit est le nom de texture (`.png` optionnel, aucun `/` toléré).
        let (rel, nom_texture) = match rest.split_once(".g4tx/") {
            Some((conteneur, nom)) => {
                let nom = nom.strip_suffix(".png").unwrap_or(nom);
                (format!("{conteneur}.g4tx"), Some(nom.to_string()))
            }
            None => (
                rest.strip_suffix(".png")
                    .map_or_else(|| rest.to_string(), |s| format!("{s}.g4tx")),
                None,
            ),
        };
        let vfs_path = if rel.starts_with("data/") { rel } else { format!("data/{rel}") };

        let nom_invalide = nom_texture
            .as_deref()
            .is_some_and(|n| n.is_empty() || n.contains('/') || n.contains(".."));
        if vfs_path.contains("..") || !vfs_path.ends_with(".g4tx") || nom_invalide {
            respond_text(
                &mut stream,
                400,
                "Bad Request",
                "chemin invalide (.g4tx/.png attendu)",
            );
            return;
        }
        let g4tx = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        let png = match nom_texture.as_deref() {
            // Texture nommée : jamais de repli sur « la plus grande » — un nom qui n'existe pas
            // doit donner 404, pas une image arbitraire qui passerait pour la bonne.
            Some(nom) => g4tx.as_deref().and_then(|d| g4tx_decode::decode_named_to_png(d, nom)),
            None => g4tx
                .as_deref()
                .and_then(|d| g4tx_decode::decode_best_to_png(d, g4tx_decode::basename_of(&vfs_path))),
        };
        match png {
            Some(png) => respond(&mut stream, 200, "OK", "image/png", &png),
            None => respond_text(&mut stream, 404, "Not Found", "texture absente/non décodée"),
        }
        return;
    }

    // `/ui/theme.json` — le thème de l'interface : la palette de texte du jeu + ses polices.
    //
    // Les couleurs ne sont pas choisies : ce sont les 70 entrées de `common/font/font_color.cfg.bin`
    // (`FONT_COLOR`), chacune avec son triplet de texte et celui de ses rubis (furigana), rendues
    // en hexadécimal CSS pour être utilisables hors du moteur.
    if path == "/ui/theme.json" || path == "/ui/theme" {
        let (palette, polices) = {
            let vfs = state.vfs.lock().unwrap();
            let palette = vfs
                .read("data/common/font/font_color.cfg.bin")
                .ok()
                .and_then(|d| cfgbin::to_iecode_json(&d))
                .map(|json| nie_data::font_color::parse_font_colors(&json))
                .unwrap_or_default();
            // Familles de police : un dossier par famille sous `font/`, chacune avec son atlas.
            let mut polices: Vec<String> = vfs
                .iter()
                .map(|(p, _)| p.to_string())
                .filter(|p| p.contains("/font/") && p.ends_with("/font.g4tx"))
                .filter_map(|p| p.rsplit('/').nth(1).map(str::to_string))
                .collect();
            polices.sort();
            polices.dedup();
            (palette, polices)
        };
        let body = serde_json::json!({
            "source": "common/font/font_color.cfg.bin + dx11/font/*/font.g4tx",
            "couleursTexte": palette.iter().map(|c| serde_json::json!({
                "id": c.id.to_hex_x8(),
                "hex": c.hex(),
                "rubiHex": c.rubi_hex(),
                "rgb": [c.rgb.0, c.rgb.1, c.rgb.2],
                "rubiRgb": [c.rubi_rgb.0, c.rubi_rgb.1, c.rubi_rgb.2],
            })).collect::<Vec<_>>(),
            "polices": polices,
        });
        match serde_json::to_vec(&body) {
            Ok(bytes) => respond(&mut stream, 200, "OK", "application/json; charset=utf-8", &bytes),
            Err(e) => respond_text(&mut stream, 500, "Internal Server Error", &e.to_string()),
        }
        return;
    }

    // `/ui/text.png?t=<texte>&fg=<RRGGBB>` — un texte rendu dans la VRAIE police du jeu.
    //
    // Une police du jeu est un **atlas bitmap** plus des métriques, pas une police vectorielle :
    // elle ne peut pas être servie comme webfont. Le texte est donc composé ici, avec le même
    // chemin que la scène de dialogue (`font::LatinAtlas`), et livré en PNG à fond transparent.
    if path == "/ui/text.png" {
        let texte = param(query, "t").unwrap_or_default();
        if texte.is_empty() || texte.chars().count() > 120 {
            respond_text(&mut stream, 400, "Bad Request", "paramètre `t` vide ou trop long");
            return;
        }
        let fg = param(query, "fg")
            .and_then(|s| u32::from_str_radix(s.trim_start_matches('#'), 16).ok())
            .map_or([255, 255, 255, 255], |v| {
                [
                    ((v >> 16) & 0xFF) as u8,
                    ((v >> 8) & 0xFF) as u8,
                    (v & 0xFF) as u8,
                    255,
                ]
            });
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
        match render_text_png(&cfg, &g4tx, &texte, fg) {
            Some(png) => respond(&mut stream, 200, "OK", "image/png", &png),
            None => respond_text(&mut stream, 500, "Internal Server Error", "rendu échoué"),
        }
        return;
    }

    // `/icons/index.json` — l'index des icônes du jeu (nom → atlas + rectangle + URL).
    //
    // Produit par `niers icons index`. Les icônes elles-mêmes ne sont PAS matérialisées : les
    // atlas pèsent des centaines de mégaoctets, et chaque entrée porte l'URL `/tex/…` qui les
    // décode à la demande.
    if path == "/icons/index.json" || path == "/icons/index" {
        let chemin = std::env::var("NIE_ICONS_INDEX")
            .unwrap_or_else(|_| String::from("var/icons-index.json"));
        match std::fs::read(&chemin) {
            Ok(bytes) => respond(&mut stream, 200, "OK", "application/json; charset=utf-8", &bytes),
            Err(e) => respond_text(
                &mut stream,
                404,
                "Not Found",
                &format!("index absent ({chemin} : {e}) — le produire par `niers icons index`"),
            ),
        }
        return;
    }

    // `/avatar/catalog.json` — le catalogue résolu de l'éditeur d'avatar.
    //
    // Le fichier est **produit par `niers avatar export`**, pas recalculé ici : la résolution
    // croise le VFS, la base de connaissance (noms d'icônes) et `menu_text`, et ce travail vit
    // déjà dans `nie-cli`. Le servir tel quel évite d'en tenir deux versions.
    if path == "/avatar/catalog.json" || path == "/avatar/catalog" {
        let chemin = std::env::var("NIE_AVATAR_CATALOG")
            .unwrap_or_else(|_| String::from("var/avatar-resolved.json"));
        match std::fs::read(&chemin) {
            Ok(bytes) => respond(&mut stream, 200, "OK", "application/json; charset=utf-8", &bytes),
            Err(e) => respond_text(
                &mut stream,
                404,
                "Not Found",
                &format!(
                    "catalogue absent ({chemin} : {e}) — le produire par `niers avatar export -o {chemin}`"
                ),
            ),
        }
        return;
    }

    // `/avatar/layout/<ecran>.json` — le layout d'un écran de l'éditeur, positions comprises.
    //
    // Produit par `nie-game --menu <ecran> --from-setting --runtime --export-layout`, qui place
    // chaque objet à partir des **points d'attache** déclarés par les `CMenuAttachLocator` de
    // l'écran (`nie_formats::menu::attach_slots`) : les positions viennent donc des fichiers du
    // jeu, pas d'un relevé sur capture. Servir le fichier tel quel évite de refaire ce calcul.
    if let Some(rest) = path.strip_prefix("/avatar/layout/") {
        let ecran = rest.strip_suffix(".json").unwrap_or(rest);
        let invalide = ecran.is_empty()
            || ecran.len() > 64
            || !ecran.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
        if invalide {
            respond_text(&mut stream, 400, "Bad Request", "nom d'écran invalide");
            return;
        }
        let base = std::env::var("NIE_AVATAR_LAYOUTS")
            .unwrap_or_else(|_| String::from("var/avatar-ui/layouts"));
        let chemin = std::path::Path::new(&base).join(format!("{ecran}.json"));
        match std::fs::read(&chemin) {
            Ok(bytes) => respond(&mut stream, 200, "OK", "application/json; charset=utf-8", &bytes),
            Err(e) => respond_text(
                &mut stream,
                404,
                "Not Found",
                &format!("layout {ecran} absent ({e}) — le produire par `nie-game --menu {ecran} --from-setting --runtime --export-layout`"),
            ),
        }
        return;
    }

    // `/avatar/icon/<nom>.png` — une vignette de l'éditeur, décodée à la volée.
    //
    // L'atlas se **dérive du nom** : `icon_ava_face05_001` vit dans `icon_ava_face05.g4tx`
    // (le suffixe numérique final est l'index de la vignette). Aucun index à maintenir.
    if let Some(rest) = path.strip_prefix("/avatar/icon/") {
        let nom = rest.strip_suffix(".png").unwrap_or(rest);
        let invalide = nom.is_empty()
            || nom.contains('/')
            || nom.contains("..")
            || !nom.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
        if invalide {
            respond_text(&mut stream, 400, "Bad Request", "nom d'icône invalide");
            return;
        }
        let Some((atlas, _index)) = nom.rsplit_once('_') else {
            respond_text(&mut stream, 400, "Bad Request", "nom sans suffixe d'index");
            return;
        };
        let cible = format!("/21_icon_avatar/{atlas}.g4tx");
        let png = {
            let vfs = state.vfs.lock().unwrap();
            vfs.iter()
                .map(|(p, _)| p.to_string())
                .find(|p| p.ends_with(&cible))
                .and_then(|p| vfs.read(&p).ok())
                .and_then(|d| g4tx_decode::decode_named_to_png(&d, nom))
        };
        match png {
            Some(png) => respond(&mut stream, 200, "OK", "image/png", &png),
            None => respond_text(
                &mut stream,
                404,
                "Not Found",
                &format!("icône « {nom} » absente de {atlas}.g4tx"),
            ),
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
                respond(
                    &mut stream,
                    200,
                    "OK",
                    "application/json; charset=utf-8",
                    &body,
                );
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
                respond(
                    &mut stream,
                    200,
                    "OK",
                    "application/json; charset=utf-8",
                    &body,
                );
            }
            None => respond_text(
                &mut stream,
                404,
                "Not Found",
                "cfg.bin absent ou non-RDBN a listes",
            ),
        }
        return;
    }

    // `/lip/<vfs-path>.json` — décode une piste de lip-sync `.p3lip` en visèmes datés
    // (`{duration_s, frames:[{time_s, viseme, channel, param}]}`) à jouer en synchro voix.
    if let Some(rest) = path.strip_prefix("/lip/") {
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
        match bytes.as_deref().map(nie_formats::lip::parse) {
            Some(Ok(lip)) => {
                let body = serde_json::to_vec(&lip).unwrap_or_default();
                respond(
                    &mut stream,
                    200,
                    "OK",
                    "application/json; charset=utf-8",
                    &body,
                );
            }
            Some(Err(e)) => {
                respond_text(
                    &mut stream,
                    422,
                    "Unprocessable Entity",
                    &format!("p3lip invalide : {e}"),
                );
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
            || !screen
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
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
                respond_text(
                    &mut stream,
                    500,
                    "Internal Server Error",
                    "layout illisible",
                );
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
            g4tx_decode::decode_best_to_rgba(&g4tx, g4tx_decode::basename_of(&vfs_path))
        });
        match png {
            Some(bytes) => respond(&mut stream, 200, "OK", "image/png", &bytes),
            None => respond_text(&mut stream, 500, "Internal Server Error", "rendu échoué"),
        }
        return;
    }

    // `/menu-tree.json` — arbre de TOUS les écrans de menu (440 `*_setting`, dont 304 `*_menu_setting`
    // + fenêtres/sélecteurs) ; `/menu-tree/<screen>.json` — un écran. Chaque écran : nav-hash
    // `CRC32(stem)` + ses layers `{hash=CRC32(name), name, objbin}`, ressources et commandes (port
    // `nie_data::menu_setting`). Source unique navigable du hub (débloque navigation + labels + rendu
    // par écran). Données byte-exact : `consistent: true` ⇔ chaque `hash == CRC32(name)`.
    if let Some(rest) = path.strip_prefix("/menu-tree")
        && (rest.is_empty() || rest == ".json" || rest.starts_with('/'))
    {
        let sel = rest
            .strip_prefix('/')
            .unwrap_or(rest)
            .strip_suffix(".json")
            .unwrap_or("")
            .trim();
        let dir = &state.menu_cfg_dir;
        if sel.is_empty() {
            let mut paths: Vec<PathBuf> = match fs::read_dir(dir) {
                Ok(rd) => rd.flatten().map(|e| e.path()).collect(),
                Err(_) => Vec::new(),
            };
            paths.sort();
            let mut screens: Vec<serde_json::Value> = Vec::new();
            for p in &paths {
                let Some(fname) = p.file_name().and_then(|s| s.to_str()) else {
                    continue;
                };
                let Some(stem) = fname.strip_suffix("_setting.cfg.bin.json") else {
                    continue;
                };
                if let Some(v) = menu_screen_entry(p, stem) {
                    screens.push(v);
                }
            }
            if screens.is_empty() {
                respond_text(
                    &mut stream,
                    404,
                    "Not Found",
                    "aucun menu_setting (dump absent ?)",
                );
                return;
            }
            let body = serde_json::json!({ "count": screens.len(), "screens": screens });
            let bytes = serde_json::to_vec(&body).unwrap_or_default();
            respond(&mut stream, 200, "OK", "application/json", &bytes);
            return;
        }
        if sel.len() > 64
            || !sel
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            respond_text(&mut stream, 400, "Bad Request", "écran invalide");
            return;
        }
        let p = dir.join(format!("{sel}_setting.cfg.bin.json"));
        match menu_screen_entry(&p, sel) {
            Some(v) => {
                let bytes = serde_json::to_vec(&v).unwrap_or_default();
                respond(&mut stream, 200, "OK", "application/json", &bytes);
            }
            None => respond_text(&mut stream, 404, "Not Found", "écran introuvable"),
        }
        return;
    }

    // `/story-scene[/<n>].png` — scène de dialogue du MODE HISTOIRE : un vrai dialogue
    // (`inagle_event_subtitles`) rendu dans la VRAIE police + boîte + onglet locuteur. `<n>` =
    // offset de ligne déterministe (défaut 0). Sert le mode histoire à azalee, sans dump.
    if let Some(rest) = path.strip_prefix("/story-scene") {
        let sel = rest
            .trim_start_matches('/')
            .strip_suffix(".png")
            .unwrap_or("")
            .trim();
        let offset: i64 = sel.parse().unwrap_or(0).max(0);
        let Some(db) = state.db_path.clone() else {
            respond_text(
                &mut stream,
                503,
                "Service Unavailable",
                "miroir SQLite absent",
            );
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
            respond_text(
                &mut stream,
                404,
                "Not Found",
                "dialogue introuvable (table inagle absente ?)",
            );
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
            respond_text(
                &mut stream,
                500,
                "Internal Server Error",
                "police absente du VFS",
            );
            return;
        };
        match compose_story_png(&cfg, &g4tx, &speaker, &text) {
            Some(png) => respond(&mut stream, 200, "OK", "image/png", &png),
            None => respond_text(
                &mut stream,
                500,
                "Internal Server Error",
                "composition échouée",
            ),
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
            !s.is_empty()
                && s.len() <= 32
                && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        };
        if !valid(sub) || !valid(code) {
            respond_text(
                &mut stream,
                400,
                "Bad Request",
                "sous-domaine/code invalide",
            );
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

    // `/model-avatar/<pieces>.glb` — un avatar de l'éditeur, assemblé depuis ses pièces.
    //
    // `<pieces>` liste les pièces séparées par `+`, chacune sous la forme `<dossier>/<nom>` :
    // `_uniform` mis à part, un dossier commençant par `_` désigne une pièce de `20_EDIT`, un
    // dossier sans souligné un modèle d'uniforme —
    // `u000101/u000101+s000201/s000201+_facebase/face51_nose01+_hairF/hairF001`.
    //
    // L'avatar du jeu n'est pas un modèle unique : c'est cet empilement que
    // `assemble_avatar_model` recompose. Attention, `_base/base_*` N'EST PAS le corps malgré son
    // nom et malgré ce qu'affirmait la doc d'`assemble.rs` : ces mailles ne portent que l'œil et
    // la bouche, à hauteur de tête (y ∈ [1,29 ; 1,60] m). Le corps habillé de l'éditeur est
    // `_uniform/u000101` (haut et short, cheville → cou) plus `_uniform/s000201` (chaussures),
    // d'après les recettes `common/chr/_test/default/mdl_edit_avatar*.cfg.bin`.
    if let Some(rest) = path.strip_prefix("/model-avatar/") {
        let body = rest.strip_suffix(".glb").unwrap_or(rest);
        let valide = |s: &str| {
            !s.is_empty() && s.len() <= 48 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        };
        let specs: Vec<(String, String)> = body
            .split('+')
            .filter_map(|spec| spec.split_once('/'))
            .filter(|(d, n)| valide(d) && valide(n))
            .map(|(d, n)| (d.to_string(), n.to_string()))
            .collect();
        if specs.is_empty() {
            respond_text(&mut stream, 404, "Not Found", "aucune pièce lisible");
            return;
        }
        let couches_visage: Vec<String> = param(query, "face")
            .unwrap_or_default()
            .split(',')
            .filter(|c| {
                !c.is_empty()
                    && c.len() <= 40
                    && c.chars().all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '/')
            })
            .map(str::to_string)
            .collect();
        match get_or_build_avatar_glb(&state, &specs, &couches_visage) {
            Ok(glb) => respond(&mut stream, 200, "OK", "model/gltf-binary", &glb),
            Err(e) => {
                debug!("assemblage avatar échoué : {e}");
                respond_text(&mut stream, 500, "Internal Server Error", "assemblage échoué");
            }
        }
        return;
    }

    // `/model-edit/<dossier>/<nom>.glb` — un modèle de l'**éditeur d'avatar**.
    //
    // Ces modèles ne suivent pas la convention des autres : ils vivent à plat sous
    // `common/chr/_face/20_EDIT/<dossier>/<nom>.{g4md,g4mg}` (`_base` pour les corps,
    // `_facebase` pour les visages, `_hairF`/`_hairB`/`_hairU` pour les coiffures, `_ear`,
    // `_accessory`), sans sous-dossier par code — d'où une route à part plutôt qu'un
    // sous-domaine de `/model-chr/`.
    //
    // La texture est cherchée à deux endroits, dans cet ordre : `<nom>.g4tx` puis `<nom>M.g4tx`,
    // la seconde forme étant celle des coiffures (`hairF001` → `hairF001M.g4tx`). Sans texture,
    // le maillage est servi nu plutôt que refusé.
    if let Some(rest) = path.strip_prefix("/model-edit/") {
        let body = rest.strip_suffix(".glb").unwrap_or(rest);
        let mut parts = body.splitn(2, '/');
        let dossier = parts.next().unwrap_or("");
        let nom = parts.next().unwrap_or("");
        let valide = |s: &str| {
            !s.is_empty()
                && s.len() <= 48
                && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        };
        if !valide(dossier) || !valide(nom) {
            respond_text(&mut stream, 400, "Bad Request", "dossier/nom invalide");
            return;
        }
        match get_or_build_edit_glb(&state, dossier, nom) {
            Ok(glb) => respond(&mut stream, 200, "OK", "model/gltf-binary", &glb),
            Err(e) => {
                debug!("assemblage edit {dossier}/{nom} échoué : {e}");
                respond_text(
                    &mut stream,
                    404,
                    "Not Found",
                    &format!("modèle {dossier}/{nom} non disponible : {e}"),
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
                !s.is_empty()
                    && s.len() <= 32
                    && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
            });
        if !valid {
            respond_text(&mut stream, 400, "Bad Request", "chemin map invalide");
            return;
        }
        match get_or_build_map_glb(&state, rel) {
            Ok(glb) => respond(&mut stream, 200, "OK", "model/gltf-binary", &glb),
            Err(e) => {
                debug!("assemblage map {rel} échoué : {e}");
                respond_text(
                    &mut stream,
                    404,
                    "Not Found",
                    &format!("map {rel} non disponible : {e}"),
                );
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
            || !code
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        {
            respond_text(&mut stream, 400, "Bad Request", "code invalide");
            return;
        }

        match get_or_build_glb(&state, code) {
            Ok(glb) => {
                respond(&mut stream, 200, "OK", "model/gltf-binary", &glb);
            }
            Err(e) => {
                warn!("assemblage {code} échoué : {e}");
                respond_text(
                    &mut stream,
                    404,
                    "Not Found",
                    &format!("modèle {code} non disponible : {e}"),
                );
            }
        }
        return;
    }

    // `/audio-info/<vfs-path>` — CATALOGUE des cues d'une banque audio, en JSON.
    //
    // Un `.acb` est une banque : `/audio` n'en décodait qu'UNE piste (la plus volumineuse), ce qui
    // rendait les centaines d'autres inatteignables. Cette route les énumère (index, cue-id,
    // taille, codec, nom quand la CueNameTable le donne) ; chacune se joue ensuite par
    // `/audio/<chemin>?cue=<index>`. C'est le socle de la galerie audio.
    if let Some(rest) = path.strip_prefix("/audio-info/") {
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
            None => respond_text(&mut stream, 404, "Not Found", "fichier audio absent du VFS"),
            Some(raw) => {
                let j = audio_info_json(&vfs_path, &raw);
                let body = serde_json::to_vec(&j).unwrap_or_default();
                respond(&mut stream, 200, "OK", "application/json", &body);
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
    // `?cue=N` sélectionne l'entrée N de la banque (index de `/audio-info`), au lieu du défaut
    // « la plus volumineuse ». Le paramètre était documenté mais MORT : la query string était
    // strippée avant le routage, donc jamais lue.
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
        // `?cue=N` = rang de l'entrée dans l'AWB. `?id=N` = cue-id AFS2, tel que `/audio-info`
        // le publie (`awbId`) : c'est la forme stable, le rang dépendant de l'ordre du fichier.
        let cue: Option<usize> = param(query, "cue").and_then(|v| v.parse().ok());
        let awb_id: Option<u16> = param(query, "id").and_then(|v| v.parse().ok());
        let bytes = {
            let vfs = state.vfs.lock().unwrap();
            vfs.read(&vfs_path).ok()
        };
        match bytes {
            None => {
                respond_text(&mut stream, 404, "Not Found", "fichier audio absent du VFS");
            }
            Some(raw) => {
                // Avec `?cue=`/`?id=`, on passe obligatoirement par la banque : `decode_to_wav`
                // ne sait choisir que le défaut. Sans eux, le comportement est INCHANGÉ.
                let result = if cue.is_some() || awb_id.is_some() {
                    match resoudre_awb(&state, &vfs_path, &raw) {
                        None => Err(anyhow::anyhow!(
                            "{vfs_path} : pas de banque AWB, `?cue=`/`?id=` sans objet"
                        )),
                        Some((awb_bytes, _)) => {
                            let rang = match awb_id {
                                None => cue,
                                Some(id) => match nie_formats::cri_audio::Awb::parse(&awb_bytes) {
                                    Ok(a) => match a.index_of_id(id) {
                                        Some(i) => Some(i),
                                        None => {
                                            respond_text(
                                                &mut stream,
                                                404,
                                                "Not Found",
                                                &format!("cue-id {id} absent de la banque"),
                                            );
                                            return;
                                        }
                                    },
                                    Err(e) => {
                                        respond_text(
                                            &mut stream,
                                            500,
                                            "Internal Server Error",
                                            &format!("AWB illisible : {e}"),
                                        );
                                        return;
                                    }
                                },
                            };
                            decode_awb_entry(&awb_bytes, &vfs_path, rang)
                        }
                    }
                } else {
                    decode_audio_to_wav(&raw, &vfs_path)
                };
                let result = result.or_else(|e| {
                    let msg = e.to_string();
                    if msg.contains("ACB sans AWB") {
                        // AWB externe : même chemin, extension .awb
                        let awb_path = if vfs_path.ends_with(".acb") {
                            format!("{}.awb", &vfs_path[..vfs_path.len() - 4])
                        } else {
                            return Err(e);
                        };
                        let vfs_guard = state.vfs.lock().unwrap();
                        let awb_bytes = vfs_guard
                            .read(&awb_path)
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
                        respond_text(
                            &mut stream,
                            500,
                            "Internal Server Error",
                            &format!("décodage audio échoué : {e}"),
                        );
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
        // Lit et démuxe ; en cas d'échec (absente du disque, ou octets qui ne sont pas du CRID),
        // retente sur la variante jumelle avant d'abandonner. L'erreur rapportée reste celle du
        // chemin DEMANDÉ : c'est celui que l'appelant connaît.
        let lire_et_demuxer = |chemin: &str| -> Result<nie_formats::cri_audio::UsmResult, String> {
            let raw = {
                let vfs = state.vfs.lock().unwrap();
                vfs.read(chemin).map_err(|_| "absent du VFS".to_string())?
            };
            usm_demux(&raw).map_err(|e| e.to_string())
        };

        let demuxe = lire_et_demuxer(&vfs_path).or_else(|erreur_origine| {
            match variante_jumelle(&vfs_path) {
                None => Err(erreur_origine),
                Some(jumelle) => match lire_et_demuxer(&jumelle) {
                    Ok(r) => {
                        info!("{vfs_path} illisible ({erreur_origine}) — servie depuis {jumelle}");
                        Ok(r)
                    }
                    Err(_) => Err(erreur_origine),
                },
            }
        });

        match demuxe {
            Err(e) if e == "absent du VFS" => {
                respond_text(&mut stream, 404, "Not Found", "fichier vidéo absent du VFS");
            }
            Err(e) => {
                warn!("démux USM {vfs_path} échoué : {e}");
                respond_text(
                    &mut stream,
                    500,
                    "Internal Server Error",
                    &format!("démux USM échoué : {e}"),
                );
            }
            Ok(result) => {
                // `?track=audio` — la piste sonore du film, en WAV. Le commentaire de cette
                // route l'annonçait depuis toujours, mais rien ne l'implémentait : la query
                // était strippée avant le routage, et `audio_tracks` n'était lu nulle part.
                if param(query, "track").as_deref() == Some("audio") {
                    let Some(piste) = result.audio_tracks.first() else {
                        respond_text(&mut stream, 404, "Not Found", "USM sans piste audio");
                        return;
                    };
                    match nie_formats::cri_audio::decode_to_wav(piste) {
                        Ok(wav) => respond_ranged(&mut stream, "audio/wav", &wav, range_header),
                        Err(e) => {
                            warn!("décodage piste audio {vfs_path} échoué : {e}");
                            respond_text(
                                &mut stream,
                                500,
                                "Internal Server Error",
                                &format!("décodage audio du film échoué : {e}"),
                            );
                        }
                    }
                    return;
                }

                if result.video_data.is_empty() {
                    respond_text(&mut stream, 404, "Not Found", "USM sans piste vidéo");
                    return;
                }
                let (ct, body) = match result.video_codec {
                    // H.264 brut -> remux MP4 fragmenté (lisible <video>) ;
                    // repli sur le flux brut si ffmpeg indisponible.
                    VideoCodec::H264 => match mux_h264_to_mp4(&result.video_data) {
                        Some(mp4) => ("video/mp4", mp4),
                        None => ("video/h264", result.video_data),
                    },
                    VideoCodec::Vp9 => ("video/webm", result.video_data),
                    VideoCodec::Unknown => ("application/octet-stream", result.video_data),
                };
                info!(
                    "USM {} démuxé : {} frames, {}B",
                    vfs_path,
                    result.frame_count,
                    body.len()
                );
                respond_ranged(&mut stream, ct, &body, range_header);
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
    let backups = nie_formats::vfs::resolve_game_dir().join("data/backups");
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
    let Ok(azalee_backups) = std::env::var("AZALEE_BACKUPS").map(PathBuf::from) else {
        return None;
    };
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

    // Tous les chemins dérivent de la racine du jeu, résolue à l'exécution : le même binaire
    // sert un serveur Linux et un poste Windows sans qu'aucun chemin de machine ne soit compilé
    // dedans. `var/` vit à côté du jeu, comme le reste des artefacts régénérables.
    let racine = cli.game_dir.clone().unwrap_or_else(nie_formats::vfs::resolve_game_dir);
    info!("racine du jeu : {}", racine.display());
    let var = racine.join("var");
    let glb_dir = cli.glb_dir.clone().unwrap_or_else(|| racine.join("data/dx11/model"));
    let cache_dir = cli.cache_dir.clone().unwrap_or_else(|| var.join("model-cache"));
    let crc_manifest = cli.crc_manifest.clone().unwrap_or_else(|| var.join("model-crc-manifest.ndjson"));
    let uniform_map_path = cli.uniform_map.clone().unwrap_or_else(|| var.join("uniform-model-map.ndjson"));
    let body_manifest = cli.body_manifest.clone().unwrap_or_else(|| var.join("body-type-manifest.ndjson"));
    let menu_cfg_dir = cli
        .menu_cfg_dir
        .clone()
        .unwrap_or_else(|| racine.join("data/common/gamedata/menu/cfg"));
    let asset_cross_ref =
        cli.asset_cross_ref.clone().unwrap_or_else(|| racine.join("data/asset-cross-reference.json"));
    // Ces deux-là appartiennent au dépôt azalee : sans argument explicite, les routes qui en
    // dépendent restent inactives plutôt que de pointer un chemin inventé.
    let layout_dir = cli.layout_dir.clone().unwrap_or_default();
    let cpk_file_index = cli.cpk_file_index.clone().unwrap_or_default();

    // Prépare le répertoire de cache.
    fs::create_dir_all(&cache_dir)
        .with_context(|| format!("création cache_dir {}", cache_dir.display()))?;

    // Initialise le VFS.
    let mut vfs = Vfs::new();
    let game_data = racine.join("data");
    vfs.init(&game_data)
        .with_context(|| format!("init VFS depuis {}", game_data.display()))?;
    info!("VFS initialisé ({} fichiers indexés)", vfs.asset_count());

    // Index supplémentaire : rend lisibles les fichiers des CPK hors cpk_list.cfg.bin
    // (films .usm, sound_asset .acb…) via l'index global [chemin, cpk].
    match load_cpk_file_index(&cpk_file_index) {
        Ok(entries) if !entries.is_empty() => {
            let added = vfs.add_extra_index(entries);
            info!("index VFS supplémentaire : +{added} fichiers (CPK hors cpk_list)");
        }
        Ok(_) => {}
        Err(e) => warn!(
            "index VFS supplémentaire ignoré ({}): {e}",
            cpk_file_index.display()
        ),
    }

    // Charge les manifestes.
    let crc_manifest = State::load_crc_manifest(&crc_manifest)?;
    let uniform_map = State::load_uniform_map(&uniform_map_path);
    let body_map = State::load_body_map(&body_manifest);
    let asset_roles = State::load_asset_roles(&asset_cross_ref);

    // Résout le miroir SQLite.
    let db_path = resolve_db(cli.db.as_deref());
    if let Some(ref p) = db_path {
        info!("miroir SQLite : {}", p.display());
    }

    let state = Arc::new(State {
        vfs: std::sync::Mutex::new(vfs),
        glb_dir: glb_dir.clone(),
        crc_manifest,
        uniform_map,
        body_map,
        cache_dir: cache_dir.clone(),
        db_path,
        layout_dir: layout_dir.clone(),
        menu_cfg_dir: menu_cfg_dir.clone(),
        asset_roles,
    });

    // Bind du serveur TCP.
    let addr = format!("127.0.0.1:{}", cli.port);
    let listener = TcpListener::bind(&addr).with_context(|| format!("bind {addr}"))?;
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
        let g = nie_formats::vfs::resolve_game_dir().join("data/common/gamedata");
        let g = g.to_string_lossy().to_string();
        let g: &str = &g;
        let cases: [(&str, &str, String); 20] = [
            (
                "uniform_config",
                "uniform",
                format!("{g}/character/uniform_config_1.03.52.00.cfg.bin.json"),
            ),
            (
                "players_universe_config",
                "players_universe",
                format!("{g}/players_universe/players_universe_config_1.03.59.00.cfg.bin.json"),
            ),
            (
                "players_universe_event_config",
                "players_universe_event",
                format!("{g}/players_universe/players_universe_event_config.cfg.bin.json"),
            ),
            (
                "nfc_lottery_config",
                "nfc_lottery",
                format!("{g}/nfc/nfc_lottery_config.cfg.bin.json"),
            ),
            (
                "search_word_config",
                "search_word",
                format!("{g}/search_word/search_word_config.cfg.bin.json"),
            ),
            (
                "passive_skill_config",
                "passive",
                format!("{g}/skill/passive_skill_config_0.08.86.cfg.bin.json"),
            ),
            (
                "soccer_ai_cmd_config",
                "soccer_ai_cmd",
                format!("{g}/ai/soccer_ai_cmd_config_0.05.91.cfg.bin.json"),
            ),
            (
                "soccer_user_ai_config",
                "soccer_user_ai",
                format!("{g}/ai/soccer_user_ai_config_1.01.50.cfg.bin.json"),
            ),
            (
                "strategy_ai_config",
                "strategy_ai",
                format!("{g}/ai/strategy_ai_config_1.01.50.cfg.bin.json"),
            ),
            (
                "tactics_ai_config",
                "tactics_ai",
                format!("{g}/ai/tactics_ai_config_0.06.44.cfg.bin.json"),
            ),
            (
                "adaptive_trigger_def",
                "adaptive_trigger",
                format!("{g}/input/adaptive_trigger_def_0.00.00.cfg.bin.json"),
            ),
            (
                "haptic_feedback_def",
                "haptic_feedback",
                format!("{g}/input/haptic_feedback_def_0.00.00.cfg.bin.json"),
            ),
            (
                "vibration_def",
                "vibration",
                format!("{g}/input/vibration_def_0.00.09.cfg.bin.json"),
            ),
            // Échantillon de la 3e vague (workflow d'analyse 31 familles).
            (
                "basara_chara_config",
                "basara_chara",
                format!("{g}/character/basara_chara_config_0.00.00.00.cfg.bin.json"),
            ),
            (
                "belong_team_config",
                "belong_team",
                format!("{g}/character/belong_team_config_0.00.00.cfg.bin.json"),
            ),
            (
                "capsule_config",
                "capsule",
                format!("{g}/capsule/capsule_config_0.00.00.cfg.bin.json"),
            ),
            (
                "chara_base",
                "chara_base",
                format!("{g}/character/chara_base_1.03.98.00.cfg.bin.json"),
            ),
            (
                "shop_config",
                "shop",
                format!("{g}/shop/shop_config_3.00.22.cfg.bin.json"),
            ),
            (
                "quest_config",
                "quest",
                format!("{g}/quest/quest_config_1.04.11.00.cfg.bin.json"),
            ),
            (
                "real_skill_config",
                "real_skill",
                format!("{g}/skill/real_skill_config_1.03.74.00.cfg.bin.json"),
            ),
        ];
        for (key, label, path) in &cases {
            let (key, label): (&str, &str) = (key, label);
            if !std::path::Path::new(path).exists() {
                eprintln!("dump absent, skip {key}");
                continue;
            }
            let txt = std::fs::read_to_string(path).expect("lire json");
            let root: serde_json::Value = serde_json::from_str(&txt).expect("json valide");
            let (got_label, value) = nie_data::typed::decode_by_key(key, &root)
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
            code_of_dir_pair(
                "data/dx11/chr/_face/01_IE1/c01000010/c01000010.g4tx",
                "/_face/",
                ".g4tx"
            )
            .as_deref(),
            Some("c01000010")
        );
        // Keshin.
        assert_eq!(
            code_of_dir_pair(
                "data/common/chr/_keshin/k000010/k000010.g4md",
                "/_keshin/",
                ".g4md"
            )
            .as_deref(),
            Some("k000010")
        );
        // Dossier ≠ fichier (texture de partie, pas un modèle) → rejeté.
        assert_eq!(
            code_of_dir_pair(
                "data/dx11/chr/_face/01_IE1/c01000010/base_normal_00.g4tx",
                "/_face/",
                ".g4tx"
            ),
            None
        );
        // Marqueur absent → rejeté.
        assert_eq!(
            code_of_dir_pair("data/x/y/z.g4tx", "/_face/", ".g4tx"),
            None
        );
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
            concat!("data/cross-apk/work/laneE-audio/staging/c00001001.awb");

        let data = std::fs::read(AWB_PATH)
            .expect("fichier AWB absent — lancer avec `--features real-audio` sur le VPS IEVR");

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
            nie_formats::cri_audio::hca_decode_to_pcm16(entry_data, awb.subkey)
                .expect("décodage HCA IEVR échoué — clé ou format incorrect");

        assert_eq!(sample_rate, 48_000, "sample_rate attendu : 48000 Hz");
        assert_eq!(channels, 1, "canal attendu : mono (1)");
        assert!(
            !samples.is_empty(),
            "aucun sample décodé — encoder_delay absorbe tout ?"
        );

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
        assert!(
            awb_paths.len() >= 3,
            "moins de 3 AWB dans le VFS ({})",
            awb_paths.len()
        );

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
            let Ok((samples, channels, sample_rate)) =
                nie_formats::cri_audio::hca_decode_to_pcm16(entry_data, awb.subkey)
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
            assert!(
                (1..=2).contains(&channels),
                "{path} : channels {channels} inattendu"
            );
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
