//! Compatibility facade for the canonical PE inspector in [`aphrody_re`].
//!
//! New consumers should depend on `aphrody-re` directly. This re-export keeps the private
//! `ievr-tools` crate source-compatible while its remaining CRI and manifest probes are audited
//! against `nie-formats`.

pub use aphrody_re::pe::*;
