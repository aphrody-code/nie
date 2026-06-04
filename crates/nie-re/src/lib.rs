//! Moteur RE niers.
//!
//! Trois capacités, implémentées au fil de la boucle :
//! - `rtti` : récupération RTTI MSVC (`.rdata` → classes `lives::*`/`game::*` + hiérarchie).
//! - `indexer` : ré-indexation du binaire (goblin + iced-x86 via `aphrody-re`) pour
//!   vérification/reproductibilité quand `nie.exe` change.
//! - `propagate` : propagation de labels semi-supervisée sur le call-graph (auto-ML),
//!   depuis les ancres du seed Ghidra/iecode vers les ~60 000 fonctions.
//! - `anchors` : ancrage des fonctions par leurs références de chaînes (table de règles
//!   `motif→sous-système` appliquée avant la propagation).
//! - `loop_db` : câblage DB → `PropagationGraph` → écriture des résultats.
#![forbid(unsafe_code)]

pub mod anchors;
pub mod indexer;
pub mod loop_db;
pub mod propagate;
pub mod rtti;

/// Version du moteur.
#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
