//! `UpdateNoticeConfig` — port Rust de `update_notice_config_*.cfg.bin.json` (Level-5 IEVR).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `/home/ubuntu/niers/data/common/gamedata/update_notice/update_notice_config_0.00.00.cfg.bin.json`
//! - Pas de parser inagle connu : le dump `.cfg.bin.json` EST la vérité terrain.
//! - Format **`lists`** (champs nommés), identique à `banner` / `formation`.
//! - Deux listes dans ce fichier :
//!   - `m_updateNoticeDataList` — 26 entrées `UPDATE_NOTICE_DATA` : couple
//!     (`textureName`, `textId`) décrivant une page d'écran de notification de mise à jour.
//!   - `m_updateNoticeInfoList` — 4 entrées `UPDATE_NOTICE_INFO` : un groupe de pages
//!     (tranche `[start, count]` dans `m_updateNoticeDataList`) plus sa condition d'activation.
//!
//! ## Champs `UPDATE_NOTICE_DATA`
//!
//! | Champ JSON    | Type JSON  | Sémantique observée                                   |
//! |---------------|------------|-------------------------------------------------------|
//! | `textureName` | hex string | Hash du nom de texture de la page (ex. `"0xAB293174"`) |
//! | `textId`      | hex string | Hash du texte affiché sur la page (jointure texte)    |
//!
//! ## Champs `UPDATE_NOTICE_INFO`
//!
//! | Champ JSON         | Type JSON     | Sémantique observée                                          |
//! |--------------------|---------------|-------------------------------------------------------------|
//! | `updateId`         | hex string    | Identifiant unique de la notification de mise à jour         |
//! | `globalBitFlagId`  | hex string    | Hash du flag global « déjà vu » associé à cette notification |
//! | `updateNoticeData` | array\[2\] int | Tranche `[start, count]` dans `m_updateNoticeDataList`       |
//! | `enableCond`       | base64 string | Condition d'activation : blob binaire opaque (non décodé)   |
//!
//! ### Partition observée de `updateNoticeData`
//!
//! Les 4 tranches partitionnent exactement les 26 entrées de la liste de données :
//! `[0, 8]`, `[8, 6]`, `[14, 5]`, `[19, 7]` (0+8=8, 8+6=14, 14+5=19, 19+7=26).
//!
//! ### Note sur `enableCond`
//!
//! `enableCond` est une chaîne base64 encodant un blob binaire (même famille de condition
//! que `openCond` de la galerie / `enableCond` ailleurs dans le game-data). Le format interne
//! n'est pas décodé ici : la valeur est conservée verbatim comme `String` opaque.

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_str, list_values};
use crate::hash::HashId;

// ─── UpdateNoticeData ─────────────────────────────────────────────────────────

/// Entrée `UPDATE_NOTICE_DATA` — une page d'écran de notification de mise à jour.
///
/// Vérité terrain : `m_updateNoticeDataList[0] = { textureName: "0xAB293174", textId: "0x29F4B231" }`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct UpdateNoticeData {
    /// `textureName` — hash du nom de texture de la page affichée.
    pub texture_name: HashId,
    /// `textId` — hash du texte affiché sur la page (jointure texte localisé).
    pub text_id: HashId,
}

impl UpdateNoticeData {
    /// Parse une entrée de `m_updateNoticeDataList`. `None` si `textureName` est nul ou absent.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let texture_name = field_hash(v, "textureName");
        if texture_name.is_zero() {
            return None;
        }
        Some(Self {
            texture_name,
            text_id: field_hash(v, "textId"),
        })
    }
}

// ─── UpdateNoticeInfo ─────────────────────────────────────────────────────────

/// Entrée `UPDATE_NOTICE_INFO` — un groupe de pages de notification + sa condition.
///
/// `data_start`/`data_count` désignent une tranche contiguë de `m_updateNoticeDataList`.
///
/// Vérité terrain : `m_updateNoticeInfoList[0] = { updateId: "0x647E0ABB",
/// globalBitFlagId: "0x00C0E385", updateNoticeData: [0, 8], enableCond: "AAAAABgF..." }`.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct UpdateNoticeInfo {
    /// `updateId` — identifiant unique de la notification de mise à jour.
    pub update_id: HashId,
    /// `globalBitFlagId` — hash du flag global « déjà vu » lié à cette notification.
    pub global_bit_flag_id: HashId,
    /// `updateNoticeData[0]` — index de départ dans `m_updateNoticeDataList`.
    pub data_start: i64,
    /// `updateNoticeData[1]` — nombre de pages (entrées) à partir de `data_start`.
    pub data_count: i64,
    /// `enableCond` — condition d'activation : chaîne base64 opaque (blob binaire non décodé).
    pub enable_cond: String,
}

impl UpdateNoticeInfo {
    /// Parse une entrée de `m_updateNoticeInfoList`. `None` si `updateId` est nul ou absent.
    ///
    /// Le champ `updateNoticeData` est un tableau JSON de 2 entiers `[start, count]` ;
    /// les valeurs absentes sont lues comme `0`.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let update_id = field_hash(v, "updateId");
        if update_id.is_zero() {
            return None;
        }
        let arr = v.get("updateNoticeData").and_then(Value::as_array);
        let data_start = arr
            .and_then(|a| a.first())
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let data_count = arr
            .and_then(|a| a.get(1))
            .and_then(Value::as_i64)
            .unwrap_or(0);
        Some(Self {
            update_id,
            global_bit_flag_id: field_hash(v, "globalBitFlagId"),
            data_start,
            data_count,
            enable_cond: field_str(v, "enableCond").unwrap_or("").into(),
        })
    }
}

// ─── UpdateNoticeConfig ───────────────────────────────────────────────────────

/// Contenu complet d'un `update_notice_config_*.cfg.bin.json`.
///
/// Utiliser [`parse_update_notice_config`] pour construire depuis un JSON déjà désérialisé.
#[derive(Debug, Clone)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct UpdateNoticeConfig {
    /// Pages de notification (`m_updateNoticeDataList`) — 26 entrées dans le dump réel.
    pub data: Vec<UpdateNoticeData>,
    /// Groupes de notification (`m_updateNoticeInfoList`) — 4 entrées dans le dump réel.
    pub infos: Vec<UpdateNoticeInfo>,
}

impl UpdateNoticeConfig {
    /// Recherche un groupe par son `updateId`. `None` si absent.
    #[must_use]
    pub fn find_by_update_id(&self, update_id: HashId) -> Option<&UpdateNoticeInfo> {
        self.infos.iter().find(|i| i.update_id == update_id)
    }

    /// Renvoie la tranche de pages (`UPDATE_NOTICE_DATA`) référencée par un groupe.
    ///
    /// Découpe `data[data_start .. data_start + data_count]`, bornée à la taille réelle
    /// de la liste pour ne jamais paniquer sur des indices hors limites.
    #[must_use]
    pub fn pages_of(&self, info: &UpdateNoticeInfo) -> &[UpdateNoticeData] {
        let len = self.data.len();
        let start = (info.data_start.max(0) as usize).min(len);
        let count = info.data_count.max(0) as usize;
        let end = start.saturating_add(count).min(len);
        &self.data[start..end]
    }
}

// ─── Parseur principal ────────────────────────────────────────────────────────

/// Parse un `update_notice_config_*.cfg.bin.json` complet (deux listes).
///
/// Renvoie un [`UpdateNoticeConfig`] avec les pages et les groupes remplis. Les entrées
/// sans identifiant valide sont silencieusement ignorées.
#[must_use]
pub fn parse_update_notice_config(root: &Value) -> UpdateNoticeConfig {
    let mut data = Vec::new();
    if let Some(values) = list_values(root, "m_updateNoticeDataList") {
        for v in values {
            if let Some(item) = UpdateNoticeData::from_value(v) {
                data.push(item);
            }
        }
    }
    let mut infos = Vec::new();
    if let Some(values) = list_values(root, "m_updateNoticeInfoList") {
        for v in values {
            if let Some(item) = UpdateNoticeInfo::from_value(v) {
                infos.push(item);
            }
        }
    }
    UpdateNoticeConfig { data, infos }
}
