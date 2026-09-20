//! Document de scène partagé par les hôtes natifs et web, indépendant du jeu d'origine.
use crate::glb::Model;
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

/// Objet éditable ; le chemin de l'asset est résolu par l'hôte, pas par le moteur.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneObject {
    /// Nom dans la hiérarchie.
    pub name: String,
    /// Référence de ressource GLB.
    pub asset: String,
    /// Translation en unités monde.
    pub position: [f32; 3],
    /// Rotation autour de Y, en degrés.
    pub yaw: f32,
    /// Échelle par axe, strictement positive.
    pub scale: [f32; 3],
    /// Présence dans le rendu.
    pub visible: bool,
}

/// Projet sérialisable réutilisable sans fenêtre, VFS ni API graphique.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SceneDocument {
    /// Version du contrat de document.
    pub version: u32,
    /// Objets dans l'ordre de la hiérarchie.
    pub objects: Vec<SceneObject>,
}

impl Default for SceneDocument {
    fn default() -> Self {
        Self {
            version: 1,
            objects: vec![],
        }
    }
}

impl SceneDocument {
    /// Refuse les versions inconnues et les valeurs qui feraient dégénérer le rendu.
    pub fn validate(&self) -> Result<()> {
        ensure!(self.version == 1, "version de scène non prise en charge");
        ensure!(self.objects.len() <= 128, "maximum 128 objets par scène");
        for object in &self.objects {
            ensure!(
                !object.asset.is_empty() && object.asset.len() <= 4096,
                "référence d'asset invalide"
            );
            ensure!(object.name.len() <= 256, "nom d'objet trop long");
            ensure!(
                object
                    .position
                    .iter()
                    .all(|v| v.is_finite() && v.abs() <= 1e6),
                "position invalide"
            );
            ensure!(object.yaw.is_finite(), "rotation invalide");
            ensure!(
                object
                    .scale
                    .iter()
                    .all(|v| v.is_finite() && (0.001..=1000.0).contains(v)),
                "échelle invalide"
            );
        }
        Ok(())
    }

    /// Compose les objets pour téléversement GPU. À appeler lors d'une édition, pas par image.
    /// Le résolveur permet de partager le même document entre disque, VFS et navigateur.
    pub fn compose(&self, mut resolve: impl FnMut(&str) -> Result<Model>) -> Result<Model> {
        self.validate()?;
        let mut scene = Model {
            primitives: vec![],
            textures: vec![],
        };
        for object in self.objects.iter().filter(|o| o.visible) {
            let mut model = resolve(&object.asset)?;
            let texture_base = scene.textures.len();
            let (s, c) = object.yaw.to_radians().sin_cos();
            let rotate = |v: [f32; 3]| [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
            for primitive in &mut model.primitives {
                for point in &mut primitive.positions {
                    *point = rotate(std::array::from_fn(|i| point[i] * object.scale[i]));
                    for (v, offset) in point.iter_mut().zip(object.position) {
                        *v += offset;
                    }
                }
                for normal in &mut primitive.normals {
                    *normal = rotate(std::array::from_fn(|i| normal[i] / object.scale[i]));
                    let length = normal.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-12);
                    for v in normal {
                        *v /= length;
                    }
                }
                primitive.texture = primitive.texture.map(|t| t + texture_base);
            }
            scene.primitives.extend(model.primitives);
            scene.textures.extend(model.textures);
        }
        Ok(scene)
    }
}

/// Editable scene object used by the version 2 document contract.
///
/// [`SceneObject`] deliberately remains unchanged so existing v1 callers and struct literals keep
/// compiling. Hosts can migrate a v1 document with [`SceneDocumentV2::from_v1`].
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SceneObjectV2 {
    /// Persisted identifier within a v2 document.
    ///
    /// V1 migration derives a deterministic initial value from object order. That value is not
    /// stable across a fresh migration after the v1 objects have been reordered; once saved as
    /// v2, the identifier is data and must be preserved by editors.
    ///
    /// Absent from an incoming payload, it is empty; the editing session mints one. Once saved,
    /// it is data and must be preserved.
    #[serde(default)]
    pub id: String,
    /// Optional parent object identifier.
    #[serde(default)]
    pub parent: Option<String>,
    pub name: String,
    pub asset: String,
    /// Translation local to `parent`, or world-space translation for a root.
    pub position: [f32; 3],
    /// Unit quaternion local to `parent`, in `[x, y, z, w]` order.
    pub rotation: [f32; 4],
    /// Scale local to `parent`.
    pub scale: [f32; 3],
    /// Local visibility. An object is effectively visible only when it and every ancestor are
    /// visible.
    pub visible: bool,
}

/// Version 2 scene document. Kept as a separate type to preserve the public v1 Rust API.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SceneDocumentV2 {
    pub version: u32,
    pub objects: Vec<SceneObjectV2>,
}

impl Default for SceneDocumentV2 {
    fn default() -> Self {
        Self {
            version: 2,
            objects: vec![],
        }
    }
}

impl SceneObjectV2 {
    /// Upgrades one v1 object, keeping its yaw as a rotation about Y.
    ///
    /// The identifier is left EMPTY: only the owner of the whole document knows which ones are
    /// already taken, so minting one here would invent a collision.
    #[must_use]
    pub fn from_v1_object(object: &SceneObject) -> Self {
        let mut upgraded = Self {
            id: String::new(),
            parent: None,
            name: object.name.clone(),
            asset: object.asset.clone(),
            position: object.position,
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: object.scale,
            visible: object.visible,
        };
        upgraded.set_yaw_degrees(object.yaw);
        upgraded
    }

    /// Le lacet, en degrés : la rotation autour de Y que porte le quaternion.
    ///
    /// Le document v1 ne savait exprimer que celle-là, et l'éditeur natif n'expose toujours
    /// qu'elle. La lire du quaternion plutôt que de la stocker à côté évite deux sources de
    /// vérité pour la même rotation.
    #[must_use]
    pub fn yaw_degrees(&self) -> f32 {
        let [x, y, z, w] = self.rotation;
        let sin = 2.0f32.mul_add(w * y, 2.0 * x * z);
        let cos = 2.0f32.mul_add(-(y * y + z * z), 1.0);
        sin.atan2(cos).to_degrees()
    }

    /// Remplace la rotation par ce seul lacet.
    ///
    /// C'est un REMPLACEMENT, pas une composition : une inclinaison posée par le gizmo du
    /// viewport disparaît. L'éditeur natif n'offre pas d'autre axe, donc il ne peut pas en
    /// détruire un qu'il montrerait.
    pub fn set_yaw_degrees(&mut self, degrees: f32) {
        let half = degrees.to_radians() * 0.5;
        self.rotation = [0.0, half.sin(), 0.0, half.cos()];
    }
}

impl SceneDocumentV2 {
    /// Loads either persisted document version and returns the current v2 representation.
    /// Unknown fields are ignored by serde so additive schema changes remain readable; an
    /// unsupported explicit version is still rejected.
    pub fn from_json(json: &str) -> Result<Self> {
        let header: serde_json::Value = serde_json::from_str(json)?;
        let version = header
            .get("version")
            .and_then(serde_json::Value::as_u64)
            .ok_or_else(|| anyhow::anyhow!("version de scène absente ou invalide"))?;
        match version {
            1 => {
                let document: SceneDocument = serde_json::from_value(header)?;
                document.validate()?;
                Ok(Self::from_v1(&document))
            }
            2 => {
                let document: Self = serde_json::from_value(header)?;
                document.validate()?;
                Ok(document)
            }
            _ => anyhow::bail!("version de scène non prise en charge: {version}"),
        }
    }

    /// Deterministically upgrades a v1 document without changing its rendered transforms.
    #[must_use]
    pub fn from_v1(document: &SceneDocument) -> Self {
        let objects = document
            .objects
            .iter()
            .enumerate()
            .map(|(index, object)| SceneObjectV2 {
                id: format!("object-{index}"),
                ..SceneObjectV2::from_v1_object(object)
            })
            .collect();
        Self {
            version: 2,
            objects,
        }
    }

    /// Validates identifiers, hierarchy and finite full-TRS values.
    pub fn validate(&self) -> Result<()> {
        ensure!(self.version == 2, "version de scène non prise en charge");
        // V1 keeps its historical 128-object rendering guard. V2 is an authoring document and
        // permits larger hierarchies while retaining a finite denial-of-service bound.
        ensure!(self.objects.len() <= 4096, "maximum 4096 objets par scène");

        let mut ids = HashSet::with_capacity(self.objects.len());
        for object in &self.objects {
            ensure!(
                !object.id.is_empty() && object.id.len() <= 256,
                "identifiant d'objet invalide"
            );
            ensure!(
                ids.insert(object.id.as_str()),
                "identifiant d'objet dupliqué"
            );
            ensure!(
                !object.asset.is_empty() && object.asset.len() <= 4096,
                "référence d'asset invalide"
            );
            ensure!(object.name.len() <= 256, "nom d'objet trop long");
            ensure!(
                object
                    .position
                    .iter()
                    .all(|v| v.is_finite() && v.abs() <= 1e6),
                "position invalide"
            );
            ensure!(
                object.rotation.iter().all(|v| v.is_finite()),
                "rotation invalide"
            );
            let norm_sq = object.rotation.iter().map(|v| v * v).sum::<f32>();
            ensure!(
                norm_sq.is_finite() && (norm_sq - 1.0).abs() <= 1e-4,
                "quaternion non normalisé"
            );
            ensure!(
                object
                    .scale
                    .iter()
                    .all(|v| v.is_finite() && (0.001..=1000.0).contains(v)),
                "échelle invalide"
            );
        }

        let parents: HashMap<&str, Option<&str>> = self
            .objects
            .iter()
            .map(|object| (object.id.as_str(), object.parent.as_deref()))
            .collect();
        for object in &self.objects {
            let mut seen = HashSet::new();
            let mut current = object.parent.as_deref();
            while let Some(parent) = current {
                ensure!(parent != object.id, "cycle dans la hiérarchie de scène");
                ensure!(seen.insert(parent), "cycle dans la hiérarchie de scène");
                current = *parents
                    .get(parent)
                    .ok_or_else(|| anyhow::anyhow!("parent d'objet introuvable"))?;
            }
        }
        Ok(())
    }

    /// Returns inherited visibility after following the validated parent chain.
    pub fn is_effectively_visible(&self, id: &str) -> Result<bool> {
        self.validate()?;
        let objects: HashMap<&str, &SceneObjectV2> = self
            .objects
            .iter()
            .map(|object| (object.id.as_str(), object))
            .collect();
        let mut current = objects
            .get(id)
            .copied()
            .ok_or_else(|| anyhow::anyhow!("objet introuvable"))?;
        loop {
            if !current.visible {
                return Ok(false);
            }
            let Some(parent) = current.parent.as_deref() else {
                return Ok(true);
            };
            current = objects[parent];
        }
    }

    /// The world matrix of `id`, column-major (`m[col][row]`): its ancestors' local `T·R·S`
    /// matrices multiplied root first.
    ///
    /// The same product as the game's forward kinematics, `nie_formats::g4sk::
    /// rest_world_matrices`, and a test holds the two to 1e-6. It is written here rather than
    /// called because `nie-formats` is only a DEV dependency of this crate: `nie-viewer-web`
    /// ships this renderer alone to browsers without WebGPU, and pulling the format crate (and
    /// its Lua decoder) into that module would charge every such visitor for code a scene
    /// document never runs.
    pub fn world_matrix(&self, id: &str) -> Result<[[f32; 4]; 4]> {
        self.validate()?;
        let objects: HashMap<&str, &SceneObjectV2> = self
            .objects
            .iter()
            .map(|object| (object.id.as_str(), object))
            .collect();
        let mut current = objects
            .get(id)
            .copied()
            .ok_or_else(|| anyhow::anyhow!("objet introuvable"))?;
        let mut chain = vec![current];
        while let Some(parent) = current.parent.as_deref() {
            current = objects[parent];
            chain.push(current);
        }
        let mut world = [
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ];
        for object in chain.iter().rev() {
            world = mat_mul(&world, &trs_matrix(object));
        }
        Ok(world)
    }

    /// Evaluates the world-space transform (translation, rotation quat, scale) of an object.
    ///
    /// Read back from [`Self::world_matrix`], which is the composition that renders. Accumulating
    /// the three parts separately gave a second answer that disagreed as soon as a stretched
    /// parent held a turned child: that chain shears, and a triplet cannot say so. Scales are
    /// validated positive, so the decomposition needs no sign handling, and it is exact whenever
    /// the chain carries no shear.
    pub fn evaluate_world_transform(&self, id: &str) -> Result<([f32; 3], [f32; 4], [f32; 3])> {
        let m = self.world_matrix(id)?;
        let length = |c: &[f32; 4]| (c[0] * c[0] + c[1] * c[1] + c[2] * c[2]).sqrt();
        let scale = [length(&m[0]), length(&m[1]), length(&m[2])];
        let r = |row: usize, col: usize| m[col][row] / scale[col].max(1e-12);
        Ok(([m[3][0], m[3][1], m[3][2]], quat_from_rotation(r), scale))
    }

    /// Composes objects in a v2 document into a single Model, accounting for hierarchy and full TRS.
    pub fn compose(&self, resolve: impl FnMut(&str) -> Result<Model>) -> Result<Model> {
        Ok(self.compose_indexed(resolve)?.0)
    }

    /// The same composition, saying WHICH object produced each emitted primitive.
    ///
    /// Picking answers with a primitive index; an editor needs an object identifier. Building the
    /// mapping in the same pass that builds the model is the only arrangement where the two
    /// cannot drift: a second walk over the document would re-decide visibility, and an object
    /// hidden by an ancestor contributes no primitive at all.
    ///
    /// The returned vector is parallel to `Model::primitives`.
    pub fn compose_indexed(
        &self,
        mut resolve: impl FnMut(&str) -> Result<Model>,
    ) -> Result<(Model, Vec<String>)> {
        self.validate()?;
        let mut owners: Vec<String> = Vec::new();
        let mut scene = Model {
            primitives: vec![],
            textures: vec![],
        };
        for object in &self.objects {
            if !self.is_effectively_visible(&object.id)? {
                continue;
            }
            let mut model = resolve(&object.asset)?;
            let produced = model.primitives.len();
            let texture_base = scene.textures.len();
            let m = self.world_matrix(&object.id)?;
            let column = |c: usize| [m[c][0], m[c][1], m[c][2]];
            let (a0, a1, a2) = (column(0), column(1), column(2));
            // Normals take the inverse transpose; its columns are the cross products of the
            // matrix's columns, up to the determinant, whose sign is positive for validated
            // scales and whose magnitude the normalisation removes.
            let cofactor = [cross(a1, a2), cross(a2, a0), cross(a0, a1)];

            for primitive in &mut model.primitives {
                for point in &mut primitive.positions {
                    let p = *point;
                    *point = std::array::from_fn(|k| {
                        a0[k] * p[0] + a1[k] * p[1] + a2[k] * p[2] + m[3][k]
                    });
                }
                for normal in &mut primitive.normals {
                    let n = *normal;
                    let turned: [f32; 3] = std::array::from_fn(|k| {
                        cofactor[0][k] * n[0] + cofactor[1][k] * n[1] + cofactor[2][k] * n[2]
                    });
                    let length = turned.iter().map(|v| v * v).sum::<f32>().sqrt().max(1e-12);
                    *normal = turned.map(|v| v / length);
                }
                primitive.texture = primitive.texture.map(|t| t + texture_base);
            }
            scene.primitives.extend(model.primitives);
            scene.textures.extend(model.textures);
            owners.extend(std::iter::repeat_n(object.id.clone(), produced));
        }
        Ok((scene, owners))
    }
}

/// `T·R·S` of one object, column-major (`m[col][row]`).
fn trs_matrix(object: &SceneObjectV2) -> [[f32; 4]; 4] {
    let [x, y, z, w] = object.rotation;
    let rotation = [
        [
            1.0 - 2.0 * (y * y + z * z),
            2.0 * (x * y - w * z),
            2.0 * (x * z + w * y),
        ],
        [
            2.0 * (x * y + w * z),
            1.0 - 2.0 * (x * x + z * z),
            2.0 * (y * z - w * x),
        ],
        [
            2.0 * (x * z - w * y),
            2.0 * (y * z + w * x),
            1.0 - 2.0 * (x * x + y * y),
        ],
    ];
    let [sx, sy, sz] = object.scale;
    let [tx, ty, tz] = object.position;
    let column = |c: usize, scale: f32| {
        [
            rotation[0][c] * scale,
            rotation[1][c] * scale,
            rotation[2][c] * scale,
            0.0,
        ]
    };
    [
        column(0, sx),
        column(1, sy),
        column(2, sz),
        [tx, ty, tz, 1.0],
    ]
}

/// `a·b` for column-major 4×4 matrices.
/// Produit `a·b`, délégué à `glam` (`scalar-math`).
///
/// **Colonne-majeur** ici (`m[colonne][ligne]`), qui est la convention native de `glam` : aucune
/// transposition, contrairement à `scene` et `glb` qui sont ligne-majeurs. Les deux conventions
/// vivent dans ce crate sans qu'un type les sépare.
fn mat_mul(a: &[[f32; 4]; 4], b: &[[f32; 4]; 4]) -> [[f32; 4]; 4] {
    (glam::Mat4::from_cols_array_2d(a) * glam::Mat4::from_cols_array_2d(b)).to_cols_array_2d()
}

fn cross(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}

/// The unit quaternion `[x, y, z, w]` of a rotation matrix given as `r(row, col)`.
fn quat_from_rotation(r: impl Fn(usize, usize) -> f32) -> [f32; 4] {
    let trace = r(0, 0) + r(1, 1) + r(2, 2);
    let q = if trace > 0.0 {
        let s = 0.5 / (trace + 1.0).sqrt();
        [
            (r(2, 1) - r(1, 2)) * s,
            (r(0, 2) - r(2, 0)) * s,
            (r(1, 0) - r(0, 1)) * s,
            0.25 / s,
        ]
    } else if r(0, 0) > r(1, 1) && r(0, 0) > r(2, 2) {
        let s = 2.0 * (1.0 + r(0, 0) - r(1, 1) - r(2, 2)).sqrt();
        [
            0.25 * s,
            (r(1, 0) + r(0, 1)) / s,
            (r(0, 2) + r(2, 0)) / s,
            (r(2, 1) - r(1, 2)) / s,
        ]
    } else if r(1, 1) > r(2, 2) {
        let s = 2.0 * (1.0 - r(0, 0) + r(1, 1) - r(2, 2)).sqrt();
        [
            (r(1, 0) + r(0, 1)) / s,
            0.25 * s,
            (r(2, 1) + r(1, 2)) / s,
            (r(0, 2) - r(2, 0)) / s,
        ]
    } else {
        let s = 2.0 * (1.0 - r(0, 0) - r(1, 1) + r(2, 2)).sqrt();
        [
            (r(0, 2) + r(2, 0)) / s,
            (r(2, 1) + r(1, 2)) / s,
            0.25 * s,
            (r(1, 0) - r(0, 1)) / s,
        ]
    };
    let length = q.iter().map(|v| v * v).sum::<f32>().sqrt();
    if length > 1e-12 {
        q.map(|v| v / length)
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}

impl From<&SceneDocument> for SceneDocumentV2 {
    fn from(document: &SceneDocument) -> Self {
        Self::from_v1(document)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn la_composition_dit_quel_objet_a_produit_chaque_primitive() {
        let primitive = || crate::glb::Primitive {
            positions: vec![[0.0; 3], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0]],
            normals: vec![[0.0, 0.0, 1.0]; 3],
            uv: vec![[0.0; 2]; 3],
            indices: vec![0, 1, 2],
            texture: None,
        };
        let document = SceneDocumentV2 {
            version: 2,
            objects: vec![
                SceneObjectV2 {
                    id: "visible".into(),
                    parent: None,
                    name: "visible".into(),
                    asset: "deux.glb".into(),
                    position: [0.0; 3],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    scale: [1.0; 3],
                    visible: true,
                },
                SceneObjectV2 {
                    id: "cache".into(),
                    parent: None,
                    name: "cache".into(),
                    asset: "deux.glb".into(),
                    position: [0.0; 3],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    scale: [1.0; 3],
                    visible: false,
                },
            ],
        };
        let (model, owners) = document
            .compose_indexed(|_| {
                Ok(Model {
                    primitives: vec![primitive(), primitive()],
                    textures: vec![],
                })
            })
            .unwrap();

        // Le vecteur est PARALLÈLE aux primitives, et l'objet caché n'en produit aucune : c'est
        // exactement ce qu'une seconde passe sur le document se tromperait à recalculer.
        assert_eq!(model.primitives.len(), owners.len());
        assert_eq!(owners, vec!["visible".to_owned(), "visible".to_owned()]);
    }

    #[test]
    fn le_lacet_se_lit_et_se_recrit_dans_le_quaternion() {
        let mut object = SceneObjectV2 {
            id: "a".into(),
            parent: None,
            name: "a".into(),
            asset: "a.glb".into(),
            position: [0.0; 3],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0; 3],
            visible: true,
        };
        for degrees in [-179.0, -90.0, -0.5, 0.0, 37.5, 90.0, 179.0] {
            object.set_yaw_degrees(degrees);
            assert!(
                (object.yaw_degrees() - degrees).abs() < 1e-3,
                "{degrees} -> {}",
                object.yaw_degrees()
            );
        }
    }

    #[test]
    fn la_migration_v1_conserve_le_lacet() {
        let v1 = SceneDocument {
            version: 1,
            objects: vec![SceneObject {
                name: "a".into(),
                asset: "a.glb".into(),
                position: [0.0; 3],
                yaw: 42.0,
                scale: [1.0; 3],
                visible: true,
            }],
        };
        let v2 = SceneDocumentV2::from_v1(&v1);
        assert!((v2.objects[0].yaw_degrees() - 42.0).abs() < 1e-3);
    }

    #[test]
    fn document_roundtrip_et_validation() {
        let mut document = SceneDocument {
            version: 1,
            objects: vec![SceneObject {
                name: "Objet".into(),
                asset: "asset.glb".into(),
                position: [1., 2., 3.],
                yaw: 90.,
                scale: [2., 1., 1.],
                visible: true,
            }],
        };
        let restored: SceneDocument =
            serde_json::from_str(&serde_json::to_string(&document).unwrap()).unwrap();
        assert_eq!(document, restored);
        let model = document
            .compose(|_| {
                Ok(Model {
                    textures: vec![],
                    primitives: vec![crate::glb::Primitive {
                        positions: vec![[1., 0., 0.]],
                        normals: vec![[1., 0., 0.]],
                        uv: vec![],
                        indices: vec![],
                        texture: None,
                    }],
                })
            })
            .unwrap();
        assert!((model.primitives[0].positions[0][2] - 1.).abs() < 1e-5);
        document.objects[0].scale[0] = 0.;
        assert!(document.validate().is_err());
    }

    #[test]
    fn document_v2_roundtrip_preserves_hierarchy_and_full_trs() {
        let document = SceneDocumentV2 {
            version: 2,
            objects: vec![
                SceneObjectV2 {
                    id: "root".into(),
                    parent: None,
                    name: "Root".into(),
                    asset: "root.glb".into(),
                    position: [1.0, 2.0, 3.0],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    scale: [1.0, 2.0, 3.0],
                    visible: true,
                },
                SceneObjectV2 {
                    id: "child".into(),
                    parent: Some("root".into()),
                    name: "Child".into(),
                    asset: "child.glb".into(),
                    position: [0.0; 3],
                    rotation: [0.5, 0.5, 0.5, 0.5],
                    scale: [1.0; 3],
                    visible: false,
                },
            ],
        };
        document.validate().unwrap();
        let json = serde_json::to_string(&document).unwrap();
        let restored: SceneDocumentV2 = serde_json::from_str(&json).unwrap();
        assert_eq!(restored, document);
    }

    #[test]
    fn v1_migration_assigns_deterministic_initial_ids_and_converts_yaw() {
        let v1 = SceneDocument {
            version: 1,
            objects: vec![SceneObject {
                name: "Object".into(),
                asset: "object.glb".into(),
                position: [1.0, 2.0, 3.0],
                yaw: 90.0,
                scale: [2.0, 1.0, 1.0],
                visible: true,
            }],
        };
        let first = SceneDocumentV2::from_v1(&v1);
        let second = SceneDocumentV2::from_v1(&v1);
        assert_eq!(first, second);
        assert_eq!(first.objects[0].id, "object-0");
        assert_eq!(first.objects[0].parent, None);
        assert!((first.objects[0].rotation[1] - 2.0f32.sqrt() / 2.0).abs() < 1e-6);
        first.validate().unwrap();
    }

    #[test]
    fn loader_migrates_real_v1_json_fixture() {
        let json = r#"{
            "version": 1,
            "objects": [{
                "name": "Player",
                "asset": "data/common/chr/c000101.glb",
                "position": [1.0, 2.0, 3.0],
                "yaw": -45.0,
                "scale": [1.0, 1.0, 1.0],
                "visible": true
            }]
        }"#;
        let document = SceneDocumentV2::from_json(json).unwrap();
        assert_eq!(document.version, 2);
        assert_eq!(document.objects[0].id, "object-0");
        assert_eq!(document.objects[0].name, "Player");
        assert!(document.objects[0].rotation[1] < 0.0);
    }

    #[test]
    fn loader_accepts_v2_additive_fields_and_rejects_unknown_version() {
        let v2 = r#"{
            "version": 2,
            "futureDocumentField": true,
            "objects": [{
                "id": "root", "parent": null, "name": "Root", "asset": "root.glb",
                "position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0, 1.0],
                "scale": [1.0, 1.0, 1.0], "visible": true, "futureObjectField": 7
            }]
        }"#;
        assert_eq!(SceneDocumentV2::from_json(v2).unwrap().objects.len(), 1);
        assert!(SceneDocumentV2::from_json(r#"{"version":3,"objects":[]}"#).is_err());
        assert!(SceneDocumentV2::from_json(r#"{"objects":[]}"#).is_err());
    }

    #[test]
    fn document_v2_rejects_duplicate_missing_and_cyclic_parents() {
        let object = |id: &str, parent: Option<&str>| SceneObjectV2 {
            id: id.into(),
            parent: parent.map(str::to_owned),
            name: id.into(),
            asset: "asset.glb".into(),
            position: [0.0; 3],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0; 3],
            visible: true,
        };
        let invalid = [
            vec![object("same", None), object("same", None)],
            vec![object("child", Some("missing"))],
            vec![object("a", Some("b")), object("b", Some("a"))],
        ];
        for objects in invalid {
            assert!(
                SceneDocumentV2 {
                    version: 2,
                    objects
                }
                .validate()
                .is_err()
            );
        }
    }

    #[test]
    fn document_v2_rejects_invalid_quaternion() {
        let document = SceneDocumentV2 {
            version: 2,
            objects: vec![SceneObjectV2 {
                id: "object".into(),
                parent: None,
                name: "Object".into(),
                asset: "object.glb".into(),
                position: [0.0; 3],
                rotation: [0.0; 4],
                scale: [1.0; 3],
                visible: true,
            }],
        };
        assert!(document.validate().is_err());
    }

    #[test]
    fn visibility_is_inherited_from_ancestors() {
        let object = |id: &str, parent: Option<&str>, visible| SceneObjectV2 {
            id: id.into(),
            parent: parent.map(str::to_owned),
            name: id.into(),
            asset: "asset.glb".into(),
            position: [0.0; 3],
            rotation: [0.0, 0.0, 0.0, 1.0],
            scale: [1.0; 3],
            visible,
        };
        let document = SceneDocumentV2 {
            version: 2,
            objects: vec![
                object("root", None, false),
                object("child", Some("root"), true),
            ],
        };
        assert!(!document.is_effectively_visible("child").unwrap());
        assert!(!document.is_effectively_visible("root").unwrap());
        assert!(document.is_effectively_visible("missing").is_err());
    }

    #[test]
    fn v2_evaluate_world_transform_and_compose() {
        let half_angle = std::f32::consts::FRAC_1_SQRT_2;
        let document = SceneDocumentV2 {
            version: 2,
            objects: vec![
                SceneObjectV2 {
                    id: "root".into(),
                    parent: None,
                    name: "Root".into(),
                    asset: "mesh.glb".into(),
                    position: [0.0, 10.0, 0.0],
                    rotation: [0.0, half_angle, 0.0, half_angle],
                    scale: [2.0, 2.0, 2.0],
                    visible: true,
                },
                SceneObjectV2 {
                    id: "child".into(),
                    parent: Some("root".into()),
                    name: "Child".into(),
                    asset: "mesh.glb".into(),
                    position: [1.0, 0.0, 0.0],
                    rotation: [0.0, 0.0, 0.0, 1.0],
                    scale: [1.0, 1.0, 1.0],
                    visible: true,
                },
            ],
        };

        let (pos, rot, scale) = document.evaluate_world_transform("child").unwrap();
        assert!((pos[0] - 0.0).abs() < 1e-5);
        assert!((pos[1] - 10.0).abs() < 1e-5);
        assert!((pos[2] - (-2.0)).abs() < 1e-5);
        assert!((rot[1] - half_angle).abs() < 1e-5);
        assert!((scale[0] - 2.0).abs() < 1e-5);

        let composed = document
            .compose(|_| {
                Ok(Model {
                    textures: vec![],
                    primitives: vec![crate::glb::Primitive {
                        positions: vec![[0.0, 0.0, 0.0]],
                        normals: vec![[0.0, 1.0, 0.0]],
                        uv: vec![],
                        indices: vec![],
                        texture: None,
                    }],
                })
            })
            .unwrap();

        assert_eq!(composed.primitives.len(), 2);
        // Root point at (0, 10, 0)
        assert!((composed.primitives[0].positions[0][1] - 10.0).abs() < 1e-5);
        // Child point at (0, 10, -2)
        assert!((composed.primitives[1].positions[0][2] - (-2.0)).abs() < 1e-5);
    }

    /// A parent scaled along X with a child turned about Z: a matrix chain SHEARS the child, a
    /// position/quaternion/scale triplet cannot. The game composes matrices (`g4sk::
    /// rest_world_matrices`), and so do glTF and three.js, so the triplet is the one that is wrong.
    #[test]
    fn un_parent_etire_cisaille_un_enfant_tourne_comme_le_jeu() {
        let quarter = std::f32::consts::FRAC_PI_8;
        let object =
            |id: &str, parent: Option<&str>, rotation: [f32; 4], scale: [f32; 3]| SceneObjectV2 {
                id: id.into(),
                parent: parent.map(Into::into),
                name: id.into(),
                asset: if id == "child" {
                    "mesh.glb".into()
                } else {
                    "empty.glb".into()
                },
                position: [0.0; 3],
                rotation,
                scale,
                visible: true,
            };
        let document = SceneDocumentV2 {
            version: 2,
            objects: vec![
                object("parent", None, [0.0, 0.0, 0.0, 1.0], [2.0, 1.0, 1.0]),
                object(
                    "child",
                    Some("parent"),
                    [0.0, 0.0, quarter.sin(), quarter.cos()],
                    [1.0; 3],
                ),
            ],
        };
        let (composed, owners) = document
            .compose_indexed(|asset| {
                Ok(Model {
                    textures: vec![],
                    primitives: if asset == "mesh.glb" {
                        vec![crate::glb::Primitive {
                            // A surface containing the X axis and the Z axis, whose normal
                            // therefore has to stay perpendicular to both once transformed.
                            positions: vec![[0.0; 3], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0]],
                            normals: vec![[0.0, 1.0, 0.0]; 3],
                            uv: vec![],
                            indices: vec![0, 1, 2],
                            texture: None,
                        }]
                    } else {
                        vec![]
                    },
                })
            })
            .unwrap();
        assert_eq!(owners, ["child"]);
        let primitive = &composed.primitives[0];
        let h = std::f32::consts::FRAC_1_SQRT_2;
        // R(45°)·(1,0,0) = (h, h, 0), then the parent doubles X.
        let [x, y, z] = primitive.positions[1];
        assert!(
            (x - 2.0 * h).abs() < 1e-5 && (y - h).abs() < 1e-5 && z.abs() < 1e-5,
            "{x} {y} {z}"
        );

        let n = primitive.normals[0];
        let dot = |a: [f32; 3], b: [f32; 3]| a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
        assert!(dot(n, primitive.positions[1]).abs() < 1e-5, "normal {n:?}");
        assert!(dot(n, primitive.positions[2]).abs() < 1e-5, "normal {n:?}");
        assert!((dot(n, n) - 1.0).abs() < 1e-5);

        // The same chain through the game's own forward kinematics.
        let pose = |o: &SceneObjectV2| nie_formats::g4sk::BonePose {
            local: nie_formats::g4sk::LocalTrs {
                scale: o.scale,
                quat: o.rotation,
                translation: o.position,
            },
            inverse_bind: [[0.0; 4]; 4],
        };
        let game = nie_formats::g4sk::rest_world_matrices(
            &[pose(&document.objects[0]), pose(&document.objects[1])],
            &[-1, 0],
        );
        let ours = document.world_matrix("child").unwrap();
        for (column, expected) in ours.iter().zip(&game[1]) {
            for (a, b) in column.iter().zip(expected) {
                assert!((a - b).abs() < 1e-6, "{ours:?} != {:?}", game[1]);
            }
        }
    }
}
