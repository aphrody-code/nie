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

pub mod nie_index_json;

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
}

/// Version du seeder.
#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
