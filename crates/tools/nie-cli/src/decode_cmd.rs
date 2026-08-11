//! `niers decode` — décodage d'un fichier ou d'une arborescence vers JSON / PNG.
//!
//! Doctrine (`docs/ARCHITECTURE-POLYGLOTTE.md`) : la CLI est un rôle Rust. Cette commande
//! remplace deux chemins qui faisaient la même chose ailleurs :
//! - `apps/nie-decode` (Bun) — décodage en lot via la FFI, avec ses propres workers ;
//! - `iecode convert` / `iecode format` (C++), atteignables via `niers cpp`.
//!
//! Le dispatch de format n'est pas réimplémenté ici : il vient de
//! [`nie_formats::decode::to_json`], partagé avec la FFI. Le parallélisme vient de rayon.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use anyhow::{Context, bail};
use rayon::prelude::*;

/// Extensions décodées vers JSON.
const EXT_JSON: &[&str] = &[
    "bin", "objbin", "g4pkm", "lip", "p3lip", "mev", "mevbin", "g4md", "g4pk", "cfg",
];
/// Extensions décodées vers PNG.
const EXT_PNG: &[&str] = &["g4tx"];

/// Décode un tampon : rend `(octets, extension de sortie)`.
///
/// G4TX passe par le décodeur de textures (PNG) ; tout le reste par le dispatch JSON.
fn decode_bytes(data: &[u8], as_png: bool) -> Option<(Vec<u8>, &'static str, &'static str)> {
    if as_png {
        return nie_formats::g4tx_decode::decode_best_to_png(data).map(|png| (png, "png", "g4tx"));
    }
    nie_formats::decode::decode(data).map(|d| (d.json, "json", d.format))
}

/// Décode un fichier unique vers `out` (ou à côté de la source si `out` est un répertoire).
///
/// # Erreurs
/// Lecture impossible, format non reconnu, écriture impossible.
pub fn file(src: &Path, out: Option<&Path>, quiet: bool) -> anyhow::Result<()> {
    let data = fs::read(src).with_context(|| format!("lecture de {}", src.display()))?;
    let as_png = src
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| EXT_PNG.contains(&e.to_ascii_lowercase().as_str()));

    let Some((bytes, ext, format)) = decode_bytes(&data, as_png) else {
        bail!(
            "format non décodé : {} ({})",
            src.display(),
            nie_formats::decode::format_name(&data)
        );
    };

    let dest = match out {
        Some(p) if p.is_dir() => p.join(src.file_name().unwrap_or_default()).with_extension(ext),
        Some(p) => p.to_path_buf(),
        None => src.with_extension(ext),
    };
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(&dest, &bytes).with_context(|| format!("écriture de {}", dest.display()))?;
    if !quiet {
        println!(
            "decode={} format={} out={} bytes={}",
            src.display(),
            format,
            dest.display(),
            bytes.len()
        );
    }
    Ok(())
}

/// Liste récursivement les fichiers décodables d'un répertoire.
fn collect(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(collect(&p));
        } else if let Some(ext) = p.extension().and_then(|e| e.to_str()) {
            let ext = ext.to_ascii_lowercase();
            if EXT_JSON.contains(&ext.as_str()) || EXT_PNG.contains(&ext.as_str()) {
                out.push(p);
            }
        }
    }
    out
}

/// Décode récursivement un répertoire vers `out`, en parallèle (rayon).
///
/// L'arborescence source est préservée sous `out`. Les fichiers dont le format n'est pas
/// reconnu sont comptés, pas fatals : un dump complet contient toujours des inconnus.
///
/// # Erreurs
/// Si la source n'est pas lisible.
pub fn dir(src: &Path, out: &Path, quiet: bool) -> anyhow::Result<()> {
    let files = collect(src);
    if files.is_empty() {
        bail!("aucun fichier décodable sous {}", src.display());
    }
    let ok = AtomicUsize::new(0);
    let skipped = AtomicUsize::new(0);

    files.par_iter().for_each(|p| {
        let Ok(data) = fs::read(p) else {
            skipped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let as_png = p
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| EXT_PNG.contains(&e.to_ascii_lowercase().as_str()));
        let Some((bytes, ext, _format)) = decode_bytes(&data, as_png) else {
            skipped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let rel = p.strip_prefix(src).unwrap_or(p);
        let dest = out.join(rel).with_extension(ext);
        if let Some(parent) = dest.parent() {
            fs::create_dir_all(parent).ok();
        }
        if fs::write(&dest, &bytes).is_ok() {
            ok.fetch_add(1, Ordering::Relaxed);
        } else {
            skipped.fetch_add(1, Ordering::Relaxed);
        }
    });

    if !quiet {
        println!(
            "decode-dir={} out={} ok={} skipped={} total={}",
            src.display(),
            out.display(),
            ok.load(Ordering::Relaxed),
            skipped.load(Ordering::Relaxed),
            files.len()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn les_extensions_png_et_json_sont_disjointes() {
        // Un même suffixe dans les deux listes rendrait la sortie non déterministe.
        for e in EXT_PNG {
            assert!(!EXT_JSON.contains(e), "{e} est dans les deux listes");
        }
    }

    #[test]
    fn un_tampon_de_bruit_n_est_pas_decode() {
        assert!(decode_bytes(&[0xAB; 64], false).is_none());
    }

    #[test]
    fn collect_ignore_les_extensions_inconnues() {
        let dir = std::env::temp_dir().join("niers-decode-test");
        let _ = fs::create_dir_all(&dir);
        let _ = fs::write(dir.join("a.txt"), b"x");
        assert!(collect(&dir).iter().all(|p| p.extension().is_some()));
        assert!(!collect(&dir).iter().any(|p| p.ends_with("a.txt")));
    }
}
