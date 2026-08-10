//! `Emblem` — port de `menu/emblem_resource_*.cfg.bin` : les écussons d'équipe (team emblems) IEVR.
//!
//! ## Vérité terrain
//!
//! - Dump réel (VFS) : `data/common/gamedata/menu/emblem_resource_0.04.18.cfg.bin`.
//! - Format **RDBN à listes** (`{ "lists": [ { "name", "typeName", "values" } ] }`), décodé en
//!   forme iecode par `nie-model-serve::cfgbin_to_iecode_root` (cf. `read_values`).
//! - Référence de portage : `packages/inagle/src/parsers/emblems.ts` (`parseContent`,
//!   l.55-94), header inagle « vérifiée octet pour octet contre le .bin ».
//!
//! ## Les deux listes du fichier
//!
//! | Liste                            | Type                          | Lignes | Champs |
//! |----------------------------------|-------------------------------|--------|--------|
//! | `m_EmblemResourceInfoList`       | `EMBLEM_RESOURCE_INFO`        | 1/emblème | 6 (tous String) |
//! | `m_EmblemResourceBasePathList`   | `EMBLEM_RESOURCE_BASE_PATH`   | 1      | 1 (`basePath`) |
//!
//! Le `basePath` (ex. `"#/menu/"`) est commun à toutes les ressources d'emblème et vit dans sa
//! propre liste à une seule entrée.
//!
//! ## Entrée gabarit « default »
//!
//! La première entrée de `m_EmblemResourceInfoList` est un **gabarit** (`emblemName == "default"`)
//! dont les chemins de texture contiennent le jeton [`RESOURCE_ID_TOKEN`] (`<resourceID>`). Les
//! entrées concrètes (ex. `em010001`) portent déjà leurs chemins résolus ; pour matérialiser le
//! chemin d'un emblème depuis le gabarit, substituer son `emblem_name` au jeton via
//! [`resolve_resource_id`]. Port fidèle d'inagle : `isTemplate = s_filePath.contains("<resourceID>")
//! || emblemName == "default"`.
//!
//! ## `emblem_id`
//!
//! Le champ `emblemId` est un hash Level-5 ; il est rendu en chaîne hexadécimale
//! (`"0xE35E00DF"`) par le décodeur cfg.bin et conservé **tel quel** en `String` (comme inagle,
//! qui s'en sert directement comme identifiant). [`Emblem::emblem_id_hash`] le réinterprète en
//! [`HashId`] si besoin.

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_str, list_values, owned};
use crate::hash::HashId;

/// Jeton substitué dans les chemins de l'entrée gabarit « default » (port inagle).
pub const RESOURCE_ID_TOKEN: &str = "<resourceID>";

/// Substitue `emblem_name` au jeton [`RESOURCE_ID_TOKEN`] dans un chemin de gabarit.
///
/// Sur un chemin concret (sans jeton) la chaîne est renvoyée inchangée. Matérialise les chemins
/// de texture d'un emblème depuis le gabarit « default » : par exemple
/// `"200_icon/01_icon_emblem/<resourceID>.g4tx"` + `"em010001"` →
/// `"200_icon/01_icon_emblem/em010001.g4tx"`.
#[must_use]
pub fn resolve_resource_id(path: &str, emblem_name: &str) -> String {
    path.replace(RESOURCE_ID_TOKEN, emblem_name)
}

// ─── Emblem ─────────────────────────────────────────────────────────────────────

/// Une entrée `EMBLEM_RESOURCE_INFO` — un écusson d'équipe (1 par emblème).
///
/// Vérité terrain (`emblem_resource_0.04.18`), entrée concrète `em010001` :
/// `emblemId="0xD5ABE1F0", emblemName="em010001",
///  s_filePath="200_icon/01_icon_emblem/em010001_s.g4tx", s_texName="em010001_s01",
///  l_filePath="200_icon/01_icon_emblem/em010001.g4tx", l_texName="em010001"`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct Emblem {
    /// `emblemId` — hash identifiant l'emblème, conservé en chaîne hex (`"0xD5ABE1F0"`).
    pub emblem_id: String,
    /// `emblemName` — nom logique de l'emblème (ex. `em010001`, ou `default` pour le gabarit).
    pub emblem_name: String,
    /// `s_filePath` — chemin de la **petite** texture `.g4tx` (relatif au [`base_path`](Self::base_path)).
    pub small_file_path: String,
    /// `s_texName` — nom de la petite texture (ex. `em010001_s01`).
    pub small_tex_name: String,
    /// `l_filePath` — chemin de la **grande** texture `.g4tx` (relatif au [`base_path`](Self::base_path)).
    pub large_file_path: String,
    /// `l_texName` — nom de la grande texture (ex. `em010001`).
    pub large_tex_name: String,
    /// `basePath` — chemin de base commun (ex. `"#/menu/"`), recopié depuis la liste dédiée.
    pub base_path: String,
    /// `true` pour l'entrée gabarit (`emblemName == "default"` ou chemins contenant
    /// [`RESOURCE_ID_TOKEN`]). Port inagle de `isTemplate`.
    pub is_template: bool,
}

impl Emblem {
    /// Construit une entrée depuis un objet `values[]` (forme iecode) et le `base_path` commun.
    ///
    /// Port 1:1 d'inagle `parseContent` (l.69-91) : les champs absents valent `""` et
    /// `is_template = s_filePath.contains("<resourceID>") || emblemName == "default"`.
    #[must_use]
    pub fn from_value(v: &Value, base_path: &str) -> Self {
        let emblem_name = field_str(v, "emblemName").map_or_else(String::new, owned);
        let small_file_path = field_str(v, "s_filePath").map_or_else(String::new, owned);
        let is_template = small_file_path.contains(RESOURCE_ID_TOKEN) || emblem_name == "default";
        Self {
            emblem_id: field_str(v, "emblemId").map_or_else(String::new, owned),
            emblem_name,
            small_file_path,
            small_tex_name: field_str(v, "s_texName").map_or_else(String::new, owned),
            large_file_path: field_str(v, "l_filePath").map_or_else(String::new, owned),
            large_tex_name: field_str(v, "l_texName").map_or_else(String::new, owned),
            base_path: owned(base_path),
            is_template,
        }
    }

    /// Nom d'affichage : `emblem_name` s'il est non vide, sinon `emblem_id` (port inagle `name`).
    #[must_use]
    pub fn display_name(&self) -> &str {
        if self.emblem_name.is_empty() {
            &self.emblem_id
        } else {
            &self.emblem_name
        }
    }

    /// Réinterprète `emblem_id` (chaîne hex `"0x..."`) en [`HashId`]. [`HashId::ZERO`] si invalide.
    #[must_use]
    pub fn emblem_id_hash(&self) -> HashId {
        HashId::parse(&self.emblem_id).unwrap_or(HashId::ZERO)
    }

    /// Chemin de la petite texture résolu pour `emblem_name` (substitue [`RESOURCE_ID_TOKEN`]).
    /// Sur une entrée concrète le chemin est déjà résolu et renvoyé inchangé.
    #[must_use]
    pub fn small_file_path_for(&self, emblem_name: &str) -> String {
        resolve_resource_id(&self.small_file_path, emblem_name)
    }

    /// Chemin de la grande texture résolu pour `emblem_name` (substitue [`RESOURCE_ID_TOKEN`]).
    #[must_use]
    pub fn large_file_path_for(&self, emblem_name: &str) -> String {
        resolve_resource_id(&self.large_file_path, emblem_name)
    }
}

// ─── EmblemResourceDatabase ──────────────────────────────────────────────────────

/// Contenu complet d'un `emblem_resource_*.cfg.bin` : tous les emblèmes + le `base_path` commun.
///
/// Construire via [`parse_emblem_resources`].
#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct EmblemResourceDatabase {
    /// Toutes les entrées `EMBLEM_RESOURCE_INFO` (gabarit « default » inclus, en première position).
    pub emblems: Vec<Emblem>,
    /// `basePath` commun (`"#/menu/"` dans le dump réel).
    pub base_path: String,
}

impl EmblemResourceDatabase {
    /// Nombre d'emblèmes (gabarit compris).
    #[must_use]
    pub fn len(&self) -> usize {
        self.emblems.len()
    }

    /// `true` si aucun emblème.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.emblems.is_empty()
    }

    /// Itère sur les emblèmes.
    pub fn iter(&self) -> core::slice::Iter<'_, Emblem> {
        self.emblems.iter()
    }

    /// Recherche un emblème par son `emblem_id` (chaîne hex, ex. `"0xD5ABE1F0"`). `None` si absent.
    #[must_use]
    pub fn find_by_id(&self, emblem_id: &str) -> Option<&Emblem> {
        self.emblems.iter().find(|e| e.emblem_id == emblem_id)
    }

    /// Recherche un emblème par son `emblem_name` (ex. `"em010001"`). `None` si absent.
    #[must_use]
    pub fn find_by_name(&self, emblem_name: &str) -> Option<&Emblem> {
        self.emblems.iter().find(|e| e.emblem_name == emblem_name)
    }

    /// Renvoie l'entrée gabarit (« default »), si présente.
    #[must_use]
    pub fn template(&self) -> Option<&Emblem> {
        self.emblems.iter().find(|e| e.is_template)
    }
}

// ─── Parseur principal ───────────────────────────────────────────────────────────

/// Parse un `emblem_resource_*.cfg.bin` complet (forme iecode `{ "lists": [...] }`).
///
/// Port 1:1 d'inagle `parseContent` (`emblems.ts` l.55-94) : récupère d'abord le `basePath` de
/// `m_EmblemResourceBasePathList[0]`, puis construit une entrée par ligne de
/// `m_EmblemResourceInfoList`. Comptes réels (`emblem_resource_0.04.18`) : 2 emblèmes (gabarit
/// `default` + `em010001`), 1 `basePath` (`"#/menu/"`).
#[must_use]
pub fn parse_emblem_resources(root: &Value) -> EmblemResourceDatabase {
    // basePath : liste séparée, 1 entrée (inagle l.60-65).
    let base_path = list_values(root, "m_EmblemResourceBasePathList")
        .and_then(|vals| vals.first())
        .and_then(|v| field_str(v, "basePath"))
        .map_or_else(String::new, owned);

    let emblems = list_values(root, "m_EmblemResourceInfoList")
        .map(|vals| {
            vals.iter()
                .map(|v| Emblem::from_value(v, &base_path))
                .collect()
        })
        .unwrap_or_default();

    EmblemResourceDatabase { emblems, base_path }
}
