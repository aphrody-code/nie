//! `nie-forge` — la **chaîne de production de `nie.exe`**.
//!
//! Le projet ne vise plus seulement à rejouer le jeu : il vise à **produire le
//! binaire**. La forge matérialise ce but en une boucle mesurable :
//!
//! ```text
//!   nie.exe (référence)
//!        │  split      → recouvrement total en unités (en-têtes, fonctions, données…)
//!        ▼
//!   cover.json ── registry.json (quelle unité est fournie par du code Rust)
//!        │  build      → concatène les charges utiles : Rust quand c'est prouvé,
//!        ▼               référence sinon
//!   dist/nie.exe ── verify → sha256 identique à la référence, sinon échec
//!        │  report     → part réellement produite par Rust (unités + masse d'octets)
//! ```
//!
//! ## Le principe qui rend l'objectif atteignable
//!
//! Le binaire produit est **identique dès le premier jour** (toutes les unités
//! viennent de la référence), et la métrique de progression est la **part
//! d'octets réellement générés par du code Rust**. On ne « presque » produit
//! jamais le fichier : il est byte-exact en permanence, et la conquête est
//! interne. C'est la discipline des projets de décompilation *matching*, avec
//! l'oracle en plus (`scripts/uemu.py` valide le comportement, la forge valide
//! les octets).
//!
//! ## Statuts de correspondance
//!
//! - `verbatim` — l'unité vient de la référence (rien n'est prétendu).
//! - `emitted` — l'unité est **calculée** par du code Rust (en-têtes PE).
//! - `semantic` — une implémentation Rust existe et son **comportement** est
//!   validé byte-exact par l'oracle uemu ; son codegen ne coïncide pas encore.
//! - `bytes` — le codegen rustc de l'implémentation **coïncide** avec les octets
//!   originaux (hors champs relogés) : l'unité est produite par Rust.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod asmsrc;
pub mod cc;
pub mod lift;
#[cfg(feature = "redb")]
pub mod redb;
pub mod registry;
pub mod report;
pub mod store;

pub use asmsrc::AsmSource;
pub use lift::lift_body;
#[cfg(feature = "redb")]
pub use redb::ReNames;
pub use registry::{MatchStatus, Registry, RegistryEntry};
pub use report::Report;
pub use store::ForgeStore;
