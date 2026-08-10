// SPDX-License-Identifier: Apache-2.0
//! Famille `soccer_performance` — configuration des « performances » (animations
//! d'événement spéciales) de match.
//!
//! ## Rôle
//!
//! Une *performance* est un événement spectaculaire déclenché en match (cinématique /
//! animation de présentation). Chaque entrée associe un identifiant de performance à son
//! événement (`eventId`), au texte de nom de l'événement (`eventNameTextId`), à l'image
//! d'illustration de l'UI (`textureFilePath` / `textureId`, un `.g4tx`) et à une condition
//! de validité encodée (`validCond`).
//!
//! ## Vérité terrain (anti-hallucination)
//!
//! - VFS : `data/common/gamedata/soccer/soccer_performance_config_0.00.00.00.cfg.bin`
//! - Format : RDBN `lists`, mono-liste `m_soccerPerformanceConfigList`
//!   (type `SOCCER_PERFORMANCE_CONFIG`), **16 entrées**.
//! - Port 1:1 de inagle `packages/inagle/src/parsers/performance-config.ts`
//!   (`parseContent` l.51-77, `extractImageName` l.43-45).
//!
//! Première entrée vérifiée (dump réel du VFS) : `performanceId = 0x16E827AF`,
//! `eventId = 0x83BCE8A4`, `eventNameTextId = 0xD5826DD1`,
//! `textureFilePath = "#/menu/220_img/performance_img/img_performance_type_01.g4tx"`,
//! `textureId = 0x31D18379`,
//! `validCond = "AAAAABgFNRftNPcACgEoAAYCNBboJ68yAAAAAXg="`.
//!
//! ## Note sur `image_name` (port de `extractImageName`)
//!
//! inagle expose un `imagePath` dérivé de `textureFilePath` en retirant le préfixe
//! `#/menu/220_img/` et le suffixe `.g4tx` (`String.prototype.replace`, **première**
//! occurrence seulement). On reproduit ce comportement à l'identique dans
//! [`SoccerPerformanceConfig::image_name`] via `replacen(.., 1)`.

use alloc::string::String;
use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_str, list_values, owned};
use crate::hash::HashId;

/// Nom de l'unique liste portée du config.
pub const LIST_NAME: &str = "m_soccerPerformanceConfigList";

/// Préfixe retiré par [`SoccerPerformanceConfig::image_name`] (port de `extractImageName`).
const IMG_PREFIX: &str = "#/menu/220_img/";
/// Suffixe retiré par [`SoccerPerformanceConfig::image_name`].
const IMG_SUFFIX: &str = ".g4tx";

/// Une entrée `SOCCER_PERFORMANCE_CONFIG` de `m_soccerPerformanceConfigList` (6 champs,
/// comme le dump réel du VFS).
///
/// ## Vérité terrain
///
/// `soccer_performance_config_0.00.00.00.cfg.bin`, `m_soccerPerformanceConfigList[0]` :
/// `{ performanceId: 0x16E827AF, eventId: 0x83BCE8A4, eventNameTextId: 0xD5826DD1,
///    textureFilePath: "#/menu/220_img/performance_img/img_performance_type_01.g4tx",
///    textureId: 0x31D18379, validCond: "AAAAABgFNRftNPcACgEoAAYCNBboJ68yAAAAAXg=" }`
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SoccerPerformanceConfig {
    /// `performanceId` — hash identifiant la performance.
    pub performance_id: HashId,
    /// `eventId` — hash de l'événement de match déclenchant la performance.
    pub event_id: HashId,
    /// `eventNameTextId` — hash du texte de nom de l'événement (`0x00000000` si absent).
    pub event_name_text_id: HashId,
    /// `textureFilePath` — chemin VFS du `.g4tx` d'illustration (conservé brut).
    pub texture_file_path: String,
    /// `textureId` — hash de la texture associée.
    pub texture_id: HashId,
    /// `validCond` — condition de validité encodée (base64, conservée brute comme inagle).
    pub valid_cond: String,
}

impl SoccerPerformanceConfig {
    /// Parse une valeur `values[]` de `m_soccerPerformanceConfigList` (objet JSON à 6 clés).
    ///
    /// Port 1:1 de `parseContent` (performance-config.ts l.57-73) : mapping list→struct sans
    /// filtrage (inagle pousse toutes les valeurs). Les champs chaîne absents valent `""` ;
    /// `eventNameTextId` absent vaut la sentinelle `0x00000000` (`field_hash` → `ZERO`).
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        SoccerPerformanceConfig {
            performance_id: field_hash(v, "performanceId"),
            event_id: field_hash(v, "eventId"),
            event_name_text_id: field_hash(v, "eventNameTextId"),
            texture_file_path: owned(field_str(v, "textureFilePath").unwrap_or("")),
            texture_id: field_hash(v, "textureId"),
            valid_cond: owned(field_str(v, "validCond").unwrap_or("")),
        }
    }

    /// Nom d'image dérivé de `textureFilePath` — port 1:1 de `extractImageName`
    /// (performance-config.ts l.43-45) : retire le préfixe `#/menu/220_img/` puis le suffixe
    /// `.g4tx`, **première** occurrence seulement (sémantique de `String.replace` JS).
    ///
    /// Vérité terrain : entrée 0 → `"performance_img/img_performance_type_01"`.
    #[must_use]
    pub fn image_name(&self) -> String {
        self.texture_file_path
            .replacen(IMG_PREFIX, "", 1)
            .replacen(IMG_SUFFIX, "", 1)
    }
}

/// Parse toute la liste `m_soccerPerformanceConfigList` d'un `soccer_performance_config`
/// désérialisé. Conserve l'ordre et le nombre des valeurs (port 1:1 de `parseContent`,
/// aucun filtrage).
#[must_use]
pub fn parse_performance_config(root: &Value) -> Vec<SoccerPerformanceConfig> {
    let mut out = Vec::new();
    if let Some(values) = list_values(root, LIST_NAME) {
        out.reserve(values.len());
        for v in values {
            out.push(SoccerPerformanceConfig::from_value(v));
        }
    }
    out
}

/// Cherche une performance par son `performanceId` (commodité, équivalent du `byId` d'inagle).
#[must_use]
pub fn find_performance(
    list: &[SoccerPerformanceConfig],
    performance_id: HashId,
) -> Option<&SoccerPerformanceConfig> {
    list.iter().find(|p| p.performance_id == performance_id)
}
