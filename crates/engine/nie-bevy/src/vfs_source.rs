//! Une source d'assets Bevy adossée au VFS du jeu — `nie://data/...` lit dans les CPK.
//!
//! # Pourquoi une source, et pas la source de fichiers de Bevy
//!
//! Le jeu installé porte 255 342 fichiers dans **936 CPK** et 39 seulement hors paquet. La source
//! par défaut de Bevy lit des fichiers sur disque : elle ne verrait rien. Extraire les CPK vers un
//! dossier ferait de l'intégration un pont vers une copie — et écrirait des octets du jeu, ce que
//! ce dépôt s'interdit dans ses tests. Le VFS de `nie_formats` sait déjà résoudre un chemin
//! logique vers son CPK, décompresser le CRILAYLA et garder un cache borné ; cette source ne fait
//! que le présenter au serveur d'assets.
//!
//! # Contrat
//!
//! - `read` : les octets du fichier, tels que le VFS les rend. Un chemin inconnu est `NotFound`.
//! - `read_meta` : toujours `NotFound`. Les CPK ne portent pas de `.meta` ; avec
//!   `AssetMetaCheck::Never` le serveur ne le demande jamais, et sans lui il retombe proprement.
//! - `read_directory` / `is_directory` : énumération par préfixe sur l'index du VFS. C'est la
//!   partie qui coûte — l'index d'un montage dump se construit paresseusement et une seule fois —
//!   et rien dans le chargement d'un modèle ne l'appelle.
//!
//! La source doit être enregistrée **avant** `AssetPlugin` ([`register_vfs_source`]).

use std::path::{Path, PathBuf};
use std::sync::Arc;

use bevy_app::App;
use bevy_asset::AssetApp;
use bevy_asset::io::{
    AssetReader, AssetReaderError, AssetSourceBuilder, AssetSourceId, PathStream, Reader, VecReader,
};
use nie_formats::vfs::Vfs;

/// Le nom de la source : un chemin d'asset s'écrit `nie://data/common/...`.
pub const VFS_SOURCE: &str = "nie";

/// Lecteur d'assets sur le VFS du jeu.
#[derive(Clone)]
pub struct VfsAssetReader {
    vfs: Arc<Vfs>,
}

impl VfsAssetReader {
    /// Enveloppe un VFS déjà monté.
    #[must_use]
    pub fn new(vfs: Arc<Vfs>) -> Self {
        Self { vfs }
    }

    /// Chemin logique du VFS : séparateurs `/` quel que soit l'hôte. Bevy remet un `Path` natif,
    /// et le VFS indexe des chemins internes, jamais des chemins Windows.
    fn logical(path: &Path) -> String {
        let mut out = String::new();
        for component in path.components() {
            if let std::path::Component::Normal(part) = component {
                if !out.is_empty() {
                    out.push('/');
                }
                out.push_str(&part.to_string_lossy());
            }
        }
        out
    }
}

impl AssetReader for VfsAssetReader {
    async fn read<'a>(&'a self, path: &'a Path) -> Result<impl Reader + 'a, AssetReaderError> {
        let logical = Self::logical(path);
        self.vfs
            .read(&logical)
            .map(VecReader::new)
            .map_err(|_| AssetReaderError::NotFound(path.to_path_buf()))
    }

    async fn read_meta<'a>(&'a self, path: &'a Path) -> Result<impl Reader + 'a, AssetReaderError> {
        // Jamais de `.meta` dans un CPK : l'annoncer plutôt que de fabriquer un lecteur vide.
        Err::<VecReader, _>(AssetReaderError::NotFound(path.to_path_buf()))
    }

    async fn read_directory<'a>(
        &'a self,
        path: &'a Path,
    ) -> Result<Box<PathStream>, AssetReaderError> {
        let prefix = {
            let mut p = Self::logical(path);
            if !p.is_empty() {
                p.push('/');
            }
            p
        };
        // Enfants DIRECTS seulement, dédupliqués : `read_directory` a la sémantique d'un `ls`,
        // pas d'un `find`.
        let mut children: Vec<PathBuf> = self
            .vfs
            .iter()
            .filter_map(|(entry, _)| entry.strip_prefix(prefix.as_str()))
            .map(|rest| rest.split('/').next().unwrap_or(rest))
            .map(|child| Path::new(path).join(child))
            .collect();
        children.sort();
        children.dedup();
        if children.is_empty() {
            return Err(AssetReaderError::NotFound(path.to_path_buf()));
        }
        Ok(Box::new(futures_lite::stream::iter(children)))
    }

    async fn is_directory<'a>(&'a self, path: &'a Path) -> Result<bool, AssetReaderError> {
        let mut prefix = Self::logical(path);
        prefix.push('/');
        Ok(self
            .vfs
            .iter()
            .any(|(entry, _)| entry.starts_with(prefix.as_str())))
    }
}

/// Enregistre la source `nie://` sur une application, **avant** `AssetPlugin`.
///
/// Le VFS est partagé par `Arc` : le serveur d'assets peut instancier le lecteur plusieurs
/// fois (une par source construite), et le cache CPK doit rester unique.
pub fn register_vfs_source(app: &mut App, vfs: Arc<Vfs>) -> &mut App {
    app.register_asset_source(
        AssetSourceId::Name(VFS_SOURCE.into()),
        AssetSourceBuilder::new(move || Box::new(VfsAssetReader::new(Arc::clone(&vfs)))),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un chemin natif devient un chemin logique à `/`, sans racine ni `.`.
    #[test]
    fn le_chemin_logique_est_a_barres_obliques() {
        assert_eq!(
            VfsAssetReader::logical(Path::new("data/common/chr/x.g4md")),
            "data/common/chr/x.g4md"
        );
        assert_eq!(VfsAssetReader::logical(Path::new("./data/./a")), "data/a");
        assert_eq!(VfsAssetReader::logical(Path::new("")), "");
    }
}
