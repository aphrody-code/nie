//! `UserNamePlateConfig` — port Rust de `user_name_plate_config_*.cfg.bin.json` (Level-5 IEVR).
//!
//! Plaques de nom (« nameplate ») affichées sur le profil joueur : image, police du nom,
//! flag de déblocage et condition d'ouverture.
//!
//! ## Vérité terrain
//!
//! - Dump réel : `/home/ubuntu/niers/data/common/gamedata/user_name_plate/user_name_plate_config_1.03.50.00.cfg.bin.json`
//! - 1 liste dans ce fichier :
//!   - `m_userNamePlateInfoList` — 142 entrées `USER_NAME_PLATE_INFO`, chacune décrivant
//!     une plaque de nom débloquable.
//!
//! ## Champs observés sur le dump réel
//!
//! | Champ                  | Type JSON  | Sémantique observée                                         |
//! |------------------------|------------|--------------------------------------------------------------|
//! | `userNamePlateId`      | hex string | Identifiant hash de la plaque (ex. `"0x0976673C"`)          |
//! | `userNamePlateNameId`  | hex string | Hash du texte de nom associé (ex. `"0x011D2282"`)           |
//! | `sortNo`               | integer    | Ordre d'affichage unique; the first 60 legacy values are sequential |
//! | `textureFileNameText`  | string     | Chemin VFS du `.g4tx` (ex. `"#/menu/.../nm00001.g4tx"`)     |
//! | `textureFileNameCrc`   | hex string | CRC32 du chemin de texture                                   |
//! | `mainTextureNameCrc`   | hex string | CRC32 de la texture principale                               |
//! | `shadowTextureNameCrc` | hex string | CRC32 de la texture d'ombre                                  |
//! | `nameFontStyle`        | hex string | Hash du style de police du nom (8 valeurs distinctes)        |
//! | `flagIndex`            | integer    | Index 0..59 for legacy rows; 0 for the later grouped rows     |
//! | `enableCond`           | string     | Condition base64 opaque, or `0xFFFFFFFF` when absent          |
//!
//! `enableCond` is an opaque base64 condition. The unsigned -1 sentinel is normalized to an
//! empty string for entries that have no activation condition.
//!
//! Le parser inagle (`packages/inagle/src/parsers/nameplate-config.ts`) n'expose qu'un
//! sous-ensemble des champs (id, nameId, sortNo, image, fontStyle, flagIndex, enableCond) ;
//! on conserve ici **tous** les champs du dump, y compris les trois CRC de texture.

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, field_optional_str, field_str, list_values};
use crate::hash::HashId;

// ─── UserNamePlateInfo ─────────────────────────────────────────────────────────

/// Entrée `USER_NAME_PLATE_INFO` — plaque de nom débloquable du profil joueur.
///
/// Vérité terrain : `user_name_plate_config_1.03.50.00.cfg.bin.json`, liste
/// `m_userNamePlateInfoList`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct UserNamePlateInfo {
    /// `userNamePlateId` — identifiant hash de la plaque (ex. `0x0976673C`).
    pub user_name_plate_id: HashId,
    /// `userNamePlateNameId` — hash du texte de nom associé (ex. `0x011D2282`).
    pub user_name_plate_name_id: HashId,
    /// `sortNo` — unique display order; not globally sequential.
    pub sort_no: i64,
    /// `textureFileNameText` — chemin VFS du fichier `.g4tx` de la plaque.
    ///
    /// Vérité terrain : `m_userNamePlateInfoList[0].textureFileNameText =
    /// "#/menu/200_icon/25_icon_nameplate/nm00001.g4tx"`.
    pub texture_file_name_text: String,
    /// `textureFileNameCrc` — CRC32 du chemin de texture (ex. `0xAF3937FF`).
    pub texture_file_name_crc: HashId,
    /// `mainTextureNameCrc` — CRC32 de la texture principale (ex. `0xA892B3C2`).
    pub main_texture_name_crc: HashId,
    /// `shadowTextureNameCrc` — CRC32 de la texture d'ombre (ex. `0x319BE278`).
    pub shadow_texture_name_crc: HashId,
    /// `nameFontStyle` — hash du style de police du nom.
    pub name_font_style: HashId,
    /// `flagIndex` — progression flag index; later grouped entries reuse zero.
    pub flag_index: i64,
    /// `enableCond` — condition d'activation : chaîne base64 opaque (données binaires non
    /// décodées), ou `""` pour les plaques actives par défaut.
    pub enable_cond: String,
}

impl UserNamePlateInfo {
    /// Parse une entrée de `m_userNamePlateInfoList`. `None` si `userNamePlateId` est nul/absent.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let user_name_plate_id = field_hash(v, "userNamePlateId");
        if user_name_plate_id.is_zero() {
            return None;
        }
        Some(Self {
            user_name_plate_id,
            user_name_plate_name_id: field_hash(v, "userNamePlateNameId"),
            sort_no: field_i64(v, "sortNo").unwrap_or(0),
            texture_file_name_text: field_str(v, "textureFileNameText").unwrap_or("").into(),
            texture_file_name_crc: field_hash(v, "textureFileNameCrc"),
            main_texture_name_crc: field_hash(v, "mainTextureNameCrc"),
            shadow_texture_name_crc: field_hash(v, "shadowTextureNameCrc"),
            name_font_style: field_hash(v, "nameFontStyle"),
            flag_index: field_i64(v, "flagIndex").unwrap_or(0),
            enable_cond: field_optional_str(v, "enableCond").unwrap_or("").into(),
        })
    }
}

// ─── UserNamePlateConfig ───────────────────────────────────────────────────────

/// Contenu complet d'un `user_name_plate_config_*.cfg.bin.json`.
///
/// Utiliser [`parse_user_name_plate_config`] pour construire depuis un `serde_json::Value`.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct UserNamePlateConfig {
    /// 142 entrées de plaque (`m_userNamePlateInfoList`).
    pub entries: Vec<UserNamePlateInfo>,
}

impl UserNamePlateConfig {
    /// Recherche une plaque par son `userNamePlateId`. `None` si absente.
    ///
    /// # Exemple
    ///
    /// ```
    /// use nie_data::user_name_plate::{UserNamePlateInfo, UserNamePlateConfig};
    /// use nie_data::hash::HashId;
    ///
    /// let config = UserNamePlateConfig {
    ///     entries: vec![UserNamePlateInfo {
    ///         user_name_plate_id: HashId(0x0976_673C),
    ///         user_name_plate_name_id: HashId(0x011D_2282),
    ///         sort_no: 1,
    ///         texture_file_name_text: "#/menu/200_icon/25_icon_nameplate/nm00001.g4tx".into(),
    ///         texture_file_name_crc: HashId(0xAF39_37FF),
    ///         main_texture_name_crc: HashId(0xA892_B3C2),
    ///         shadow_texture_name_crc: HashId(0x319B_E278),
    ///         name_font_style: HashId(0x66A0_930A),
    ///         flag_index: 0,
    ///         enable_cond: String::new(),
    ///     }],
    /// };
    /// assert!(config.find_by_id(HashId(0x0976_673C)).is_some());
    /// assert!(config.find_by_id(HashId(0xDEAD_BEEF)).is_none());
    /// ```
    #[must_use]
    pub fn find_by_id(&self, id: HashId) -> Option<&UserNamePlateInfo> {
        self.entries.iter().find(|e| e.user_name_plate_id == id)
    }

    /// Recherche une plaque par son `flagIndex`. `None` si absente.
    #[must_use]
    pub fn find_by_flag_index(&self, flag_index: i64) -> Option<&UserNamePlateInfo> {
        self.entries.iter().find(|e| e.flag_index == flag_index)
    }
}

// ─── Parseur principal ─────────────────────────────────────────────────────────

/// Parse un `user_name_plate_config_*.cfg.bin.json` complet (liste `m_userNamePlateInfoList`).
///
/// Renvoie un [`UserNamePlateConfig`] avec toutes les entrées valides (id non-nul).
/// Les entrées invalides sont silencieusement ignorées.
///
/// Compte réel : `user_name_plate_config_1.03.50.00.cfg.bin.json` → 142 entrées.
#[must_use]
pub fn parse_user_name_plate_config(root: &Value) -> UserNamePlateConfig {
    let entries = if let Some(values) = list_values(root, "m_userNamePlateInfoList") {
        let mut out = Vec::new();
        for v in values {
            if let Some(info) = UserNamePlateInfo::from_value(v) {
                out.push(info);
            }
        }
        out
    } else {
        Vec::new()
    };
    UserNamePlateConfig { entries }
}
