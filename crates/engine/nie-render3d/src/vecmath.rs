//! Helpers vectoriels 3D partagés par [`render`](crate::render) et [`scene`](crate::scene).
//!
//! POD `[f32; 3]` + math **scalaire** (pas de SIMD/FMA) pour le déterminisme du rendu CPU.
//! L'implémentation vit dans `aphrody-softraster` (propriétaire : `aphrody-ui`), le rastériseur
//! CPU partagé avec la pile 3D Aphrody ; ce module n'en garde que les noms internes.

pub(crate) use aphrody_softraster::{V3, cross, dot, normv, sub};
