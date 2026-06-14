//! `nie-trace` — RE **en direct** (runtime) d'`nie.exe` exécuté sous Wine sur Linux.
//!
//! Le binaire du jeu tourne sous Wine/Proton (le PE est chargé dans l'espace d'adressage
//! Linux du process — cf. [`wine_memory`]). Ce crate lit/scanne sa mémoire **sans le stopper**
//! via `process_vm_readv(2)`, pour valider au réel les structures C++ reversées statiquement
//! (offsets, vtables, clés, état de scène) — l'objectif pixel-perfect impose de vérifier que
//! les structs miroir Rust collent aux instances vivantes.
//!
//! ## Chaîne RE runtime (cf. `scripts/`)
//!
//! 1. [`patch_eac`] — neutralise la **modale fatale** d'init EAC sur une **copie**
//!    (`nie_eacpatched.exe`), pour que le boot headless *offline* ne meure pas dessus.
//!    Ne touche jamais l'original ; vérifie les 5 octets avant d'écrire.
//! 2. `scripts/boot-nie-direct.sh` — lance le `.exe` headless (Proton `runinprefix`, DXVK
//!    lavapipe, Xvfb). Le lanceur est **parent** du jeu → ancêtre → ptrace permis (yama=1).
//! 3. [`wine_memory`] — lit la mémoire live (`maps` / `base` / `read` / [`dump_regions`] /
//!    [`scan_regions`]).
//!
//! ## `unsafe`
//!
//! Seul crate de niers à appeler libc : `process_vm_readv`/`writev` sont des FFI. L'unsafe est
//! confiné à [`wine_memory::read`]/[`wine_memory::write`] (deux blocs, documentés `SAFETY`),
//! Linux-only ; tout le reste (`/proc`, patch, scan) est sûr. Ce crate n'a donc PAS
//! `#![forbid(unsafe_code)]`, contrairement au reste du workspace.

use std::fs;
use std::io::{Read, Seek, SeekFrom, Write as _};
use std::path::Path;

use thiserror::Error;

pub mod wine_memory;

pub use wine_memory::{
    MapEntry, WineMemoryError, find_module_base, find_module_base_in, find_module_regions,
    find_pid_by_comm, is_ancestor_of, likely_permitted, module_image_range, parse_map_line, read,
    read_exact, read_maps, read_ptrace_scope, read_u32, read_u64, write,
};

// ─── EAC patch (port de scripts/patch-eac.sh) ──────────────────────────────────────

/// File offset du `call` vers le constructeur de modale fatale (VA `0x14114ea02`,
/// image base `0x140000000`). NOP-er ces 5 octets rend l'échec d'init EAC headless non-fatal.
pub const EAC_PATCH_OFFSET: u64 = 0x0114_DE02;
/// Octets d'origine attendus : `call 0x140afa1a0` (`e8 99 b7 9a ff`). Garde-fou anti-mauvais-build.
pub const EAC_PATCH_ORIG: [u8; 5] = [0xE8, 0x99, 0xB7, 0x9A, 0xFF];
/// 5× `nop` — neutralise le call.
pub const EAC_PATCH_NOP: [u8; 5] = [0x90, 0x90, 0x90, 0x90, 0x90];

/// Erreur du patch EAC.
#[derive(Debug, Error)]
pub enum EacPatchError {
    #[error("E/S sur le patch EAC : {0}")]
    Io(#[from] std::io::Error),
    #[error(
        "octets @0x{offset:X} = {got}, attendu {want} — build de nie.exe différent, abandon"
    )]
    Mismatch { offset: u64, got: String, want: String },
}

/// Compte-rendu d'un patch EAC réussi.
#[derive(Debug, Clone)]
pub struct EacPatchReport {
    pub offset: u64,
    pub original: [u8; 5],
    pub patched: [u8; 5],
    pub dst_len: u64,
}

/// Crée `dst` comme **copie** de `src` puis NOP le `call` de modale fatale EAC @
/// [`EAC_PATCH_OFFSET`]. Vérifie que les 5 octets valent [`EAC_PATCH_ORIG`] avant d'écrire
/// (sinon [`EacPatchError::Mismatch`]). **Ne touche jamais `src`**.
///
/// Équivalent natif de `scripts/patch-eac.sh` ; opère sur une copie dans le dossier du jeu pour
/// que les DLL voisines (Goldberg `steam_api64`, proxy EOSSDK) se résolvent.
pub fn patch_eac(src: &Path, dst: &Path) -> Result<EacPatchReport, EacPatchError> {
    fs::copy(src, dst)?;
    let mut f = fs::OpenOptions::new().read(true).write(true).open(dst)?;

    f.seek(SeekFrom::Start(EAC_PATCH_OFFSET))?;
    let mut got = [0u8; 5];
    f.read_exact(&mut got)?;
    if got != EAC_PATCH_ORIG {
        return Err(EacPatchError::Mismatch {
            offset: EAC_PATCH_OFFSET,
            got: hex5(&got),
            want: hex5(&EAC_PATCH_ORIG),
        });
    }

    f.seek(SeekFrom::Start(EAC_PATCH_OFFSET))?;
    f.write_all(&EAC_PATCH_NOP)?;
    f.flush()?;
    let dst_len = f.metadata()?.len();

    Ok(EacPatchReport {
        offset: EAC_PATCH_OFFSET,
        original: EAC_PATCH_ORIG,
        patched: EAC_PATCH_NOP,
        dst_len,
    })
}

fn hex5(b: &[u8; 5]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

// ─── Dump / scan de plages (capacités « dumper la mémoire ») ───────────────────────

/// Un hit de [`scan_regions`].
#[derive(Debug, Clone)]
pub struct ScanHit {
    pub addr: u64,
    pub perms: String,
    /// RVA module-relative si une base est connue et `addr >= base`.
    pub rva: Option<u64>,
}

/// Résultat de [`dump_regions`].
#[derive(Debug, Clone, Copy, Default)]
pub struct DumpStats {
    pub regions: usize,
    pub bytes: u64,
}

/// Dumpe les plages **lisibles** de `regions` (du process `pid`) vers `out_dir`, un fichier
/// `<start>-<end>.bin` par plage. Saute silencieusement les plages volatiles/refusées.
pub fn dump_regions(
    pid: i32,
    regions: &[MapEntry],
    out_dir: &Path,
) -> std::io::Result<DumpStats> {
    fs::create_dir_all(out_dir)?;
    let mut stats = DumpStats::default();
    for m in regions {
        if !m.is_readable() || m.size() == 0 {
            continue;
        }
        let mut buf = vec![0u8; m.size() as usize];
        let got = match read(pid, m.start, &mut buf) {
            Ok(n) if n > 0 => n,
            _ => continue, // plage volatile/refusée : on saute
        };
        let name = format!("{:012x}-{:012x}.bin", m.start, m.end);
        fs::write(out_dir.join(name), &buf[..got])?;
        stats.regions += 1;
        stats.bytes += got as u64;
    }
    Ok(stats)
}

/// Cherche `needle` dans les plages **lisibles** de `regions`, jusqu'à `limit` hits.
/// `base` (optionnel) sert à calculer la RVA module-relative de chaque hit.
pub fn scan_regions(
    pid: i32,
    regions: &[MapEntry],
    base: Option<u64>,
    needle: &[u8],
    limit: usize,
) -> Vec<ScanHit> {
    let mut hits = Vec::new();
    if needle.is_empty() {
        return hits;
    }
    for m in regions {
        if hits.len() >= limit || !m.is_readable() || m.size() == 0 {
            continue;
        }
        let mut buf = vec![0u8; m.size() as usize];
        let got = match read(pid, m.start, &mut buf) {
            Ok(n) if n > 0 => n,
            _ => continue,
        };
        let span = &buf[..got];
        let mut from = 0usize;
        while hits.len() < limit {
            let Some(idx) = find_subslice(&span[from..], needle) else { break };
            let at = m.start + (from + idx) as u64;
            let rva = base.filter(|&b| at >= b).map(|b| at - b);
            hits.push(ScanHit { addr: at, perms: m.perms.clone(), rva });
            from += idx + 1;
        }
    }
    hits
}

/// Première occurrence de `needle` dans `hay` (recherche naïve ; suffisant pour des plages
/// de quelques Mo et un motif court).
fn find_subslice(hay: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > hay.len() {
        return None;
    }
    hay.windows(needle.len()).position(|w| w == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eac_constants_are_self_consistent() {
        assert_eq!(EAC_PATCH_OFFSET, 0x0114_DE02);
        assert_eq!(hex5(&EAC_PATCH_ORIG), "e899b79aff");
        assert_eq!(hex5(&EAC_PATCH_NOP), "9090909090");
    }

    #[test]
    fn patch_eac_nops_only_when_bytes_match() {
        let dir = std::env::temp_dir().join(format!("nie-trace-eac-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let src = dir.join("src.bin");
        let dst = dir.join("dst.bin");

        // Faux binaire : assez grand pour contenir l'offset EAC (0x114DE02 ≈ 18 Mo),
        // rempli de 0x00, avec le `call` original posé à l'offset.
        let size = EAC_PATCH_OFFSET as usize + 0x1000;
        let mut data = vec![0u8; size];
        data[EAC_PATCH_OFFSET as usize..EAC_PATCH_OFFSET as usize + 5]
            .copy_from_slice(&EAC_PATCH_ORIG);
        fs::write(&src, &data).unwrap();

        let report = patch_eac(&src, &dst).expect("patch ok");
        assert_eq!(report.original, EAC_PATCH_ORIG);
        assert_eq!(report.patched, EAC_PATCH_NOP);

        // src intact, dst patché.
        let src_after = fs::read(&src).unwrap();
        assert_eq!(&src_after[EAC_PATCH_OFFSET as usize..EAC_PATCH_OFFSET as usize + 5], &EAC_PATCH_ORIG);
        let dst_after = fs::read(&dst).unwrap();
        assert_eq!(&dst_after[EAC_PATCH_OFFSET as usize..EAC_PATCH_OFFSET as usize + 5], &EAC_PATCH_NOP);

        // Octets différents → Mismatch, et on n'a pas écrasé src.
        let bad_src = dir.join("bad.bin");
        let bad_dst = dir.join("bad_dst.bin");
        let mut bad = vec![0u8; size];
        bad[EAC_PATCH_OFFSET as usize] = 0xCC; // pas le call attendu
        fs::write(&bad_src, &bad).unwrap();
        assert!(matches!(patch_eac(&bad_src, &bad_dst), Err(EacPatchError::Mismatch { .. })));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_finds_pattern_with_rva() {
        // Pas de process réel : on teste find_subslice (cœur du scan).
        let hay = b"....DEADBEEF....DEADBEEF";
        assert_eq!(find_subslice(hay, b"DEAD"), Some(4));
        // 2e "DEAD" @ index absolu 16 → dans hay[5..] : 16 - 5 = 11.
        assert_eq!(find_subslice(&hay[5..], b"DEAD"), Some(11));
        assert_eq!(find_subslice(hay, b"ZZZZ"), None);
        assert_eq!(find_subslice(b"ab", b"abc"), None);
    }
}
