//! Moteur RE niers.
//!
//! Trois capacités, implémentées au fil de la boucle :
//! - `rtti` : récupération RTTI MSVC (`.rdata` → classes `lives::*`/`game::*` + hiérarchie).
//! - `indexer` : ré-indexation du binaire (goblin + iced-x86 via `aphrody-re`) pour
//!   vérification/reproductibilité quand `nie.exe` change.
//! - `propagate` : propagation de labels semi-supervisée sur le call-graph (auto-ML),
//!   depuis les ancres du seed Ghidra/iecode vers les ~60 000 fonctions.
#![forbid(unsafe_code)]

pub mod propagate;

/// Version du moteur.
#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
