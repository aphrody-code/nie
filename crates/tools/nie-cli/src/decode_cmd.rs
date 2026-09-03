//! `niers decode` (fichier ou arborescence → JSON / PNG) et `niers format` (détection seule).
//!
//! Le dispatch de format n'est pas réimplémenté ici : il vient de
//! [`nie_formats::decode`], partagé avec la FFI. Le parallélisme vient de rayon.

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
/// G4TX passe par le décodeur de textures (PNG) ; tout le reste par le dispatch JSON. `basename`
/// (le nom du fichier source sans extension) départage les conteneurs multi-textures — sans lui,
/// un `icon_item05.g4tx` rendrait une de ses 80 icônes au hasard.
fn decode_bytes(data: &[u8], basename: &str, as_png: bool) -> Option<(Vec<u8>, &'static str, &'static str)> {
    if as_png {
        return nie_formats::g4tx_decode::decode_best_to_png(data, basename)
            .map(|png| (png, "png", "g4tx"));
    }
    // Le bytecode Lua 5.2 (`\x1bLua`, les 1 197 `.lua.bin` du jeu) n'a plus de branche ici :
    // `nie-formats` dépend désormais de `nie-lua` (feature `lua`) et le route lui-même, donc la
    // FFI et le MCP le décodent aussi. Une seule table de dispatch, comme le dit l'en-tête.
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

    let basename = src.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
    let Some((bytes, ext, format)) = decode_bytes(&data, basename, as_png) else {
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
        let basename = p.file_stem().and_then(|s| s.to_str()).unwrap_or_default();
        let Some((bytes, ext, _format)) = decode_bytes(&data, basename, as_png) else {
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

/// Liste récursivement les `*.cfg.bin` d'un répertoire (famille RDBN/T2B uniquement — les
/// textures/lua n'ont pas de forme « iecode »).
fn collect_cfg_bin(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = fs::read_dir(dir) else {
        return out;
    };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(collect_cfg_bin(&p));
        } else if p.to_string_lossy().ends_with(".cfg.bin") {
            out.push(p);
        }
    }
    out
}

/// Régénère, à côté de chaque `*.cfg.bin` sous `dir`, le `*.cfg.bin.json` en forme **iecode**
/// (`nie_formats::cfgbin::to_iecode_json` — RDBN `{lists}` / T2B `{entries}`) : c'est la forme
/// que lisent les parseurs typés de `nie-data` (golden tests, `export_*`), à distinguer du JSON
/// structurel brut que rend `niers decode` sans `--typed`.
///
/// `force=false` saute un `.json` déjà plus récent que son `.cfg.bin` (même convention que
/// `IECODE.Core/Dump/DataPathExporter.cs`, pour rester idempotent sur un corpus déjà à jour).
///
/// # Erreurs
/// Si `dir` ne contient aucun `.cfg.bin`.
pub fn refresh_typed(dir: &Path, force: bool, quiet: bool) -> anyhow::Result<()> {
    let files = collect_cfg_bin(dir);
    if files.is_empty() {
        bail!("aucun .cfg.bin sous {}", dir.display());
    }
    let ok = AtomicUsize::new(0);
    let skipped_fresh = AtomicUsize::new(0);
    let skipped_unparsed = AtomicUsize::new(0);

    files.par_iter().for_each(|p| {
        let dest = {
            let mut s = p.as_os_str().to_owned();
            s.push(".json");
            PathBuf::from(s)
        };
        if !force
            && let (Ok(src_meta), Ok(dst_meta)) = (fs::metadata(p), fs::metadata(&dest))
            && let (Ok(src_t), Ok(dst_t)) = (src_meta.modified(), dst_meta.modified())
            && dst_t >= src_t
        {
            skipped_fresh.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let Ok(data) = fs::read(p) else {
            skipped_unparsed.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let Some(json) = nie_formats::cfgbin::to_iecode_json(&data) else {
            skipped_unparsed.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let Ok(bytes) = serde_json::to_vec(&json) else {
            skipped_unparsed.fetch_add(1, Ordering::Relaxed);
            return;
        };
        if fs::write(&dest, &bytes).is_ok() {
            ok.fetch_add(1, Ordering::Relaxed);
        } else {
            skipped_unparsed.fetch_add(1, Ordering::Relaxed);
        }
    });

    if !quiet {
        println!(
            "refresh-typed={} total={} ok={} skipped_fresh={} skipped_unparsed={}",
            dir.display(),
            files.len(),
            ok.load(Ordering::Relaxed),
            skipped_fresh.load(Ordering::Relaxed),
            skipped_unparsed.load(Ordering::Relaxed)
        );
    }
    Ok(())
}

/// Rapporte le format d'un fichier ou de chaque fichier d'une arborescence, sans rien écrire.
///
/// Deux colonnes distinctes : `detect` = ce que dit le magic, `decode` = le parseur qui réussit
/// réellement. Elles divergent sur les conteneurs T2B, que la détection range tous en `inconnu`.
///
/// # Erreurs
/// Si la source est illisible ou si un répertoire ne contient aucun fichier décodable.
pub fn format(src: &Path) -> anyhow::Result<()> {
    let files = if src.is_dir() {
        let f = collect(src);
        if f.is_empty() {
            bail!("aucun fichier décodable sous {}", src.display());
        }
        f
    } else {
        vec![src.to_path_buf()]
    };

    for p in &files {
        let data = fs::read(p).with_context(|| format!("lecture de {}", p.display()))?;
        let detect = nie_formats::decode::format_name(&data);
        let decode = nie_formats::decode::decode(&data).map_or("-", |d| d.format);
        println!(
            "path={} detect={} decode={} bytes={}",
            p.display(),
            detect,
            decode,
            data.len()
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
        assert!(decode_bytes(&[0xAB; 64], "bruit", false).is_none());
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
