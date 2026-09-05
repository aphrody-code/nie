//! Document de scène partagé par les hôtes natifs et web, indépendant du jeu d'origine.
use crate::glb::Model;
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};

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
}
