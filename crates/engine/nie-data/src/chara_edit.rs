//! `CharaEditPartsTypeConfig` — port Rust de `character/chara_edit_parts_type_config_*.cfg.bin.json`
//! (Level-5 IEVR, **éditeur d'avatar / création de personnage**).
//!
//! ## Quoi
//!
//! Le catalogue des **parties customisables** de l'éditeur d'avatar : les **types de visage** et
//! les **parts de corps (accessoires)**, chacun avec une ressource (modèle 3D) **par morphologie**
//! (les 8 *body types* du jeu : male/female/small/smallfat/tall/tallmuscle/muscle/big).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `data/common/gamedata/character/chara_edit_parts_type_config_1.03.75.00.cfg.bin.json`.
//! - Format **`lists`** (champs nommés). 4 listes :
//!   - `m_CharaEditFaceTypeDataList` (42) — parts de visage par type de nez, [`CharaEditFaceTypeData`].
//!   - `m_CharaEditFaceTypeInfoList` (6) — types de modèle de visage + plage `[offset,count]` dans
//!     la data list, [`CharaEditFaceTypeInfo`].
//!   - `m_CharaEditPartsBodyTypeDataList` (24) — parts de corps (accessoires), [`CharaEditPartsBodyData`].
//!   - `m_CharaEditPartsBodyTypeInfoList` (1) — type de parts + plage, [`CharaEditPartsBodyInfo`].
//!
//! Les `*PatternID` et `*Crc` sont des hashes ; les `resource_*` sont des noms de modèle 3D
//! (`face51_nose01`, `accessory001`…). Les `*Info` portent un `[offset, count]` indexant la data list
//! associée (chaque type de visage couvre une plage de parts).

use alloc::{format, string::String, vec::Vec};
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, field_str, list_values};
use crate::hash::HashId;

/// Les 8 morphologies du jeu, dans l'ordre des suffixes de champs (`resource_<bt>`, `facePatternID_<bt>`).
pub const BODY_TYPES: [&str; 8] =
    ["male", "female", "small", "smallfat", "tall", "tallmuscle", "muscle", "big"];

/// Lit un champ `String` (vide si absent), en chaîne possédée.
fn s(v: &Value, key: &str) -> String {
    String::from(field_str(v, key).unwrap_or(""))
}

/// Une part de **visage** (`m_CharaEditFaceTypeDataList`) — un type de nez, décliné par morphologie.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaEditFaceTypeData {
    /// `noseType` — nom du type de nez (ex. `nose_type_01`).
    pub nose_type: String,
    /// `noseTypeCrc` — hash du type de nez.
    pub nose_type_crc: HashId,
    /// `facePatternID_<bt>` — hash du pattern de visage, indexé par [`BODY_TYPES`].
    pub face_pattern_id: [HashId; 8],
    /// `resource_<bt>` — nom du modèle 3D, indexé par [`BODY_TYPES`] (ex. `face51_nose01`).
    pub resource: [String; 8],
}

impl CharaEditFaceTypeData {
    fn from_value(v: &Value) -> Self {
        Self {
            nose_type: s(v, "noseType"),
            nose_type_crc: field_hash(v, "noseTypeCrc"),
            face_pattern_id: core::array::from_fn(|i| {
                field_hash(v, &format!("facePatternID_{}", BODY_TYPES[i]))
            }),
            resource: core::array::from_fn(|i| s(v, &format!("resource_{}", BODY_TYPES[i]))),
        }
    }
}

/// Un **type de modèle de visage** (`m_CharaEditFaceTypeInfoList`) + sa plage de parts.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaEditFaceTypeInfo {
    /// `faceType` — nom du type de visage (ex. `face_mdl_type_01`).
    pub face_type: String,
    /// `faceTypeCrc` — hash du type.
    pub face_type_crc: HashId,
    /// `faceTypeData[0]` — offset dans `m_CharaEditFaceTypeDataList`.
    pub data_offset: i64,
    /// `faceTypeData[1]` — nombre de parts couvertes.
    pub data_count: i64,
}

impl CharaEditFaceTypeInfo {
    fn from_value(v: &Value) -> Self {
        let arr = v.get("faceTypeData").and_then(Value::as_array);
        let at = |i: usize| arr.and_then(|a| a.get(i)).and_then(Value::as_i64).unwrap_or(0);
        Self {
            face_type: s(v, "faceType"),
            face_type_crc: field_hash(v, "faceTypeCrc"),
            data_offset: at(0),
            data_count: at(1),
        }
    }
}

/// Une part de **corps** (`m_CharaEditPartsBodyTypeDataList`) — un accessoire, décliné par morphologie.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaEditPartsBodyData {
    /// `presetID` — hash du preset d'accessoire.
    pub preset_id: HashId,
    /// `resource_<bt>` — nom du modèle 3D, indexé par [`BODY_TYPES`] (ex. `accessory001`).
    pub resource: [String; 8],
}

impl CharaEditPartsBodyData {
    fn from_value(v: &Value) -> Self {
        Self {
            preset_id: field_hash(v, "presetID"),
            resource: core::array::from_fn(|i| s(v, &format!("resource_{}", BODY_TYPES[i]))),
        }
    }
}

/// Un **type de parts de corps** (`m_CharaEditPartsBodyTypeInfoList`) + sa plage.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaEditPartsBodyInfo {
    /// `partsType` — identifiant du type de parts (entier).
    pub parts_type: i64,
    /// `partsTypeData[0]` — offset dans `m_CharaEditPartsBodyTypeDataList`.
    pub data_offset: i64,
    /// `partsTypeData[1]` — nombre de parts couvertes.
    pub data_count: i64,
}

impl CharaEditPartsBodyInfo {
    fn from_value(v: &Value) -> Self {
        let arr = v.get("partsTypeData").and_then(Value::as_array);
        let at = |i: usize| arr.and_then(|a| a.get(i)).and_then(Value::as_i64).unwrap_or(0);
        Self { parts_type: field_i64(v, "partsType").unwrap_or(0), data_offset: at(0), data_count: at(1) }
    }
}

/// Config complète de l'éditeur d'avatar (4 listes).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaEditPartsTypeConfig {
    pub face_data: Vec<CharaEditFaceTypeData>,
    pub face_info: Vec<CharaEditFaceTypeInfo>,
    pub body_data: Vec<CharaEditPartsBodyData>,
    pub body_info: Vec<CharaEditPartsBodyInfo>,
}

/// Collecte une liste nommée en mappant chaque `values[]` par `f`.
fn collect_list<T>(root: &Value, name: &str, f: impl Fn(&Value) -> T) -> Vec<T> {
    list_values(root, name).map_or_else(Vec::new, |vs| vs.iter().map(f).collect())
}

/// Parse `chara_edit_parts_type_config.cfg.bin.json` → les 4 listes de l'éditeur d'avatar.
#[must_use]
pub fn parse_chara_edit_parts_type_config(root: &Value) -> CharaEditPartsTypeConfig {
    CharaEditPartsTypeConfig {
        face_data: collect_list(root, "m_CharaEditFaceTypeDataList", CharaEditFaceTypeData::from_value),
        face_info: collect_list(root, "m_CharaEditFaceTypeInfoList", CharaEditFaceTypeInfo::from_value),
        body_data: collect_list(root, "m_CharaEditPartsBodyTypeDataList", CharaEditPartsBodyData::from_value),
        body_info: collect_list(root, "m_CharaEditPartsBodyTypeInfoList", CharaEditPartsBodyInfo::from_value),
    }
}
