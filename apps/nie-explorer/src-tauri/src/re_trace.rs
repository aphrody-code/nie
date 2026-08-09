//! Lecture mémoire **live** du process `nie.exe`/`nie_eacpatched.exe` — façade IPC au-dessus de
//! `nie-trace` (RE en direct, cf. `crates/nie-trace/src/lib.rs`). Décision utilisatrice tranchée
//! (câblage explicitement demandé, cf. `apps/nie-explorer/ROADMAP.md` §4.3/§5) : RE single-player
//! offline d'un jeu possédé, cadrée par l'accord `RG-L5-VR-2026-001` (cf. `CLAUDE.md`).
//!
//! Surface **strictement lecture seule** : [`read`](nie_trace::read)/
//! [`find_pid_by_name`](nie_trace::find_pid_by_name)/[`module_regions`](nie_trace::module_regions)/
//! [`dump_regions`](nie_trace::dump_regions) — jamais [`nie_trace::write`] ni
//! [`nie_trace::patch_eac`] sur un process vivant (`patch_eac` opère sur une COPIE fichier hors
//! ligne, pas exposé ici). Aucune écriture mémoire dans un process tiers depuis cette app.

use base64::Engine as _;
use serde::Serialize;

/// Noms de process essayés dans l'ordre — le binaire patché EAC (lancé directement, cf.
/// `nie_trace::patch_eac`) d'abord, repli sur le nom d'origine (lancé via `EACLauncher.exe`, lecture
/// alors susceptible d'échouer — driver EAC kernel actif, cf. `win_memory.rs:48`).
const CANDIDATE_PROCESS_NAMES: [&str; 2] = ["nie_eacpatched.exe", "nie.exe"];

#[derive(Serialize, specta::Type)]
pub struct ReTraceProcessDto {
    pid: i32,
    process_name: String,
    /// Base du module principal en hexadécimal (`0x…`), `None` si non résolue (process trouvé
    /// mais `find_module_base` échoue — permissions insuffisantes p. ex.).
    module_base: Option<String>,
}

/// Cherche le process `nie.exe`/`nie_eacpatched.exe` en cours d'exécution. `None` si le jeu n'est
/// pas lancé — jamais d'attache silencieuse ni de retry en boucle.
#[tauri::command]
#[specta::specta]
pub fn re_trace_find_process() -> Option<ReTraceProcessDto> {
    for name in CANDIDATE_PROCESS_NAMES {
        if let Some(pid) = nie_trace::find_pid_by_name(name) {
            let module_base = nie_trace::find_module_base(pid, "nie").map(|b| format!("0x{b:x}"));
            return Some(ReTraceProcessDto { pid, process_name: name.to_string(), module_base });
        }
    }
    None
}

#[derive(Serialize, specta::Type)]
pub struct ReTraceRegionDto {
    start: String,
    end: String,
    size: u64,
    perms: String,
    path: String,
}

fn to_region_dto(m: &nie_trace::MapEntry) -> ReTraceRegionDto {
    ReTraceRegionDto {
        start: format!("0x{:x}", m.start),
        end: format!("0x{:x}", m.end),
        size: m.size(),
        perms: m.perms.clone(),
        path: m.path.clone(),
    }
}

/// Liste les plages mémoire du **module principal** (`nie`/`nie_eacpatched`) du process `pid` —
/// jamais tout l'espace d'adressage (autres DLL, tas non pertinent) : `module_regions(.., false)`
/// filtre déjà sur le module.
#[tauri::command]
#[specta::specta]
pub fn re_trace_module_regions(pid: i32) -> Result<Vec<ReTraceRegionDto>, String> {
    let regions = nie_trace::module_regions(pid, "nie", false);
    if regions.is_empty() {
        return Err("aucune plage lisible trouvée pour ce pid — process introuvable, permissions insuffisantes, ou EAC actif (relancer nie_eacpatched.exe directement)".into());
    }
    Ok(regions.iter().map(to_region_dto).collect())
}

/// Lit `len` octets à `addr` (hex `0x…` ou décimal) dans `pid`, encodés base64 — jamais plus de
/// 1 Mio par appel (évite un `Vec` géant sur une fausse manip côté UI).
#[tauri::command]
#[specta::specta]
pub fn re_trace_read_bytes_b64(pid: i32, addr: String, len: u32) -> Result<String, String> {
    const MAX_LEN: u32 = 1024 * 1024;
    if len == 0 || len > MAX_LEN {
        return Err(format!("longueur invalide (1..={MAX_LEN})"));
    }
    let addr = parse_addr(&addr)?;
    let bytes = nie_trace::read_exact(pid, addr, len as usize).map_err(|e| e.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn parse_addr(s: &str) -> Result<u64, String> {
    let s = s.trim();
    let (digits, radix) = s.strip_prefix("0x").or_else(|| s.strip_prefix("0X")).map_or((s, 10), |d| (d, 16));
    u64::from_str_radix(digits, radix).map_err(|e| format!("adresse invalide {s:?} : {e}"))
}

#[derive(Serialize, specta::Type)]
pub struct ReTraceDumpStatsDto {
    regions: u32,
    bytes: u64,
    /// Dossier de sortie réel (sous `BaseDirectory::AppData`, jamais dans le dossier du jeu —
    /// même convention que le workspace de mods, cf. `lib.rs`).
    out_dir: String,
}

/// Dumpe les plages lisibles du module principal vers `AppData/re-dumps/<pid>-<horodatage>/` —
/// jamais dans le dossier du jeu. Réutilise [`nie_trace::dump_regions`] tel quel (lecture seule,
/// une plage volatile/refusée est simplement sautée).
#[tauri::command]
#[specta::specta]
pub fn re_trace_dump_module(pid: i32, app: tauri::AppHandle) -> Result<ReTraceDumpStatsDto, String> {
    use tauri::Manager;
    let regions = nie_trace::module_regions(pid, "nie", false);
    if regions.is_empty() {
        return Err("aucune plage lisible trouvée pour ce pid".into());
    }
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or_default();
    let out_dir = base.join("re-dumps").join(format!("{pid}-{stamp}"));
    let stats = nie_trace::dump_regions(pid, &regions, &out_dir).map_err(|e| e.to_string())?;
    Ok(ReTraceDumpStatsDto {
        regions: stats.regions as u32,
        bytes: stats.bytes,
        out_dir: out_dir.display().to_string(),
    })
}
