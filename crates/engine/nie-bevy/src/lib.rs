//! **Intégration native Bevy** — les formats réels d'Inazuma Eleven Victory Road deviennent des
//! assets Bevy.
//!
//! # Ce que « nativement » veut dire ici
//!
//! Pas un pont, pas un export intermédiaire : les décodeurs du dépôt ([`nie_formats`])
//! produisent directement des types Bevy — `bevy_image::Image`, `bevy_mesh::Mesh` — et un
//! `bevy_app::Plugin` les enregistre auprès du serveur d'assets. Une application Bevy charge
//! donc un `.g4tx` ou un `.g4md` comme elle chargerait un PNG ou un glTF.
//!
//! # La frontière, et pourquoi elle est là
//!
//! `docs/STACK.md` écarte les ECS pour le **cœur** du jeu : la reconstruction byte-exact exige
//! des structs 1:1 avec le layout C++, qu'un ECS éclaterait. Bevy est donc la **coquille** —
//! assets, fenêtre, entrées, rendu, plateformes — et jamais la simulation. Le cœur
//! (`nie-runtime`, `nie-core`, `nie-net`) ne dépend d'aucun crate `bevy_*`, et la seule chose
//! qui traverse la frontière est un instantané que le rendu lit. Cette crate est du bon côté de
//! cette ligne : elle transforme des octets en assets, elle ne décide de rien.
//!
//! # Pourquoi les sous-crates et pas `bevy`
//!
//! Le méta-crate `bevy` tire winit, l'audio, l'interface et le rendu complet. Cette intégration
//! n'a besoin que des types d'assets et du contrat de greffon, publiés séparément à la même
//! version. C'est le même code Bevy, sans les étages inutilisés — et surtout sans un second
//! wgpu : **Bevy 0.19 exige `wgpu ^29.0.3`, exactement l'épingle de ce dépôt** (`=29.0.3`,
//! alignée sur `nie-game`). Vérifié sur l'index de crates.io le 2026-09-20 ; c'était la seule
//! objection technique sérieuse, et elle ne tient pas.
//!
//! # Drapeau
//!
//! Tout est derrière la fonctionnalité `bevy`, éteinte par défaut. `crates/engine/*` est un
//! membre par défaut du workspace : sans ce drapeau, chaque `cargo check --workspace`
//! compilerait Bevy. Ce dépôt a déjà des compilations tuées par la mémoire, et `nie-render3d`
//! applique le même traitement à `gpu` et `webgpu`. Sans le drapeau, seule [`error`] existe.
//!
//! # Ce qui n'est pas réécrit
//!
//! Le décodage. `nie_formats::g4tx_decode` sait lire le BC7 et le BGRA8 des atlas, `g4mg` sait
//! extraire positions, normales, UV et skinning ; ils sont éprouvés par le rendu, la police
//! bitmap et le recoloriage. Cette crate ne fait que les raccorder au contrat d'asset de Bevy.
//! Une seconde implémentation dériverait de la première — ce dépôt l'a déjà payé ailleurs.

#![forbid(unsafe_code)]
#![warn(missing_docs)]

pub mod error;

#[cfg(feature = "bevy")]
pub mod assets;
#[cfg(feature = "bevy")]
pub mod loader;
#[cfg(feature = "bevy")]
pub mod plugin;
#[cfg(feature = "bevy")]
pub mod vfs_source;

pub use error::NieAssetError;

#[cfg(feature = "bevy")]
pub use assets::{image_from_g4tx, mesh_from_g4md_g4mg, meshes_from_g4md_g4mg};
#[cfg(feature = "bevy")]
pub use loader::{G4mdLoader, G4txLoader, NieModel};
#[cfg(feature = "bevy")]
pub use plugin::NieAssetPlugin;
#[cfg(feature = "bevy")]
pub use vfs_source::{VFS_SOURCE, VfsAssetReader, register_vfs_source};
