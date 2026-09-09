//! Classification pure des fichiers d'assets IEVR.
//!
//! Ce module porte les règles d'assets CPK partagées par le wiki Rust:
//! une extension ne dit pas comment décoder les octets, mais elle permet de choisir la famille
//! d'asset et le type de preview demandé par une interface. Le décodage réel reste dans les
//! parseurs de [`crate::cpk`], [`crate::g4tx`] et [`crate::cri_audio`].
//!
//! La validation de sécurité des chemins appartient à `nie-explore::vfs_policy`. Ici, les
//! fonctions sont volontairement sans I/O et ne nettoient jamais un chemin reçu d'un client.

extern crate alloc;

use alloc::string::String;

/// Famille de contenu produite par une entrée de l'index CPK.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CpkAssetKind {
    /// Texture G4TX servie comme image.
    Image,
    /// Pièce de modèle G4MD/G4MG pouvant être adressée à un assembleur.
    Model,
    /// Fichier dont aucun mapping d'image ou de modèle n'est déduit.
    Raw,
}

impl CpkAssetKind {
    /// Jeton stable pour les DTO et les journaux.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Model => "model",
            Self::Raw => "raw",
        }
    }
}

/// Famille de preview affichable pour une extension IEVR.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CpkPreviewKind {
    /// Texture G4TX.
    Image,
    /// Modèle G4MD/G4MG.
    Model,
    /// Fichier texte.
    Text,
    /// Configuration binaire Level-5.
    Config,
    /// Banque ou flux audio Criware.
    Sound,
    /// Cinématique ou conteneur vidéo.
    Movie,
    /// Archive G4PK/G4PKM/G4RA.
    Package,
    /// Fichier sans preview spécialisée.
    Raw,
}

impl CpkPreviewKind {
    /// Jeton stable pour les DTO et les journaux.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Model => "model",
            Self::Text => "text",
            Self::Config => "config",
            Self::Sound => "sound",
            Self::Movie => "movie",
            Self::Package => "package",
            Self::Raw => "raw",
        }
    }
}

/// Retourne le dernier suffixe d'un chemin, sans le point.
#[must_use]
pub fn extension(path: &str) -> Option<&str> {
    let name = path.rsplit('/').next().unwrap_or(path);
    let (_, ext) = name.rsplit_once('.')?;
    (!ext.is_empty()).then_some(ext)
}

/// Classe une extension d'index CPK sans tenir compte de sa casse.
#[must_use]
pub fn cpk_asset_kind(ext: &str) -> CpkAssetKind {
    if ext.eq_ignore_ascii_case("g4tx") {
        CpkAssetKind::Image
    } else if ext.eq_ignore_ascii_case("g4md") || ext.eq_ignore_ascii_case("g4mg") {
        CpkAssetKind::Model
    } else {
        CpkAssetKind::Raw
    }
}

/// Classe le contenu d'un fichier à partir de son chemin.
#[must_use]
pub fn cpk_asset_kind_for_path(path: &str) -> CpkAssetKind {
    extension(path).map_or(CpkAssetKind::Raw, cpk_asset_kind)
}

/// Classe une extension dans la même hiérarchie de preview que l'explorateur Azalée.
#[must_use]
pub fn cpk_preview_kind(ext: &str) -> CpkPreviewKind {
    if ext.eq_ignore_ascii_case("g4tx") {
        CpkPreviewKind::Image
    } else if ext.eq_ignore_ascii_case("g4md") || ext.eq_ignore_ascii_case("g4mg") {
        CpkPreviewKind::Model
    } else if matches_ignore_ascii_case(
        ext,
        &[
            "txt", "json", "xml", "csv", "lua", "cfg", "ini", "yml", "yaml",
        ],
    ) {
        CpkPreviewKind::Text
    } else if matches_ignore_ascii_case(ext, &["bin", "objbin", "fxbin", "mevbin"]) {
        CpkPreviewKind::Config
    } else if matches_ignore_ascii_case(ext, &["acb", "awb", "hca", "wav", "at9"]) {
        CpkPreviewKind::Sound
    } else if matches_ignore_ascii_case(ext, &["usm", "mp4", "webm", "bk2"]) {
        CpkPreviewKind::Movie
    } else if matches_ignore_ascii_case(ext, &["g4pk", "g4pkm", "g4ra"]) {
        CpkPreviewKind::Package
    } else {
        CpkPreviewKind::Raw
    }
}

/// Classe le preview d'un chemin en inspectant son dernier suffixe.
#[must_use]
pub fn cpk_preview_kind_for_path(path: &str) -> CpkPreviewKind {
    extension(path).map_or(CpkPreviewKind::Raw, cpk_preview_kind)
}

/// Retire le préfixe VFS optionnel et l'extension G4TX pour une route `/tex`.
///
/// Cette fonction ne valide pas le chemin et ne produit pas d'URL complète; le owner HTTP
/// (`nie-site`) ajoute son espace public et applique sa politique de route.
#[must_use]
pub fn texture_route_stem(path: &str) -> String {
    let without_data = path.strip_prefix("data/").unwrap_or(path);
    let Some(ext) = extension(without_data) else {
        return without_data.to_owned();
    };
    if ext.eq_ignore_ascii_case("g4tx") {
        without_data[..without_data.len() - ext.len() - 1].to_owned()
    } else {
        without_data.to_owned()
    }
}

fn matches_ignore_ascii_case(value: &str, candidates: &[&str]) -> bool {
    candidates
        .iter()
        .any(|candidate| value.eq_ignore_ascii_case(candidate))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_cpk_asset_families() {
        assert_eq!(cpk_asset_kind("G4TX"), CpkAssetKind::Image);
        assert_eq!(cpk_asset_kind("g4mg"), CpkAssetKind::Model);
        assert_eq!(cpk_asset_kind("bin"), CpkAssetKind::Raw);
        assert_eq!(
            cpk_asset_kind_for_path("data/dx11/menu/icon.g4tx"),
            CpkAssetKind::Image
        );
        assert_eq!(
            cpk_asset_kind_for_path("data/common/chr/a.g4md"),
            CpkAssetKind::Model
        );
    }

    #[test]
    fn matches_preview_families_and_nested_suffixes() {
        assert_eq!(cpk_preview_kind("JSON"), CpkPreviewKind::Text);
        assert_eq!(cpk_preview_kind("objbin"), CpkPreviewKind::Config);
        assert_eq!(cpk_preview_kind("ACB"), CpkPreviewKind::Sound);
        assert_eq!(cpk_preview_kind("usm"), CpkPreviewKind::Movie);
        assert_eq!(cpk_preview_kind("g4pkm"), CpkPreviewKind::Package);
        assert_eq!(
            cpk_preview_kind_for_path("data/common/gamedata/chara.cfg.bin"),
            CpkPreviewKind::Config
        );
    }

    #[test]
    fn extracts_extension_and_texture_stem_without_security_cleanup() {
        assert_eq!(extension("data/dx11/menu/icon.g4tx"), Some("g4tx"));
        assert_eq!(extension("data/no-extension"), None);
        assert_eq!(
            texture_route_stem("data/dx11/menu/icon.g4tx"),
            "dx11/menu/icon"
        );
        assert_eq!(texture_route_stem("dx11/menu/ICON.G4TX"), "dx11/menu/ICON");
        assert_eq!(texture_route_stem("dx11/menu/Icon.G4tX"), "dx11/menu/Icon");
        assert_eq!(texture_route_stem("../escape.g4tx"), "../escape");
    }
}
