//! Déformation de maillage par squelette — *linear blend skinning*.
//!
//! Le dépôt savait déjà lire un squelette ([`crate::g4sk`]), échantillonner une animation à une
//! frame fractionnaire ([`crate::g4mt::Motion::sample_local_trs`]) et résoudre la palette d'os
//! d'une primitive ([`crate::assemble::PrimitiveSkin`]). Ce qui manquait, c'était le **dernier
//! maillon** : appliquer tout cela aux sommets. Il n'existait que dans un exemple, en rotation
//! seule, et qui contournait la palette.
//!
//! ## Les trois étapes, et pourquoi elles sont séparées
//!
//! ```text
//!   matrices_monde     pose locale animée -> matrice monde, par os (cinématique directe)
//!   matrices_skinning  monde × inverse-bind, par os
//!   deformer           Σ poids · matrice · sommet, par sommet
//! ```
//!
//! Les matrices de skinning sont calculées **une fois par frame**, pas une fois par primitive :
//! un modèle de technique porte plusieurs primitives sur le même squelette, et les recalculer
//! coûterait autant de fois le même travail. La séparation est aussi ce qui permet d'envoyer le
//! même tableau à un shader le jour où le skinning passera sur GPU.
//!
//! ## Convention
//!
//! Matrices 4×4 **col-major** (`m[colonne][ligne]`), comme tout le reste de `nie-formats`, et
//! composition par [`crate::g4sk::mat_mul`]. Les positions d'une [`MeshPrimitive`] sont déjà
//! dans l'espace monde de la pose de liaison — c'est exactement l'espace que l'inverse-bind
//! attend, donc aucune transformation préalable n'est nécessaire.

extern crate alloc;

use alloc::vec::Vec;

use crate::assemble::{MeshPrimitive, PrimitiveSkin, SkeletonBone};
use crate::g4mg::Vec3;
use crate::g4mt::{Clip, Motion};
use crate::g4sk::{self, LocalTrs};

/// Une matrice 4×4 col-major.
pub type Mat4 = [[f32; 4]; 4];

/// L'identité.
#[must_use]
pub const fn identite() -> Mat4 {
    [
        [1.0, 0.0, 0.0, 0.0],
        [0.0, 1.0, 0.0, 0.0],
        [0.0, 0.0, 1.0, 0.0],
        [0.0, 0.0, 0.0, 1.0],
    ]
}

/// Une animation à échantillonner : un clip d'un [`Motion`], à une frame donnée.
#[derive(Clone, Copy)]
pub struct Echantillon<'a> {
    /// Le paquet d'animation.
    pub motion: &'a Motion,
    /// Les octets du `.g4mt` (le `Motion` n'en garde qu'un offset).
    pub data: &'a [u8],
    /// Le clip joué.
    pub clip: &'a Clip,
    /// La frame, **fractionnaire** : l'échantillonnage interpole entre deux clés.
    pub frame: f32,
}

/// Ce qu'a donné [`matrices_monde`] — les matrices, et ce qui n'a pas pu être animé.
#[derive(Debug, Clone)]
pub struct Poses {
    /// Une matrice monde par os, dans l'ordre du squelette.
    pub monde: Vec<Mat4>,
    /// Nombre d'os que l'animation pilote effectivement.
    pub os_animes: u32,
    /// Nombre d'os laissés à leur pose de repos faute de cible correspondante.
    pub os_au_repos: u32,
}

/// Matrices **monde** par os, à une frame — ou la pose de repos si `anim` est `None`.
///
/// Un os que l'animation ne pilote pas garde sa pose locale de repos ; c'est le comportement du
/// jeu et c'est ce qui permet d'animer un sous-arbre sans décrire tout le squelette.
///
/// Le squelette est supposé trié par **profondeur croissante** (un parent précède toujours ses
/// enfants), ce que garantit le format G4SK. Un parent d'index supérieur ou égal est traité
/// comme une racine plutôt que de lire une matrice pas encore calculée.
///
/// Rend `None` si le clip est **additif** : [`Motion::sample_local_trs`] le refuse, faute de
/// pose de base à superposer, et rendre la pose de repos ferait passer une animation absente
/// pour une animation neutre.
#[must_use]
pub fn matrices_monde(os: &[SkeletonBone], anim: Option<Echantillon<'_>>) -> Option<Poses> {
    if let Some(e) = anim
        && e.clip.is_additive()
    {
        return None;
    }
    // Cible d'animation de chaque os, par HASH. `resolve_targets` fait la même résolution en
    // partant des NOMS, donc en recalculant un CRC32 par couple (cible, os) ; `SkeletonBone`
    // porte déjà son hash, alors autant s'en servir.
    let cible_de = |bone: &SkeletonBone| -> Option<u16> {
        let e = anim?;
        e.motion
            .target_hashes
            .iter()
            .position(|&h| h == bone.hash)
            .and_then(|i| u16::try_from(i).ok())
    };

    let mut monde: Vec<Mat4> = Vec::with_capacity(os.len());
    let (mut animes, mut repos) = (0u32, 0u32);

    for (i, bone) in os.iter().enumerate() {
        let local_trs: LocalTrs = match (anim, cible_de(bone)) {
            (Some(e), Some(cible)) => {
                match e
                    .motion
                    .sample_local_trs(e.data, e.clip, cible, e.frame, bone.local)
                {
                    Some(trs) => {
                        animes += 1;
                        trs
                    }
                    None => {
                        repos += 1;
                        bone.local
                    }
                }
            }
            _ => {
                repos += 1;
                bone.local
            }
        };
        let local = g4sk::local_matrix(&local_trs);
        let m = match bone.parent {
            Some(p) if p < i => g4sk::mat_mul(&monde[p], &local),
            _ => local,
        };
        monde.push(m);
    }

    Some(Poses {
        monde,
        os_animes: animes,
        os_au_repos: repos,
    })
}

/// Matrices de **skinning** : `monde × inverse-bind`, par os.
///
/// C'est ce produit que [`deformer`] applique. Le calculer ici, une fois par frame, évite de le
/// refaire pour chaque primitive partageant le squelette.
#[must_use]
pub fn matrices_skinning(os: &[SkeletonBone], monde: &[Mat4]) -> Vec<Mat4> {
    os.iter()
        .enumerate()
        .map(|(i, bone)| match monde.get(i) {
            Some(m) => g4sk::mat_mul(m, &bone.inverse_bind),
            None => identite(),
        })
        .collect()
}

/// Applique une matrice col-major à un point (w = 1).
#[must_use]
fn transformer(m: &Mat4, p: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * p[0] + m[1][0] * p[1] + m[2][0] * p[2] + m[3][0],
        m[0][1] * p[0] + m[1][1] * p[1] + m[2][1] * p[2] + m[3][1],
        m[0][2] * p[0] + m[1][2] * p[1] + m[2][2] * p[2] + m[3][2],
    ]
}

/// Applique une matrice col-major à une **direction** (w = 0 : pas de translation).
#[must_use]
fn transformer_direction(m: &Mat4, v: [f32; 3]) -> [f32; 3] {
    [
        m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
        m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
        m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
    ]
}

/// Positions déformées d'une primitive.
///
/// `p' = Σ poids_i · skinning[os_i] · p`. Un sommet dont tous les poids sont nuls — ou dont les
/// indices d'os sortent de la palette — garde sa position d'origine plutôt que de s'effondrer
/// sur l'origine, qui est la forme la plus visible et la plus trompeuse de ce défaut.
#[must_use]
pub fn deformer(prim: &MeshPrimitive, skin: &PrimitiveSkin, skinning: &[Mat4]) -> Vec<Vec3> {
    prim.positions
        .iter()
        .enumerate()
        .map(|(v, p)| {
            let p = [p.x, p.y, p.z];
            let Some(acc) = melanger(skin, v, skinning, p, transformer) else {
                return Vec3 {
                    x: p[0],
                    y: p[1],
                    z: p[2],
                };
            };
            Vec3 {
                x: acc[0],
                y: acc[1],
                z: acc[2],
            }
        })
        .collect()
}

/// Normales déformées, renormalisées.
///
/// Les normales se transforment sans translation. On ignore le cas de l'échelle non uniforme,
/// qui demanderait l'inverse transposée : les squelettes de ce jeu n'en portent pas, et une
/// transposée inverse par os et par frame coûterait cher pour rien. **Si un squelette à échelle
/// anisotrope apparaît, c'est ici qu'il faudra revenir.**
#[must_use]
pub fn deformer_normales(
    prim: &MeshPrimitive,
    skin: &PrimitiveSkin,
    skinning: &[Mat4],
) -> Vec<Vec3> {
    prim.normals
        .iter()
        .enumerate()
        .map(|(v, n)| {
            let n = [n.x, n.y, n.z];
            let acc = melanger(skin, v, skinning, n, transformer_direction).unwrap_or(n);
            let len = (acc[0] * acc[0] + acc[1] * acc[1] + acc[2] * acc[2]).sqrt();
            if len <= f32::EPSILON {
                return Vec3 {
                    x: n[0],
                    y: n[1],
                    z: n[2],
                };
            }
            Vec3 {
                x: acc[0] / len,
                y: acc[1] / len,
                z: acc[2] / len,
            }
        })
        .collect()
}

/// Le mélange proprement dit. `None` si aucune influence valide n'a contribué.
fn melanger(
    skin: &PrimitiveSkin,
    v: usize,
    skinning: &[Mat4],
    p: [f32; 3],
    appliquer: fn(&Mat4, [f32; 3]) -> [f32; 3],
) -> Option<[f32; 3]> {
    let joints = skin.joints.get(v)?;
    let poids = skin.weights.get(v)?;
    let mut acc = [0.0f32; 3];
    let mut somme = 0.0f32;
    for (j, w) in joints.iter().zip(poids.iter()) {
        if *w == 0.0 {
            continue;
        }
        let Some(m) = skinning.get(*j as usize) else {
            continue;
        };
        let q = appliquer(m, p);
        acc[0] += q[0] * w;
        acc[1] += q[1] * w;
        acc[2] += q[2] * w;
        somme += *w;
    }
    (somme > 0.0).then_some(acc)
}

/// Somme des poids d'un sommet — l'invariant que toute palette bien formée respecte.
#[must_use]
pub fn somme_des_poids(skin: &PrimitiveSkin, v: usize) -> f32 {
    skin.weights.get(v).map_or(0.0, |w| w.iter().sum())
}

/// Nombre maximal d'influences réellement non nulles, sur toute la primitive.
#[must_use]
pub fn influences_max(skin: &PrimitiveSkin) -> usize {
    skin.weights
        .iter()
        .map(|w| w.iter().filter(|x| **x != 0.0).count())
        .max()
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use alloc::vec;

    use super::*;
    use crate::assemble::MeshComponent;
    use crate::g4sk::LocalTrs;

    fn repos() -> LocalTrs {
        LocalTrs {
            scale: [1.0, 1.0, 1.0],
            quat: [0.0, 0.0, 0.0, 1.0],
            translation: [0.0, 0.0, 0.0],
        }
    }

    fn os(nom: &str, parent: Option<usize>, trs: LocalTrs, inverse_bind: Mat4) -> SkeletonBone {
        SkeletonBone {
            hash: crate::cfgbin::crc32(nom.as_bytes()),
            name: alloc::string::String::from(nom),
            parent,
            local: trs,
            inverse_bind,
        }
    }

    fn primitive(positions: &[[f32; 3]]) -> MeshPrimitive {
        MeshPrimitive {
            component: MeshComponent::Body,
            source_index: 0,
            material_index: 0,
            material_name: alloc::string::String::new(),
            texture_uri: alloc::string::String::new(),
            positions: positions
                .iter()
                .map(|p| Vec3 {
                    x: p[0],
                    y: p[1],
                    z: p[2],
                })
                .collect(),
            normals: Vec::new(),
            uv0: Vec::new(),
            colors: Vec::new(),
            indices: vec![0, 1, 2],
            skin: None,
            piece: alloc::string::String::new(),
        }
    }

    /// Un seul os pesant 1,0 sur chaque sommet.
    fn skin_un_os(n: usize, os_index: u16) -> PrimitiveSkin {
        PrimitiveSkin {
            joints: vec![[os_index, 0, 0, 0, 0, 0, 0, 0]; n],
            weights: vec![[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]; n],
        }
    }

    /// **Identité.** Au repos, avec des inverse-bind cohérents, la déformation doit rendre les
    /// positions d'entrée. C'est le test qui attrape une convention de matrice inversée : une
    /// erreur col-major/row-major passe inaperçue sur une rotation pure et éclate ici.
    #[test]
    fn au_repos_la_deformation_est_l_identite() {
        // Un os translaté : sa matrice monde est T(2,3,4), son inverse-bind T(-2,-3,-4).
        let t = LocalTrs {
            translation: [2.0, 3.0, 4.0],
            ..repos()
        };
        let inv = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [-2.0, -3.0, -4.0, 1.0],
        ];
        let squelette = [os("root", None, t, inv)];
        let poses = matrices_monde(&squelette, None).expect("pose de repos");
        assert_eq!(poses.os_au_repos, 1);
        let skinning = matrices_skinning(&squelette, &poses.monde);

        let points = [[1.0, 0.0, 0.0], [0.0, 5.0, -2.0], [-3.0, 1.5, 7.0]];
        let prim = primitive(&points);
        let skin = skin_un_os(points.len(), 0);
        let sortie = deformer(&prim, &skin, &skinning);

        for (k, p) in points.iter().enumerate() {
            assert!((sortie[k].x - p[0]).abs() < 1e-6, "sommet {k} x");
            assert!((sortie[k].y - p[1]).abs() < 1e-6, "sommet {k} y");
            assert!((sortie[k].z - p[2]).abs() < 1e-6, "sommet {k} z");
        }
    }

    /// **Rigidité.** Un os unique à poids 1,0 ne peut que déplacer le nuage en bloc : toutes les
    /// distances entre sommets doivent être préservées. C'est plus fort que « ça a l'air de
    /// tourner » et cela n'exige aucun asset.
    #[test]
    fn un_os_unique_deforme_rigidement() {
        // Rotation de 90° autour de Y : quaternion (0, sin45, 0, cos45).
        let s = core::f32::consts::FRAC_1_SQRT_2;
        let tourne = LocalTrs {
            quat: [0.0, s, 0.0, s],
            ..repos()
        };
        let squelette = [os("root", None, tourne, identite())];
        let poses = matrices_monde(&squelette, None).expect("pose");
        let skinning = matrices_skinning(&squelette, &poses.monde);

        let points = [
            [1.0, 0.0, 0.0],
            [0.0, 2.0, 0.0],
            [0.0, 0.0, 3.0],
            [1.0, 1.0, 1.0],
        ];
        let prim = primitive(&points);
        let skin = skin_un_os(points.len(), 0);
        let sortie = deformer(&prim, &skin, &skinning);

        // Distances deux à deux préservées.
        for a in 0..points.len() {
            for b in (a + 1)..points.len() {
                let d0 = dist(points[a], points[b]);
                let d1 = dist(
                    [sortie[a].x, sortie[a].y, sortie[a].z],
                    [sortie[b].x, sortie[b].y, sortie[b].z],
                );
                assert!((d0 - d1).abs() < 1e-5, "paire ({a},{b}) : {d0} -> {d1}");
            }
        }
        // Et la rotation est bien celle demandée : (1,0,0) part sur (0,0,-1).
        assert!((sortie[0].x - 0.0).abs() < 1e-5, "x = {}", sortie[0].x);
        assert!((sortie[0].z + 1.0).abs() < 1e-5, "z = {}", sortie[0].z);
    }

    fn dist(a: [f32; 3], b: [f32; 3]) -> f32 {
        let d = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
        (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt()
    }

    /// La cinématique directe doit composer les parents. Un enfant translaté sous un parent
    /// tourné doit se retrouver là où la composition l'envoie, pas là où sa translation locale
    /// seule le mettrait.
    #[test]
    fn la_hierarchie_compose_les_parents() {
        let s = core::f32::consts::FRAC_1_SQRT_2;
        let parent = os(
            "root",
            None,
            LocalTrs {
                quat: [0.0, s, 0.0, s],
                ..repos()
            },
            identite(),
        );
        let enfant = os(
            "child",
            Some(0),
            LocalTrs {
                translation: [2.0, 0.0, 0.0],
                ..repos()
            },
            identite(),
        );
        let squelette = [parent, enfant];
        let poses = matrices_monde(&squelette, None).expect("pose");
        // La colonne 3 de la matrice monde de l'enfant est sa position : R(90°/Y)·(2,0,0) = (0,0,-2).
        let p = poses.monde[1][3];
        assert!(p[0].abs() < 1e-5, "x = {}", p[0]);
        assert!((p[2] + 2.0).abs() < 1e-5, "z = {}", p[2]);
    }

    /// Un sommet sans influence valide garde sa position. S'effondrer sur l'origine est le
    /// symptôme le plus visible d'un skinning cassé, et le plus facile à prendre pour un
    /// problème de modèle.
    #[test]
    fn un_sommet_sans_influence_garde_sa_position() {
        let squelette = [os("root", None, repos(), identite())];
        let poses = matrices_monde(&squelette, None).expect("pose");
        let skinning = matrices_skinning(&squelette, &poses.monde);
        let prim = primitive(&[[4.0, 5.0, 6.0]]);

        // Tous les poids à zéro.
        let vide = PrimitiveSkin {
            joints: vec![[0; 8]],
            weights: vec![[0.0; 8]],
        };
        let sortie = deformer(&prim, &vide, &skinning);
        assert_eq!((sortie[0].x, sortie[0].y, sortie[0].z), (4.0, 5.0, 6.0));

        // Indice d'os hors palette : même règle, et surtout pas de panique.
        let hors = PrimitiveSkin {
            joints: vec![[999, 0, 0, 0, 0, 0, 0, 0]],
            weights: vec![[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]],
        };
        let sortie = deformer(&prim, &hors, &skinning);
        assert_eq!((sortie[0].x, sortie[0].y, sortie[0].z), (4.0, 5.0, 6.0));
    }

    /// Les helpers de mesure disent la vérité : ce sont eux qui serviront à vérifier une palette
    /// réelle, donc ils doivent être justes sur une palette fabriquée.
    #[test]
    fn les_mesures_de_palette_sont_justes() {
        let skin = PrimitiveSkin {
            joints: vec![[0, 1, 2, 0, 0, 0, 0, 0]],
            weights: vec![[0.5, 0.25, 0.25, 0.0, 0.0, 0.0, 0.0, 0.0]],
        };
        assert!((somme_des_poids(&skin, 0) - 1.0).abs() < 1e-6);
        assert_eq!(influences_max(&skin), 3);
        assert_eq!(
            somme_des_poids(&skin, 7),
            0.0,
            "un sommet absent ne doit pas paniquer"
        );
    }
}
