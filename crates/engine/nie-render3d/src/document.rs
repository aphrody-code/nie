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
    pub id: String,
    /// Optional parent object identifier.
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
            .map(|(index, object)| {
                let half_yaw = object.yaw.to_radians() * 0.5;
                SceneObjectV2 {
                    id: format!("object-{index}"),
                    parent: None,
                    name: object.name.clone(),
                    asset: object.asset.clone(),
                    position: object.position,
                    rotation: [0.0, half_yaw.sin(), 0.0, half_yaw.cos()],
                    scale: object.scale,
                    visible: object.visible,
                }
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
}
