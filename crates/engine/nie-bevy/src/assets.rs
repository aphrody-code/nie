//! Conversion des formats du jeu vers les types d'assets Bevy.
//!
//! Chaque fonction part des **octets réels** d'un fichier du VFS et rend un type Bevy. Aucune
//! étape intermédiaire, aucun export sur disque : c'est ce qui rend l'intégration native plutôt
//! qu'un pont.
//!
//! Le décodage n'est pas réécrit ici. `nie_formats::g4tx_decode` sait lire le BC7 et le BGRA8
//! des atlas, `nie_formats::g4mg` sait extraire positions, normales, UV et skinning ; ils sont
//! éprouvés par le rendu, la police bitmap et le recoloriage. Ce module les raccorde au contrat
//! d'asset de Bevy — une seconde implémentation dériverait de la première.

use bevy_asset::RenderAssetUsages;
use bevy_image::Image;
use bevy_mesh::{Indices, Mesh, PrimitiveTopology, VertexAttributeValues};
use nie_formats::g4mg::{self, SubmeshGeometry, VertexSkin};
use nie_formats::{g4md, g4tx};
use wgpu_types::{Extent3d, TextureDimension, TextureFormat};

use crate::NiersAssetError;

// ─── Textures ────────────────────────────────────────────────────────────────────────────────

/// Convertit la texture d'indice `index` d'un conteneur G4TX en [`Image`] Bevy.
///
/// Les atlas du jeu sont des DDS BC7 ou BGRA8 ; `nie_formats` les normalise en RGBA8 non
/// pré-multiplié, ce qui est exactement `TextureFormat::Rgba8UnormSrgb`.
///
/// # Choix de l'espace colorimétrique
///
/// `Rgba8UnormSrgb` et non `Rgba8Unorm` : ces atlas portent des couleurs d'albédo, donc des
/// valeurs perceptuelles. Les déclarer linéaires assombrirait tout le rendu d'une correction
/// gamma manquante — un défaut qui se lit comme un problème d'éclairage et qu'on irait donc
/// chercher dans les lumières.
///
/// # Errors
///
/// - le conteneur ne se décode pas ([`NiersAssetError::Decode`]) ;
/// - il ne porte aucune texture, ou pas celle demandée ([`NiersAssetError::Empty`]) ;
/// - le payload n'est pas un DDS exploitable ([`NiersAssetError::Unsupported`]).
pub fn image_from_g4tx(bytes: &[u8], index: usize) -> Result<Image, NiersAssetError> {
    let atlas = g4tx::parse(bytes).map_err(|error| NiersAssetError::Decode {
        format: "g4tx",
        reason: error.to_string(),
    })?;

    let texture = atlas
        .textures
        .get(index)
        .ok_or_else(|| NiersAssetError::Empty {
            format: "g4tx",
            reason: format!(
                "texture {index} requested, the container carries {}",
                atlas.textures.len()
            ),
        })?;

    let (width, height, rgba) = nie_formats::g4tx_decode::decode_texture_rgba(bytes, texture)
        .ok_or_else(|| NiersAssetError::Unsupported {
            format: "g4tx",
            reason: format!(
                "`{}` has no decodable DDS payload ({}x{})",
                texture.name, texture.width, texture.height
            ),
        })?;

    Ok(Image::new(
        Extent3d {
            width,
            height,
            depth_or_array_layers: 1,
        },
        TextureDimension::D2,
        rgba,
        TextureFormat::Rgba8UnormSrgb,
        RenderAssetUsages::default(),
    ))
}

/// Nombre de textures d'un conteneur G4TX, sans en décoder aucune.
///
/// Un chargeur d'asset a besoin de savoir ce qu'un fichier contient avant de payer le décodage
/// BC7 de chaque plan.
///
/// # Errors
///
/// Le conteneur ne se décode pas.
pub fn g4tx_texture_count(bytes: &[u8]) -> Result<usize, NiersAssetError> {
    g4tx::parse(bytes)
        .map(|atlas| atlas.textures.len())
        .map_err(|error| NiersAssetError::Decode {
            format: "g4tx",
            reason: error.to_string(),
        })
}

// ─── Maillages ───────────────────────────────────────────────────────────────────────────────

/// Nombre d'influences de skinning qu'un sommet Bevy peut porter.
///
/// `Mesh::ATTRIBUTE_JOINT_INDEX` est `Uint16x4` et `ATTRIBUTE_JOINT_WEIGHT` `Float32x4` : quatre,
/// là où le jeu en stocke huit (`VertexSkin`). La réduction est **lossy** ; voir
/// [`reduce_influences`].
pub const BEVY_INFLUENCES: usize = 4;

/// Réduit les huit influences d'un sommet du jeu aux quatre que Bevy accepte.
///
/// Les quatre poids **les plus forts** sont gardés — pas les quatre premiers : l'ordre de
/// stockage du jeu n'est pas un ordre d'importance, et sur un sommet de coude le poids dominant
/// peut être en cinquième position. Les poids retenus sont **renormalisés** pour sommer à 1, sinon
/// le sommet se contracterait vers l'origine en proportion du poids abandonné — ce qui se lit
/// comme un maillage qui fond, pas comme une réduction d'influences.
///
/// À égalité de poids, le premier stocké gagne (tri stable). Un poids non fini compte pour zéro.
/// Un sommet sans aucun poids utile est rattaché entièrement à la jointure 0 : c'est la
/// convention de repli la moins surprenante, et elle ne peut pas produire de `NaN` en aval.
///
/// Ce que la réduction perd est mesurable : la somme des poids abandonnés. Elle n'est pas
/// publiée ici parce qu'aucun consommateur ne la lit encore ; le jour où un contrôle de qualité
/// la voudra, elle se calcule depuis les mêmes entrées.
#[must_use]
pub fn reduce_influences(bones: &[u8; 8], weights: &[f32; 8]) -> ([u16; 4], [f32; 4]) {
    let mut order: [usize; 8] = [0, 1, 2, 3, 4, 5, 6, 7];
    let weight_of = |slot: usize| -> f32 {
        let w = weights[slot];
        if w.is_finite() && w > 0.0 { w } else { 0.0 }
    };
    // Tri STABLE décroissant : à poids égal, le premier stocké reste devant.
    order.sort_by(|a, b| weight_of(*b).total_cmp(&weight_of(*a)));

    let kept = &order[..BEVY_INFLUENCES];
    let total: f32 = kept.iter().map(|slot| weight_of(*slot)).sum();
    if total <= 0.0 {
        return ([0; 4], [1.0, 0.0, 0.0, 0.0]);
    }

    let mut joints = [0u16; 4];
    let mut out = [0f32; 4];
    for (i, slot) in kept.iter().enumerate() {
        joints[i] = u16::from(bones[*slot]);
        out[i] = weight_of(*slot) / total;
    }
    (joints, out)
}

/// Construit un [`Mesh`] Bevy depuis la géométrie extraite d'une sous-maille.
///
/// Positions et indices sont obligatoires. Les normales sont reprises si la sous-maille en porte
/// autant que de positions, sinon **calculées** (`compute_smooth_normals`) — un maillage sans
/// normale ne s'éclaire pas, et Bevy ne les invente pas seul. Les UV ne sont insérés que s'ils
/// couvrent chaque sommet : un tableau d'UV partiel n'a pas de sens et serait une donnée
/// incohérente, pas un maillage sans texture.
///
/// # Pourquoi valider les indices ici
///
/// `Mesh` fait confiance à ses indices. Un indice hors table ne casse rien à la construction :
/// il devient une lecture hors limites au moment du rendu, sur le GPU ou dans `compute_*`, loin
/// du fichier fautif. Le premier keshin du corpus (`k000010`) indexe dans l'espace global du
/// G4MG, pas dans celui de la sous-maille : c'est exactement le cas qui doit rendre une erreur
/// nommée et non un panic.
///
/// # Errors
///
/// - positions ou indices vides ([`NiersAssetError::Empty`]) ;
/// - nombre d'indices non multiple de trois, indice hors table, UV ou skinning de longueur
///   différente des positions ([`NiersAssetError::Unsupported`]).
pub fn mesh_from_geometry(
    geometry: &SubmeshGeometry,
    skin: Option<&[VertexSkin]>,
) -> Result<Mesh, NiersAssetError> {
    let vertex_count = geometry.positions.len();
    if vertex_count == 0 {
        return Err(NiersAssetError::Empty {
            format: "g4mg",
            reason: format!("submesh {} has no vertex", geometry.index),
        });
    }
    if geometry.indices.is_empty() {
        return Err(NiersAssetError::Empty {
            format: "g4mg",
            reason: format!("submesh {} has no index", geometry.index),
        });
    }
    if !geometry.indices.len().is_multiple_of(3) {
        return Err(NiersAssetError::Unsupported {
            format: "g4mg",
            reason: format!(
                "submesh {}: {} indices is not a whole number of triangles",
                geometry.index,
                geometry.indices.len()
            ),
        });
    }
    if let Some(out_of_range) = geometry
        .indices
        .iter()
        .copied()
        .find(|index| *index as usize >= vertex_count)
    {
        return Err(NiersAssetError::Unsupported {
            format: "g4mg",
            reason: format!(
                "submesh {}: index {out_of_range} but only {vertex_count} vertices (global index space?)",
                geometry.index
            ),
        });
    }
    if !geometry.uv0.is_empty() && geometry.uv0.len() != vertex_count {
        return Err(NiersAssetError::Unsupported {
            format: "g4mg",
            reason: format!(
                "submesh {}: {} uv for {vertex_count} vertices",
                geometry.index,
                geometry.uv0.len()
            ),
        });
    }
    if let Some(skin) = skin
        && skin.len() != vertex_count
    {
        return Err(NiersAssetError::Unsupported {
            format: "g4mg",
            reason: format!(
                "submesh {}: {} skinned vertices for {vertex_count} positions",
                geometry.index,
                skin.len()
            ),
        });
    }

    let positions: Vec<[f32; 3]> = geometry
        .positions
        .iter()
        .map(|p| [p.x, p.y, p.z])
        .collect();
    let mut mesh = Mesh::new(PrimitiveTopology::TriangleList, RenderAssetUsages::default())
        .with_inserted_attribute(Mesh::ATTRIBUTE_POSITION, positions)
        .with_inserted_indices(Indices::U32(geometry.indices.clone()));

    if geometry.normals.len() == vertex_count {
        let normals: Vec<[f32; 3]> = geometry
            .normals
            .iter()
            .map(|n| [n.x, n.y, n.z])
            .collect();
        mesh.insert_attribute(Mesh::ATTRIBUTE_NORMAL, normals);
    } else {
        mesh.compute_smooth_normals();
    }

    if !geometry.uv0.is_empty() {
        let uv: Vec<[f32; 2]> = geometry.uv0.iter().map(|t| [t.u, t.v]).collect();
        mesh.insert_attribute(Mesh::ATTRIBUTE_UV_0, uv);
    }

    if let Some(skin) = skin {
        let mut joints = Vec::with_capacity(vertex_count);
        let mut weights = Vec::with_capacity(vertex_count);
        for vertex in skin {
            let (j, w) = reduce_influences(&vertex.bones, &vertex.weights);
            joints.push(j);
            weights.push(w);
        }
        // `Uint16x4` n'a pas de `From<Vec<[u16; 4]>>` : la variante doit être nommée.
        mesh.insert_attribute(
            Mesh::ATTRIBUTE_JOINT_INDEX,
            VertexAttributeValues::Uint16x4(joints),
        );
        mesh.insert_attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT, weights);
    }

    Ok(mesh)
}

/// Convertit toutes les sous-mailles d'un couple G4MD (descripteur) + G4MG (géométrie) en
/// [`Mesh`] Bevy, dans l'ordre du descripteur.
///
/// Le skinning est joint quand la sous-maille en porte ; une sous-maille sans attributs
/// WEIGHTS/INDICES rend un maillage rigide, ce n'est pas une erreur.
///
/// # Errors
///
/// - le G4MD ne se décode pas ([`NiersAssetError::Decode`]) ;
/// - il ne décrit aucune sous-maille ([`NiersAssetError::Empty`]) ;
/// - une sous-maille échoue [`mesh_from_geometry`] — l'erreur porte son index.
pub fn meshes_from_g4md_g4mg(md: &[u8], mg: &[u8]) -> Result<Vec<Mesh>, NiersAssetError> {
    let descriptor = g4md::parse(md).map_err(|error| NiersAssetError::Decode {
        format: "g4md",
        reason: error.to_string(),
    })?;
    let geometries = g4mg::extract_geometry(mg, &descriptor);
    if geometries.is_empty() {
        return Err(NiersAssetError::Empty {
            format: "g4mg",
            reason: "the descriptor lists no submesh".to_owned(),
        });
    }
    geometries
        .iter()
        .map(|geometry| {
            let skin = g4mg::extract_skin(mg, &descriptor, geometry.index);
            mesh_from_geometry(geometry, skin.as_deref())
        })
        .collect()
}

/// Convertit une seule sous-maille d'un couple G4MD + G4MG.
///
/// # Errors
///
/// Comme [`meshes_from_g4md_g4mg`], plus [`NiersAssetError::Empty`] si `submesh` dépasse le
/// nombre de sous-mailles.
pub fn mesh_from_g4md_g4mg(md: &[u8], mg: &[u8], submesh: usize) -> Result<Mesh, NiersAssetError> {
    let descriptor = g4md::parse(md).map_err(|error| NiersAssetError::Decode {
        format: "g4md",
        reason: error.to_string(),
    })?;
    let geometries = g4mg::extract_geometry(mg, &descriptor);
    let geometry = geometries
        .iter()
        .find(|geometry| geometry.index == submesh)
        .ok_or_else(|| NiersAssetError::Empty {
            format: "g4mg",
            reason: format!(
                "submesh {submesh} requested, the descriptor lists {}",
                geometries.len()
            ),
        })?;
    let skin = g4mg::extract_skin(mg, &descriptor, submesh);
    mesh_from_geometry(geometry, skin.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;
    use nie_formats::g4mg::{Vec2, Vec3};

    fn triangle() -> SubmeshGeometry {
        SubmeshGeometry {
            index: 0,
            vertex_count: 3,
            stride: 0,
            material_index: 0,
            index32: false,
            positions: vec![
                Vec3 { x: 0.0, y: 0.0, z: 0.0 },
                Vec3 { x: 1.0, y: 0.0, z: 0.0 },
                Vec3 { x: 0.0, y: 1.0, z: 0.0 },
            ],
            normals: Vec::new(),
            uv0: Vec::new(),
            colors: Vec::new(),
            indices: vec![0, 1, 2],
        }
    }

    /// Les quatre poids les plus FORTS sont gardés, renormalisés — pas les quatre premiers.
    ///
    /// Valeurs calculées à la main : sur `[0.1, 0.4, 0.05, 0.2, 0.15, 0.1, 0, 0]`, les quatre
    /// plus forts sont les emplacements 1, 3, 4 puis 0 (0.1 en position 0 devance le 0.1 en
    /// position 5 par stabilité), somme 0.85.
    #[test]
    fn les_quatre_poids_les_plus_forts_sont_gardes_et_renormalises() {
        let bones = [10, 11, 12, 13, 14, 15, 16, 17];
        let weights = [0.1, 0.4, 0.05, 0.2, 0.15, 0.1, 0.0, 0.0];
        let (joints, out) = reduce_influences(&bones, &weights);
        assert_eq!(joints, [11, 13, 14, 10]);
        let expected = [0.4 / 0.85, 0.2 / 0.85, 0.15 / 0.85, 0.1 / 0.85];
        for (got, want) in out.iter().zip(expected) {
            assert!((got - want).abs() < 1e-6, "{out:?} vs {expected:?}");
        }
        assert!((out.iter().sum::<f32>() - 1.0).abs() < 1e-6);
    }

    /// Un sommet sans poids utile se rattache entièrement à la jointure 0, sans `NaN`.
    #[test]
    fn un_sommet_sans_poids_se_rattache_a_la_jointure_zero() {
        let (joints, out) = reduce_influences(&[3; 8], &[0.0; 8]);
        assert_eq!(joints, [0; 4]);
        assert_eq!(out, [1.0, 0.0, 0.0, 0.0]);
        let (_, nan_case) = reduce_influences(&[3; 8], &[f32::NAN; 8]);
        assert!(nan_case.iter().all(|w| w.is_finite()));
    }

    /// Un triangle sans normale reçoit une normale calculée : `+Z` pour un tour direct dans XY.
    #[test]
    fn un_triangle_sans_normale_en_recoit_une_calculee() {
        let mesh = mesh_from_geometry(&triangle(), None).expect("triangle valide");
        assert_eq!(mesh.count_vertices(), 3);
        assert_eq!(mesh.indices().map(Indices::len), Some(3));
        let normals = mesh
            .attribute(Mesh::ATTRIBUTE_NORMAL)
            .and_then(VertexAttributeValues::as_float3)
            .expect("normales présentes");
        for n in normals {
            assert!((n[0]).abs() < 1e-6 && (n[1]).abs() < 1e-6 && (n[2] - 1.0).abs() < 1e-6, "{n:?}");
        }
    }

    /// Un indice hors table est une ERREUR nommée, jamais un maillage qui panique au rendu.
    #[test]
    fn un_indice_hors_table_est_refuse() {
        let mut geometry = triangle();
        geometry.indices = vec![0, 1, 7];
        let error = mesh_from_geometry(&geometry, None).expect_err("refus attendu");
        assert!(matches!(error, NiersAssetError::Unsupported { format: "g4mg", .. }), "{error}");
        assert!(error.to_string().contains('7'), "{error}");
    }

    /// Un nombre d'indices qui n'est pas un multiple de trois est refusé de même.
    #[test]
    fn un_nombre_dindices_non_multiple_de_trois_est_refuse() {
        let mut geometry = triangle();
        geometry.indices = vec![0, 1];
        assert!(matches!(
            mesh_from_geometry(&geometry, None),
            Err(NiersAssetError::Unsupported { .. })
        ));
    }

    /// Des UV qui ne couvrent pas chaque sommet sont une incohérence, pas un maillage sans texture.
    #[test]
    fn des_uv_partiels_sont_refuses() {
        let mut geometry = triangle();
        geometry.uv0 = vec![Vec2 { u: 0.0, v: 0.0 }];
        assert!(matches!(
            mesh_from_geometry(&geometry, None),
            Err(NiersAssetError::Unsupported { .. })
        ));
    }

    /// Le skinning est réduit à quatre influences et posé sur le maillage.
    #[test]
    fn le_skinning_est_pose_en_quatre_influences() {
        let skin = vec![
            VertexSkin {
                bones: [1, 2, 3, 4, 5, 6, 7, 8],
                weights: [0.5, 0.5, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            };
            3
        ];
        let mesh = mesh_from_geometry(&triangle(), Some(&skin)).expect("triangle skinné");
        let joints = mesh
            .attribute(Mesh::ATTRIBUTE_JOINT_INDEX)
            .expect("indices de jointure");
        assert!(matches!(joints, VertexAttributeValues::Uint16x4(v) if v.len() == 3 && v[0] == [1, 2, 3, 4]));
        // `VertexAttributeValues` n'expose `as_float3` que pour les triplets : pour un
        // `Float32x4` il faut nommer la variante.
        let VertexAttributeValues::Float32x4(weights) = mesh
            .attribute(Mesh::ATTRIBUTE_JOINT_WEIGHT)
            .expect("poids de jointure")
        else {
            panic!("les poids de jointure doivent être des Float32x4");
        };
        assert_eq!(weights.len(), 3);
        assert!((weights[0][0] - 0.5).abs() < 1e-6 && (weights[0][1] - 0.5).abs() < 1e-6);
    }

    /// Un tampon quelconque est refusé en NOMMANT le format attendu.
    #[test]
    fn un_tampon_quelconque_est_refuse_en_nommant_le_format() {
        let error = image_from_g4tx(b"not a g4tx", 0).expect_err("refus attendu");
        assert!(matches!(error, NiersAssetError::Decode { format: "g4tx", .. }), "{error}");
        let error = meshes_from_g4md_g4mg(b"not a g4md", b"").expect_err("refus attendu");
        assert!(matches!(error, NiersAssetError::Decode { format: "g4md", .. }), "{error}");
    }

    /// Un vrai atlas du jeu devient une [`Image`] Bevy aux dimensions déclarées.
    ///
    /// Conditionnel : l'atlas reste dans l'installation du joueur, aucun octet du jeu n'est
    /// écrit. Le saut est annoncé sur `stderr` : un golden qui ne s'exécute pas doit se voir.
    #[test]
    fn un_atlas_reel_devient_une_image_bevy() {
        use nie_formats::vfs::{self, Vfs};

        let mut v = Vfs::new();
        if v.init(vfs::resolve_game_dir().join("data")).is_err() {
            eprintln!("SKIP: game VFS unavailable");
            return;
        }
        let Some(path) = v
            .iter()
            .map(|(path, _)| path.to_string())
            .find(|path| path.ends_with(".g4tx"))
        else {
            eprintln!("SKIP: no .g4tx in this VFS");
            return;
        };
        let Ok(bytes) = v.read(&path) else {
            eprintln!("SKIP: {path} unreadable");
            return;
        };

        let count = g4tx_texture_count(&bytes).expect("decodable container");
        assert!(count > 0, "{path} carries no texture");
        match image_from_g4tx(&bytes, 0) {
            Ok(image) => {
                let size = image.texture_descriptor.size;
                assert!(size.width > 0 && size.height > 0, "empty image from {path}");
                assert_eq!(
                    image.data.as_ref().map(Vec::len),
                    Some((size.width * size.height * 4) as usize),
                    "the RGBA buffer must cover the image exactly"
                );
                eprintln!("{path} -> Bevy Image {}x{}, {count} textures in the atlas", size.width, size.height);
            }
            Err(NiersAssetError::Unsupported { .. }) => eprintln!("SKIP: {path} has no DDS payload"),
            Err(other) => panic!("{path}: {other}"),
        }
    }

    /// Un vrai modèle du jeu devient des [`Mesh`] Bevy — ou une erreur NOMMÉE quand ses indices
    /// vivent dans l'espace global du G4MG, ce qui est le cas connu de `k000010`.
    #[test]
    fn un_modele_reel_devient_des_meshes_bevy_ou_une_erreur_nommee() {
        use nie_formats::vfs::{self, Vfs};

        let mut v = Vfs::new();
        if v.init(vfs::resolve_game_dir().join("data")).is_err() {
            eprintln!("SKIP: game VFS unavailable");
            return;
        }
        let candidates = [
            "data/common/chr/_face/11_VICTORY/c11010010/c11010010",
            "data/common/chr/_keshin/k000010/k000010",
        ];
        // Trois issues à distinguer : aucun candidat dans ce VFS (saut), un candidat converti
        // (succès), un candidat présent qui ne convertit ni ne refuse proprement (échec). Les
        // confondre ferait passer ce test au vert sur un VFS qui ne porte aucun modèle — c'est
        // le cas quand `NIE_GAME_DIR` pointe le dépôt plutôt que l'installation du jeu.
        let mut present = 0usize;
        let mut converted = 0usize;
        for stem in candidates {
            let (Ok(md), Ok(mg)) = (v.read(&format!("{stem}.g4md")), v.read(&format!("{stem}.g4mg"))) else {
                eprintln!("SKIP: {stem} absent from this VFS");
                continue;
            };
            present += 1;
            match meshes_from_g4md_g4mg(&md, &mg) {
                Ok(meshes) => {
                    assert!(!meshes.is_empty());
                    let vertices: usize = meshes.iter().map(Mesh::count_vertices).sum();
                    assert!(vertices > 0);
                    for mesh in &meshes {
                        assert!(mesh.indices().is_some(), "{stem}: mesh without indices");
                        assert!(mesh.attribute(Mesh::ATTRIBUTE_NORMAL).is_some(), "{stem}: mesh without normals");
                    }
                    eprintln!("{stem} -> {} Bevy meshes, {vertices} vertices", meshes.len());
                    converted += 1;
                }
                // Deux refus NOMMÉS sont légitimes sur un modèle réel : `Unsupported` quand les
                // indices sortent de la table, `Empty` quand l'extraction n'en rend aucun — c'est
                // le cas de `k000010`, dont la géométrie vit dans l'espace global du G4MG. Ce qui
                // ne serait pas légitime, c'est un panic ou une erreur sans cause lisible.
                Err(error @ (NiersAssetError::Unsupported { .. } | NiersAssetError::Empty { .. })) => {
                    eprintln!("{stem}: named refusal, as designed: {error}");
                }
                Err(other) => panic!("{stem}: {other}"),
            }
        }
        if present == 0 {
            eprintln!("SKIP: no candidate model in this VFS (is NIE_GAME_DIR the game install?)");
            return;
        }
        assert!(converted > 0, "{present} candidate(s) present, none converted");
    }
}
