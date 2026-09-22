//! Le greffon qui enregistre les formats du jeu auprès du serveur d'assets de Bevy.

use bevy_app::{App, Plugin};
use bevy_asset::AssetApp;
use bevy_image::Image;
use bevy_mesh::Mesh;

use crate::loader::{G4mdLoader, G4txLoader, NieModel};

/// Enregistre les chargeurs `.g4tx` → [`Image`] et `.g4md` → [`NieModel`].
///
/// À ajouter **après** `bevy_asset::AssetPlugin` : `register_asset_loader` a besoin du serveur
/// d'assets. `init_asset::<Image>()` et `init_asset::<Mesh>()` sont idempotents, donc une
/// application qui embarque déjà `ImagePlugin` ou le rendu complet n'y perd rien.
///
/// Le greffon ne connaît pas le VFS : c'est une **source d'assets** (`nie://`) qui lit les CPK,
/// enregistrée à part par l'application, parce qu'une source se déclare avant `AssetPlugin` et
/// qu'un greffon ajouté après ne peut plus le faire.
#[derive(Debug, Default, Clone, Copy)]
pub struct NieAssetPlugin;

impl Plugin for NieAssetPlugin {
    fn build(&self, app: &mut App) {
        app.init_asset::<Image>()
            .init_asset::<Mesh>()
            .init_asset::<NieModel>()
            .register_asset_loader(G4txLoader)
            .register_asset_loader(G4mdLoader);
    }
}
