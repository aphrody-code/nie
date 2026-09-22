//! Les `AssetLoader` Bevy des formats du jeu.
//!
//! Un chargeur reçoit **un** fichier. Un modèle du jeu en est **deux** — le `.g4md` décrit, le
//! `.g4mg` porte la géométrie — donc [`G4mdLoader`] lit le `.g4mg` voisin par
//! `LoadContext::read_asset_bytes`, sur la **même source** que le fichier demandé : un
//! `nie://…/x.g4md` cherche `nie://…/x.g4mg`, dans le VFS et non sur le disque.

use bevy_asset::io::Reader;
use bevy_asset::{Asset, AssetLoader, AssetPath, Handle, LoadContext};
use bevy_image::Image;
use bevy_mesh::Mesh;
use bevy_reflect::TypePath;

use crate::assets::{g4tx_texture_count, image_from_g4tx, meshes_from_g4md_g4mg};
use crate::error::NieAssetError;

/// Un modèle du jeu chargé : ses sous-mailles, une [`Mesh`] chacune.
///
/// Les maillages sont des sous-assets **étiquetés** (`Mesh0`, `Mesh1`, …) du même chemin : on
/// peut donc aussi charger `nie://…/x.g4md#Mesh2` seul. Les compteurs sont là pour qu'un
/// consommateur puisse dire ce qu'il a reçu sans résoudre chaque handle.
#[derive(Asset, TypePath, Debug, Default)]
pub struct NieModel {
    /// Une entrée par sous-maille, dans l'ordre du descripteur.
    #[dependency]
    pub meshes: Vec<Handle<Mesh>>,
    /// Nombre de sous-mailles décrites.
    pub submesh_count: usize,
    /// Sommets de chaque sous-maille, dans le même ordre que `meshes`.
    pub vertex_counts: Vec<usize>,
}

/// `.g4tx` → [`Image`]. La texture 0 est l'asset principal ; les suivantes sont des sous-assets
/// étiquetés `Texture1`, `Texture2`, …
///
/// Une texture secondaire qui ne se décode pas est **omise**, pas fatale : un atlas peut porter
/// un plan que `g4tx_decode` ne lit pas encore, et cela ne doit pas priver du plan principal.
/// L'échec du plan 0, lui, remonte : sans lui l'asset ne veut rien dire.
#[derive(Debug, Default, Clone, Copy, TypePath)]
pub struct G4txLoader;

impl AssetLoader for G4txLoader {
    type Asset = Image;
    type Settings = ();
    type Error = NieAssetError;

    async fn load(
        &self,
        reader: &mut dyn Reader,
        _settings: &(),
        load_context: &mut LoadContext<'_>,
    ) -> Result<Image, NieAssetError> {
        let mut bytes = Vec::new();
        reader.read_to_end(&mut bytes).await?;

        let count = g4tx_texture_count(&bytes)?;
        let main = image_from_g4tx(&bytes, 0)?;
        for index in 1..count {
            if let Ok(image) = image_from_g4tx(&bytes, index) {
                load_context.add_labeled_asset(format!("Texture{index}"), image);
            }
        }
        Ok(main)
    }

    fn extensions(&self) -> &[&str] {
        &["g4tx"]
    }
}

/// `.g4md` (+ `.g4mg` voisin) → [`NieModel`], une [`Mesh`] étiquetée par sous-maille.
#[derive(Debug, Default, Clone, Copy, TypePath)]
pub struct G4mdLoader;

impl AssetLoader for G4mdLoader {
    type Asset = NieModel;
    type Settings = ();
    type Error = NieAssetError;

    async fn load(
        &self,
        reader: &mut dyn Reader,
        _settings: &(),
        load_context: &mut LoadContext<'_>,
    ) -> Result<NieModel, NieAssetError> {
        let mut md = Vec::new();
        reader.read_to_end(&mut md).await?;

        // Le compagnon vit sur la MÊME source que le descripteur : sans `with_source`, un
        // `nie://x.g4md` irait chercher `x.g4mg` sur le disque, et ne le trouverait pas.
        let source = load_context.path().source().clone_owned();
        let sibling_path = load_context.path().path().with_extension("g4mg");
        let sibling = AssetPath::from(sibling_path.clone()).with_source(source);
        let mg = load_context
            .read_asset_bytes(sibling)
            .await
            .map_err(|error| NieAssetError::Dependency {
                path: sibling_path.display().to_string(),
                reason: error.to_string(),
            })?;

        let meshes = meshes_from_g4md_g4mg(&md, &mg)?;
        let submesh_count = meshes.len();
        let mut handles = Vec::with_capacity(submesh_count);
        let mut vertex_counts = Vec::with_capacity(submesh_count);
        for (index, mesh) in meshes.into_iter().enumerate() {
            vertex_counts.push(mesh.count_vertices());
            handles.push(load_context.add_labeled_asset(format!("Mesh{index}"), mesh));
        }
        Ok(NieModel {
            meshes: handles,
            submesh_count,
            vertex_counts,
        })
    }

    fn extensions(&self) -> &[&str] {
        &["g4md"]
    }
}
