//! Aphrody lu dans le jeu : la part de l'ancienne crate `nie-aphrody` qui dépend des fichiers
//! Level-5.
//!
//! L'identité du produit (pet 2D, icônes, palette, dossier embarqué) a rejoint aphrody-ui sous le
//! nom `aphrody-identity` le 2026-09-26 ; elle est réexportée ici en [`identity`]. Restent dans nie :
//!
//! - [`gisement`] : le dossier natif construit depuis `chara_param`, `skill_config` et
//!   `aura_skill_config` (parseurs de `nie-data`) ;
//! - [`modele3d`] : le contrat 3D (pièces, chemins VFS, pont vers les pistes 2D du pet) ;
//! - le binaire `export_aphrody`, qui régénère `aphrody-identity/assets/dossier/aphrody.json`.

pub use aphrody_identity as identity;

pub mod gisement;
/// Le contrat **3D** d'Aphrody : pièces, chemins VFS, ailes de « God Knows », pont vers les
/// pistes 2D. Ne parse ni n'assemble rien — `nie_formats` en reste propriétaire.
pub mod modele3d;
