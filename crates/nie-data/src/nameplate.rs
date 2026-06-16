//! `NamePlateConfig` — port Rust de `user_name_plate_config_*.cfg.bin` (Level-5 IEVR) :
//! les **plaques de nom** (bannières de profil joueur) — image, texte, condition de déblocage.
//!
//! ## Vérité terrain
//!
//! - Parser TS de référence : `packages/inagle/src/parsers/nameplate-config.ts`
//!   (`parseContent`, liste `m_userNamePlateInfoList`, champ `m_userNamePlateInfoList`).
//! - Dump réel (VFS Steam) :
//!   `data/common/gamedata/user_name_plate/user_name_plate_config_1.03.50.00.cfg.bin`
//!   (RDBN, 1 liste `m_userNamePlateInfoList` / `typeName` `USER_NAME_PLATE_INFO`, **54 entrées**).
//!
//! ## Structure (1 liste RDBN, 10 champs)
//!
//! `userNamePlateId` (clé) · `userNamePlateNameId` (texte localisé) · `sortNo` ·
//! `textureFileNameText` (chemin VFS du `.g4tx`) · `textureFileNameCrc` / `mainTextureNameCrc` /
//! `shadowTextureNameCrc` (CRC des textures) · `nameFontStyle` · `flagIndex` · `enableCond`
//! (`0xFFFFFFFF` = aucune condition / toujours débloquée ; sinon blob base64 d'une condition de
//! déblocage). Les 3 champs `*TextureNameCrc` sont présents dans le binaire mais absents de
//! l'export inagle (lecture fidèle au `.cfg.bin`, pas à l'export).

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, field_str, list_values, owned};
use crate::hash::HashId;

/// Entrée `USER_NAME_PLATE_INFO` — une plaque de nom (bannière de profil joueur).
///
/// Port 1:1 de la ligne RDBN. Les noms de champs préservent la casse Level-5.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct NamePlateInfo {
    /// `userNamePlateId` — identifiant de la plaque (clé stable).
    pub user_name_plate_id: HashId,
    /// `userNamePlateNameId` — hash du texte de nom (jointure texte localisé).
    pub user_name_plate_name_id: HashId,
    /// `sortNo` — ordre de tri dans la liste de sélection.
    pub sort_no: i64,
    /// `textureFileNameText` — chemin VFS du `.g4tx` de la plaque
    /// (ex. `#/menu/200_icon/25_icon_nameplate/nm00001.g4tx`).
    pub texture_file_name_text: String,
    /// `textureFileNameCrc` — CRC du chemin de texture (`textureFileNameText`).
    pub texture_file_name_crc: HashId,
    /// `mainTextureNameCrc` — CRC de la région de texture principale dans l'atlas.
    pub main_texture_name_crc: HashId,
    /// `shadowTextureNameCrc` — CRC de la région d'ombre dans l'atlas.
    pub shadow_texture_name_crc: HashId,
    /// `nameFontStyle` — CRC du style de police appliqué au nom.
    pub name_font_style: HashId,
    /// `flagIndex` — index de drapeau de progression associé.
    pub flag_index: i64,
    /// `enableCond` — condition de déblocage : `"0xFFFFFFFF"` = toujours débloquée, sinon blob
    /// base64 d'une condition (laissée brute, l'interprétation relève du consommateur).
    pub enable_cond: String,
}

impl NamePlateInfo {
    /// Parse une valeur `USER_NAME_PLATE_INFO` (champs lus tels quels, port direct d'inagle).
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            user_name_plate_id: field_hash(v, "userNamePlateId"),
            user_name_plate_name_id: field_hash(v, "userNamePlateNameId"),
            sort_no: field_i64(v, "sortNo").unwrap_or(0),
            texture_file_name_text: owned(field_str(v, "textureFileNameText").unwrap_or("")),
            texture_file_name_crc: field_hash(v, "textureFileNameCrc"),
            main_texture_name_crc: field_hash(v, "mainTextureNameCrc"),
            shadow_texture_name_crc: field_hash(v, "shadowTextureNameCrc"),
            name_font_style: field_hash(v, "nameFontStyle"),
            flag_index: field_i64(v, "flagIndex").unwrap_or(0),
            enable_cond: owned(field_str(v, "enableCond").unwrap_or("")),
        }
    }

    /// `true` si la plaque est débloquée sans condition (`enableCond == "0xFFFFFFFF"`).
    #[must_use]
    pub fn is_unconditional(&self) -> bool {
        self.enable_cond == "0xFFFFFFFF"
    }
}

/// Parse la liste `m_userNamePlateInfoList` d'un `user_name_plate_config` (forme iecode `lists`).
#[must_use]
pub fn parse_nameplate_config(root: &Value) -> Vec<NamePlateInfo> {
    list_values(root, "m_userNamePlateInfoList")
        .map(|vs| vs.iter().map(NamePlateInfo::from_value).collect())
        .unwrap_or_default()
}

/// Recherche une plaque par son `userNamePlateId`.
#[must_use]
pub fn find_by_id(plates: &[NamePlateInfo], id: HashId) -> Option<&NamePlateInfo> {
    plates.iter().find(|p| p.user_name_plate_id == id)
}
