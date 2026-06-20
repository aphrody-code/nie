//! **Renderer 3D niers** — charge un GLB réel (modèle reconstruit depuis les CPK par
//! `nie_formats::assemble`) et le rend en **perspective 3D texturée** (rastérisation CPU : z-buffer,
//! backface culling, échantillonnage des atlas PNG embarqués + éclairage Lambert). C'est le maillon
//! « rendu 3D » qui manquait : le vrai jeu est en 3D, et ce module affiche les **vrais maillages et
//! textures** du jeu (pas des primitives abstraites). Le portage GPU/wgpu est l'évolution suivante ;
//! l'API reste la même.

#![forbid(unsafe_code)]

pub mod glb;
pub mod render;
pub mod scene;
