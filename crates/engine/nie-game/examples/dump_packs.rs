//! Dump exhaustif **tree-preserving** de tous les assets du VFS CPK vers un répertoire,
//! en préservant l'arborescence interne (`directory/filename`) telle que le jeu la voit.
//!
//! Pilotage **par l'index VFS** (= `cpk_list.cfg.bin` déchiffré) : on n'écrit donc que la
//! vue **dédupliquée** base+patch (dernier gagnant, exactement comme `Vfs::read`), pas les
//! doublons écrasés des CPK base. Chaque CPK n'est ouvert **qu'une fois** (groupage par
//! `cpk_filename`), accédé en **mmap** (RAM bornée — le page-cache OS exploite toute la
//! RAM dispo sans jamais charger 57 Gio d'un bloc), extrait/déchiffré/décompressé via
//! `CpkReader::extract`, puis écrit en `<out>/<chemin_interne>`.
//!
//! Parallélisme : **rayon, 1 worker par CPK**. Pas de parallélisme *intra*-CPK : le
//! déchiffrement (XOR-CRC32 position-aware) et la décompression CRILAYLA (LZ) sont
//! séquentiels par fichier.
//!
//! **GPU : volontairement INUTILISÉ.** Le pipeline d'extraction est 100 % CPU-bound
//! séquentiel par fichier (chiffrement par blocs dépendant de l'offset + LZ à fenêtre
//! glissante) : aucune parallélisation GPU n'est possible (latence d'aller-retour >
//! débit utile). Le seul parallélisme exploitable est CPU (rayon) + I/O (mmap + page-cache).
//!
//! Reprise : un fichier déjà présent **avec la bonne taille décompressée** est ignoré
//! (skip), donc relancer après interruption ne refait que le manquant. Écriture
//! atomique (`.tmp` + rename) → jamais de fichier partiel qui passerait le skip.
//!
//! Garde-fou disque : pré-vol (estimation arrondie au bloc 4 Kio vs espace libre −
//! marge) puis re-vérification périodique en cours de run (abort propre sous le seuil).
//!
//! Usage :
//! ```text
//! NIE_GAME_DIR=/home/aphrody/niers \
//!   cargo run -p nie-game --release --example dump_packs -- --out /home/aphrody/niers/data
//! ```
//! Flags : `--out <DIR>` (défaut `<game_dir>/data`), `--filter <PREFIXE>` (répétable),
//! `--jobs <N>`, `--limit <N>` (échantillon), `--dry-run`, `--force`, `--reserve-gib <N>`.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::time::Instant;

use anyhow::{Context, Result, bail};
use clap::Parser;
use memmap2::Mmap;
use rayon::prelude::*;

use nie_formats::cpk::{CpkEntry, CpkReader};
use nie_formats::vfs::Vfs;

/// Installation Steam par défaut si `NIE_GAME_DIR` n'est pas posé.
const GAME_DIR_DEFAUT: &str =
    "/mnt/c/Program Files (x86)/Steam/steamapps/common/INAZUMA ELEVEN Victory Road";

/// Taille de bloc FS pour l'estimation pessimiste du slack disque.
const BLOCK: u64 = 4096;

#[derive(Parser)]
#[command(about = "Dump exhaustif tree-preserving des packs CPK (parallèle, mmap, résumable)")]
struct Cli {
    /// Répertoire de sortie (défaut : <game_dir>/data — dump directement dans l'arbo `data/`).
    #[arg(long)]
    out: Option<PathBuf>,
    /// Ne dumpe que les chemins internes commençant par ce préfixe (répétable).
    #[arg(long)]
    filter: Vec<String>,
    /// Nombre de threads rayon (défaut : tous les cœurs).
    #[arg(long)]
    jobs: Option<usize>,
    /// N'extrait que les N premiers fichiers (échantillon / vérification).
    #[arg(long)]
    limit: Option<usize>,
    /// Liste le travail sans rien écrire.
    #[arg(long)]
    dry_run: bool,
    /// Réécrit même si la sortie existe déjà avec la bonne taille.
    #[arg(long)]
    force: bool,
    /// Marge d'espace disque libre à préserver, en Gio (défaut : 10).
    #[arg(long, default_value = "10")]
    reserve_gib: u64,
}

/// Répertoire racine du jeu : `NIE_GAME_DIR` sinon fallback Steam.
fn game_dir() -> PathBuf {
    std::env::var("NIE_GAME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(GAME_DIR_DEFAUT))
}

/// Espace disque libre (octets) pour le système de fichiers contenant `p`, via `statvfs(3)`.
///
/// Unix seulement : `statvfs` et `OsStrExt::as_bytes` n'existent pas sous Windows, où
/// l'exemple ne compilait donc pas du tout (`cargo clippy --workspace --all-targets`
/// échouait sur la machine de dev). La variante Windows renonce à la mesure — le seul
/// appelant s'en sert pour un avertissement d'espace disque, pas pour décider.
#[cfg(unix)]
fn avail_bytes(p: &Path) -> Option<u64> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    // Remonter au premier ancêtre existant (le répertoire de sortie peut ne pas exister).
    let mut probe = p;
    while !probe.exists() {
        probe = probe.parent()?;
    }
    let c = CString::new(probe.as_os_str().as_bytes()).ok()?;
    // SAFETY : `c` est un chemin C valide NUL-terminé ; `s` est zéro-initialisé puis rempli
    // par statvfs ; on ne lit `s` que si l'appel retourne 0.
    unsafe {
        let mut s: libc::statvfs = std::mem::zeroed();
        if libc::statvfs(c.as_ptr(), &mut s) == 0 {
            Some(s.f_bavail as u64 * s.f_frsize as u64)
        } else {
            None
        }
    }
}

/// Espace disque libre : non mesuré hors Unix (cf. la variante `#[cfg(unix)]`).
#[cfg(not(unix))]
fn avail_bytes(_p: &Path) -> Option<u64> {
    None
}

/// Convertit un chemin interne VFS en `PathBuf` relatif sûr (rejette `..`, racine absolue,
/// composants vides). Normalise les backslashes éventuels en `/`.
fn safe_relpath(internal: &str) -> Option<PathBuf> {
    let mut out = PathBuf::new();
    for comp in internal.replace('\\', "/").split('/') {
        match comp {
            "" | "." => continue,
            ".." => return None,
            c => out.push(c),
        }
    }
    if out.as_os_str().is_empty() {
        None
    } else {
        Some(out)
    }
}

/// Taille de sortie attendue (décompressée) d'une entrée CPK.
fn expected_len(e: &CpkEntry) -> u64 {
    if e.is_compressed {
        e.extract_size
    } else {
        e.size
    }
}

/// Compteurs partagés du run.
#[derive(Default)]
struct Stats {
    written: AtomicUsize,
    skipped: AtomicUsize,
    missing: AtomicUsize,
    errors: AtomicUsize,
    bytes: AtomicU64,
    progressed: AtomicUsize,
}

fn main() -> Result<()> {
    let cli = Cli::parse();
    let game = game_dir();
    let data_dir = game.join("data");
    let out_dir = cli.out.clone().unwrap_or_else(|| data_dir.clone());

    if let Some(n) = cli.jobs {
        rayon::ThreadPoolBuilder::new()
            .num_threads(n)
            .build_global()
            .ok();
    }

    eprintln!("→ montage VFS depuis {}", data_dir.display());
    let mut vfs = Vfs::new();
    vfs.init(&data_dir)
        .context("VFS init échoué (cpk_list.cfg.bin introuvable/illisible)")?;
    eprintln!(
        "  {} fichiers logiques, {} CPK uniques",
        vfs.asset_count(),
        vfs.cpk_count()
    );

    // Groupage par CPK (chaque CPK ouvert une seule fois), filtré par préfixe, dédupliqué
    // par l'index VFS (dernier gagnant). On collecte en propriétaire pour traverser rayon.
    let mut by_cpk: HashMap<String, Vec<(String, u32)>> = HashMap::new();
    let mut total = 0usize;
    for (path, entry) in vfs.iter() {
        if !cli.filter.is_empty() && !cli.filter.iter().any(|p| path.starts_with(p.as_str())) {
            continue;
        }
        by_cpk
            .entry(entry.cpk_filename.clone())
            .or_default()
            .push((path.to_string(), entry.file_size));
        total += 1;
    }

    // --limit : tronque le travail (échantillon déterministe par tri des chemins).
    if let Some(lim) = cli.limit {
        let mut flat: Vec<(String, String, u32)> = by_cpk
            .iter()
            .flat_map(|(cpk, v)| v.iter().map(move |(p, s)| (cpk.clone(), p.clone(), *s)))
            .collect();
        flat.sort();
        flat.truncate(lim);
        by_cpk.clear();
        for (cpk, p, s) in flat {
            by_cpk.entry(cpk).or_default().push((p, s));
        }
        total = by_cpk.values().map(Vec::len).sum();
    }

    eprintln!(
        "→ {} fichiers à traiter répartis sur {} CPK (filtre: {:?})",
        total,
        by_cpk.len(),
        cli.filter
    );

    // Pré-vol disque : estimation pessimiste (somme des tailles arrondies au bloc 4 Kio).
    let est: u64 = by_cpk
        .values()
        .flat_map(|v| v.iter())
        .map(|(_, s)| (*s as u64).div_ceil(BLOCK) * BLOCK)
        .sum();
    let reserve = cli.reserve_gib * (1 << 30);
    if let Some(free) = avail_bytes(&out_dir) {
        eprintln!(
            "→ disque : ~{:.1} Gio à écrire, {:.1} Gio libres (marge {} Gio)",
            est as f64 / 1e9,
            free as f64 / 1e9,
            cli.reserve_gib
        );
        if !cli.dry_run && est + reserve > free {
            bail!(
                "espace disque insuffisant : besoin ~{:.1} Gio + {} Gio de marge > {:.1} Gio libres",
                est as f64 / 1e9,
                cli.reserve_gib,
                free as f64 / 1e9
            );
        }
    }

    if cli.dry_run {
        eprintln!("→ dry-run : aucune écriture.");
        return Ok(());
    }

    let packs_dir = data_dir.join("packs");
    let stats = Stats::default();
    let abort = AtomicBool::new(false);
    let start = Instant::now();

    // 1 worker rayon par CPK. mmap read-only → CpkReader → extract → écriture atomique.
    by_cpk.par_iter().for_each(|(cpk, wanted)| {
        if abort.load(Ordering::Relaxed) {
            return;
        }
        if let Err(e) = process_cpk(
            &packs_dir, cpk, wanted, &out_dir, cli.force, &stats, &abort, reserve,
        ) {
            stats.errors.fetch_add(wanted.len(), Ordering::Relaxed);
            eprintln!("⚠ CPK {cpk}: {e:#}");
        }
    });

    let secs = start.elapsed().as_secs_f64();
    let w = stats.written.load(Ordering::Relaxed);
    let sk = stats.skipped.load(Ordering::Relaxed);
    let mi = stats.missing.load(Ordering::Relaxed);
    let er = stats.errors.load(Ordering::Relaxed);
    let by = stats.bytes.load(Ordering::Relaxed);
    eprintln!(
        "✓ terminé en {secs:.1}s — écrits {w}, ignorés {sk}, manquants {mi}, erreurs {er} ; {:.2} Gio ({:.0} Mio/s)",
        by as f64 / 1e9,
        if secs > 0.0 {
            by as f64 / 1e6 / secs
        } else {
            0.0
        }
    );
    if abort.load(Ordering::Relaxed) {
        bail!(
            "interrompu par le garde-fou disque (relancer libérera l'espace ou réduire la marge)"
        );
    }
    Ok(())
}

/// Traite un CPK complet : mmap → parse TOC → extrait chaque fichier voulu → écrit.
#[allow(clippy::too_many_arguments)]
fn process_cpk(
    packs_dir: &Path,
    cpk: &str,
    wanted: &[(String, u32)],
    out_dir: &Path,
    force: bool,
    stats: &Stats,
    abort: &AtomicBool,
    reserve: u64,
) -> Result<()> {
    // L'index VFS référence parfois un `cpk_filename` vide ou un pack absent de `packs/`
    // (1 entrée fantôme sur les builds Steam courants) : ce ne sont pas des erreurs
    // d'extraction → on compte ces fichiers comme « manquants » avec un seul avertissement.
    if cpk.is_empty() || !packs_dir.join(cpk).is_file() {
        stats.missing.fetch_add(wanted.len(), Ordering::Relaxed);
        eprintln!(
            "⚠ CPK absent/sans nom — {} fichier(s) ignoré(s) : {cpk:?}",
            wanted.len()
        );
        return Ok(());
    }

    let cpk_path = packs_dir.join(cpk);
    let file =
        File::open(&cpk_path).with_context(|| format!("ouverture {}", cpk_path.display()))?;
    // SAFETY : mmap read-only d'un fichier ouvert ; pas de mutation, pas d'aliasing &mut.
    let mmap =
        unsafe { Mmap::map(&file) }.with_context(|| format!("mmap {}", cpk_path.display()))?;

    let reader = CpkReader::new(&mmap, cpk).with_context(|| format!("parse CPK {cpk}"))?;

    // Index full_path → entrée pour résolution O(1) (repli basename pour les rares écarts
    // de casse/chemin, comme `Vfs::read`).
    let full = |e: &CpkEntry| format!("{}/{}", e.directory, e.filename);
    let mut by_full: HashMap<String, &CpkEntry> = HashMap::with_capacity(reader.entries.len());
    let mut by_base: HashMap<&str, &CpkEntry> = HashMap::with_capacity(reader.entries.len());
    for e in &reader.entries {
        by_full.insert(full(e), e);
        by_base.entry(e.filename.as_str()).or_insert(e);
    }

    for (internal, _vfs_size) in wanted {
        if abort.load(Ordering::Relaxed) {
            return Ok(());
        }
        let base = internal.rsplit('/').next().unwrap_or(internal);
        let entry = by_full
            .get(internal.as_str())
            .copied()
            .or_else(|| by_base.get(base).copied());
        let entry = match entry {
            Some(e) => e,
            None => {
                stats.missing.fetch_add(1, Ordering::Relaxed);
                continue;
            }
        };

        let Some(rel) = safe_relpath(internal) else {
            stats.errors.fetch_add(1, Ordering::Relaxed);
            eprintln!("⚠ chemin non sûr ignoré : {internal}");
            continue;
        };
        let out_path = out_dir.join(&rel);

        // Skip si déjà présent avec la bonne taille décompressée (reprise).
        let want_len = expected_len(entry);
        if !force
            && let Ok(meta) = fs::metadata(&out_path)
            && meta.len() == want_len
        {
            stats.skipped.fetch_add(1, Ordering::Relaxed);
            continue;
        }

        let data = match reader.extract(&mmap, entry) {
            Ok(d) => d,
            Err(e) => {
                stats.errors.fetch_add(1, Ordering::Relaxed);
                eprintln!("⚠ extract {internal}: {e:#}");
                continue;
            }
        };

        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).with_context(|| format!("mkdir {}", parent.display()))?;
        }
        // Écriture atomique : .tmp puis rename (jamais de partiel qui passe le skip).
        let tmp = out_path.with_extension("nie-dump-tmp");
        {
            let f = File::create(&tmp).with_context(|| format!("création {}", tmp.display()))?;
            let mut bw = BufWriter::new(f);
            bw.write_all(&data)
                .with_context(|| format!("écriture {}", tmp.display()))?;
            bw.flush().ok();
        }
        fs::rename(&tmp, &out_path).with_context(|| format!("rename → {}", out_path.display()))?;

        stats.written.fetch_add(1, Ordering::Relaxed);
        stats.bytes.fetch_add(data.len() as u64, Ordering::Relaxed);

        // Progression + re-vérification disque périodique (1 thread à la fois, léger).
        let n = stats.progressed.fetch_add(1, Ordering::Relaxed) + 1;
        if n.is_multiple_of(5000) {
            let by = stats.bytes.load(Ordering::Relaxed);
            eprintln!("  … {n} fichiers écrits ({:.1} Gio)", by as f64 / 1e9);
        }
        if n.is_multiple_of(2048)
            && let Some(free) = avail_bytes(out_dir)
            && free < reserve
        {
            abort.store(true, Ordering::Relaxed);
            eprintln!(
                "⚠ garde-fou disque : {:.1} Gio libres < marge {:.1} Gio — arrêt.",
                free as f64 / 1e9,
                reserve as f64 / 1e9
            );
            return Ok(());
        }
    }
    Ok(())
}
