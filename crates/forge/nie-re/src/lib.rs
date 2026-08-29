//! Moteur RE niers.
//!
//! Trois capacités, implémentées au fil de la boucle :
//! - `rtti` : récupération RTTI MSVC (`.rdata` → classes `lives::*`/`game::*` + hiérarchie).
//! - `indexer` : ré-indexation du binaire (goblin + iced-x86 via `aphrody-re`) pour
//!   vérification/reproductibilité quand `nie.exe` change.
//! - `disasm` : récupération des arêtes d'appel manquantes par désassemblage `iced-x86`
//!   de `.text` (enrichit le call-graph au-delà du plafond de l'export Ghidra).
//! - `propagate` : propagation de labels semi-supervisée sur le call-graph (auto-ML),
//!   depuis les ancres du seed Ghidra/iecode vers les ~60 000 fonctions.
//! - `anchors` : ancrage des fonctions par leurs références de chaînes (table de règles
//!   `motif→sous-système` appliquée avant la propagation).
//! - `loop_db` : câblage DB → `PropagationGraph` → écriture des résultats.
//! - `dump` : recherche de motifs (AOB, wildcards) dans un minidump live de `nie.exe`,
//!   avec traduction `module + RVA` (oracle de lecture/validation runtime ; complète le
//!   scanner *process live* de `nie-trace` pour le cas dump `.dmp` hors-ligne).
//!   Réexport du crate `nie-dump` : le code vit à part pour rester consommable par
//!   `nie-explorer`, que les dépendances de ce crate-ci (rusqlite via `nie-index`, dépôt
//!   frère `aphrody`) interdisent de lier.
#![forbid(unsafe_code)]
#![allow(clippy::pedantic)]

pub mod adjacency;
pub mod anchors;
pub mod disasm;
pub use nie_dump as dump;
pub mod funclua;
pub mod indexer;
pub mod loop_db;
pub mod pdata;
pub mod propagate;
pub mod recover;
pub mod rtti;
pub mod vtable;
pub mod vtable_anon;

/// Version du moteur.
#[must_use]
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
