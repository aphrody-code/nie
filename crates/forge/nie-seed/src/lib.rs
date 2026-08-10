//! Import du savoir fusionné comme ancres de vérité de la boucle RE.
//!
//! Sources :
//! - `research/nie-index.json` (60 183 fonctions Ghidra : type retour, params, callees `ce`,
//!   strings référencées `st`, data-refs `dr`, constantes `hx`, sous-système `ns`, rôle `ro`,
//!   `pagerank_scores`, `globals`, `rtti_to_functions`) ;
//! - `research/nie-rtti-classes.txt` (1 234 classes RTTI `game::`/`lives::`) ;
//! - formats Level-5 documentés par iecode (`IECODE.Core/Formats/**`) ;
//! - tables hash→nom d'inagle (CRC32/FNV des IDs persos/skills/items).
//!
//! Le module [`stats`] résume une passe d'ingestion. L'ingestion proprement dite est
//! implémentée dans [`nie_index_json`].
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

pub mod format_catalog;
pub mod formats;
pub mod inagle;
pub mod nie_index_json;
pub mod rtti_classes;

use std::path::Path;

/// Statistiques d'une passe d'ingestion.
#[derive(Debug, Default, Clone, serde::Serialize)]
pub struct Stats {
    pub functions: usize,
    pub xrefs: usize,
    pub str_refs: usize,
    pub consts: usize,
    pub globals: usize,
    pub rtti_classes: usize,
    pub anchors: usize,
    /// Nombre de formats documentés insérés (catalogue minimal codé en dur).
    pub formats: usize,
    /// Nombre de formats insérés depuis le catalogue JSON iecode (`export-knowledge`).
    pub catalog_formats: usize,
    /// Nombre de champs d'en-tête insérés depuis le catalogue JSON iecode.
    pub catalog_fields: usize,
    /// Nombre de couples (hash, nom) inagle insérés.
    pub hash_names: usize,
}

/// Version du seeder.
#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Lance l'intégralité de l'ingestion connaissance et renvoie les compteurs.
///
/// - `binary_id` : id du binaire dans `nie_index::Db` (déjà inséré via `upsert_binary`).
/// - `refs_root` : racine du répertoire `refs/` (contient `iecode-re/research/nie-rtti-classes.txt`).
/// - `inagle_sqlite_dir` : répertoire contenant les fichiers `supabase-*.sqlite`
///   (typiquement `apps/azalee/data/backups/`).
/// - `format_catalog_json` : chemin du catalogue JSON exporté par
///   `iecode export-knowledge --out <fichier>` (optionnel). Si fourni et lisible,
///   il enrichit les tables `format`/`format_field` avec le savoir complet d'iecode
///   (layouts de champs d'en-tête), au-delà du catalogue minimal codé en dur.
///
/// # Erreurs
///
/// Retourne une erreur agrégée si l'une des étapes critiques échoue. L'ingestion du
/// catalogue JSON et celle d'inagle sont tolérantes : une erreur y est journalisée
/// sans interrompre la passe.
pub fn ingest_all(
    db: &mut nie_index::Db,
    binary_id: i64,
    refs_root: &Path,
    inagle_sqlite_dir: Option<&Path>,
    format_catalog_json: Option<&Path>,
) -> anyhow::Result<Stats> {
    let mut stats = Stats::default();

    // 1. Classes RTTI
    let rtti_path = refs_root
        .join("iecode-re")
        .join("research")
        .join("nie-rtti-classes.txt");
    stats.rtti_classes = rtti_classes::ingest_rtti_classes(db, binary_id, &rtti_path)?;
    // anchors = une ancre par classe RTTI
    stats.anchors += stats.rtti_classes;

    // 2. Formats Level-5 / Criware (catalogue minimal codé en dur)
    stats.formats = formats::ingest_formats(db)?;

    // 2b. Catalogue JSON iecode complet (optionnel, enrichit format/format_field).
    if let Some(json) = format_catalog_json {
        match format_catalog::ingest_format_catalog(db, json) {
            Ok(s) => {
                stats.catalog_formats = s.formats;
                stats.catalog_fields = s.fields;
            }
            Err(e) => {
                tracing::warn!("ingestion catalogue iecode ignorée : {e:#}");
            }
        }
    }

    // 3. Hash→nom inagle (optionnel si la DB n'est pas disponible)
    if let Some(dir) = inagle_sqlite_dir {
        match inagle::ingest_inagle_hashes(db, dir) {
            Ok(n) => stats.hash_names = n,
            Err(e) => {
                tracing::warn!("ingestion inagle ignorée : {e:#}");
            }
        }
    }

    Ok(stats)
}
