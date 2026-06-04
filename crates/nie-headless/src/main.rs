//! `nie-headless` — runner CLI headless pour les formats IEVR.
//!
//! Prend un fichier extrait du jeu, détecte son format et affiche un résumé JSON
//! sur stdout. C'est le squelette du « jeu en headless » côté outils : pas de
//! moteur Windows, pas de binaire propriétaire — uniquement les parsers Rust de
//! `nie-formats`.
//!
//! ## Utilisation
//!
//! ```text
//! nie-headless <FICHIER>
//! nie-headless --help
//! ```
//!
//! ## Sortie JSON
//!
//! ```json
//! {
//!   "chemin": "assets/data.cpk",
//!   "taille_octets": 4096,
//!   "format": "CPK",
//!   "detail": { ... }
//! }
//! ```
//!
//! Le champ `detail` dépend du format détecté :
//! - **CRILAYLA** : `{ "taille_decompresse": N }` après décompression complète.
//! - **@UTF** : `{ "nom_table": "...", "colonnes": N, "lignes": N }`.
//! - **CPK** : `{ "nom_table": "...", "colonnes": N, "lignes": N }` (table @UTF interne).
//! - **cfg.bin (RDBN)** : `{ "version": N, "types": N, "champs": N, "racines": N }`.
//! - Tout autre format reconnu : `{}`.
//! - Format inconnu : `{}`.

#![forbid(unsafe_code)]

use std::path::PathBuf;

use anyhow::{Context, Result};
use clap::Parser;
use serde::Serialize;
use serde_json::Value;

use nie_formats::{FileFormat, cfgbin, cpk, crilayla, detect};

// ---------------------------------------------------------------------------
// Détection étendue
// ---------------------------------------------------------------------------

/// Détecte le format d'un tampon, avec prise en charge du magic RDBN (cfg.bin)
/// en complément de [`nie_formats::detect`] (qui ne couvre pas encore RDBN).
fn detect_etendu(donnees: &[u8]) -> FileFormat {
    let format = detect(donnees);
    if format == FileFormat::Unknown && cfgbin::is_rdbn(donnees) {
        FileFormat::CfgBin
    } else {
        format
    }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

/// Runner headless IEVR — détecte le format d'un fichier et affiche un résumé JSON.
#[derive(Debug, Parser)]
#[command(name = "nie-headless", version, about, long_about = None)]
struct Cli {
    /// Chemin vers le fichier à analyser.
    fichier: PathBuf,

    /// Indentation JSON (0 = compact, 2 = lisible).
    #[arg(long, default_value = "2")]
    indent: usize,
}

// ---------------------------------------------------------------------------
// Résumé JSON
// ---------------------------------------------------------------------------

/// Résumé d'analyse d'un fichier.
#[derive(Debug, Serialize)]
struct Resume {
    /// Chemin du fichier tel que passé en argument.
    chemin: String,
    /// Taille en octets.
    taille_octets: u64,
    /// Nom court du format détecté (ex. `"CPK"`, `"CRILAYLA"`, `"?"`).
    format: &'static str,
    /// Détails supplémentaires, spécifiques au format.
    detail: Value,
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

fn main() -> Result<()> {
    let cli = Cli::parse();

    let chemin_str = cli.fichier.display().to_string();
    let donnees = std::fs::read(&cli.fichier)
        .with_context(|| format!("impossible de lire '{chemin_str}'"))?;

    let taille_octets = donnees.len() as u64;
    let format = detect_etendu(&donnees);
    let detail = construire_detail(format, &donnees)?;

    let resume = Resume {
        chemin: chemin_str,
        taille_octets,
        format: format.name(),
        detail,
    };

    let json = if cli.indent == 0 {
        serde_json::to_string(&resume).context("sérialisation JSON")?
    } else {
        let formatter = serde_json::ser::PrettyFormatter::with_indent(
            b"  ", // toujours 2 espaces (l'indent CLI pilote le nombre de niveaux,
                   // mais serde n'expose pas l'indent par niveau — on utilise 2 espaces)
        );
        let mut buf = Vec::new();
        let mut ser = serde_json::Serializer::with_formatter(&mut buf, formatter);
        resume.serialize(&mut ser).context("sérialisation JSON")?;
        String::from_utf8(buf).context("UTF-8 JSON")?
    };

    println!("{json}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Analyse par format
// ---------------------------------------------------------------------------

/// Construit le champ `detail` JSON en fonction du format détecté.
fn construire_detail(format: FileFormat, donnees: &[u8]) -> Result<Value> {
    match format {
        FileFormat::CriLayla => detail_crilayla(donnees),
        FileFormat::Utf => detail_utf(donnees),
        FileFormat::Cpk => detail_cpk(donnees),
        FileFormat::CfgBin => detail_cfgbin(donnees),
        // Formats reconnus mais sans parser Rust disponible dans nie-formats :
        // on renvoie un objet vide plutôt que d'échouer.
        FileFormat::Hca
        | FileFormat::Acb
        | FileFormat::Awb
        | FileFormat::Usm
        | FileFormat::G4mg
        | FileFormat::G4md
        | FileFormat::G4tx
        | FileFormat::G4sk
        | FileFormat::G4pk
        | FileFormat::G4nv
        | FileFormat::Unknown => Ok(serde_json::json!({})),
    }
}

/// Décompresse un flux CRILAYLA et retourne la taille décompressée.
fn detail_crilayla(donnees: &[u8]) -> Result<Value> {
    let decompresse = crilayla::decompress(donnees)
        .map_err(|e| anyhow::anyhow!("CRILAYLA : {e}"))?;
    Ok(serde_json::json!({
        "taille_decompresse": decompresse.len()
    }))
}

/// Parse une table @UTF et retourne nom + dimensions.
fn detail_utf(donnees: &[u8]) -> Result<Value> {
    let table = cpk::parse_utf(donnees)
        .map_err(|e| anyhow::anyhow!("@UTF : {e}"))?;
    Ok(serde_json::json!({
        "nom_table": table.name,
        "colonnes":  table.column_count(),
        "lignes":    table.row_count(),
    }))
}

/// Parse l'en-tête CPK (table @UTF interne).
fn detail_cpk(donnees: &[u8]) -> Result<Value> {
    let header = cpk::parse_cpk(donnees)
        .map_err(|e| anyhow::anyhow!("CPK : {e}"))?;
    Ok(serde_json::json!({
        "nom_table": header.utf.name,
        "colonnes":  header.utf.column_count(),
        "lignes":    header.utf.row_count(),
    }))
}

/// Parse un fichier RDBN (cfg.bin) et retourne les compteurs.
fn detail_cfgbin(donnees: &[u8]) -> Result<Value> {
    // `detect` retourne `CfgBin` sur le magic RDBN.
    let rdbn = cfgbin::parse(donnees)
        .map_err(|e| anyhow::anyhow!("RDBN/cfg.bin : {e}"))?;
    Ok(serde_json::json!({
        "version": rdbn.header.version,
        "types":   rdbn.types.len(),
        "champs":  rdbn.fields.len(),
        "racines": rdbn.roots.len(),
    }))
}
