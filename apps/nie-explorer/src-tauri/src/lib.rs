//! Backend Tauri de `nie-explorer` — explorateur/éditeur du VFS (CPK) d'Inazuma Eleven:
//! Victory Road. Toute la logique de décodage vient de `nie-formats`/`nie-explore` (même
//! moteur que `niers vfs cat`, cf. `CLAUDE.md` anti-doublon) ; ce module n'est qu'une façade
//! IPC (JSON) au-dessus de ces crates + une recherche chara/waza via le miroir `nie-wiki`.

use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine as _;
use nie_formats::vfs::Vfs;
use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_sql::{Migration, MigrationKind};

/// Migrations SQLite du workspace de mods (`tauri-plugin-sql`, base `mods.db` dans
/// `BaseDirectory::AppData` — jamais dans le dossier du jeu). Un mod = un ensemble de fichiers
/// VFS remplacés par une copie éditée par l'utilisatrice ; `nie-formats` n'a pas d'encodeur CPK,
/// donc ce registre ne modifie RIEN en place — il organise des copies destinées à l'export.
fn mods_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "mods + mod_files + recent_paths",
            kind: MigrationKind::Up,
            sql: r#"
                CREATE TABLE mods (
                    id          TEXT PRIMARY KEY,
                    name        TEXT NOT NULL,
                    description TEXT NOT NULL DEFAULT '',
                    enabled     INTEGER NOT NULL DEFAULT 0,
                    priority    INTEGER NOT NULL DEFAULT 0,
                    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
                );
                CREATE TABLE mod_files (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    mod_id        TEXT NOT NULL REFERENCES mods(id) ON DELETE CASCADE,
                    vfs_path      TEXT NOT NULL,
                    staged_file   TEXT NOT NULL,
                    original_file TEXT,
                    staged_size   INTEGER,
                    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE(mod_id, vfs_path)
                );
                CREATE INDEX idx_mod_files_mod ON mod_files(mod_id);
                CREATE TABLE recent_paths (
                    path      TEXT PRIMARY KEY,
                    kind      TEXT NOT NULL,
                    opened_at TEXT NOT NULL DEFAULT (datetime('now'))
                );
            "#,
        },
        Migration {
            // Index complet du VFS (~255 800 entrées, cf. `vfs_all_entries` + `src/lib/
            // vfsIndexDb.ts`) : matérialisé sur demande (« Réindexer » dans Paramètres), PAS au
            // démarrage. Objectif = PRÉCISION — `code` (basename sans extension, ex.
            // `c01000100`, `c01000100_5000`, `whs00010`) indexé pour une résolution EXACTE
            // (`code = ? OR code LIKE ?||'\_%'`) au lieu du `.contains()` substring en mémoire
            // de `vfs_related`, qui peut matcher un code apparaissant par hasard ailleurs dans
            // un chemin sans rapport (faux positif).
            version: 2,
            description: "vfs_files (index complet du VFS pour résolution précise par code)",
            kind: MigrationKind::Up,
            sql: r#"
                CREATE TABLE vfs_files (
                    path TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    ext  TEXT NOT NULL,
                    code TEXT NOT NULL,
                    cpk  TEXT NOT NULL,
                    size INTEGER NOT NULL
                );
                CREATE INDEX idx_vfs_files_code ON vfs_files(code);
                CREATE INDEX idx_vfs_files_ext ON vfs_files(ext);
                CREATE TABLE vfs_index_meta (
                    id          INTEGER PRIMARY KEY CHECK (id = 1),
                    total       INTEGER NOT NULL,
                    reindexed_at TEXT NOT NULL
                );
            "#,
        },
    ]
}

/// Chemin passé en argument au lancement (« Ouvrir avec nie-explorer » depuis l'explorateur
/// Windows) — posé au cold-start, consommé une fois par le frontend via [`take_pending_open`].
struct PendingOpen(Mutex<Option<String>>);

/// Premier argument CLI qui ressemble à un chemin de fichier existant (ignore argv[0] et les
/// flags `-*` que Tauri/webview peuvent ajouter).
fn first_path_arg<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().skip(1).find(|a| !a.starts_with('-') && std::path::Path::new(a).is_file())
}

/// Ouvre le VFS depuis `game_dir` (ou [`nie_formats::vfs::resolve_game_dir`] si `None`/vide).
fn open_vfs(game_dir: Option<String>) -> Result<Vfs, String> {
    let root = match game_dir.filter(|s| !s.trim().is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => nie_formats::vfs::resolve_game_dir(),
    };
    let data_dir = root.join("data");
    let mut vfs = Vfs::new();
    vfs.init(&data_dir).map_err(|e| format!("init VFS depuis {} : {e}", data_dir.display()))?;
    Ok(vfs)
}

#[derive(Serialize)]
struct EntryDto {
    path: String,
    name: String,
    size: u32,
    cpk: String,
}

#[derive(Serialize)]
struct LsDto {
    dirs: Vec<String>,
    files: Vec<EntryDto>,
    /// Rôle du dossier courant (cf. `nie_explore::folder_roles`), `None` si non catalogué —
    /// jamais un rôle deviné : la table ne couvre que ce qui est sourcé/vérifié.
    role: Option<FolderRoleDto>,
}

#[derive(Serialize)]
struct FolderRoleDto {
    role: String,
    status: String,
}

#[derive(Serialize)]
struct StatsDto {
    total: usize,
    cpk_count: usize,
    extra_count: usize,
    loose_count: usize,
    top_ext: Vec<(String, usize)>,
}

/// Racine de jeu par défaut (résolue comme `niers vfs`, sans argument explicite).
#[tauri::command]
fn default_game_dir() -> String {
    nie_formats::vfs::resolve_game_dir().display().to_string()
}

/// Vérifie qu'un répertoire de jeu est valide (contient `data/cpk_list.cfg.bin`).
#[tauri::command]
fn check_game_dir(game_dir: String) -> bool {
    PathBuf::from(game_dir).join("data").join("cpk_list.cfg.bin").is_file()
}

#[tauri::command]
fn vfs_ls(prefix: String, game_dir: Option<String>) -> Result<LsDto, String> {
    let vfs = open_vfs(game_dir)?;
    let prefix = prefix.trim_matches('/');

    let mut dirs: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
    let mut files: Vec<EntryDto> = Vec::new();

    for (path, entry) in vfs.iter() {
        let rest = if prefix.is_empty() {
            path
        } else if path == prefix {
            continue;
        } else if let Some(r) = path.strip_prefix(prefix).and_then(|r| r.strip_prefix('/')) {
            r
        } else {
            continue;
        };
        match rest.split_once('/') {
            Some((seg, _)) => {
                dirs.insert(seg.to_string());
            }
            None => files.push(EntryDto {
                path: path.to_string(),
                name: rest.to_string(),
                size: entry.file_size,
                cpk: entry.cpk_filename.clone(),
            }),
        }
    }
    files.sort_by(|a, b| a.name.cmp(&b.name));
    let role = nie_explore::folder_roles::describe_folder(prefix)
        .map(|r| FolderRoleDto { role: r.role.to_string(), status: r.status.to_string() });
    Ok(LsDto { dirs: dirs.into_iter().collect(), files, role })
}

#[tauri::command]
fn vfs_find(query: String, ext: Option<String>, limit: usize, game_dir: Option<String>) -> Result<Vec<EntryDto>, String> {
    let vfs = open_vfs(game_dir)?;
    let q = query.to_lowercase();
    let ext_dot = ext.filter(|e| !e.is_empty()).map(|e| format!(".{}", e.trim_start_matches('.').to_lowercase()));

    let mut hits: Vec<EntryDto> = vfs
        .iter()
        .filter(|(p, _)| p.to_lowercase().contains(&q))
        .filter(|(p, _)| ext_dot.as_deref().is_none_or(|e| p.to_lowercase().ends_with(e)))
        .map(|(path, entry)| EntryDto {
            path: path.to_string(),
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            size: entry.file_size,
            cpk: entry.cpk_filename.clone(),
        })
        .collect();
    hits.sort_by(|a, b| a.path.cmp(&b.path));
    hits.truncate(limit.max(1));
    Ok(hits)
}

#[tauri::command]
fn vfs_stats(game_dir: Option<String>) -> Result<StatsDto, String> {
    let vfs = open_vfs(game_dir)?;
    let mut counts: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for (path, _) in vfs.iter() {
        let base = path.rsplit('/').next().unwrap_or(path);
        let ext = base.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_else(|| "<none>".to_string());
        *counts.entry(ext).or_default() += 1;
    }
    let mut top_ext: Vec<(String, usize)> = counts.into_iter().collect();
    top_ext.sort_by_key(|(_, c)| std::cmp::Reverse(*c));
    top_ext.truncate(30);
    Ok(StatsDto {
        total: vfs.asset_count(),
        cpk_count: vfs.cpk_count(),
        extra_count: vfs.extra_count(),
        loose_count: vfs.loose_count(),
        top_ext,
    })
}

/// Aperçu structuré d'une entrée : résumé par format ([`nie_explore::describe_content`]) +
/// les 64 premiers octets en hex (pour un magic visible même sans décodeur dédié).
#[tauri::command]
fn vfs_describe(path: String, game_dir: Option<String>) -> Result<Vec<String>, String> {
    let vfs = open_vfs(game_dir)?;
    let data = vfs.read(&path).map_err(|e| e.to_string())?;
    let mut lines = nie_explore::describe_content(&path, &data).unwrap_or_default();
    if lines.is_empty() {
        lines.push("format      brut / non reconnu".to_string());
    }
    lines.push(format!("magic       {}", nie_explore::hex_prefix(&data, 16)));
    lines.push(format!("taille      {} octets", data.len()));
    Ok(lines)
}

/// Contenu brut, borné à `max_bytes` (défaut 2 MiB) pour rester raisonnable sur l'IPC JSON —
/// utiliser `vfs_extract_to` pour les gros fichiers (écriture disque directe côté Rust).
#[tauri::command]
fn vfs_read_b64(path: String, game_dir: Option<String>, max_bytes: Option<usize>) -> Result<String, String> {
    let vfs = open_vfs(game_dir)?;
    let data = vfs.read(&path).map_err(|e| e.to_string())?;
    let cap = max_bytes.unwrap_or(2 * 1024 * 1024);
    if data.len() > cap {
        return Err(format!("fichier trop volumineux pour l'aperçu ({} octets > {cap})", data.len()));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// Décode la meilleure texture d'un `.g4tx` en PNG (base64), pour un `<img>` côté UI.
#[tauri::command]
fn vfs_texture_png_b64(path: String, game_dir: Option<String>) -> Result<String, String> {
    let vfs = open_vfs(game_dir)?;
    let data = vfs.read(&path).map_err(|e| e.to_string())?;
    let png = nie_formats::g4tx_decode::decode_best_to_png(&data).ok_or("décodage PNG impossible (texture non reconnue)")?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&png))
}

/// Extrait un fichier VFS directement vers `dest` (écriture Rust→disque, pas de round-trip JS).
#[tauri::command]
fn vfs_extract_to(path: String, dest: String, game_dir: Option<String>) -> Result<u64, String> {
    let vfs = open_vfs(game_dir)?;
    let data = vfs.read(&path).map_err(|e| e.to_string())?;
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&dest, &data).map_err(|e| e.to_string())?;
    Ok(data.len() as u64)
}

/// Écrit des octets édités (base64, depuis l'éditeur hex de l'UI) vers `dest` — n'écrit
/// JAMAIS dans un CPK : `nie-formats` n'a pas d'encodeur CPK, donc « éditer » un asset du
/// jeu produit toujours une copie externe, jamais une modification en place des packs.
#[tauri::command]
fn save_bytes_b64(dest: String, data_b64: String) -> Result<u64, String> {
    let data = base64::engine::general_purpose::STANDARD.decode(data_b64.as_bytes()).map_err(|e| e.to_string())?;
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&dest, &data).map_err(|e| e.to_string())?;
    Ok(data.len() as u64)
}

// ─── Sauvegardes (Lives, `nie-save`) ────────────────────────────────────────────────

/// Sauvegarde actuellement ouverte (déchiffrée en mémoire, jamais persistée telle quelle) —
/// `Some((conteneur, chemin d'origine))` après [`save_open`].
struct SaveState(Mutex<Option<(nie_save::LivesContainer, PathBuf)>>);

#[derive(Serialize)]
struct SaveBlobDto {
    filename: String,
    subtype: String,
    size: usize,
}

/// Déchiffre + parse un fichier de sauvegarde Lives (ex. `002AB8F4-USERDATALIVE`) et renvoie
/// son résumé (`nie_save::SaveSummary`, sérialisé tel quel — joueur, niveau, temps de jeu,
/// roster…). Le conteneur déchiffré reste en mémoire pour [`save_list_blobs`]/[`save_export`].
#[tauri::command]
fn save_open(path: String, state: tauri::State<SaveState>) -> Result<serde_json::Value, String> {
    let container = nie_save::io::read_save(std::path::Path::new(&path)).map_err(|e| e.to_string())?;
    let summary = nie_save::summarize(&container);
    let json = serde_json::to_value(&summary).map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some((container, PathBuf::from(path)));
    Ok(json)
}

#[tauri::command]
fn save_list_blobs(state: tauri::State<SaveState>) -> Result<Vec<SaveBlobDto>, String> {
    let guard = state.0.lock().unwrap();
    let (container, _) = guard.as_ref().ok_or("aucune sauvegarde ouverte")?;
    Ok(container
        .entries
        .iter()
        .zip(&container.blobs)
        .map(|(e, b)| SaveBlobDto {
            filename: e.filename.clone(),
            subtype: format!("{:?}", b.header.subtype),
            size: b.body.len(),
        })
        .collect())
}

#[tauri::command]
fn save_blob_hex_b64(index: usize, state: tauri::State<SaveState>) -> Result<String, String> {
    let guard = state.0.lock().unwrap();
    let (container, _) = guard.as_ref().ok_or("aucune sauvegarde ouverte")?;
    let blob = container.blobs.get(index).ok_or("index de blob invalide")?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&blob.body))
}

/// Ré-encode le conteneur actuellement ouvert (round-trip octet-identique si rien n'a été
/// modifié) et l'écrit à `dest` — jamais l'original en place (choisi par l'utilisatrice).
#[tauri::command]
fn save_export(dest: String, state: tauri::State<SaveState>) -> Result<u64, String> {
    let guard = state.0.lock().unwrap();
    let (container, _) = guard.as_ref().ok_or("aucune sauvegarde ouverte")?;
    let bytes = container.encrypt().map_err(|e| e.to_string())?;
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
}

// La recherche chara/waza (miroir wiki) est faite CÔTÉ FRONTEND via tauri-plugin-sql
// (`src/lib/wikiDb.ts`, mêmes requêtes SQL que `nie-wiki::query::search_characters`/
// `search_skills`) — pas de commande Rust ici : `nie-wiki` (rusqlite) est volontairement HORS
// de ce binaire (conflit de lien natif `sqlite3` avec `sqlx-sqlite`, cf. Cargo.toml).

/// Scanne la totalité du VFS (~255 800 entrées) — utilisé par `vfsIndexDb.reindex` (frontend)
/// pour matérialiser un index SQL persistant (`vfs_files`, table gérée par `tauri-plugin-sql`)
/// permettant une résolution EXACTE par code interne (segment de chemin), plus précise que le
/// `.contains()` substring en mémoire de [`vfs_related`] (qui peut matcher un code interne
/// apparaissant par hasard ailleurs dans un chemin non lié).
#[tauri::command]
fn vfs_all_entries(game_dir: Option<String>) -> Result<Vec<EntryDto>, String> {
    let vfs = open_vfs(game_dir)?;
    Ok(vfs
        .iter()
        .map(|(path, entry)| EntryDto {
            path: path.to_string(),
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            size: entry.file_size,
            cpk: entry.cpk_filename.clone(),
        })
        .collect())
}

/// Chemins VFS dont le nom (sans extension) est CONTENU dans `needle`, insensible à la casse —
/// substring en mémoire, fallback historique tant que l'index SQL ([`vfs_all_entries`] +
/// `vfsIndexDb`) n'a pas été construit côté frontend.
#[tauri::command]
fn vfs_related(needle: String, limit: usize, game_dir: Option<String>) -> Result<Vec<EntryDto>, String> {
    let vfs = open_vfs(game_dir)?;
    let mut hits: Vec<EntryDto> = vfs
        .iter()
        .filter(|(p, _)| p.contains(&needle))
        .map(|(path, entry)| EntryDto {
            path: path.to_string(),
            name: path.rsplit('/').next().unwrap_or(path).to_string(),
            size: entry.file_size,
            cpk: entry.cpk_filename.clone(),
        })
        .collect();
    hits.sort_by(|a, b| a.path.cmp(&b.path));
    hits.truncate(limit.max(1));
    Ok(hits)
}

// ─── Fichier ouvert depuis l'explorateur Windows (« Ouvrir avec ») ─────────────────

/// Rend une fois le chemin passé en argument au lancement (`argv[1]`), puis se vide — le
/// frontend l'appelle une seule fois au démarrage pour savoir s'il doit ouvrir un fichier
/// « externe » (hors VFS, ex. un `.g4tx` déjà extrait sur disque) plutôt que la racine du VFS.
#[tauri::command]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Aperçu structuré d'un fichier QUELCONQUE du disque (pas du VFS) — utilisé par « Ouvrir
/// avec nie-explorer » sur un fichier déjà extrait/exporté.
#[tauri::command]
fn describe_disk_file(path: String) -> Result<Vec<String>, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let mut lines = nie_explore::describe_content(&path, &data).unwrap_or_default();
    if lines.is_empty() {
        lines.push("format      brut / non reconnu".to_string());
    }
    lines.push(format!("magic       {}", nie_explore::hex_prefix(&data, 16)));
    lines.push(format!("taille      {} octets", data.len()));
    Ok(lines)
}

#[tauri::command]
fn read_disk_file_b64(path: String, max_bytes: Option<usize>) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let cap = max_bytes.unwrap_or(2 * 1024 * 1024);
    if data.len() > cap {
        return Err(format!("fichier trop volumineux pour l'aperçu ({} octets > {cap})", data.len()));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

// ─── Pont Blender (tools/niers) ─────────────────────────────────────────────────────

/// Candidats d'installation Blender à essayer si aucun chemin explicite n'est fourni.
const BLENDER_CANDIDATES: &[&str] = &[
    r"C:\Program Files\Blender Foundation\Blender 5.2\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.2\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.1\blender.exe",
    r"C:\Program Files\Blender Foundation\Blender 4.0\blender.exe",
];

fn resolve_blender_exe(blender_exe: Option<String>) -> Result<PathBuf, String> {
    if let Some(p) = blender_exe.filter(|s| !s.trim().is_empty()) {
        let p = PathBuf::from(p);
        return if p.is_file() { Ok(p) } else { Err(format!("blender.exe introuvable : {}", p.display())) };
    }
    BLENDER_CANDIDATES
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .ok_or_else(|| "blender.exe introuvable (candidats standards absents) — renseignez le chemin dans Paramètres".to_string())
}

/// Extrait `path` (+ ses fichiers frères de même basename dans le même dossier VFS : g4mg/g4sk/
/// g4tx/g4mt) vers un dossier temporaire, lance Blender avec un script d'amorçage qui active
/// l'addon `tools/niers` (`bpy.utils` via `sys.path`, sans dépendre du dossier d'addons
/// utilisateur Blender) puis pré-charge le modèle via son opérateur natif
/// `level5_g4_port.load_original_model` (le même que « File > Import » appellerait).
/// Pose `NIE_GAME_DIR` dans l'environnement du process Blender : le panneau de recherche
/// niers→Blender (`niers_bridge.py`) l'utilise pour retrouver `niers.exe` et le VFS sans deviner.
#[tauri::command]
fn open_in_blender(path: String, blender_exe: Option<String>, game_dir: Option<String>) -> Result<String, String> {
    let blender = resolve_blender_exe(blender_exe)?;
    let root = match game_dir.filter(|s| !s.trim().is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => nie_formats::vfs::resolve_game_dir(),
    };
    let addon_parent = root.join("tools");
    if !addon_parent.join("niers").join("__init__.py").is_file() {
        return Err(format!("addon introuvable : {}", addon_parent.join("niers").display()));
    }

    let vfs = open_vfs(Some(root.display().to_string()))?;
    let data = vfs.read(&path).map_err(|e| e.to_string())?;

    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let export_dir = std::env::temp_dir().join("nie-explorer").join("blender").join(stamp.to_string());
    std::fs::create_dir_all(&export_dir).map_err(|e| e.to_string())?;

    let base = path.rsplit('/').next().unwrap_or(&path);
    let stem = base.rsplit_once('.').map(|(s, _)| s).unwrap_or(base);
    let dir_prefix = path.strip_suffix(base).unwrap_or("");

    // Fichiers frères de même basename (g4mg/g4sk/g4tx/g4mt) : nécessaires au rendu complet
    // (le G4MD seul n'a ni géométrie ni squelette).
    //
    // IMPORTANT (trouvé par test réel headless `blender --background`, pas deviné) :
    // `apply_original_model_to_settings` (appelé par `load_original_model`) EXIGE que le
    // chemin du modèle soit sous un `data/common`/`data/dx11` — c'est de là qu'il déduit
    // code personnage/série/textures. Une extraction à plat (`export_dir/<stem>.<ext>`) échoue
    // avec « must be inside a data/common or data/dx11 filesystem tree ». On préserve donc le
    // chemin VFS relatif complet (`candidate`) sous `export_dir`, pas juste le basename.
    let sibling_exts = ["g4md", "g4mg", "g4sk", "g4mt", "g4tx"];
    let mut extracted_main: Option<PathBuf> = None;
    for ext in sibling_exts {
        let candidate = format!("{dir_prefix}{stem}.{ext}");
        let bytes = if candidate == path { Some(data.clone()) } else { vfs.read(&candidate).ok() };
        if let Some(bytes) = bytes {
            let dest = export_dir.join(&candidate);
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
            if candidate == path || ext == "g4md" {
                extracted_main = Some(dest);
            }
        }
    }
    let main_path = extracted_main.unwrap_or(export_dir.join(&path));

    let script_path = export_dir.join("_bootstrap.py");
    let script = format!(
        r#"import sys, traceback
sys.path.insert(0, {addon_parent:?})
try:
    import niers as g4b
    g4b.register()
    print("[nie-explorer] addon niers activé")
except Exception:
    traceback.print_exc()

try:
    import bpy
    bpy.ops.level5_g4_port.load_original_model('EXEC_DEFAULT', filepath={main_path:?})
    print("[nie-explorer] modèle pré-chargé :", {main_path:?})
except Exception:
    traceback.print_exc()
"#,
        addon_parent = addon_parent.display().to_string(),
        main_path = main_path.display().to_string(),
    );
    std::fs::write(&script_path, script).map_err(|e| e.to_string())?;

    std::process::Command::new(&blender)
        .arg("--python")
        .arg(&script_path)
        .env("NIE_GAME_DIR", root.display().to_string())
        .spawn()
        .map_err(|e| format!("échec du lancement de Blender ({}) : {e}", blender.display()))?;

    Ok(format!("Blender lancé — {} exporté(s) vers {}", sibling_exts.len(), export_dir.display()))
}

// ─── Aperçu 3D (G4MD+G4MG → GLB embarqué → `nie-render3d`, rendu natif pur-Rust) ───────
//
// PAS de `bpy` (Blender-comme-module-Python, `pip install bpy`, existe officiellement —
// developer.blender.org/docs/handbook/building_blender/python_module — et PyPI publie bien un
// build 5.2.0/Python 3.13 correspondant à la version installée) : vérifié après coup que ce
// module embarquable n'a PAS de window manager (`bpy.context.window`/`context.workspace`
// absents, opérateurs GUI en échec) — or `tools/niers` s'appuie dessus (barre de progression
// `context.window_manager.progress_update`, panneau N, préférences d'addon), donc PAS un bon
// candidat à l'embarquement headless sans réécrire l'addon. L'intégration Blender de ce fichier
// ([`open_in_blender`]) lance donc le vrai Blender GUI en process séparé — choix délibéré, pas
// une lacune d'API. Pour un aperçu INSTANTANÉ sans lancer d'application externe, on utilise
// `nie-render3d` : rasterizer CPU pur-Rust déjà du workspace (`crates/nie-render3d`), qui charge
// le GLB assemblé par `nie_formats::assemble::assemble_generic_model` (même pipeline que le CDN
// `nie-model-serve`).

/// Résout `nie-render3d.exe` : `<racine>/target/{debug,release}/nie-render3d.exe`.
fn resolve_render3d_exe(root: &std::path::Path) -> Result<PathBuf, String> {
    for profile in ["debug", "release"] {
        let p = root.join("target").join(profile).join("nie-render3d.exe");
        if p.is_file() {
            return Ok(p);
        }
    }
    Err("nie-render3d.exe introuvable — construisez-le : `cargo build -p nie-render3d --release`".to_string())
}

/// Assemble un G4MD+G4MG (+ G4TX frère si présent) en GLB autonome (textures embarquées) et le
/// rend via `nie-render3d` (rasterizer CPU pur-Rust, orbit-camera) → PNG (base64).
#[tauri::command]
fn vfs_glb_preview_png_b64(path: String, game_dir: Option<String>) -> Result<String, String> {
    use nie_formats::assemble::{assemble_generic_model, EmbeddedTexture, GenericModelInput, MeshComponent};

    let root = match game_dir.clone().filter(|s| !s.trim().is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => nie_formats::vfs::resolve_game_dir(),
    };
    let render3d = resolve_render3d_exe(&root)?;
    let vfs = open_vfs(Some(root.display().to_string()))?;
    let data = vfs.read(&path).map_err(|e| e.to_string())?;

    let base = path.rsplit('/').next().unwrap_or(&path);
    let stem = base.rsplit_once('.').map(|(s, _)| s).unwrap_or(base);
    let dir_prefix = path.strip_suffix(base).unwrap_or("");
    let sibling = |ext: &str| -> Option<Vec<u8>> {
        let candidate = format!("{dir_prefix}{stem}.{ext}");
        if candidate == path { Some(data.clone()) } else { vfs.read(&candidate).ok() }
    };

    let g4md = sibling("g4md").ok_or("G4MD introuvable (fichier ou frère de même nom)")?;
    let g4mg = sibling("g4mg").ok_or("G4MG introuvable (frère de même nom requis pour la géométrie)")?;

    let mut model = assemble_generic_model(GenericModelInput { code: stem.to_string(), g4md, g4mg, component: MeshComponent::Generic })
        .map_err(|e| format!("assemblage GLB : {e}"))?;

    let png = sibling("g4tx").and_then(|g4tx| nie_formats::g4tx_decode::decode_best_to_png(&g4tx));
    if let Some(png) = png {
        model.embedded_textures.push(EmbeddedTexture { component: MeshComponent::Generic, name: format!("{stem}_tex"), png_bytes: png });
    }

    let glb = model.to_glb_embedded();
    let dir = std::env::temp_dir().join("nie-explorer").join("render3d");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let glb_path = dir.join(format!("{stem}.glb"));
    let png_path = dir.join(format!("{stem}.png"));
    std::fs::write(&glb_path, &glb).map_err(|e| e.to_string())?;

    let status = std::process::Command::new(&render3d)
        .arg("--glb")
        .arg(&glb_path)
        .arg("--out")
        .arg(&png_path)
        .args(["--frames", "1", "--width", "512", "--height", "512"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("échec de lancement de nie-render3d : {e}"))?;
    if !status.success() {
        return Err(format!("nie-render3d a échoué ({status})"));
    }

    let png = std::fs::read(&png_path).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&png))
}

// ─── Aperçu audio (ADX/HCA/AWB/ACB → WAV, natif Rust — clé IEVR déjà reversée) ─────────

/// Décode n'importe quel format audio Criware du VFS (`.acb`/`.awb`/`.hca`/`.adx`, dispatch par
/// magic) en WAV PCM16, base64 — `nie_formats::cri_audio::decode_to_wav` (feature `audio-decode`,
/// `cridecoder` + `IEVR_HCA_KEY` reversé de `nie.exe`, vérifié byte-exact sur `c00001001.awb`
/// (48 kHz mono, non silencieux) — cf. `docs/INVENTAIRE.md` § C1).
///
/// Décodage lancé sur un THREAD DÉDIÉ à pile de 16 Mio : trouvé par test réel (pas supposé) —
/// `cridecoder` fait un vrai `STATUS_STACK_OVERFLOW` sur la pile debug par défaut (~1 Mio
/// Windows) sur `c01000010.awb` réel (fonctionne en `--release`, casse en `cargo build`/
/// `tauri dev`, le mode utilisé pendant tout le développement de cette app). Un
/// `STATUS_STACK_OVERFLOW` tue le PROCESS entier (fault SEH, pas rattrapable par
/// `catch_unwind`/`thread::join`) : la pile élargie doit réellement suffire, ce n'est pas un
/// filet de sécurité — reconfirmé : le même fichier décode sans erreur sur un thread à 16 Mio,
/// y compris en debug non optimisé.
#[tauri::command]
fn vfs_audio_preview_b64(path: String, game_dir: Option<String>) -> Result<String, String> {
    let vfs = open_vfs(game_dir)?;
    let data = vfs.read(&path).map_err(|e| e.to_string())?;

    let wav = std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(move || nie_formats::cri_audio::decode_to_wav(&data))
        .map_err(|e| format!("échec de lancement du thread de décodage : {e}"))?
        .join()
        .map_err(|_| "le décodage audio a paniqué (thread dédié)".to_string())??;

    const CAP: usize = 40 * 1024 * 1024;
    if wav.len() > CAP {
        return Err(format!("WAV décodé trop volumineux pour l'aperçu ({} octets > {CAP})", wav.len()));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&wav))
}

// ─── Aperçu vidéo (USM/Sofdec2 → MP4, via `ffmpeg` en sous-processus) ──────────────────
//
// Pas de binding `libvlc` : ce système n'a pas VLC/libvlc installé (vérifié — seul `ffmpeg`
// est présent, via winget), et l'intégration native de libvlc demanderait un rendu dans un
// HWND enfant superposé à la webview (fenêtrage natif spécifique par OS) — hors de portée
// raisonnable sans confirmer d'abord la présence de libvlc chez l'utilisatrice. `ffmpeg` en
// sous-processus + `<video>` HTML est le chemin robuste : `nie-formats::cri_audio::usm_demux`
// extrait le flux élémentaire H.264 (déjà porté, byte-exact), remuxé en MP4 par `ffmpeg`.

/// Remuxe le flux vidéo H.264 d'un `.usm` en MP4 lisible par un `<video>` HTML (base64, borné).
/// VP9 brut n'est pas remuxable simplement (pas de conteneur) : renvoie une erreur claire.
#[tauri::command]
fn vfs_video_preview_b64(path: String, game_dir: Option<String>) -> Result<String, String> {
    let vfs = open_vfs(game_dir)?;
    let data = vfs.read(&path).map_err(|e| e.to_string())?;
    let usm = nie_formats::cri_audio::usm_demux(&data).map_err(|e| e.to_string())?;
    if usm.video_codec != nie_formats::cri_audio::VideoCodec::H264 {
        return Err(format!("codec {:?} non pris en charge pour l'aperçu (H.264 uniquement) — utilisez Extraire", usm.video_codec));
    }
    if usm.video_data.is_empty() {
        return Err("aucun flux vidéo dans ce fichier".to_string());
    }

    let dir = std::env::temp_dir().join("nie-explorer").join("video-preview");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = dir.join("in.h264");
    let out = dir.join("out.mp4");
    std::fs::write(&raw, &usm.video_data).map_err(|e| e.to_string())?;

    let status = std::process::Command::new("ffmpeg")
        .args(["-y", "-f", "h264", "-i"])
        .arg(&raw)
        .args(["-c:v", "copy", "-movflags", "+faststart"])
        .arg(&out)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("échec de lancement de ffmpeg (introuvable sur le PATH ?) : {e}"))?;
    if !status.success() {
        return Err(format!("ffmpeg a échoué ({status})"));
    }

    let mp4 = std::fs::read(&out).map_err(|e| e.to_string())?;
    const CAP: usize = 40 * 1024 * 1024;
    if mp4.len() > CAP {
        return Err(format!("MP4 remuxé trop volumineux pour l'aperçu ({} octets > {CAP})", mp4.len()));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&mp4))
}

// ─── Résolveur distant azalee (GraphQL + REST) ──────────────────────────────────────
//
// Contrat RÉEL confirmé depuis les sources du service (VPS OVH, `~/rg/apps/azalee`, session
// 2026-08-07) — pas une convention devinée :
//   - GraphQL POST `{base}/api/graphql` (graphql-yoga, sans auth) : `app/api/graphql/route.ts`.
//     Requêtes : `characters(q,limit)`/`character(id)`, `skills(q,limit)`/`skill(id)`,
//     `items(q,limit)`/`item(id)`, `auras(q,element,typeSlug!)`.
//   - REST `GET {base}/api/cpk?q=<sous-chaîne>` (index CPK complet, 250 800 fichiers) et
//     `GET {base}/api/cpk?path=<...>&meta=1` (métadonnées + URL CDN) : `app/api/cpk/route.ts`.
//   - REST `POST {base}/api/save/resolve-roster` `{ids: string[]}` → noms résolus du roster
//     d'une save (miroir serveur, aucun ID inventé) : `app/api/save/resolve-roster/route.ts`.
// Testé en direct (`curl`) le 2026-08-07 : les deux endpoints répondent en production.

const AZALEE_DEFAULT_URL: &str = "https://azalee.rosegriffon.fr";

fn azalee_base(base_url: &str) -> &str {
    let b = base_url.trim();
    if b.is_empty() { AZALEE_DEFAULT_URL } else { b.trim_end_matches('/') }
}

fn graphql_query(base_url: &str, query: &str, variables: serde_json::Value) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/graphql", azalee_base(base_url));
    let body = serde_json::json!({ "query": query, "variables": variables });
    let resp = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(body)
        .map_err(|e| format!("requête GraphQL échouée ({url}) : {e}"))?;
    let json: serde_json::Value = resp.into_json().map_err(|e| format!("réponse non-JSON : {e}"))?;
    if let Some(errors) = json.get("errors") {
        return Err(format!("erreurs GraphQL : {errors}"));
    }
    json.get("data").cloned().ok_or_else(|| "réponse GraphQL sans champ « data »".to_string())
}

/// Recherche de personnages via le GraphQL azalee (`characters(q, limit)`), en bonus du miroir
/// local `nie-wiki` — utile quand aucun `supabase-*.sqlite` local n'est configuré.
#[tauri::command]
fn remote_search_chara(base_url: String, query: String) -> Result<serde_json::Value, String> {
    graphql_query(
        &base_url,
        "query($q: String) { characters(q: $q, limit: 20) { id internalCode name { fr en ja } \
         variants { charaParamId position element rarity image } } }",
        serde_json::json!({ "q": query }),
    )
}

/// Recherche de techniques via le GraphQL azalee (`skills(q, limit)`).
#[tauri::command]
fn remote_search_waza(base_url: String, query: String) -> Result<serde_json::Value, String> {
    graphql_query(
        &base_url,
        "query($q: String) { skills(q: $q, limit: 20) { id name { fr en ja } category element power tension image } }",
        serde_json::json!({ "q": query }),
    )
}

/// Recherche plein-texte dans l'index CPK distant (250 800 fichiers, azalee) — utile en
/// complément du VFS local (comparaison, ou navigation sans avoir le jeu monté).
#[tauri::command]
fn remote_cpk_search(base_url: String, query: String) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/cpk?q={}", azalee_base(&base_url), urlencode(&query));
    let resp = ureq::get(&url).call().map_err(|e| format!("requête distante échouée ({url}) : {e}"))?;
    resp.into_json::<serde_json::Value>().map_err(|e| format!("réponse non-JSON : {e}"))
}

/// Résout les IDs de roster d'une sauvegarde (hash `0x........`) en noms réels via le miroir
/// serveur azalee — AUCUN octet de save ne transite, seulement les IDs déjà extraits en local
/// par `nie-save`. Anti-hallucination côté serveur : un ID absent revient `name: null`.
#[tauri::command]
fn remote_resolve_roster(base_url: String, ids: Vec<String>) -> Result<serde_json::Value, String> {
    let url = format!("{}/api/save/resolve-roster", azalee_base(&base_url));
    let resp = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({ "ids": ids }))
        .map_err(|e| format!("requête distante échouée ({url}) : {e}"))?;
    resp.into_json::<serde_json::Value>().map_err(|e| format!("réponse non-JSON : {e}"))
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // DOIT être le premier plugin enregistré (contrat tauri-plugin-single-instance) :
        // relance = focus la fenêtre existante + transmet argv (« Ouvrir avec » Explorer).
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            use tauri::Manager;
            if let Some(path) = first_path_arg(argv) {
                let _ = app.emit("open-path", &path);
            }
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:mods.db", mods_migrations())
                .build(),
        )
        .manage(PendingOpen(Mutex::new(first_path_arg(std::env::args()))))
        .manage(SaveState(Mutex::new(None)))
        .setup(|app| {
            // Habillage natif Windows 11 (Mica) — cf. demande utilisateur « ui windows native ».
            // Best-effort : une build hors Win11/serveur peut échouer l'appel, sans bloquer le
            // lancement (fenêtre reste opaque « surface » standard dans ce cas).
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window_vibrancy::apply_mica(&window, None);
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            default_game_dir,
            check_game_dir,
            vfs_ls,
            vfs_find,
            vfs_stats,
            vfs_describe,
            vfs_read_b64,
            vfs_texture_png_b64,
            vfs_extract_to,
            save_bytes_b64,
            vfs_related,
            vfs_all_entries,
            take_pending_open,
            describe_disk_file,
            read_disk_file_b64,
            open_in_blender,
            remote_search_chara,
            remote_search_waza,
            remote_cpk_search,
            remote_resolve_roster,
            save_open,
            save_list_blobs,
            save_blob_hex_b64,
            save_export,
            vfs_video_preview_b64,
            vfs_glb_preview_png_b64,
            vfs_audio_preview_b64,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
