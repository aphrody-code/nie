//! Banc d'essai des hot paths du dépôt.
//!
//! Deux rôles :
//! 1. **mesurer** côté Rust (`crc32`, `crilayla`) ;
//! 2. **produire les échantillons** que les harnais C++, C# et TypeScript rejouent à
//!    l'identique (`sample`), pour que la comparaison porte sur le langage et non sur
//!    l'entrée.
//!
//! Protocole commun aux quatre harnais, à respecter si on en ajoute un :
//! - données générées par le même `xorshift64*` (graine `0x2545_F491_4F6C_DD1D`) ;
//! - 3 tours de chauffe, 7 mesures, **médiane** retenue (pas la moyenne : elle encaisse
//!   mal la préemption du système) ;
//! - une ligne `clé=valeur` par mesure, débit en Mio/s.

#![forbid(unsafe_code)]

use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{Context, bail};
use clap::{Parser, Subcommand};

/// Graine partagée par les quatre harnais.
const SEED: u64 = 0x2545_F491_4F6C_DD1D;
/// Tours de chauffe avant mesure.
const WARMUP: usize = 3;
/// Mesures conservées pour la médiane.
const RUNS: usize = 7;

#[derive(Parser)]
#[command(name = "nie-bench", about = "Banc d'essai des hot paths (côté Rust)")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// CRC32 sur un tampon pseudo-aléatoire.
    Crc32 {
        /// Taille du tampon, en Mio.
        #[arg(long, default_value_t = 64)]
        mib: usize,
    },
    /// Décompression CRILAYLA d'un échantillon réel.
    Crilayla {
        /// Blob CRILAYLA produit par `nie-bench sample`.
        #[arg(long, default_value = "bench/data/sample.crilayla")]
        input: PathBuf,
        /// Décompressions par mesure : un blob de quelques dizaines de Kio se décode en
        /// microsecondes, sous la résolution utile de l'horloge.
        #[arg(long, default_value_t = 500)]
        iters: usize,
    },
    /// Extrait un blob CRILAYLA d'un CPK du jeu, pour les quatre harnais.
    Sample {
        /// Fichier `.cpk` source.
        #[arg(long)]
        cpk: PathBuf,
        /// Destination du blob.
        #[arg(long, default_value = "bench/data/sample.crilayla")]
        out: PathBuf,
        /// Taille décompressée maximale, en Mio : on veut un blob représentatif, pas
        /// l'archive entière (7 itérations × 4 harnais sur 250 Mio ne mesurent que la RAM).
        #[arg(long, default_value_t = 8)]
        max_mib: usize,
    },
}

/// Générateur partagé : xorshift64*, identique dans les quatre harnais.
fn fill_xorshift(buf: &mut [u8]) {
    let mut x = SEED;
    for chunk in buf.chunks_mut(8) {
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        let v = x.wrapping_mul(0x2545_F491_4F6C_DD1D).to_le_bytes();
        chunk.copy_from_slice(&v[..chunk.len()]);
    }
}

/// Médiane d'un échantillon de durées (en secondes).
fn median(mut v: Vec<f64>) -> f64 {
    v.sort_by(f64::total_cmp);
    v[v.len() / 2]
}

fn bench_crc32(mib: usize) {
    let mut buf = vec![0u8; mib * 1024 * 1024];
    fill_xorshift(&mut buf);

    for _ in 0..WARMUP {
        std::hint::black_box(nie_formats::cfgbin::crc32(&buf));
    }
    let mut times = Vec::with_capacity(RUNS);
    let mut last = 0u32;
    for _ in 0..RUNS {
        let t = Instant::now();
        last = nie_formats::cfgbin::crc32(&buf);
        times.push(t.elapsed().as_secs_f64());
        std::hint::black_box(last);
    }
    let s = median(times);
    println!(
        "lang=rust bench=crc32 mib={mib} median_ms={:.3} mib_s={:.1} checksum=0x{last:08x}",
        s * 1000.0,
        mib as f64 / s
    );
}

fn bench_crilayla(input: &PathBuf, iters: usize) -> anyhow::Result<()> {
    let data = fs::read(input).with_context(|| {
        format!(
            "échantillon absent : {} — lance `nie-bench sample --cpk <fichier.cpk>`",
            input.display()
        )
    })?;
    if !nie_formats::crilayla::has_magic(&data) {
        bail!("{} n'est pas un blob CRILAYLA", input.display());
    }

    for _ in 0..WARMUP {
        std::hint::black_box(nie_formats::crilayla::decompress(&data).ok());
    }
    let mut times = Vec::with_capacity(RUNS);
    let mut out_len = 0usize;
    for _ in 0..RUNS {
        let t = Instant::now();
        for _ in 0..iters {
            let out = nie_formats::crilayla::decompress(&data)?;
            out_len = out.len();
            std::hint::black_box(out);
        }
        times.push(t.elapsed().as_secs_f64());
    }
    let s = median(times);
    let mib = (out_len * iters) as f64 / (1024.0 * 1024.0);
    println!(
        "lang=rust bench=crilayla in={} out={out_len} iters={iters} median_ms={:.3} mib_s={:.1}",
        data.len(),
        s * 1000.0,
        mib / s
    );
    Ok(())
}

/// Cherche le magic `CRILAYLA` dans un CPK **déchiffré** et écrit le premier blob complet.
///
/// Le blob fait `0x10 + compressed_size + 0x100` octets : en-tête, corps compressé, et le
/// préfixe non compressé de 256 octets que CRILAYLA place en fin de flux.
fn make_sample(cpk: &PathBuf, out: &PathBuf, max_mib: usize) -> anyhow::Result<()> {
    let mut buf = fs::read(cpk).with_context(|| format!("lecture de {}", cpk.display()))?;
    let name = cpk
        .file_name()
        .and_then(|n| n.to_str())
        .context("nom de fichier CPK invalide")?;
    // Les blocs d'un CPK sont chiffrés (XOR dérivé du nom) : sans ça, aucun magic en clair.
    nie_formats::cpk::decrypt_cpk_in_place(&mut buf, name);

    let magic = b"CRILAYLA";
    let mut best: Option<(usize, usize, usize)> = None; // (offset, compressed, uncompressed)
    for i in 0..buf.len().saturating_sub(16) {
        if &buf[i..i + 8] != magic {
            continue;
        }
        let uncompressed = u32::from_le_bytes([buf[i + 8], buf[i + 9], buf[i + 10], buf[i + 11]]);
        let compressed = u32::from_le_bytes([buf[i + 12], buf[i + 13], buf[i + 14], buf[i + 15]]);
        let total = 0x10 + compressed as usize + 0x100;
        if i + total > buf.len() || uncompressed == 0 {
            continue;
        }
        // Le plus gros sous le plafond : un blob de quelques Kio ne mesurerait que le bruit,
        // l'archive entière ne mesurerait que la bande passante mémoire.
        if uncompressed as usize > max_mib * 1024 * 1024 {
            continue;
        }
        if best.is_none_or(|(_, c, _)| (compressed as usize) > c) {
            best = Some((i, compressed as usize, uncompressed as usize));
        }
    }

    let Some((off, compressed, uncompressed)) = best else {
        bail!("aucun blob CRILAYLA dans {}", cpk.display());
    };
    let total = 0x10 + compressed + 0x100;
    let blob = &buf[off..off + total];
    // Vérifier avant d'écrire : un échantillon que le décodeur refuse ne mesure rien.
    let decoded = nie_formats::crilayla::decompress(blob)?;
    // Le décodeur restitue le préfixe brut de 0x100 octets en plus de la taille annoncée :
    // les deux longueurs sont donc légitimes.
    if decoded.len() != uncompressed && decoded.len() != uncompressed + 0x100 {
        bail!(
            "échantillon incohérent : décodé {} octets, en-tête en annonce {uncompressed}",
            decoded.len()
        );
    }
    if let Some(parent) = out.parent() {
        fs::create_dir_all(parent).ok();
    }
    fs::write(out, blob)?;
    println!(
        "sample={} offset={off} compressed={compressed} uncompressed={uncompressed}",
        out.display()
    );
    Ok(())
}

fn main() -> anyhow::Result<()> {
    match Cli::parse().cmd {
        Cmd::Crc32 { mib } => {
            bench_crc32(mib);
            Ok(())
        }
        Cmd::Crilayla { input, iters } => bench_crilayla(&input, iters),
        Cmd::Sample { cpk, out, max_mib } => make_sample(&cpk, &out, max_mib),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_generateur_est_deterministe() {
        let mut a = [0u8; 64];
        let mut b = [0u8; 64];
        fill_xorshift(&mut a);
        fill_xorshift(&mut b);
        assert_eq!(a, b, "les quatre harnais doivent voir les mêmes octets");
        assert!(a.iter().any(|&x| x != 0), "tampon resté nul");
    }

    #[test]
    fn la_mediane_prend_la_valeur_centrale() {
        assert!((median(vec![3.0, 1.0, 2.0]) - 2.0).abs() < f64::EPSILON);
    }
}
