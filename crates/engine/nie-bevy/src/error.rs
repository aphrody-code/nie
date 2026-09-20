//! Le contrat d'erreur de la conversion — le seul module compilé sans la fonctionnalité `bevy`.
//!
//! Il est séparé pour une raison mesurable : `crates/engine/*` est membre par défaut du
//! workspace, et un `cargo check --workspace` doit rester au même coût qu'avant l'ajout de cette
//! crate. Sans `bevy`, c'est tout ce qu'elle contient.

use thiserror::Error;

/// Échec de conversion d'un asset du jeu vers un type Bevy.
///
/// Les variantes distinguent des enquêtes différentes. Un `.g4tx` corrompu ([`Self::Decode`]),
/// un `.g4tx` sans texture ([`Self::Empty`]) et un `.g4tx` dont le payload n'est pas un DDS
/// ([`Self::Unsupported`]) se ressemblent vus d'un chargeur d'assets — « ça n'a pas chargé » —
/// et n'ont rien à voir vus du dépôt. Les confondre envoie chercher un défaut de décodage là où
/// la donnée est simplement vide.
///
/// La conversion vers `bevy_ecs::error::BevyError`, exigée par `AssetLoader::Error`, est
/// automatique : `BevyError` a un `From<E>` pour tout `E: std::error::Error + Send + Sync`.
#[derive(Debug, Error)]
pub enum NiersAssetError {
    /// Le conteneur ne se décode pas — magic inattendu, troncature, version non gérée.
    #[error("{format}: decode failed: {reason}")]
    Decode {
        /// Le format attendu (`g4tx`, `g4md`, `g4mg`).
        format: &'static str,
        /// Ce que le décodeur a répondu.
        reason: String,
    },

    /// Le conteneur se décode mais ne porte rien d'exploitable pour Bevy.
    #[error("{format}: nothing to convert: {reason}")]
    Empty {
        /// Le format concerné.
        format: &'static str,
        /// Ce qui manque.
        reason: String,
    },

    /// Le format est reconnu mais ce contenu précis n'est pas porté, ou est incohérent
    /// (indice de sommet hors table, nombre d'indices non multiple de trois).
    ///
    /// C'est une erreur et non un panic Bevy : `Mesh` fait confiance à ses indices, et un indice
    /// hors table y devient une lecture hors limites au moment du rendu, loin du fichier fautif.
    #[error("{format}: unsupported payload: {reason}")]
    Unsupported {
        /// Le format concerné.
        format: &'static str,
        /// L'encodage ou l'incohérence rencontrés.
        reason: String,
    },

    /// Lecture impossible depuis le serveur d'assets.
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    /// Un fichier compagnon n'a pas pu être lu — le `.g4mg` d'un `.g4md`, par exemple.
    ///
    /// Nommé à part parce que la cause n'est pas dans le fichier demandé : c'est son voisin qui
    /// manque, et le message doit dire lequel.
    #[error("dependency {path}: {reason}")]
    Dependency {
        /// Le chemin du compagnon, tel que demandé au serveur d'assets.
        path: String,
        /// Ce que le serveur a répondu.
        reason: String,
    },
}
