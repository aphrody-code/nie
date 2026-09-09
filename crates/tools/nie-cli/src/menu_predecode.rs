//! Pré-décodage des sprites menu IEVR : g4tx -> DDS -> RGBA -> PNG écrit dans le dump disque.
//!
//! # Fonctionnement
//!
//! Pour chaque chemin g4tx du sous-arbre `data/dx11/menu/**` indexé dans Redis db3
//! (`iev:file:index`), on :
//!
//! 1. Lit le fichier depuis le CPK (via `CpkReader` + index Redis).
//! 2. Parse le conteneur G4TX pour extraire le payload DDS.
//! 3. Décode le DDS (BC1/BC3/BC7/RGBA8) en RGBA via `image_dds`.
//! 4. Encode en PNG et écrit à `<dump_root>/<chemin relatif sans data/>.png` (idempotent).
//!
//! The CLI scans every indexed menu texture, covering localized and base variants.
//!
//! Concurrence : pool Rayon (threads = nb CPUs, saturé sur les décodages BCn).

#![allow(clippy::pedantic)]

use std::{
    collections::HashMap,
    io::Cursor,
    path::Path,
    sync::atomic::{AtomicU32, Ordering},
};

use anyhow::Context;
use rayon::prelude::*;

use image_dds::ddsfile::Dds;
use nie_explore::menu_predecode::plan;
use nie_formats::cpk::CpkReader;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

pub struct PredecodeStats {
    pub decoded: u32,
    pub skipped: u32,
    pub failed: u32,
}

// ---------------------------------------------------------------------------
// Entrée principale
// ---------------------------------------------------------------------------

/// Pré-décode tous les sprites menu ciblés et écrit les PNG dans `dump_root`.
///
/// `priority_paths` : si non-vide, traite ces chemins en premier ; le reste du sous-arbre
/// menu est traité si `all_menu` est vrai.
pub fn run(
    dump_root: &Path,
    packs_dir: &Path,
    redis_url: &str,
    priority_paths: &[String],
    all_menu: bool,
) -> anyhow::Result<PredecodeStats> {
    // --- Connexion Redis ---
    let client =
        redis::Client::open(redis_url).with_context(|| format!("connexion Redis {redis_url}"))?;
    let mut conn = client.get_connection().context("get_connection Redis")?;

    // --- Collecte des chemins à traiter ---
    let mut indexed = Vec::new();

    // Resolve explicitly prioritized paths first. The current CLI passes none;
    // library callers may still provide paths from their own index.
    for p in priority_paths {
        // A logical VFS path such as "dx11/menu/..." maps to the Redis key
        // "data/dx11/menu/...".
        let redis_key = format!("data/{p}");
        let cpk: Option<String> = redis::cmd("HGET")
            .arg("iev:file:index")
            .arg(&redis_key)
            .query(&mut conn)
            .ok()
            .flatten();
        if cpk.is_some() {
            indexed.push((redis_key, cpk.unwrap_or_default()));
        }
    }

    if all_menu {
        // Scan HSCAN de tous les g4tx menu (fr, en, pt, de, es, it, zh_hans, ko, base).
        let mut cursor: u64 = 0;
        loop {
            let result: redis::Value = redis::cmd("HSCAN")
                .arg("iev:file:index")
                .arg(cursor)
                .arg("MATCH")
                .arg("data/dx11/menu*g4tx")
                .arg("COUNT")
                .arg(10_000u32)
                .query(&mut conn)?;

            let (next_cursor, pairs) = parse_hscan_result(result)?;
            indexed.extend(pairs);
            cursor = next_cursor;
            if cursor == 0 {
                break;
            }
        }
    }

    let plan = plan(priority_paths, &indexed, all_menu, &["fr", "en"]);
    let total = plan.paths.len();
    eprintln!("predecode total={total} sprites à traiter");

    // --- Traitement parallèle ---
    let decoded = AtomicU32::new(0);
    let skipped = AtomicU32::new(0);
    let failed = AtomicU32::new(0);

    // Index CPK déjà ouverts : chargés une fois par CPK (mmap-like via std::fs::read).
    // Chaque thread Rayon a son propre CPK buffer (clone minimal — taille ~10-50 MB/CPK).
    // Pour éviter de relire le même CPK plusieurs fois, on groupe par CPK.
    for path in &plan.missing_archive {
        eprintln!("warn: pas de CPK pour {path}");
        failed.fetch_add(1, Ordering::Relaxed);
    }

    let cpk_groups: Vec<(String, Vec<String>)> = plan.by_archive.into_iter().collect();
    let total_cpks = cpk_groups.len();
    eprintln!("predecode {total_cpks} CPK distincts");

    cpk_groups
        .into_par_iter()
        .for_each(|(cpk_name, sprite_paths)| {
            let cpk_path = packs_dir.join(&cpk_name);
            let cpk_data = match std::fs::read(&cpk_path) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("error: lecture CPK {cpk_name}: {e}");
                    failed.fetch_add(sprite_paths.len() as u32, Ordering::Relaxed);
                    return;
                }
            };

            let reader = match CpkReader::new(&cpk_data, &cpk_name) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("error: parse CPK {cpk_name}: {e}");
                    failed.fetch_add(sprite_paths.len() as u32, Ordering::Relaxed);
                    return;
                }
            };

            // Index par chemin logique (directory + "/" + filename).
            let entry_map: HashMap<String, usize> = reader
                .entries
                .iter()
                .enumerate()
                .map(|(i, e)| {
                    let logical = if e.directory.is_empty() {
                        e.filename.clone()
                    } else {
                        format!("{}/{}", e.directory, e.filename)
                    };
                    (logical, i)
                })
                .collect();

            for sprite_path in &sprite_paths {
                // sprite_path = "dx11/menu/..."
                let png_out =
                    dump_root.join(format!("{}.png", sprite_path.trim_end_matches(".g4tx")));

                // Idempotent : skip si le PNG existe et est non-vide.
                if png_out.exists() {
                    let meta = std::fs::metadata(&png_out).ok();
                    if meta.is_some_and(|m| m.len() > 0) {
                        skipped.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                }

                // Rechercher l'entrée dans le CPK.
                // Le chemin dans le CPK est "data/<sprite_path>".
                let cpk_inner = format!("data/{sprite_path}");
                let entry_idx = entry_map.get(&cpk_inner).copied().or_else(|| {
                    // Fallback : juste le chemin sans "data/"
                    entry_map.get(sprite_path).copied()
                });

                let entry_idx = match entry_idx {
                    Some(i) => i,
                    None => {
                        eprintln!("warn: entrée introuvable dans CPK {cpk_name}: {cpk_inner}");
                        failed.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                };

                let entry = &reader.entries[entry_idx];
                let g4tx_bytes = match reader.extract(&cpk_data, entry) {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("error: extraction {sprite_path}: {e}");
                        failed.fetch_add(1, Ordering::Relaxed);
                        continue;
                    }
                };

                match g4tx_to_png(&g4tx_bytes, sprite_path) {
                    Ok(png_bytes) => {
                        if let Err(e) = write_png(&png_out, &png_bytes) {
                            eprintln!("error: écriture PNG {}: {e}", png_out.display());
                            failed.fetch_add(1, Ordering::Relaxed);
                        } else {
                            decoded.fetch_add(1, Ordering::Relaxed);
                        }
                    }
                    Err(e) => {
                        eprintln!("error: décodage {sprite_path}: {e}");
                        failed.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        });

    Ok(PredecodeStats {
        decoded: decoded.load(Ordering::Relaxed),
        skipped: skipped.load(Ordering::Relaxed),
        failed: failed.load(Ordering::Relaxed),
    })
}

// ---------------------------------------------------------------------------
// Décodage G4TX -> PNG
// ---------------------------------------------------------------------------

/// Décode un fichier g4tx (DDS payload) en PNG.
/// Seule la première texture principale (mip 0) est exportée.
fn g4tx_to_png(data: &[u8], debug_path: &str) -> anyhow::Result<Vec<u8>> {
    // Parse le conteneur G4TX pour trouver le payload DDS.
    let g4tx =
        nie_formats::g4tx::parse(data).with_context(|| format!("parse G4TX {debug_path}"))?;

    let tex = g4tx
        .textures
        .first()
        .ok_or_else(|| anyhow::anyhow!("g4tx vide (aucune texture) : {debug_path}"))?;

    let payload = data
        .get(tex.data_offset..tex.data_offset + tex.data_size)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "payload DDS hors limites offset={} size={} total={} : {debug_path}",
                tex.data_offset,
                tex.data_size,
                data.len()
            )
        })?;

    // Décode le DDS en RgbaImage via image_dds.
    let dds = Dds::read(Cursor::new(payload)).with_context(|| format!("parse DDS {debug_path}"))?;

    let rgba_image =
        image_dds::image_from_dds(&dds, 0).with_context(|| format!("decode DDS {debug_path}"))?;

    // Encode en PNG lossless.
    let mut png_bytes: Vec<u8> = Vec::new();
    rgba_image
        .write_to(&mut Cursor::new(&mut png_bytes), image::ImageFormat::Png)
        .with_context(|| format!("encode PNG {debug_path}"))?;

    Ok(png_bytes)
}

// ---------------------------------------------------------------------------
// Écriture PNG (crée les dossiers parents)
// ---------------------------------------------------------------------------

fn write_png(out: &Path, bytes: &[u8]) -> anyhow::Result<()> {
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("création dossiers {}", parent.display()))?;
    }
    std::fs::write(out, bytes).with_context(|| format!("écriture {}", out.display()))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers Redis
// ---------------------------------------------------------------------------

/// Parse le résultat HSCAN Redis en (next_cursor, Vec<(field, value)>).
fn parse_hscan_result(val: redis::Value) -> anyhow::Result<(u64, Vec<(String, String)>)> {
    use redis::Value;
    if let Value::Array(outer) = val {
        if outer.len() != 2 {
            anyhow::bail!("HSCAN: format de réponse inattendu (len={})", outer.len());
        }
        let cursor_val = &outer[0];
        let items_val = &outer[1];

        let cursor: u64 = match cursor_val {
            Value::BulkString(b) => String::from_utf8_lossy(b).parse().unwrap_or(0),
            Value::Int(n) => *n as u64,
            _ => 0,
        };

        let mut pairs = Vec::new();
        if let Value::Array(items) = items_val {
            let mut i = 0;
            while i + 1 < items.len() {
                let field = redis_value_to_string(&items[i]);
                let value = redis_value_to_string(&items[i + 1]);
                if let (Some(f), Some(v)) = (field, value) {
                    pairs.push((f, v));
                }
                i += 2;
            }
        }
        Ok((cursor, pairs))
    } else {
        anyhow::bail!("HSCAN: réponse non-Array");
    }
}

fn redis_value_to_string(val: &redis::Value) -> Option<String> {
    use redis::Value;
    match val {
        Value::BulkString(b) => Some(String::from_utf8_lossy(b).into_owned()),
        Value::SimpleString(s) => Some(s.clone()),
        _ => None,
    }
}
