//! **Renderer 3D niers** — charge un GLB réel (modèle reconstruit depuis les CPK par
//! `nie_formats::assemble`) et le rend en **perspective 3D texturée** (rastérisation CPU : z-buffer,
//! backface culling, échantillonnage des atlas PNG embarqués + éclairage Lambert). C'est le maillon
//! « rendu 3D » qui manquait : le vrai jeu est en 3D, et ce module affiche les **vrais maillages et
//! textures** du jeu (pas des primitives abstraites).
//!
//! Deux chemins de rendu, même contrat (`Model` → RGBA8) :
//! - [`render`] — rastériseur **CPU** de référence : headless, déterministe, sans pilote graphique.
//!   C'est lui qui sert de vérité terrain aux tests golden.
//! - [`gpu`] (feature `gpu`) — pipeline **wgpu** : le modèle est téléversé une fois en mémoire GPU
//!   puis chaque image ne coûte qu'un appel de dessin. C'est ce qui rend une caméra manipulable à
//!   la souris possible, là où le CPU convient pour une vignette mais pas pour un viewport.

#![forbid(unsafe_code)]

pub mod glb;
#[cfg(feature = "gpu")]
pub mod gpu;
pub mod render;
pub mod scene;
mod vecmath;
