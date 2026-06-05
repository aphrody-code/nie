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
    CharacterAssemblyInput, SeasonKey, TextureUriConfig, assemble_armed,
    assemble_character_model, assemble_keshin, g4md_to_g4mg_path, load_manifest,
    resolve_crc_to_g4md_path,
};
use nie_formats::vfs::Vfs;

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

    /// Manifeste body_type_idx (var/body-type-manifest.ndjson, optionnel — fallback type_idx=0).
    #[arg(long, default_value = "/home/ubuntu/niers/var/body-type-manifest.ndjson")]
    body_manifest: PathBuf,

    /// Répertoire de cache GLB assemblés.
    #[arg(long, default_value = "/home/ubuntu/niers/var/model-cache")]
    cache_dir: PathBuf,

    /// Port d'écoute (localhost uniquement).
    #[arg(long, default_value_t = 8790)]
    port: u16,

    /// Nombre de threads de travail.
    #[arg(long, default_value_t = 4)]
    threads: usize,
}

// ── État partagé ──────────────────────────────────────────────────────────────

/// État partagé entre les threads (derrière Arc).
struct State {
    vfs: std::sync::Mutex<Vfs>,
    glb_dir: PathBuf,
    crc_manifest: Vec<nie_formats::assemble::ManifestEntry>,
    /// internal_code → body_type_idx (depuis var/body-type-manifest.ndjson).
    body_map: HashMap<String, u8>,
    cache_dir: PathBuf,
    tex_cfg: TextureUriConfig,
    /// SQLite mirror : résolution uniforme via inagle_*.
    db_path: Option<PathBuf>,
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

    // Tentative de chargement des données G4MD/G4MG de l'uniforme depuis le VFS.
    let (uniform_g4md, uniform_g4mg) = if uniform_crc != 0 {
        match load_uniform_from_vfs(state, uniform_crc) {
            Ok((md, mg)) => (Some(md), Some(mg)),
            Err(e) => {
                debug!("uniforme {:#010x} non chargé depuis VFS : {e}", uniform_crc);
                (None, None)
            }
        }
    } else {
        (None, None)
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

    Ok(model.to_glb_textured(&state.tex_cfg))
}

/// Charge les données G4MD+G4MG d'un uniforme depuis le VFS via le manifeste CRC.
fn load_uniform_from_vfs(state: &State, crc: u32) -> Result<(Vec<u8>, Vec<u8>)> {
    let g4md_path = resolve_crc_to_g4md_path(&state.crc_manifest, crc)
        .ok_or_else(|| anyhow::anyhow!("CRC {:#010x} absent du manifeste", crc))?;
    let g4mg_path = g4md_to_g4mg_path(g4md_path);

    let vfs = state.vfs.lock().unwrap();
    let g4md = vfs.read(g4md_path)
        .with_context(|| format!("lecture G4MD {g4md_path}"))?;
    let g4mg = vfs.read(&g4mg_path)
        .with_context(|| format!("lecture G4MG {g4mg_path}"))?;

    Ok((g4md, g4mg))
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

    // Routing.
    if path == "/health" {
        respond_text(&mut stream, 200, "OK", "ok");
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
        body_map,
        cache_dir: cli.cache_dir.clone(),
        tex_cfg: TextureUriConfig::default(),
        db_path,
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
