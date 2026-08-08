//! Backend Tauri de `nie-explorer` — explorateur/éditeur du VFS (CPK) d'Inazuma Eleven:
//! Victory Road. Toute la logique de décodage vient de `nie-formats`/`nie-explore` (même
//! moteur que `niers vfs cat`, cf. `CLAUDE.md` anti-doublon) ; ce module n'est qu'une façade
//! IPC (JSON) au-dessus de ces crates + une recherche chara/waza via le miroir `nie-wiki`.

use std::path::PathBuf;
use std::sync::Mutex;

use base64::Engine as _;
use nie_formats::cpk::{CpkEntry, CpkReader};
use nie_formats::vfs::Vfs;
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use tauri_plugin_sql::{Migration, MigrationKind};

mod game_data;
mod steam;

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

/// Résout la racine du jeu à utiliser : `game_dir` explicite (réglage utilisatrice) sinon
/// [`resolve_game_dir_native`]. Pure — ne construit pas de VFS (cf. [`with_vfs`]).
fn resolve_root(game_dir: Option<&str>) -> PathBuf {
    match game_dir.filter(|s| !s.trim().is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => resolve_game_dir_native(),
    }
}

/// Résolution du dossier de jeu par défaut, dans l'ordre :
/// 1. `NIE_GAME_DIR` (env, dev/CI).
/// 2. Répertoire courant, s'il contient déjà `data/cpk_list.cfg.bin`.
/// 3. VRAIE détection Steam ([`steam::detect_game_dir`] — registre + `libraryfolders.vdf` +
///    `appmanifest_2799860.acf`), pas un chemin deviné.
/// 4. Repli : répertoire courant tel quel (même invalide) — plus honnête qu'un faux chemin
///    plausible : l'UI (`check_game_dir`) affichera clairement « introuvable » plutôt que de
///    pointer silencieusement vers un dossier qui n'existe sur aucune machine utilisatrice.
fn resolve_game_dir_native() -> PathBuf {
    if let Ok(dir) = std::env::var("NIE_GAME_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    let cwd = std::env::current_dir().unwrap_or_default();
    if cwd.join("data").join("cpk_list.cfg.bin").is_file() {
        return cwd;
    }
    if let Some(dir) = steam::detect_game_dir() {
        return dir;
    }
    cwd
}

/// VFS mis en cache dans l'état géré Tauri — construit UNE SEULE FOIS par racine résolue, puis
/// réutilisé par toutes les commandes. Avant ce cache, `open_vfs()` reconstruisait un `Vfs`
/// (déchiffrement + réindexation des ~255 800 entrées) à CHAQUE appel IPC, y compris un simple
/// clic de navigation dans l'Explorateur — cause réelle de la latence signalée. Précédé d'un
/// appel explicite [`preload_vfs`] au démarrage de l'appli pour amortir le premier coût avant
/// toute interaction utilisatrice.
struct VfsState(Mutex<Option<(PathBuf, Vfs)>>);

/// Exécute `f` sur le VFS mis en cache pour `game_dir` (le (re)construit d'abord si la racine
/// résolue diffère de celle en cache, ou si aucun VFS n'a encore été chargé).
fn with_vfs<T>(game_dir: Option<String>, state: &VfsState, f: impl FnOnce(&Vfs) -> Result<T, String>) -> Result<T, String> {
    let root = resolve_root(game_dir.as_deref());
    let mut guard = state.0.lock().map_err(|_| "verrou VFS empoisonné".to_string())?;
    let needs_rebuild = guard.as_ref().is_none_or(|(cached_root, _)| cached_root != &root);
    if needs_rebuild {
        let data_dir = root.join("data");
        let mut vfs = Vfs::new();
        vfs.init(&data_dir).map_err(|e| format!("init VFS depuis {} : {e}", data_dir.display()))?;
        *guard = Some((root.clone(), vfs));
    }
    let (_, vfs) = guard.as_ref().expect("vient d'être rempli ci-dessus");
    f(vfs)
}

// `specta::Type` (en plus de `Serialize`) sur tous les DTOs qui traversent l'IPC : c'est ce qui
// permet à `tauri-specta` de régénérer `src/lib/bindings.ts` à partir des VRAIES signatures Rust
// (cf. `run()` → `specta_builder()`), au lieu du miroir manuel que `src/lib/api.ts` maintenait
// jusqu'ici (désynchronisable en silence à chaque commande ajoutée/modifiée).
#[derive(Serialize, specta::Type)]
struct EntryDto {
    path: String,
    name: String,
    size: u32,
    cpk: String,
}

#[derive(Serialize, specta::Type)]
struct LsDto {
    dirs: Vec<String>,
    files: Vec<EntryDto>,
    /// Rôle du dossier courant (cf. `nie_explore::folder_roles`), `None` si non catalogué —
    /// jamais un rôle deviné : la table ne couvre que ce qui est sourcé/vérifié.
    role: Option<FolderRoleDto>,
}

#[derive(Serialize, specta::Type)]
struct FolderRoleDto {
    role: String,
    status: String,
}

// `u32` (pas `usize`) : `specta-typescript` refuse d'exporter les entiers 64 bits (`usize`
// compris) par défaut — risque réel de perte de précision côté JS (`Number.MAX_SAFE_INTEGER`
// < 2⁶⁴). `u32` (≤ 4 294 967 295) couvre très largement des compteurs de fichiers (~255 800
// entrées VFS au total) sans avoir besoin de désactiver ce garde-fou.
#[derive(Serialize, specta::Type)]
struct StatsDto {
    total: u32,
    cpk_count: u32,
    extra_count: u32,
    loose_count: u32,
    top_ext: Vec<(String, u32)>,
}

/// Racine de jeu par défaut — VRAIE détection (registre Steam + bibliothèques +
/// `appmanifest_2799860.acf`, cf. [`resolve_game_dir_native`]), pas un chemin deviné.
#[tauri::command]
#[specta::specta]
fn default_game_dir() -> String {
    resolve_game_dir_native().display().to_string()
}

/// Vérifie qu'un répertoire de jeu est valide (contient `data/cpk_list.cfg.bin`).
#[tauri::command]
#[specta::specta]
fn check_game_dir(game_dir: String) -> bool {
    PathBuf::from(game_dir).join("data").join("cpk_list.cfg.bin").is_file()
}

/// Force le (re)chargement du VFS en cache — appelé une fois au démarrage du frontend pour
/// amortir le coût d'indexation AVANT la première navigation (cf. demande utilisatrice
/// « précharge le VFS au chargement pour éviter la latence ensuite »). Renvoie les mêmes
/// statistiques que [`vfs_stats`] pour un toast de confirmation côté UI.
#[tauri::command]
#[specta::specta]
fn preload_vfs(game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<StatsDto, String> {
    vfs_stats(game_dir, state)
}

#[tauri::command]
#[specta::specta]
fn vfs_ls(prefix: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<LsDto, String> {
    with_vfs(game_dir, &state, |vfs| {
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
    })
}

#[tauri::command]
#[specta::specta]
fn vfs_find(
    query: String,
    ext: Option<String>,
    limit: u32,
    game_dir: Option<String>,
    state: tauri::State<VfsState>,
) -> Result<Vec<EntryDto>, String> {
    with_vfs(game_dir, &state, |vfs| {
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
        hits.truncate(limit.max(1) as usize);
        Ok(hits)
    })
}

#[tauri::command]
#[specta::specta]
fn vfs_stats(game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<StatsDto, String> {
    with_vfs(game_dir, &state, |vfs| {
        let mut counts: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
        for (path, _) in vfs.iter() {
            let base = path.rsplit('/').next().unwrap_or(path);
            let ext = base.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_else(|| "<none>".to_string());
            *counts.entry(ext).or_default() += 1;
        }
        let mut top_ext: Vec<(String, u32)> = counts.into_iter().collect();
        top_ext.sort_by_key(|(_, c)| std::cmp::Reverse(*c));
        top_ext.truncate(30);
        Ok(StatsDto {
            total: vfs.asset_count() as u32,
            cpk_count: vfs.cpk_count() as u32,
            extra_count: vfs.extra_count() as u32,
            loose_count: vfs.loose_count() as u32,
            top_ext,
        })
    })
}

/// Métadonnées d'une seule entrée VFS (`None` si le chemin n'existe pas) — sert notamment à
/// savoir si un fichier est "loose" (`cpk` vide) donc éditable EN PLACE via [`vfs_write_b64`],
/// sans devoir refaire transiter tout l'index (`vfs_ls`/`vfs_all_entries`) pour un seul chemin.
#[tauri::command]
#[specta::specta]
fn vfs_entry_meta(path: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Option<EntryDto>, String> {
    with_vfs(game_dir, &state, |vfs| {
        Ok(vfs.find(&path).map(|e| EntryDto {
            path: path.clone(),
            name: path.rsplit('/').next().unwrap_or(&path).to_string(),
            size: e.file_size,
            cpk: e.cpk_filename.clone(),
        }))
    })
}

/// Aperçu structuré d'une entrée : résumé par format ([`nie_explore::describe_content`]) +
/// les 64 premiers octets en hex (pour un magic visible même sans décodeur dédié).
#[tauri::command]
#[specta::specta]
fn vfs_describe(path: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Vec<String>, String> {
    with_vfs(game_dir, &state, |vfs| {
        let data = vfs.read(&path).map_err(|e| e.to_string())?;
        let mut lines = nie_explore::describe_content(&path, &data).unwrap_or_default();
        if lines.is_empty() {
            lines.push("format      brut / non reconnu".to_string());
        }
        lines.push(format!("magic       {}", nie_explore::hex_prefix(&data, 16)));
        lines.push(format!("taille      {} octets", data.len()));
        Ok(lines)
    })
}

/// Contenu brut, borné à `max_bytes` (défaut 2 MiB) pour rester raisonnable sur l'IPC JSON —
/// utiliser `vfs_extract_to` pour les gros fichiers (écriture disque directe côté Rust).
#[tauri::command]
#[specta::specta]
fn vfs_read_b64(path: String, game_dir: Option<String>, max_bytes: Option<u32>, state: tauri::State<VfsState>) -> Result<String, String> {
    with_vfs(game_dir, &state, |vfs| {
        let data = vfs.read(&path).map_err(|e| e.to_string())?;
        let cap = max_bytes.map(|b| b as usize).unwrap_or(2 * 1024 * 1024);
        if data.len() > cap {
            return Err(format!("fichier trop volumineux pour l'aperçu ({} octets > {cap})", data.len()));
        }
        Ok(base64::engine::general_purpose::STANDARD.encode(&data))
    })
}

/// Décode la meilleure texture d'un `.g4tx` en PNG (base64), pour un `<img>` côté UI.
#[tauri::command]
#[specta::specta]
fn vfs_texture_png_b64(path: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<String, String> {
    with_vfs(game_dir, &state, |vfs| {
        let data = vfs.read(&path).map_err(|e| e.to_string())?;
        let png = nie_formats::g4tx_decode::decode_best_to_png(&data).ok_or("décodage PNG impossible (texture non reconnue)")?;
        Ok(base64::engine::general_purpose::STANDARD.encode(&png))
    })
}

/// Extrait un fichier VFS directement vers `dest` (écriture Rust→disque, pas de round-trip JS).
#[tauri::command]
#[specta::specta]
// `u32` (pas `u64`) pour toutes les tailles en octets retournées ci-dessous : même contrainte
// `specta-typescript` que `StatsDto` (pas d'entier 64 bits exporté), et même convention déjà en
// place pour `EntryDto.size`/`VfsEntry.file_size` — aucun asset individuel du jeu n'approche 4 Gio.
fn vfs_extract_to(path: String, dest: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<u32, String> {
    with_vfs(game_dir, &state, |vfs| {
        let data = vfs.read(&path).map_err(|e| e.to_string())?;
        if let Some(parent) = std::path::Path::new(&dest).parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(&dest, &data).map_err(|e| e.to_string())?;
        Ok(data.len() as u32)
    })
}

/// Écrit `data_b64` EN PLACE sur un fichier VFS "loose" (physiquement présent sur disque sous
/// `<jeu>/<chemin>`, PAS empaqueté dans un CPK — `entry.cpk` vide côté `EntryDto`/`VfsEntry`,
/// cf. `Vfs::read` § « CPK vide → fichier loose ») — contrairement à [`vfs_extract_to`]/
/// [`save_bytes_b64`] qui exportent toujours vers une destination choisie par l'utilisatrice.
/// Refuse explicitement les entrées empaquetées dans un CPK : `nie-formats` n'a pas d'encodeur
/// CPK, y écrire corromprait l'archive — même contrainte que partout ailleurs dans ce fichier,
/// vérifiée ICI plutôt que suppposée (le VFS sait exactement quelles entrées sont loose).
#[tauri::command]
#[specta::specta]
fn vfs_write_b64(path: String, data_b64: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<u32, String> {
    let root = resolve_root(game_dir.as_deref());
    with_vfs(Some(root.display().to_string()), &state, |vfs| {
        let entry = vfs.find(&path).ok_or_else(|| format!("fichier VFS introuvable : {path}"))?;
        if !entry.cpk_filename.is_empty() {
            return Err(format!(
                "« {path} » est empaqueté dans {} — nie-formats n'a pas d'encodeur CPK, écriture \
                 en place impossible. Utilisez « Enregistrer sous… » pour exporter une copie externe.",
                entry.cpk_filename
            ));
        }
        let data = base64::engine::general_purpose::STANDARD.decode(data_b64.as_bytes()).map_err(|e| e.to_string())?;
        // Chemin interne VFS (`data/common/...`) déjà relatif à la racine du jeu (pas au dossier
        // `data/` lui-même) — même formule que `Vfs::read` pour une entrée loose enregistrée dans
        // `cpk_list.cfg.bin` (`game_data_dir.join(strip_prefix("data/"))`, avec
        // `game_data_dir = <racine>/data`, ce qui revient exactement à `<racine>.join(path)`).
        write_loose_bytes(&root, &path, &data)
    })
}

/// Écrit `data_b64` comme fichier "loose" AU MÊME CHEMIN qu'une entrée normalement empaquetée
/// dans un CPK — contournement de l'absence d'encodeur CPK, PAS une écriture confirmée : le
/// comportement réel de `nie.exe` face à un fichier loose à la place d'un CPK-packed n'est **pas
/// confirmé par rétro-ingénierie** (même incertitude déjà documentée pour l'export de mod
/// « overlay loose-file » dans `modWorkspace.ts`/`exportMod`). Le jeu peut tout simplement
/// ignorer ce fichier et continuer à lire le CPK. Confirmation explicite déjà exigée côté UI
/// avant l'appel (EAC présent sur cette installation).
#[tauri::command]
#[specta::specta]
fn vfs_write_loose_override_b64(path: String, data_b64: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<u32, String> {
    let root = resolve_root(game_dir.as_deref());
    with_vfs(Some(root.display().to_string()), &state, |vfs| {
        vfs.find(&path).ok_or_else(|| format!("fichier VFS introuvable : {path}"))?;
        let data = base64::engine::general_purpose::STANDARD.decode(data_b64.as_bytes()).map_err(|e| e.to_string())?;
        write_loose_bytes(&root, &path, &data)
    })
}

/// Écrit `data` à `<root>/<path>` (même formule de chemin que [`vfs_write_b64`]) — factorisé
/// entre l'écriture "loose" normale et l'override loose d'une entrée normalement CPK-packed.
fn write_loose_bytes(root: &std::path::Path, path: &str, data: &[u8]) -> Result<u32, String> {
    let disk_path = root.join(path);
    if let Some(parent) = disk_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&disk_path, data).map_err(|e| e.to_string())?;
    Ok(data.len() as u32)
}

/// Écrit des octets édités (base64, depuis l'éditeur hex de l'UI) vers `dest` — n'écrit
/// JAMAIS dans un CPK : `nie-formats` n'a pas d'encodeur CPK, donc « éditer » un asset du
/// jeu produit toujours une copie externe, jamais une modification en place des packs.
#[tauri::command]
#[specta::specta]
fn save_bytes_b64(dest: String, data_b64: String) -> Result<u32, String> {
    let data = base64::engine::general_purpose::STANDARD.decode(data_b64.as_bytes()).map_err(|e| e.to_string())?;
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).ok();
    }
    std::fs::write(&dest, &data).map_err(|e| e.to_string())?;
    Ok(data.len() as u32)
}

// ─── Sauvegardes (Lives, `nie-save`) ────────────────────────────────────────────────

/// Sauvegarde actuellement ouverte (déchiffrée en mémoire, jamais persistée telle quelle) —
/// `Some((conteneur, chemin d'origine))` après [`save_open`].
struct SaveState(Mutex<Option<(nie_save::LivesContainer, PathBuf)>>);

#[derive(Serialize, specta::Type)]
struct SaveBlobDto {
    filename: String,
    subtype: String,
    size: u32,
}

/// Déchiffre + parse un fichier de sauvegarde Lives (ex. `002AB8F4-USERDATALIVE`) et renvoie
/// son résumé (`nie_save::SaveSummary`, sérialisé tel quel — joueur, niveau, temps de jeu,
/// roster…). Le conteneur déchiffré reste en mémoire pour [`save_list_blobs`]/[`save_export`].
/// Auto-détecte LA meilleure sauvegarde Steam Cloud (`userdata/<steamid>/2799860/remote/*-
/// USERDATALIVE`, cf. `steam::pick_best_save`) — `None` si Steam/le jeu/toute sauvegarde valide
/// est absent de ce poste (jamais un chemin deviné). Le frontend (`SaveView`) l'appelle au
/// montage et n'ouvre le sélecteur manuel qu'en repli, au lieu d'un `open()` systématique.
#[tauri::command]
#[specta::specta]
fn default_save_path() -> Option<String> {
    steam::pick_best_save(|p| nie_save::io::read_save(p).is_ok()).map(|p| p.display().to_string())
}

#[tauri::command]
#[specta::specta]
fn save_open(path: String, state: tauri::State<SaveState>) -> Result<RawJson, String> {
    let container = nie_save::io::read_save(std::path::Path::new(&path)).map_err(|e| e.to_string())?;
    let summary = nie_save::summarize(&container);
    let json = serde_json::to_value(&summary).map_err(|e| e.to_string())?;
    *state.0.lock().unwrap() = Some((container, PathBuf::from(path)));
    Ok(RawJson(json))
}

#[tauri::command]
#[specta::specta]
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
            size: b.body.len() as u32,
        })
        .collect())
}

#[tauri::command]
#[specta::specta]
fn save_blob_hex_b64(index: u32, state: tauri::State<SaveState>) -> Result<String, String> {
    let guard = state.0.lock().unwrap();
    let (container, _) = guard.as_ref().ok_or("aucune sauvegarde ouverte")?;
    let blob = container.blobs.get(index as usize).ok_or("index de blob invalide")?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&blob.body))
}

/// Ré-encode le conteneur actuellement ouvert (round-trip octet-identique si rien n'a été
/// modifié) et l'écrit à `dest` — jamais l'original en place (choisi par l'utilisatrice).
#[tauri::command]
#[specta::specta]
fn save_export(dest: String, state: tauri::State<SaveState>) -> Result<u32, String> {
    let guard = state.0.lock().unwrap();
    let (container, _) = guard.as_ref().ok_or("aucune sauvegarde ouverte")?;
    let bytes = container.encrypt().map_err(|e| e.to_string())?;
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u32)
}

// La recherche chara/waza (miroir wiki) est faite CÔTÉ FRONTEND via tauri-plugin-sql
// (`src/lib/wikiDb.ts`, mêmes requêtes SQL que `nie-wiki::query::search_characters`/
// `search_skills`) — pas de commande Rust ici : `nie-wiki` (rusqlite) est volontairement HORS
// de ce binaire (conflit de lien natif `sqlite3` avec `sqlx-sqlite`, cf. Cargo.toml).

/// Résout le miroir SQLite (`supabase-*.sqlite`) par défaut — même ordre de résolution que
/// [`nie_wiki::mirror::resolve`] (`NIE_WIKI_DB`/`SQLITE_DB_PATH`, fichier le plus récent), mais
/// avec un répertoire de backups RÉEL pour cette appli desktop (`<racine du jeu>/var/wiki-mirror`,
/// où vit effectivement `supabase-2026-06-05T00-08-26.sqlite` sur ce poste) plutôt que le chemin
/// de dev WSL codé en dur `/home/ubuntu/niers/data/backups` (inexistant hors de la machine de
/// développement). Renvoie `None` si rien n'est trouvé — jamais un chemin deviné : le champ
/// « Base SQLite » des Paramètres reste alors vide, à renseigner manuellement.
#[tauri::command]
#[specta::specta]
fn default_wiki_db(game_dir: Option<String>) -> Option<String> {
    for var in ["NIE_WIKI_DB", "SQLITE_DB_PATH"] {
        if let Ok(v) = std::env::var(var) {
            if PathBuf::from(&v).is_file() {
                return Some(v);
            }
        }
    }
    let root = resolve_root(game_dir.as_deref());
    let backups_dir = root.join("var").join("wiki-mirror");
    latest_sqlite_in(&backups_dir).map(|p| p.display().to_string())
}

/// Résout `var/niers.sqlite` (base RE — fonctions/classes RTTI/xrefs labellisées par `nie-re`,
/// cf. `src/lib/reDb.ts`) sous la racine du jeu. Commande Rust plutôt qu'un `exists()` JS
/// (`@tauri-apps/plugin-fs`) : la portée `fs:scope` de l'app ne couvre que `$APPDATA`, un
/// `std::fs` Rust n'a pas cette restriction — même raison que [`default_wiki_db`] au-dessus.
#[tauri::command]
#[specta::specta]
fn default_re_db(game_dir: Option<String>) -> Option<String> {
    let root = resolve_root(game_dir.as_deref());
    let path = root.join("var").join("niers.sqlite");
    path.is_file().then(|| path.display().to_string())
}

/// Fichier `supabase-*.sqlite` non-vide le plus récent (tri lexicographique DESC — les noms
/// portent un horodatage ISO 8601, donc l'ordre lexicographique = l'ordre chronologique) —
/// même algorithme que `nie_wiki::mirror::latest_sqlite_in`.
fn latest_sqlite_in(dir: &std::path::Path) -> Option<PathBuf> {
    let mut entries: Vec<PathBuf> = std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.extension().is_some_and(|ext| ext == "sqlite")
                && p.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.starts_with("supabase-"))
                && p.metadata().is_ok_and(|m| m.len() > 0)
        })
        .collect();
    entries.sort();
    entries.into_iter().next_back()
}

/// Scanne la totalité du VFS (~255 800 entrées) — utilisé par `vfsIndexDb.reindex` (frontend)
/// pour matérialiser un index SQL persistant (`vfs_files`, table gérée par `tauri-plugin-sql`)
/// permettant une résolution EXACTE par code interne (segment de chemin), plus précise que le
/// `.contains()` substring en mémoire de [`vfs_related`] (qui peut matcher un code interne
/// apparaissant par hasard ailleurs dans un chemin non lié).
#[tauri::command]
#[specta::specta]
fn vfs_all_entries(game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Vec<EntryDto>, String> {
    with_vfs(game_dir, &state, |vfs| {
        Ok(vfs
            .iter()
            .map(|(path, entry)| EntryDto {
                path: path.to_string(),
                name: path.rsplit('/').next().unwrap_or(path).to_string(),
                size: entry.file_size,
                cpk: entry.cpk_filename.clone(),
            })
            .collect())
    })
}

/// Chemins VFS dont le nom (sans extension) est CONTENU dans `needle`, insensible à la casse —
/// substring en mémoire, fallback historique tant que l'index SQL ([`vfs_all_entries`] +
/// `vfsIndexDb`) n'a pas été construit côté frontend.
#[tauri::command]
#[specta::specta]
fn vfs_related(needle: String, limit: u32, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Vec<EntryDto>, String> {
    with_vfs(game_dir, &state, |vfs| {
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
        hits.truncate(limit.max(1) as usize);
        Ok(hits)
    })
}

// ─── Données de jeu statiques (nie-data — techniques, extensible) ─────────────────────

/// Liste toutes les techniques du jeu (`nie_data::skill`, cf. `game_data.rs`) — première
/// donnée de jeu STATIQUE câblée depuis `nie-data` (dépendance déclarée mais jamais utilisée
/// avant), via le pont déjà existant `nie_explore::bridge` (même moteur que `niers vfs cat`).
#[tauri::command]
#[specta::specta]
fn game_data_skills(game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Vec<game_data::SkillDto>, String> {
    with_vfs(game_dir, &state, game_data::list_skills)
}

/// Objets (armes/consommables/costumes/…, `nie_data::item`) — même patron que [`game_data_skills`].
#[tauri::command]
#[specta::specta]
fn game_data_items(game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Vec<game_data::ItemDto>, String> {
    with_vfs(game_dir, &state, game_data::list_items)
}

/// Avatar/Keshin (`nie_data::aura`) — même patron que [`game_data_skills`].
#[tauri::command]
#[specta::specta]
fn game_data_auras(game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Vec<game_data::AuraDto>, String> {
    with_vfs(game_dir, &state, game_data::list_auras)
}

/// Succès (`nie_data::trophy`) — même patron que [`game_data_skills`].
#[tauri::command]
#[specta::specta]
fn game_data_trophies(game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Vec<game_data::TrophyDto>, String> {
    with_vfs(game_dir, &state, game_data::list_trophies)
}

/// Quêtes (`nie_data::quest`) — même patron que [`game_data_skills`].
#[tauri::command]
#[specta::specta]
fn game_data_quests(game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Vec<game_data::QuestDto>, String> {
    with_vfs(game_dir, &state, game_data::list_quests)
}

/// Personnages sélectionnables pour le calculateur de stats (`nie_data::chara_param` joint à
/// `chara_base`/`chara_text`) — même patron que [`game_data_skills`].
#[tauri::command]
#[specta::specta]
fn game_data_chara_picker(game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<Vec<game_data::CharaPickerDto>, String> {
    with_vfs(game_dir, &state, game_data::list_chara_picker)
}

/// Calcule les stats d'un personnage (§4.2 roadmap) — `nie_core::growth::calculate_stats` sur
/// les tables de croissance IEVR embarquées, cf. `game_data::calculate_character_stats`.
/// `rarity_code` : 0=N, 2=R, 3=SR, 4=SSR, 5=UR, 6=LR, 7=Legend, 20=BASARA.
#[tauri::command]
#[specta::specta]
fn game_data_calculate_stats(
    chara_param_id: String,
    level: u8,
    rarity_code: u8,
    game_dir: Option<String>,
    state: tauri::State<VfsState>,
) -> Result<game_data::StatBlockDto, String> {
    with_vfs(game_dir, &state, |vfs| game_data::calculate_character_stats(vfs, &chara_param_id, level, rarity_code))
}

/// Décode N'IMPORTE QUEL `.cfg.bin` du VFS (RDBN *ou* T2B, détecté automatiquement via
/// [`nie_formats::cfgbin::is_rdbn`]) vers la forme JSON "inagle" — couvre TOUS les fichiers de
/// configuration du jeu (personnages, objets, techniques, auras, boutiques, quêtes, trophées,
/// tactiques, capsules, costumes… plusieurs centaines de fichiers dans `data/common/gamedata/`
/// et `data/common/text/`), pas seulement les quelques modules `nie-data` câblés individuellement
/// avec un DTO typé (`game_data.rs`) — cf. demande utilisatrice « niers doit couvrir tout
/// nie.exe ». Générique : aucun parseur par format à écrire, juste le pont déjà
/// vérifié [`nie_explore::bridge`] (même moteur que `niers vfs cat`).
#[tauri::command]
#[specta::specta]
fn vfs_decode_cfgbin(path: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<RawJson, String> {
    with_vfs(game_dir, &state, |vfs| game_data::decode_cfgbin(vfs, &path).map(RawJson))
}

/// Ré-encode du JSON édité (forme "inagle" `{"entries":[...]}` T2B **ou** `{"lists":[...]}`
/// RDBN, dispatch automatique symétrique à [`vfs_decode_cfgbin`]) vers un `.cfg.bin` binaire
/// VALIDE.
///
/// - T2B : `nie_formats::cfgbin::encode_t2b`, reconstruction libre à partir du JSON seul.
/// - RDBN : `nie_formats::cfgbin::encode_rdbn` + `nie_explore::bridge::json_to_rdbn_lists`, qui a
///   besoin de l'ORIGINAL déjà décodé comme gabarit — c'est un *patch* de valeurs, pas une
///   reconstruction libre : le JSON seul perd l'information de type par colonne (ex. Short/
///   ActType ou Rates/Position sont indiscernables une fois sérialisés). D'où `path` en plus de
///   `json` ici : on relit et reparse le fichier original depuis le VFS pour fournir ce gabarit.
///
/// Les deux encodeurs sont vérifiés par round-trip réel sur des centaines/milliers de vrais
/// fichiers du jeu (`cfgbin.rs` : `encode_t2b_round_trip_sur_le_vrai_jeu`,
/// `encode_rdbn_round_trip_sur_le_vrai_jeu` ; `bridge.rs` : `json_bridge_round_trip_sur_le_vrai_jeu`,
/// `json_bridge_rdbn_round_trip_sur_le_vrai_jeu`), pas devinés.
///
/// Renvoie les octets en base64 : compose avec [`vfs_write_b64`]/
/// [`vfs_write_loose_override_b64`]/[`save_bytes_b64`] côté frontend pour l'écriture réelle —
/// pas de nouvelle commande d'écriture, réutilisation de celles qui existent déjà.
#[tauri::command]
#[specta::specta]
fn encode_cfgbin_config(path: String, json: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<String, String> {
    let value: serde_json::Value = serde_json::from_str(&json).map_err(|e| format!("JSON invalide : {e}"))?;
    let bytes = if value.get("lists").is_some() {
        with_vfs(game_dir, &state, |vfs| {
            let raw = vfs.read(&path).map_err(|e| e.to_string())?;
            let rdbn = nie_formats::cfgbin::parse(&raw).map_err(|e| format!("parse RDBN {path} : {e}"))?;
            let original = nie_formats::cfgbin::read_values(&rdbn, &raw);
            let lists = nie_explore::bridge::json_to_rdbn_lists(&original, &value)?;
            nie_formats::cfgbin::encode_rdbn(&lists)
        })?
    } else {
        let entries = nie_explore::bridge::json_to_t2b_entries(&value)?;
        nie_formats::cfgbin::encode_t2b(&entries)
    };
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

// ─── CPK brut hors VFS (« ouvrir un .cpk physiquement présent sur disque ») ────────────
//
// Le VFS (`Vfs`/`VfsState` ci-dessus) ne connaît QUE les CPK référencés par `cpk_list.cfg.bin`
// du jeu monté. Cette section permet d'ouvrir N'IMPORTE QUEL fichier `.cpk` du disque (mod
// téléchargé, sauvegarde d'un pack, DLC séparé…) directement, sans passer par l'index du jeu —
// même lecteur `nie_formats::cpk::CpkReader` que `Vfs`, juste sans l'indirection cpk_list/VFS.

/// CPK brut actuellement ouvert (octets bruts + lecteur d'entrées) — `Some` après
/// [`open_raw_cpk`], consommé par [`raw_cpk_extract_to`]/[`raw_cpk_read_b64`]/
/// [`raw_cpk_describe`] via l'INDEX de l'entrée (pas son chemin : `nie-formats` n'exclut pas les
/// doublons de nom entre dossiers différents d'un même CPK, l'index est donc la seule clé fiable).
struct RawCpkState(Mutex<Option<(PathBuf, Vec<u8>, CpkReader)>>);

#[derive(Serialize, specta::Type)]
struct RawCpkEntryDto {
    /// Index dans `CpkReader::entries` — clé stable pour les commandes suivantes (PAS le chemin :
    /// deux entrées de dossiers différents peuvent partager un nom de fichier).
    index: u32,
    path: String,
    size: u32,
    is_compressed: bool,
}

fn raw_cpk_entry_dto(index: usize, e: &CpkEntry) -> RawCpkEntryDto {
    let path = if e.directory.is_empty() { e.filename.clone() } else { format!("{}/{}", e.directory, e.filename) };
    RawCpkEntryDto { index: index as u32, path, size: e.extract_size as u32, is_compressed: e.is_compressed }
}

#[derive(Serialize, specta::Type)]
struct PackFileDto {
    /// Chemin absolu réel sur disque (PAS un chemin interne VFS) — passé tel quel à
    /// [`open_raw_cpk`] pour l'ouvrir.
    path: String,
    name: String,
    size: u32,
}

/// Liste les VRAIS fichiers `.cpk` physiquement présents sous `<racine>/data/packs/` — le VFS
/// n'expose JAMAIS ces conteneurs comme des entrées navigables (`vfs_ls`/`vfs_all_entries` ne
/// listent que les chemins internes du jeu, ex. `data/common/...`, jamais `data/packs/*.cpk`
/// eux-mêmes), donc naviguer vers `data/packs` dans l'Explorateur y paraissait vide/« non
/// préchargé » alors que les fichiers sont bien là — cette commande comble ce trou en lisant le
/// vrai dossier, pour un pont direct vers [`open_raw_cpk`]/l'onglet CPK brut.
#[tauri::command]
#[specta::specta]
fn list_packs_dir(game_dir: Option<String>) -> Result<Vec<PackFileDto>, String> {
    let root = resolve_root(game_dir.as_deref());
    let packs = root.join("data").join("packs");
    let dir_iter = std::fs::read_dir(&packs).map_err(|e| format!("lecture de {} : {e}", packs.display()))?;
    let mut out = Vec::new();
    for entry in dir_iter.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()).map(|e| e.eq_ignore_ascii_case("cpk")).unwrap_or(false) {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0) as u32;
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or_default().to_string();
            out.push(PackFileDto { path: path.display().to_string(), name, size });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Ouvre un fichier `.cpk` quelconque du disque (chemin absolu choisi par l'utilisatrice) et
/// renvoie la liste de ses entrées — met à jour [`RawCpkState`] pour les commandes suivantes.
#[tauri::command]
#[specta::specta]
fn open_raw_cpk(path: String, state: tauri::State<RawCpkState>) -> Result<Vec<RawCpkEntryDto>, String> {
    let data = std::fs::read(&path).map_err(|e| format!("lecture de {path} : {e}"))?;
    let filename = std::path::Path::new(&path).file_name().and_then(|n| n.to_str()).unwrap_or(&path).to_string();
    let reader = CpkReader::new(&data, &filename).map_err(|e| format!("parsing CPK {path} : {e}"))?;
    let dtos: Vec<RawCpkEntryDto> = reader.entries.iter().enumerate().map(|(i, e)| raw_cpk_entry_dto(i, e)).collect();
    *state.0.lock().unwrap() = Some((PathBuf::from(path), data, reader));
    Ok(dtos)
}

/// Aperçu structuré d'une entrée du CPK brut ouvert (même moteur que [`vfs_describe`]) — extrait
/// et décompresse d'abord via [`CpkReader::extract`].
#[tauri::command]
#[specta::specta]
fn raw_cpk_describe(index: u32, state: tauri::State<RawCpkState>) -> Result<Vec<String>, String> {
    let guard = state.0.lock().unwrap();
    let (_, data, reader) = guard.as_ref().ok_or("aucun CPK ouvert")?;
    let entry = reader.entries.get(index as usize).ok_or("index d'entrée invalide")?;
    let extracted = reader.extract(data, entry).map_err(|e| e.to_string())?;
    let path = if entry.directory.is_empty() { entry.filename.clone() } else { format!("{}/{}", entry.directory, entry.filename) };
    let mut lines = nie_explore::describe_content(&path, &extracted).unwrap_or_default();
    if lines.is_empty() {
        lines.push("format      brut / non reconnu".to_string());
    }
    lines.push(format!("magic       {}", nie_explore::hex_prefix(&extracted, 16)));
    lines.push(format!("taille      {} octets", extracted.len()));
    Ok(lines)
}

/// Contenu brut d'une entrée du CPK ouvert, borné (même plafond par défaut que [`vfs_read_b64`]).
#[tauri::command]
#[specta::specta]
fn raw_cpk_read_b64(index: u32, max_bytes: Option<u32>, state: tauri::State<RawCpkState>) -> Result<String, String> {
    let guard = state.0.lock().unwrap();
    let (_, data, reader) = guard.as_ref().ok_or("aucun CPK ouvert")?;
    let entry = reader.entries.get(index as usize).ok_or("index d'entrée invalide")?;
    let extracted = reader.extract(data, entry).map_err(|e| e.to_string())?;
    let cap = max_bytes.map(|b| b as usize).unwrap_or(2 * 1024 * 1024);
    if extracted.len() > cap {
        return Err(format!("fichier trop volumineux pour l'aperçu ({} octets > {cap})", extracted.len()));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&extracted))
}

/// Extrait une entrée du CPK ouvert vers `dest` (écriture Rust→disque directe).
#[tauri::command]
#[specta::specta]
fn raw_cpk_extract_to(index: u32, dest: String, state: tauri::State<RawCpkState>) -> Result<u32, String> {
    let guard = state.0.lock().unwrap();
    let (_, data, reader) = guard.as_ref().ok_or("aucun CPK ouvert")?;
    let entry = reader.entries.get(index as usize).ok_or("index d'entrée invalide")?;
    let extracted = reader.extract(data, entry).map_err(|e| e.to_string())?;
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dest, &extracted).map_err(|e| e.to_string())?;
    Ok(extracted.len() as u32)
}

/// Extrait TOUTES les entrées du CPK ouvert vers `dest_dir`, en préservant l'arborescence
/// `directory/filename` d'origine (mécanique identique à [`raw_cpk_extract_to`], en boucle sur
/// `RawCpkState.entries`) — évite d'extraire un CPK entier une entrée à la fois depuis l'UI.
/// Renvoie `(n_ok, n_err)` : les échecs individuels (entrée corrompue/compression non supportée)
/// n'interrompent pas le reste de l'extraction, pour ne pas perdre tout le travail sur 1 entrée.
#[tauri::command]
#[specta::specta]
fn raw_cpk_extract_all(dest_dir: String, state: tauri::State<RawCpkState>) -> Result<(u32, u32), String> {
    let guard = state.0.lock().unwrap();
    let (_, data, reader) = guard.as_ref().ok_or("aucun CPK ouvert")?;
    let (mut n_ok, mut n_err) = (0u32, 0u32);
    for entry in &reader.entries {
        let rel = if entry.directory.is_empty() {
            entry.filename.clone()
        } else {
            format!("{}/{}", entry.directory, entry.filename)
        };
        let dest = std::path::Path::new(&dest_dir).join(&rel);
        let ok = (|| -> Result<(), String> {
            let extracted = reader.extract(data, entry).map_err(|e| e.to_string())?;
            if let Some(parent) = dest.parent() {
                std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            std::fs::write(&dest, &extracted).map_err(|e| e.to_string())
        })();
        match ok {
            Ok(()) => n_ok += 1,
            Err(_) => n_err += 1, // entrée corrompue/compression non supportée : on continue le reste
        }
    }
    Ok((n_ok, n_err))
}

// ─── Fichier ouvert depuis l'explorateur Windows (« Ouvrir avec ») ─────────────────

/// Rend une fois le chemin passé en argument au lancement (`argv[1]`), puis se vide — le
/// frontend l'appelle une seule fois au démarrage pour savoir s'il doit ouvrir un fichier
/// « externe » (hors VFS, ex. un `.g4tx` déjà extrait sur disque) plutôt que la racine du VFS.
#[tauri::command]
#[specta::specta]
fn take_pending_open(state: tauri::State<PendingOpen>) -> Option<String> {
    state.0.lock().unwrap().take()
}

/// Aperçu structuré d'un fichier QUELCONQUE du disque (pas du VFS) — utilisé par « Ouvrir
/// avec nie-explorer » sur un fichier déjà extrait/exporté.
#[tauri::command]
#[specta::specta]
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
#[specta::specta]
fn read_disk_file_b64(path: String, max_bytes: Option<u32>) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| e.to_string())?;
    let cap = max_bytes.map(|b| b as usize).unwrap_or(2 * 1024 * 1024);
    if data.len() > cap {
        return Err(format!("fichier trop volumineux pour l'aperçu ({} octets > {cap})", data.len()));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&data))
}

/// Resynchronise le chrome natif Windows 11 (Mica, barre de titre/légende) sur le thème
/// clair/sombre choisi côté frontend (`next-themes`, `resolvedTheme`) — corrige le fait que le
/// chrome natif restait figé en sombre (`Some(true)` posé une seule fois au lancement, cf. `run()`)
/// même si l'utilisatrice bascule en clair dans Paramètres. No-op silencieux hors Windows 11
/// (même best-effort que l'appel initial dans `run()`).
#[tauri::command]
#[specta::specta]
fn set_titlebar_theme(dark: bool, window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        window_vibrancy::apply_mica(&window, Some(dark)).map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (dark, window);
    }
    Ok(())
}

/// `true` si `path` désigne un FICHIER (pas un dossier) existant sur disque — hors de toute
/// portée `fs:scope` JS (même famille que [`describe_disk_file`], `std::fs` direct). Utilisé pour
/// valider un chemin venu du presse-papiers (Ctrl+V, cf. [`copy_disk_file_to_appdata`]) : le
/// plugin `fs` JS `exists()` est scopé à `$APPDATA/**` et renverrait faux/erreur sur un chemin
/// disque quelconque, alors que c'est justement le cas normal ici.
#[tauri::command]
#[specta::specta]
fn disk_file_exists(path: String) -> bool {
    std::fs::metadata(&path).is_ok_and(|m| m.is_file())
}

/// Copie un fichier disque ARBITRAIRE (hors de toute portée `fs:scope` JS — même famille que
/// [`read_disk_file_b64`]/[`describe_disk_file`], `std::fs` direct) vers un chemin relatif sous
/// `AppData` (espace de travail des mods, `mods/<modId>/…`, `crates`/… JS `modWorkspace.ts`).
/// Utilisé par le VRAI Ctrl+V (`editBus.paste()` → `stageReplacementFromPath`) : la source vient
/// du presse-papiers, pas d'un sélecteur natif — elle n'a donc PAS la portée temporaire que
/// Tauri accorde aux chemins choisis via `@tauri-apps/plugin-dialog`, et le plugin `fs` JS
/// (portée = `$APPDATA/**` seulement, cf. `capabilities/default.json`) refuserait de la lire.
/// `dest_appdata_rel` DOIT rester sous `AppData` (jamais le dossier du jeu) — construit côté
/// frontend depuis `modDir(modId)`, jamais depuis une entrée utilisatrice libre.
#[tauri::command]
#[specta::specta]
fn copy_disk_file_to_appdata(app: tauri::AppHandle, src: String, dest_appdata_rel: String) -> Result<u64, String> {
    use tauri::Manager;
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest = base.join(&dest_appdata_rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let n = std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    Ok(n)
}

/// Remplace la texture d'un `.g4tx` **mono-texture, sans région d'atlas** (§2.2 roadmap,
/// « Éditeur d'image (textures) ») par un PNG choisi — lit `vfs_path`, valide qu'il s'agit bien
/// du cas simple pris en charge (cf. doc `nie_formats::g4tx_encode`, rejette explicitement les
/// atlas multi-région comme `gaiji_game.g4tx` où « remplacer » n'aurait pas de sens univoque),
/// décode le PNG source (chemin disque arbitraire, hors portée `fs:scope` JS — même famille que
/// [`copy_disk_file_to_appdata`]) et écrit le `.g4tx` réencodé directement dans l'espace de
/// travail du mod (`AppData/mods/<modId>/…`, jamais le dossier du jeu). Conserve `name`/`id` de
/// la texture d'origine (dimensions reprises du PNG, peuvent différer de l'original).
#[tauri::command]
#[specta::specta]
fn stage_texture_replacement(
    app: tauri::AppHandle,
    vfs_path: String,
    png_src_path: String,
    dest_appdata_rel: String,
    game_dir: Option<String>,
    state: tauri::State<VfsState>,
) -> Result<u64, String> {
    use tauri::Manager;

    let g4tx_bytes = with_vfs(game_dir, &state, |vfs| {
        let data = vfs.read(&vfs_path).map_err(|e| e.to_string())?;
        let parsed = nie_formats::g4tx::parse(&data).map_err(|e| e.to_string())?;
        if parsed.header.texture_count != 1 || parsed.header.sub_texture_count != 0 {
            return Err(
                "remplacement pris en charge uniquement pour les .g4tx mono-texture sans région d'atlas \
                 (les atlas multi-région comme gaiji_game.g4tx partagent une texture entre plusieurs \
                 régions — « remplacer » n'aurait pas de sens univoque)."
                    .to_string(),
            );
        }
        let tex = &parsed.textures[0];
        let png_bytes = std::fs::read(&png_src_path).map_err(|e| format!("lecture PNG '{png_src_path}' : {e}"))?;
        let (w, h, rgba) = nie_formats::g4tx_encode::decode_png_to_rgba8(&png_bytes)?;
        let dds = nie_formats::g4tx_encode::encode_dds_bgra8(w, h, &rgba)?;
        Ok(nie_formats::g4tx_encode::encode_g4tx_single_texture(&tex.name, tex.id, w as i16, h as i16, &dds))
    })?;

    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let dest = base.join(&dest_appdata_rel);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dest, &g4tx_bytes).map_err(|e| e.to_string())?;
    Ok(g4tx_bytes.len() as u64)
}

/// Une entrée à empaqueter dans un `.cpk` exporté (§1.2 roadmap) — `vfs_path` sert à dériver
/// `directory`/`filename` (même convention que [`nie_formats::cpk::CpkEntry`] en lecture),
/// `staged_appdata_rel` est le chemin RELATIF sous `AppData` du fichier de remplacement déjà
/// mis en scène dans le mod (`ModFileRow.staged_file` côté frontend).
#[derive(Deserialize, specta::Type)]
struct CpkExportFileDto {
    vfs_path: String,
    staged_appdata_rel: String,
}

/// Exporte les fichiers d'un mod en un `.cpk` **autonome, non chiffré, non compressé** (§1.2
/// roadmap) — cf. `nie_formats::cpk_encode` pour la portée exacte et ses limites documentées
/// (vérifié par round-trip contre `CpkReader` déjà validé sur le vrai jeu, PAS par chargement
/// réel dans `nie.exe`). Lit chaque fichier mis en scène depuis `AppData` (`std::fs` direct, hors
/// portée `fs:scope` JS — même famille que [`copy_disk_file_to_appdata`]), jamais depuis le
/// dossier du jeu.
#[tauri::command]
#[specta::specta]
fn export_mod_as_cpk(app: tauri::AppHandle, files: Vec<CpkExportFileDto>, dest: String) -> Result<u64, String> {
    use tauri::Manager;

    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut entries = Vec::with_capacity(files.len());
    for f in &files {
        let staged_path = base.join(&f.staged_appdata_rel);
        let data = std::fs::read(&staged_path).map_err(|e| format!("lecture '{}' : {e}", staged_path.display()))?;
        let base_name = f.vfs_path.rsplit('/').next().unwrap_or(&f.vfs_path);
        let directory = f.vfs_path.strip_suffix(base_name).unwrap_or("").trim_end_matches('/').to_string();
        entries.push(nie_formats::cpk_encode::CpkWriteEntry { filename: base_name.to_string(), directory, data });
    }

    let bytes = nie_formats::cpk_encode::encode_cpk(&entries)?;
    if let Some(parent) = std::path::Path::new(&dest).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    Ok(bytes.len() as u64)
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

/// Dépôt source amont de l'addon Blender `tools/niers` (Level-5 G4 Blender Tools, licence de
/// republication confirmée auprès de l'auteur — cf. `tools/niers/README.md` en-tête). `tools/
/// niers` est **vendorisé** dans niers depuis 2026-08-08 (fichiers réguliers versionnés, PAS un
/// submodule Git) : une utilisatrice qui clone `niers` l'a directement, sans étape `git submodule
/// update --init`. Cette constante ne sert donc plus qu'au filet de sécurité ci-dessous.
const NIERS_BLENDER_ADDON_GIT_URL: &str = "https://github.com/The-RealBobi/G4_Blender.git";

/// Garantit que `<root>/tools/niers/__init__.py` existe. Dans niers lui-même c'est TOUJOURS vrai
/// (vendorisé, cf. constante ci-dessus) ; ce filet de sécurité clone l'addon à la volée pour le
/// cas où `root` (le dossier du JEU, résolu par [`resolve_root`]) n'est PAS un checkout de ce
/// repo — un build distribué de `nie-explorer` pointé sur une simple install Steam n'a que le
/// jeu, pas `tools/`. Renvoie le dossier PARENT de l'addon (`<root>/tools`), pas l'addon
/// lui-même — c'est ce dont [`open_in_blender`]/[`install_niers_blender_addon`] ont besoin pour
/// `sys.path.insert`/zipper le dossier `niers`.
fn ensure_niers_blender_addon(root: &std::path::Path) -> Result<PathBuf, String> {
    let tools_dir = root.join("tools");
    let addon_dir = tools_dir.join("niers");
    if addon_dir.join("__init__.py").is_file() {
        return Ok(tools_dir);
    }
    std::fs::create_dir_all(&tools_dir).map_err(|e| format!("création de {} : {e}", tools_dir.display()))?;
    // Dossier présent mais incomplet (clone précédent interrompu) : repart de zéro plutôt que de
    // laisser `git clone` échouer sur un dossier non-vide non-git.
    if addon_dir.is_dir() {
        std::fs::remove_dir_all(&addon_dir).map_err(|e| format!("nettoyage de {} : {e}", addon_dir.display()))?;
    }
    let status = std::process::Command::new("git")
        .args(["clone", "--depth", "1", NIERS_BLENDER_ADDON_GIT_URL])
        .arg(&addon_dir)
        .stdin(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("échec de lancement de git (introuvable sur le PATH ?) : {e}"))?;
    if !status.success() {
        return Err(format!("échec du clonage de l'extension Blender niers ({status}) — {NIERS_BLENDER_ADDON_GIT_URL}"));
    }
    if !addon_dir.join("__init__.py").is_file() {
        return Err(format!("extension clonée mais `__init__.py` introuvable sous {}", addon_dir.display()));
    }
    Ok(tools_dir)
}

/// Extrait `path` (+ ses fichiers frères de même basename dans le même dossier VFS : g4mg/g4sk/
/// g4tx/g4mt) vers un dossier temporaire, lance Blender avec un script d'amorçage qui active
/// l'addon `tools/niers` (`bpy.utils` via `sys.path`, sans dépendre du dossier d'addons
/// utilisateur Blender — cloné à la volée via [`ensure_niers_blender_addon`] si absent) puis
/// importe RÉELLEMENT le modèle via l'opérateur `import_scene.level5_g4` (« File > Import >
/// Level-5 G4 Model »). Pose `NIE_GAME_DIR` dans l'environnement du process Blender : le panneau
/// de recherche niers→Blender (`niers_bridge.py`) l'utilise pour retrouver `niers.exe` et le VFS
/// sans deviner.
///
/// **Bug corrigé (2026-08-08, « Blender ouvre un fichier vide »)** : le script d'amorçage
/// appelait `level5_g4_port.load_original_model` — ce n'est PAS un import de scène, c'est
/// l'opérateur « choisir le template original » du **wizard d'export/portage** (`g4_port_addon.
/// py`, panneau « 1. Original model template » : il peuple les *réglages* internes de l'addon
/// pour un futur export, ne crée AUCUN objet maillage). Confirmé par lecture du code source de
/// l'addon (`tools/niers/g4_port_addon.py` `LEVEL5_G4PORT_OT_load_original_model.execute` appelle
/// `apply_original_model_to_settings`, pas un import). Le VRAI importeur (« File > Import >
/// Level-5 G4 Model », README de l'addon) est `import_scene.level5_g4` — **validé par un test
/// réel `blender --background --python`** sur le vrai `c01000010.g4md` : 3 objets créés
/// (`c01000010_20`/`eye_10`/`mouth_10`), contre 0 avant. `skip_character_setup=True` +
/// `import_character_parts=False` : évite le wizard interactif de pièces de personnage
/// (`INVOKE_DEFAULT` modal) pour un import direct et prévisible du seul fichier cliqué.
#[tauri::command]
#[specta::specta]
fn open_in_blender(path: String, blender_exe: Option<String>, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<String, String> {
    let blender = resolve_blender_exe(blender_exe)?;
    let root = resolve_root(game_dir.as_deref());
    let addon_parent = ensure_niers_blender_addon(&root)?;

    let built = with_vfs(Some(root.display().to_string()), &state, |vfs| {
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
        Ok((export_dir, main_path, sibling_exts.len()))
    })?;
    let (export_dir, main_path, sibling_count) = built;

    let error_log = export_dir.join("_nie_explorer_import_error.log");
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

import bpy

ERROR_LOG = {error_log:?}

def _nie_explorer_import():
    try:
        bpy.ops.import_scene.level5_g4(
            'EXEC_DEFAULT',
            filepath={main_path:?},
            skip_character_setup=True,
            import_character_parts=False,
            create_report_text=False,
        )
        print("[nie-explorer] modèle importé :", {main_path:?})
    except Exception:
        tb = traceback.format_exc()
        print(tb)
        try:
            with open(ERROR_LOG, "w", encoding="utf-8") as f:
                f.write(tb)
        except Exception:
            pass
        try:
            bpy.context.workspace.status_text_set("[nie-explorer] ECHEC import (voir " + ERROR_LOG + ")")
        except Exception:
            pass

# Differe via bpy.app.timers (meme mecanisme que l'addon lui-meme pour ses propres operateurs
# differes, cf. g4_animation_addon.defer_blender_call) : au tout premier instant ou --python
# s'execute au demarrage GUI, la fenetre/le contexte 3D ne sont pas garantis prets pour un
# operateur qui touche context.window_manager/context.workspace (import_scene.level5_g4 en a
# besoin pour sa barre de progression) -- un appel synchrone immediat peut echouer en silence.
bpy.app.timers.register(_nie_explorer_import, first_interval=0.3)
"#,
        addon_parent = addon_parent.display().to_string(),
        error_log = error_log.display().to_string(),
        main_path = main_path.display().to_string(),
    );
    std::fs::write(&script_path, script).map_err(|e| e.to_string())?;

    std::process::Command::new(&blender)
        .arg("--python")
        .arg(&script_path)
        .env("NIE_GAME_DIR", root.display().to_string())
        // Lu par `inferred_raw_data_root`/`candidate_data_roots` de l'addon SI le chemin importé
        // n'est déjà sous un dossier `data/common/...` (ce qui EST le cas ici, cf. préservation du
        // chemin VFS ci-dessus — la résolution par chemin suffit pour ce fichier précis) ; posé
        // quand même en filet pour toute résolution qui remonterait plus haut (skelette partagé
        // hors de l'arborescence exportée, cf. `LEVEL5_G4_RAW_ROOT` dans `tools/niers/__init__.py`).
        .env("LEVEL5_G4_RAW_ROOT", root.join("data").display().to_string())
        .spawn()
        .map_err(|e| format!("échec du lancement de Blender ({}) : {e}", blender.display()))?;

    Ok(format!("Blender lancé — {} exporté(s) vers {} (import différé, log d'erreur : {})", sibling_count, export_dir.display(), error_log.display()))
}

// ─── Installation PERSISTANTE de l'extension Blender niers (« lier au max Blender et niers ») ─
//
// [`open_in_blender`] ci-dessus est un lien TRANSITOIRE : addon activé via `sys.path` pour la
// durée d'un seul process Blender lancé PAR nie-explorer, jamais installé dans le vrai dossier
// d'addons utilisateur. Cette section installe l'extension **pour de vrai** (comme Preferences >
// Add-ons > Install from Disk le ferait) ET configure sa préférence `raw_data_root` sur le VRAI
// dossier `data/` du jeu — un Blender lancé ensuite INDÉPENDAMMENT de nie-explorer (double-clic
// sur l'icône, pas de bootstrap) a alors l'addon actif ET connaît déjà le dépôt de données niers,
// sans que l'utilisatrice n'ouvre jamais Préférences > Add-ons.

/// Zippe `addon_dir` (`tools/niers`) en préservant son nom de dossier comme racine de l'archive
/// (`niers/__init__.py`, pas `__init__.py` à plat) — requis par `bpy.ops.preferences.addon_install`
/// pour une extension multi-fichiers (cf. README de l'addon : « package the directory as ZIP
/// while keeping its folder name and `__init__.py` at the add-on root »). Exclut `.git`.
fn zip_addon_dir(addon_dir: &std::path::Path) -> Result<PathBuf, String> {
    let addon_name = addon_dir.file_name().and_then(|n| n.to_str()).ok_or("nom de dossier d'addon invalide")?.to_string();
    let dest_dir = std::env::temp_dir().join("nie-explorer").join("blender-addon");
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let zip_path = dest_dir.join("niers-addon.zip");
    let file = std::fs::File::create(&zip_path).map_err(|e| format!("création de {} : {e}", zip_path.display()))?;
    let mut writer = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    fn walk(
        dir: &std::path::Path,
        base: &std::path::Path,
        addon_name: &str,
        writer: &mut zip::ZipWriter<std::fs::File>,
        options: zip::write::SimpleFileOptions,
    ) -> Result<(), String> {
        let entries = std::fs::read_dir(dir).map_err(|e| format!("lecture de {} : {e}", dir.display()))?;
        for entry in entries {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if entry.file_name() == ".git" {
                continue;
            }
            if path.is_dir() {
                walk(&path, base, addon_name, writer, options)?;
            } else {
                let rel = path.strip_prefix(base).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
                writer.start_file(format!("{addon_name}/{rel}"), options).map_err(|e| e.to_string())?;
                let bytes = std::fs::read(&path).map_err(|e| format!("lecture de {} : {e}", path.display()))?;
                std::io::Write::write_all(writer, &bytes).map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }
    walk(addon_dir, addon_dir, &addon_name, &mut writer, options)?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(zip_path)
}

/// Installe/met à jour l'extension Blender **niers** dans le vrai dossier d'addons de
/// l'utilisatrice (`bpy.ops.preferences.addon_install` + `addon_enable`, PAS le bootstrap
/// `sys.path` transitoire de [`open_in_blender`]) et configure sa préférence `raw_data_root` sur
/// le vrai `<jeu>/data` (résolu par `inferred_raw_data_root`/`candidate_data_roots` de l'addon
/// pour la recherche de squelette partagé/pièces de personnage — cf. `tools/niers/g4_animation_
/// addon.py`) — persisté via `bpy.ops.wm.save_userpref()`, donc actif au prochain lancement de
/// Blender INDÉPENDAMMENT de nie-explorer. Bloquant (`--background`, `.output()` synchrone) : pas
/// de fenêtre à garder ouverte contrairement à [`open_in_blender`], donc pas de fuite de process.
#[tauri::command]
#[specta::specta]
fn install_niers_blender_addon(blender_exe: Option<String>, game_dir: Option<String>) -> Result<String, String> {
    let root = resolve_root(game_dir.as_deref());
    let addon_parent = ensure_niers_blender_addon(&root)?;
    let addon_dir = addon_parent.join("niers");
    let blender = resolve_blender_exe(blender_exe)?;
    let zip_path = zip_addon_dir(&addon_dir)?;

    let data_root = root.join("data");
    let script_path = zip_path.with_file_name("_install.py");
    let script = format!(
        r#"import traceback
import bpy

OK_MARKER = "NIE_EXPLORER_ADDON_INSTALL_OK"

try:
    bpy.ops.preferences.addon_install(filepath={zip_path:?}, overwrite=True)
    bpy.ops.preferences.addon_enable(module="niers")
    prefs = bpy.context.preferences.addons["niers"].preferences
    prefs.raw_data_root = {data_root:?}
    bpy.ops.wm.save_userpref()
    print(OK_MARKER)
except Exception:
    traceback.print_exc()
    print("NIE_EXPLORER_ADDON_INSTALL_FAILED")
"#,
        zip_path = zip_path.display().to_string(),
        data_root = data_root.display().to_string(),
    );
    std::fs::write(&script_path, &script).map_err(|e| e.to_string())?;

    let output = std::process::Command::new(&blender)
        .args(["--background", "--python"])
        .arg(&script_path)
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|e| format!("échec de lancement de Blender ({}) : {e}", blender.display()))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if stdout.contains("NIE_EXPLORER_ADDON_INSTALL_OK") {
        Ok(format!(
            "Extension niers installée + activée (Préférences Blender persistées). Dossier de données lié : {}",
            data_root.display()
        ))
    } else {
        // Sortie complète (stdout+stderr) tronquée : le traceback Python utile est dedans, jamais
        // avalé — contrairement au `Blender a échoué (status)` générique qu'on aurait sinon.
        let mut detail = format!("{stdout}\n{stderr}");
        const CAP: usize = 4000;
        if detail.len() > CAP {
            detail.truncate(CAP);
            detail.push_str("\n… (tronqué)");
        }
        Err(format!("échec de l'installation de l'extension Blender niers :\n{detail}"))
    }
}

// ─── Aperçu 3D (G4MD+G4MG → GLB embarqué → `nie-render3d`, rendu natif pur-Rust EN PROCESS) ──
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
//
// **Appelé EN PROCESS depuis 2026-08-08**, plus via un binaire externe. Avant cette date,
// [`vfs_glb_preview_png_b64`]/[`vfs_glb_preview_turntable_mp4_b64`] shellaient vers
// `target/{debug,release}/nie-render3d.exe` (résolu par un `resolve_render3d_exe` aujourd'hui
// supprimé) — introuvable dans tout build DISTRIBUÉ de nie-explorer (`scripts/package.sh` ne
// packages QUE nie-game/nie-headless/nie-play/nie-runtime, jamais nie-render3d ; `tauri.conf.
// json` n'a pas de `bundle.resources`/`externalBin` pour lui) : l'aperçu 3D échouait
// silencieusement hors poste de dev. `nie-render3d::{glb::parse, render::render}` est du
// `#![forbid(unsafe_code)]` pur-Rust sans état global — l'appeler en lib direct est aussi sûr
// que n'importe quel autre décodeur `nie-formats` déjà appelé en process, élimine la dépendance
// au binaire ET le double aller-retour disque (écrire le GLB, relire chaque PNG).

/// Assemble le GLB (G4MD+G4MG+G4TX frère, cf. commentaire de section) pour `path` — cœur partagé
/// entre [`vfs_glb_preview_png_b64`] (vue fixe) et [`vfs_glb_preview_turntable_mp4_b64`] (rotation
/// §2.3 roadmap), pour ne pas dupliquer la résolution de frères/assemblage.
fn assemble_glb_for_preview(vfs: &nie_formats::vfs::Vfs, path: &str) -> Result<(String, Vec<u8>), String> {
    use nie_formats::assemble::{assemble_generic_model, EmbeddedTexture, GenericModelInput, MeshComponent};

    let data = vfs.read(path).map_err(|e| e.to_string())?;

    let base = path.rsplit('/').next().unwrap_or(path);
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

    Ok((stem.to_string(), model.to_glb_embedded()))
}

/// Même logique que [`assemble_glb_for_preview`] (résolution de frères g4mg/g4tx + assemblage
/// GLB), mais scopée aux entrées d'un CPK brut ouvert ([`RawCpkState`]) plutôt qu'au VFS complet
/// — ferme le gap documenté `apps/nie-explorer/ROADMAP.md` §6 (« parité RawCpkView/DetailPane »,
/// aperçu 3D listé « hors de portée pour un CPK ouvert hors VFS » faute d'un « résolveur de
/// frères scopé au seul CPK courant »). Correspondance par (dossier, basename) au lieu d'un
/// chemin VFS complet : un CPK brut ouvert hors VFS n'a pas de préfixe `data/...` fiable, mais
/// `CpkEntry` porte déjà `directory`/`filename` séparément — pas besoin de reconstruire un chemin.
fn assemble_glb_from_cpk_entries(data: &[u8], reader: &CpkReader, entry: &CpkEntry) -> Result<(String, Vec<u8>), String> {
    use nie_formats::assemble::{assemble_generic_model, EmbeddedTexture, GenericModelInput, MeshComponent};

    let stem = entry.filename.rsplit_once('.').map(|(s, _)| s).unwrap_or(&entry.filename).to_string();
    let sibling = |ext: &str| -> Option<Vec<u8>> {
        let target = format!("{stem}.{ext}");
        reader
            .entries
            .iter()
            .find(|e| e.directory == entry.directory && e.filename.eq_ignore_ascii_case(&target))
            .and_then(|e| reader.extract(data, e).ok())
    };

    let g4md = sibling("g4md").ok_or("G4MD introuvable dans ce CPK (même dossier, même nom de base)")?;
    let g4mg = sibling("g4mg").ok_or("G4MG introuvable dans ce CPK (frère requis pour la géométrie)")?;

    let mut model = assemble_generic_model(GenericModelInput { code: stem.clone(), g4md, g4mg, component: MeshComponent::Generic })
        .map_err(|e| format!("assemblage GLB : {e}"))?;

    let png = sibling("g4tx").and_then(|g4tx| nie_formats::g4tx_decode::decode_best_to_png(&g4tx));
    if let Some(png) = png {
        model.embedded_textures.push(EmbeddedTexture { component: MeshComponent::Generic, name: format!("{stem}_tex"), png_bytes: png });
    }

    Ok((stem, model.to_glb_embedded()))
}

/// Aperçu 3D fixe pour une entrée du CPK brut ouvert (hors VFS) — équivalent de
/// [`vfs_glb_preview_png_b64`], résolution de frères via [`assemble_glb_from_cpk_entries`].
#[tauri::command]
#[specta::specta]
fn raw_cpk_glb_preview_png_b64(index: u32, state: tauri::State<RawCpkState>) -> Result<String, String> {
    let guard = state.0.lock().unwrap();
    let (_, data, reader) = guard.as_ref().ok_or("aucun CPK ouvert")?;
    let entry = reader.entries.get(index as usize).ok_or("index d'entrée invalide")?;
    let (_stem, glb) = assemble_glb_from_cpk_entries(data, reader, entry)?;
    let model = nie_render3d::glb::parse(&glb).map_err(|e| format!("parse GLB : {e}"))?;
    let rgba = nie_render3d::render::render(&model, 0.6, RENDER3D_SIZE, RENDER3D_SIZE);
    let png = encode_png_rgba(&rgba, RENDER3D_SIZE, RENDER3D_SIZE)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&png))
}

/// Encode un buffer RGBA8 (sortie de `nie_render3d::render::render`) en PNG — même réglages que
/// le CLI `nie-render3d` (`png` crate, `ColorType::Rgba`/`BitDepth::Eight`) ; dupliqué ici plutôt
/// qu'exposé depuis `nie-render3d` car ce dernier n'a pas de `[lib]` pour l'encodage (seuls
/// `glb`/`render`/`scene` sont publics, l'encodage PNG vit dans son `main.rs` binaire).
fn encode_png_rgba(rgba: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(std::io::Cursor::new(&mut out), w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(rgba).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

const RENDER3D_SIZE: u32 = 512;

#[tauri::command]
#[specta::specta]
fn vfs_glb_preview_png_b64(path: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<String, String> {
    let root = resolve_root(game_dir.as_deref());
    let (_stem, glb) = with_vfs(Some(root.display().to_string()), &state, |vfs| assemble_glb_for_preview(vfs, &path))?;
    let model = nie_render3d::glb::parse(&glb).map_err(|e| format!("parse GLB : {e}"))?;
    // angle=0.6 rad : même cadrage par défaut que le CLI `nie-render3d --frames 1` (main.rs).
    let rgba = nie_render3d::render::render(&model, 0.6, RENDER3D_SIZE, RENDER3D_SIZE);
    let png = encode_png_rgba(&rgba, RENDER3D_SIZE, RENDER3D_SIZE)?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&png))
}

/// Aperçu 3D **interactif** (§2.3 roadmap, « caméra orbitale ») : au lieu d'une image fixe,
/// rend un **turntable** (36 images à angles régulièrement espacés sur 360°, EN PROCESS via
/// `nie_render3d::render::render`) remuxé en MP4 par `ffmpeg` en sous-processus (seul `ffmpeg`
/// reste externe — même outil déjà requis pour l'aperçu vidéo USM, cf. [`vfs_video_preview_b64`],
/// le mux H.264 n'a pas d'équivalent pur-Rust raisonnable dans ce budget) — le frontend l'affiche
/// dans un `<video controls>`, dont la barre de défilement native EST la caméra orbitale (glisser
/// = tourner autour du modèle). Alternative délibérément choisie à l'embarquement d'une fenêtre
/// wgpu native dans WebView2 (fenêtrage Win32 imbriqué fragile, hors de portée raisonnable ici) —
/// même moteur de rendu (`nie-render3d`) que [`vfs_glb_preview_png_b64`], juste plus d'images.
#[tauri::command]
#[specta::specta]
fn vfs_glb_preview_turntable_mp4_b64(path: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<String, String> {
    const FRAMES: u32 = 36;
    const FPS: u32 = 12;

    let root = resolve_root(game_dir.as_deref());
    let (stem, glb) = with_vfs(Some(root.display().to_string()), &state, |vfs| assemble_glb_for_preview(vfs, &path))?;
    let model = nie_render3d::glb::parse(&glb).map_err(|e| format!("parse GLB : {e}"))?;

    // Dossier unique par appel (stem+horodatage) : évite qu'un second aperçu concurrent sur le
    // même modèle n'écrase les frames PNG en cours de lecture par `ffmpeg` (le binaire externe
    // précédent réutilisait un dossier fixe par stem, sans ce risque car un seul writer à la fois).
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
    let dir = std::env::temp_dir().join("nie-explorer").join("render3d").join(format!("{stem}-{stamp}"));
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for i in 0..FRAMES {
        let angle = std::f32::consts::TAU * (i as f32) / (FRAMES as f32);
        let rgba = nie_render3d::render::render(&model, angle, RENDER3D_SIZE, RENDER3D_SIZE);
        let png = encode_png_rgba(&rgba, RENDER3D_SIZE, RENDER3D_SIZE)?;
        std::fs::write(dir.join(format!("f_{i:04}.png")), png).map_err(|e| e.to_string())?;
    }

    let mp4_path = dir.join("turntable.mp4");
    let status = std::process::Command::new("ffmpeg")
        .args(["-y", "-loglevel", "error", "-framerate", &FPS.to_string(), "-i"])
        .arg(dir.join("f_%04d.png"))
        .args(["-c:v", "libx264", "-pix_fmt", "yuv420p"])
        .arg(&mp4_path)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|e| format!("échec de lancement de ffmpeg (introuvable sur le PATH ?) : {e}"));
    let status = match status {
        Ok(s) => s,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dir);
            return Err(e);
        }
    };
    if !status.success() {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(format!("ffmpeg a échoué ({status})"));
    }

    let mp4 = std::fs::read(&mp4_path).map_err(|e| e.to_string());
    let _ = std::fs::remove_dir_all(&dir);
    let mp4 = mp4?;
    const CAP: usize = 60 * 1024 * 1024;
    if mp4.len() > CAP {
        return Err(format!("turntable MP4 trop volumineux pour l'aperçu ({} octets > {CAP})", mp4.len()));
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(&mp4))
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
#[specta::specta]
fn vfs_audio_preview_b64(path: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<String, String> {
    let data = with_vfs(game_dir, &state, |vfs| vfs.read(&path).map_err(|e| e.to_string()))?;
    audio_wav_b64_from_bytes(data)
}

/// Cœur du décodage audio CRI (HCA/ADX) → WAV b64, indépendant de la SOURCE des octets (VFS monté
/// OU entrée d'un CPK brut hors VFS, cf. [`raw_cpk_audio_preview_b64`]) — factorisé pour la parité
/// d'outils `RawCpkView`/`DetailPane` (roadmap §6, « pas de Blender/aperçu 3D/audio/vidéo pour les
/// entrées d'un CPK ouvert hors VFS »).
fn audio_wav_b64_from_bytes(data: Vec<u8>) -> Result<String, String> {
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

/// Même décodage audio que [`vfs_audio_preview_b64`], mais depuis une entrée du CPK brut ouvert
/// (hors VFS) — un seul fichier autonome (HCA/ADX ne référence jamais de fichier frère), donc pas
/// de dépendance à l'indexation VFS. (L'aperçu 3D, qui a besoin des frères g4md/g4mg, a sa PROPRE
/// résolution scopée au CPK courant plutôt que le VFS — cf. [`raw_cpk_glb_preview_png_b64`]/
/// [`assemble_glb_from_cpk_entries`], plus VFS-only depuis 2026-08-08.)
#[tauri::command]
#[specta::specta]
fn raw_cpk_audio_preview_b64(index: u32, state: tauri::State<RawCpkState>) -> Result<String, String> {
    let data = {
        let guard = state.0.lock().unwrap();
        let (_, data, reader) = guard.as_ref().ok_or("aucun CPK ouvert")?;
        let entry = reader.entries.get(index as usize).ok_or("index d'entrée invalide")?;
        reader.extract(data, entry).map_err(|e| e.to_string())?
    };
    audio_wav_b64_from_bytes(data)
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
#[specta::specta]
fn vfs_video_preview_b64(path: String, game_dir: Option<String>, state: tauri::State<VfsState>) -> Result<String, String> {
    let data = with_vfs(game_dir, &state, |vfs| vfs.read(&path).map_err(|e| e.to_string()))?;
    video_mp4_b64_from_bytes(data)
}

/// Cœur du remuxage vidéo USM→MP4, indépendant de la SOURCE des octets (VFS monté OU entrée d'un
/// CPK brut hors VFS, cf. [`raw_cpk_video_preview_b64`]) — même factorisation que
/// [`audio_wav_b64_from_bytes`], même raison (parité d'outils `RawCpkView`, roadmap §6).
fn video_mp4_b64_from_bytes(data: Vec<u8>) -> Result<String, String> {
    let usm = nie_formats::cri_audio::usm_demux(&data).map_err(|e| e.to_string())?;
    if usm.video_codec != nie_formats::cri_audio::VideoCodec::H264 {
        return Err(format!("codec {:?} non pris en charge pour l'aperçu (H.264 uniquement) — utilisez Extraire", usm.video_codec));
    }
    if usm.video_data.is_empty() {
        return Err("aucun flux vidéo dans ce fichier".to_string());
    }
    let video_data = usm.video_data;

    let dir = std::env::temp_dir().join("nie-explorer").join("video-preview");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let raw = dir.join("in.h264");
    let out = dir.join("out.mp4");
    std::fs::write(&raw, &video_data).map_err(|e| e.to_string())?;

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

/// Même remuxage vidéo que [`vfs_video_preview_b64`], mais depuis une entrée du CPK brut ouvert
/// (hors VFS) — un `.usm` est autonome (pas de fichier frère référencé), donc pas de dépendance à
/// l'indexation VFS.
#[tauri::command]
#[specta::specta]
fn raw_cpk_video_preview_b64(index: u32, state: tauri::State<RawCpkState>) -> Result<String, String> {
    let data = {
        let guard = state.0.lock().unwrap();
        let (_, data, reader) = guard.as_ref().ok_or("aucun CPK ouvert")?;
        let entry = reader.entries.get(index as usize).ok_or("index d'entrée invalide")?;
        reader.extract(data, entry).map_err(|e| e.to_string())?
    };
    video_mp4_b64_from_bytes(data)
}

/// JSON libre renvoyé tel quel sur l'IPC (réponses azalee : GraphQL/REST, forme non fixe côté
/// serveur — le frontend les type déjà en `any`/interfaces locales, cf. `src/lib/api.ts`).
///
/// `serde_json::Value` EST récursif (`Object`/`Array` se contiennent eux-mêmes, cf.
/// `impl Type for SerdeValue` dans `specta`) : l'exporter TS dessus fait un vrai
/// `STATUS_STACK_OVERFLOW` — vérifié en réel, y compris sur un thread à pile 64 Mio dédiée (cf.
/// `run()`), donc PAS un simple manque de pile, une récursion qui ne se referme jamais côté
/// réflexion de types. Ce wrapper s'exporte comme `unknown` côté TS (`specta_typescript::define`,
/// un type opaque non récursif) sans changer un seul octet envoyé sur l'IPC : `Serialize`
/// délègue tel quel à `serde_json::Value`.
struct RawJson(serde_json::Value);

impl serde::Serialize for RawJson {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        self.0.serialize(s)
    }
}

impl specta::Type for RawJson {
    fn definition(_: &mut specta::Types) -> specta::datatype::DataType {
        specta::datatype::DataType::Reference(specta_typescript::define("unknown"))
    }
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
#[specta::specta]
fn remote_search_chara(base_url: String, query: String) -> Result<RawJson, String> {
    graphql_query(
        &base_url,
        "query($q: String) { characters(q: $q, limit: 20) { id internalCode name { fr en ja } \
         variants { charaParamId position element rarity image } } }",
        serde_json::json!({ "q": query }),
    )
    .map(RawJson)
}

/// Recherche de techniques via le GraphQL azalee (`skills(q, limit)`).
#[tauri::command]
#[specta::specta]
fn remote_search_waza(base_url: String, query: String) -> Result<RawJson, String> {
    graphql_query(
        &base_url,
        "query($q: String) { skills(q: $q, limit: 20) { id name { fr en ja } category element power tension image } }",
        serde_json::json!({ "q": query }),
    )
    .map(RawJson)
}

/// Recherche plein-texte dans l'index CPK distant (250 800 fichiers, azalee) — utile en
/// complément du VFS local (comparaison, ou navigation sans avoir le jeu monté).
#[tauri::command]
#[specta::specta]
fn remote_cpk_search(base_url: String, query: String) -> Result<RawJson, String> {
    let url = format!("{}/api/cpk?q={}", azalee_base(&base_url), urlencode(&query));
    let resp = ureq::get(&url).call().map_err(|e| format!("requête distante échouée ({url}) : {e}"))?;
    resp.into_json::<serde_json::Value>().map(RawJson).map_err(|e| format!("réponse non-JSON : {e}"))
}

/// Résout les IDs de roster d'une sauvegarde (hash `0x........`) en noms réels via le miroir
/// serveur azalee — AUCUN octet de save ne transite, seulement les IDs déjà extraits en local
/// par `nie-save`. Anti-hallucination côté serveur : un ID absent revient `name: null`.
#[tauri::command]
#[specta::specta]
fn remote_resolve_roster(base_url: String, ids: Vec<String>) -> Result<RawJson, String> {
    let url = format!("{}/api/save/resolve-roster", azalee_base(&base_url));
    let resp = ureq::post(&url)
        .set("Content-Type", "application/json")
        .send_json(serde_json::json!({ "ids": ids }))
        .map_err(|e| format!("requête distante échouée ({url}) : {e}"))?;
    resp.into_json::<serde_json::Value>().map(RawJson).map_err(|e| format!("réponse non-JSON : {e}"))
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

/// Collecte toutes les commandes IPC pour `tauri-specta` — une SEULE liste, source de vérité à
/// la fois pour l'enregistrement runtime (`invoke_handler`) et pour l'export des bindings
/// TypeScript (`src/lib/bindings.ts`), là où il fallait avant maintenir `tauri::generate_handler!`
/// ICI et le miroir `invoke<T>("cmd", {...})` de `api.ts` À LA MAIN, sans qu'un oubli ne soit
/// jamais signalé par le compilateur.
fn specta_builder() -> tauri_specta::Builder<tauri::Wry> {
    tauri_specta::Builder::<tauri::Wry>::new().commands(tauri_specta::collect_commands![
        default_game_dir,
        check_game_dir,
        default_wiki_db,
        default_re_db,
        preload_vfs,
        vfs_ls,
        vfs_find,
        vfs_stats,
        vfs_entry_meta,
        vfs_describe,
        vfs_read_b64,
        vfs_texture_png_b64,
        vfs_extract_to,
        vfs_write_b64,
        vfs_write_loose_override_b64,
        save_bytes_b64,
        vfs_related,
        vfs_all_entries,
        game_data_skills,
        game_data_items,
        game_data_auras,
        game_data_trophies,
        game_data_quests,
        game_data_chara_picker,
        game_data_calculate_stats,
        vfs_decode_cfgbin,
        encode_cfgbin_config,
        list_packs_dir,
        open_raw_cpk,
        raw_cpk_describe,
        raw_cpk_read_b64,
        raw_cpk_extract_to,
        raw_cpk_extract_all,
        raw_cpk_audio_preview_b64,
        raw_cpk_video_preview_b64,
        copy_disk_file_to_appdata,
        disk_file_exists,
        stage_texture_replacement,
        export_mod_as_cpk,
        set_titlebar_theme,
        take_pending_open,
        describe_disk_file,
        read_disk_file_b64,
        open_in_blender,
        install_niers_blender_addon,
        remote_search_chara,
        remote_search_waza,
        remote_cpk_search,
        remote_resolve_roster,
        default_save_path,
        save_open,
        save_list_blobs,
        save_blob_hex_b64,
        save_export,
        vfs_video_preview_b64,
        vfs_glb_preview_png_b64,
        vfs_glb_preview_turntable_mp4_b64,
        vfs_audio_preview_b64,
        raw_cpk_glb_preview_png_b64,
    ])
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Régénère `src/lib/bindings.ts` à CHAQUE lancement en dev — jamais en release (pas de
    // dépendance à `specta-typescript`/écriture disque dans le binaire distribué). Le frontend
    // importe ce fichier généré directement (cf. `src/lib/api.ts`), donc toute commande
    // ajoutée/modifiée ici se reflète côté TS au prochain `cargo tauri dev`, sans étape manuelle.
    //
    // Lancé sur un THREAD DÉDIÉ à pile large (64 Mio) : trouvé par test réel (pas supposé) — la
    // réflexion de types de `specta` sur ~29 commandes (dont plusieurs `serde_json::Value`,
    // récursif : `Object`/`Array` se référencent eux-mêmes) fait un vrai `STATUS_STACK_OVERFLOW`
    // sur la pile principale par défaut (thread `main`, crash silencieux avant même la création
    // de la fenêtre). Même remède que [`vfs_audio_preview_b64`] pour `cridecoder` : une pile
    // dédiée plus large suffit largement, ce n'est pas une récursion infinie (le process ne
    // boucle pas indéfiniment, il complète normalement une fois la pile élargie).
    #[cfg(debug_assertions)]
    std::thread::Builder::new()
        .stack_size(64 * 1024 * 1024)
        .spawn(|| {
            specta_builder()
                .export(specta_typescript::Typescript::default(), "../src/lib/bindings.ts")
                .expect("échec de l'export des bindings TypeScript (tauri-specta)");
        })
        .expect("échec de lancement du thread d'export specta")
        .join()
        .expect("le thread d'export specta a paniqué");

    let specta = specta_builder();

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
        .manage(VfsState(Mutex::new(None)))
        .manage(RawCpkState(Mutex::new(None)))
        .setup(|app| {
            // Habillage natif Windows 11 (Mica) — cf. demande utilisateur « ui windows native ».
            // Best-effort : une build hors Win11/serveur peut échouer l'appel, sans bloquer le
            // lancement (fenêtre reste opaque « surface » standard dans ce cas).
            //
            // `Some(true)` FORCE le mode sombre du chrome natif (texte/boutons de légende de la
            // vraie barre de titre) — `None` (essayé d'abord, cf. capture d'écran réelle) suit le
            // thème CLAIR du système au lieu du thème sombre par défaut de l'appli
            // (`defaultTheme="dark"`, `main.tsx`), ce qui donnait une barre de titre native
            // blanche au-dessus d'un contenu sombre. Valeur initiale sombre (cohérente avec le
            // défaut de l'appli) ; resynchronisée en direct au changement clair/sombre
            // (Paramètres) par [`set_titlebar_theme`], appelée depuis `App.tsx` sur
            // `resolvedTheme` (next-themes).
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window_vibrancy::apply_mica(&window, Some(true));
                }
            }

            // Précharge le VFS sur un thread dédié pendant que la fenêtre s'affiche — le premier
            // clic de navigation du frontend (qui appelle aussi `preload_vfs` explicitement au
            // montage, cf. `App.tsx`) retrouve alors un cache déjà chaud dans la plupart des cas,
            // au lieu d'attendre l'indexation complète (~255 800 entrées) en plein milieu d'un
            // clic. Best-effort : une erreur ici (jeu non détecté) est silencieuse, l'appel
            // explicite du frontend au montage remontera la vraie erreur à l'UI.
            {
                use tauri::Manager;
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let state = handle.state::<VfsState>();
                    let _ = with_vfs(None, &state, |_vfs| Ok(()));
                });
            }
            Ok(())
        })
        .invoke_handler(specta.invoke_handler())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Golden réel sur le vrai jeu (`data/`, 57 Go, gitignored) : vérifie END-TO-END le nouveau
/// rendu 3D EN PROCESS (2026-08-08, cf. commentaire au-dessus de `assemble_glb_for_preview`) —
/// pas seulement « ça compile » après la suppression de `resolve_render3d_exe`/du subprocess.
/// `cargo test -p nie-explorer --lib --features real-fixtures`.
#[cfg(all(test, feature = "real-fixtures"))]
mod real_fixtures_tests {
    use super::{
        assemble_glb_for_preview, assemble_glb_from_cpk_entries, encode_png_rgba, ensure_niers_blender_addon, CpkReader, Vfs,
        RENDER3D_SIZE,
    };

    /// `tools/niers` (vendorisé dans niers depuis 2026-08-08, cf. `docs/PLAN.md`) doit être
    /// détecté PRÉSENT sans déclencher de `git clone` (rapide, déterministe — pas de dépendance
    /// réseau dans ce test). Le chemin réseau (`git clone` si absent, filet de sécurité pour un
    /// `game_dir` qui n'est pas un checkout de ce repo) est vérifié manuellement contre le vrai
    /// dépôt GitHub, pas ici (pas d'accès réseau garanti en CI).
    #[test]
    fn ensure_niers_blender_addon_detecte_le_vendoring_deja_present() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let tools_dir = ensure_niers_blender_addon(&root).expect("tools/niers doit déjà être présent (vendorisé)");
        assert!(tools_dir.join("niers").join("__init__.py").is_file());
        // La VRAIE ligne attendue de l'addon (pas un fichier vide/corrompu) : le bl_info du plugin.
        let init = std::fs::read_to_string(tools_dir.join("niers").join("__init__.py")).unwrap();
        assert!(init.contains("Level-5 G4 Blender Tools"), "contenu inattendu — mauvais addon ?");
    }

    #[test]
    fn glb_preview_png_en_process_sur_un_vrai_modele() {
        let data_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../data");
        assert!(data_dir.is_dir(), "data/ introuvable ({}) — test réservé au poste avec le vrai jeu", data_dir.display());
        let mut vfs = Vfs::new();
        vfs.init(&data_dir).expect("init VFS depuis le vrai data/");

        // `c01000010` = visage IE1 d'Endou (même fixture que `nie_formats::assemble::tests`,
        // casse réelle du VFS vérifiée via `niers vfs find c01000010` : `01_IE1`, pas `01_ie1`).
        let path = "data/common/chr/_face/01_IE1/c01000010/c01000010.g4md";
        let (stem, glb) = assemble_glb_for_preview(&vfs, path).expect("assemblage GLB réel");
        assert_eq!(stem, "c01000010");
        assert!(glb.len() > 1000, "GLB assemblé suspicieusement petit ({} octets)", glb.len());

        let model = nie_render3d::glb::parse(&glb).expect("parse du GLB assemblé");
        let rgba = nie_render3d::render::render(&model, 0.6, RENDER3D_SIZE, RENDER3D_SIZE);
        assert_eq!(rgba.len(), (RENDER3D_SIZE * RENDER3D_SIZE * 4) as usize);
        // Pas une image vide/uniforme : `render::render` peint un dégradé de fond SOMBRE
        // (canaux ≤ ~24+26/28+30/40+34, cf. `crates/nie-render3d/src/render.rs::render`) — un
        // pixel de mesh (argile ~150-206 ou texture éclairée) dépasse largement ce plafond sur
        // ses 3 canaux. Même heuristique que le test unitaire `render_produit_des_pixels_de_mesh`
        // de `nie-render3d` lui-même — preuve qu'un vrai mesh a été rasterisé, pas un fond vide.
        let mesh_pixels = rgba.chunks_exact(4).filter(|p| p[0] > 80 && p[1] > 80 && p[2] > 80).count();
        assert!(mesh_pixels > 1000, "rendu quasi vide ({mesh_pixels} pixels de mesh) — mesh non rasterisé ?");

        let png = encode_png_rgba(&rgba, RENDER3D_SIZE, RENDER3D_SIZE).expect("encodage PNG");
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"), "signature PNG absente");
        assert!(png.len() > 5000, "PNG suspicieusement petit ({} octets) pour un vrai rendu 512x512", png.len());

        // Écrit le PNG en dur pour inspection visuelle (pas un fichier de test committé — juste
        // une preuve tangible que le rendu produit bien une image reconnaissable).
        let out = std::env::temp_dir().join("nie-explorer-test-glb-preview.png");
        std::fs::write(&out, &png).expect("écriture du PNG de contrôle");
        println!("PNG de contrôle écrit : {}", out.display());
    }

    /// Même vérification que ci-dessus, mais pour le chemin **CPK brut hors VFS**
    /// ([`assemble_glb_from_cpk_entries`]/`raw_cpk_glb_preview_png_b64`, gap §6 roadmap fermé
    /// 2026-08-08) : ouvre un vrai `.cpk` de `data/packs/` directement (pas via le VFS monté),
    /// résout les frères g4mg/g4tx par (dossier, basename) parmi les entrées du CPK, assemble et
    /// rend. Le même modèle (`c01000010`) que le test VFS ci-dessus, pour comparaison directe.
    #[test]
    fn raw_cpk_glb_preview_en_process_sur_un_vrai_pack() {
        let pack = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../data/packs/eaabb0359e96871a72ea9f86c5d3d10d.cpk");
        assert!(pack.is_file(), "pack introuvable ({}) — test réservé au poste avec le vrai jeu", pack.display());
        let data = std::fs::read(&pack).expect("lecture du CPK réel");
        let reader = CpkReader::new(&data, "eaabb0359e96871a72ea9f86c5d3d10d.cpk").expect("parsing du CPK réel");

        let entry = reader
            .entries
            .iter()
            .find(|e| e.filename.eq_ignore_ascii_case("c01000010.g4md"))
            .expect("c01000010.g4md doit être dans ce pack (même fixture que le test VFS ci-dessus)");

        let (stem, glb) = assemble_glb_from_cpk_entries(&data, &reader, entry).expect("assemblage GLB depuis le CPK brut");
        assert_eq!(stem, "c01000010");

        let model = nie_render3d::glb::parse(&glb).expect("parse du GLB assemblé (CPK brut)");
        let rgba = nie_render3d::render::render(&model, 0.6, RENDER3D_SIZE, RENDER3D_SIZE);
        let mesh_pixels = rgba.chunks_exact(4).filter(|p| p[0] > 80 && p[1] > 80 && p[2] > 80).count();
        assert!(mesh_pixels > 1000, "rendu CPK-brut quasi vide ({mesh_pixels} pixels de mesh)");

        let png = encode_png_rgba(&rgba, RENDER3D_SIZE, RENDER3D_SIZE).expect("encodage PNG");
        assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"), "signature PNG absente");
    }
}
