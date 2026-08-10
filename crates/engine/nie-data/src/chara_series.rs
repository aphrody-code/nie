//! `chara_series` — séries de jeu d'un personnage (`character/chara_series_config.cfg.bin`).
//!
//! ## Vérité terrain (anti-hallucination)
//!
//! - Parser TS de référence : `packages/inagle/src/parsers/belong-team.ts`
//!   (`loadCharaSeriesInfo`, `buildSeriesMapping`, table `SERIES_NAMES_BY_TYPE`) — **port 1:1**.
//! - Données : `data/common/gamedata/character/chara_series_config.cfg.bin` (VFS IEVR), format
//!   **RDBN** (`lists`). Liste `m_charaSeriesInfoList`, type `CHARA_SERIES_INFO`, **9 séries** ;
//!   champs réels (probe live) : `charaSeriesId` (Hash), `charaSeriesType` (Int),
//!   `charaSeriesNameTextId` (Hash). Ex. row0 : `0x62E8448F` / type 1 / `0xE6D1097B`.
//!
//! ## Noms de série
//!
//! Les noms viennent d'une **table par TYPE codée en dur** (inagle : *« text files don't have
//! reliable entries »*, validée contre `zukan.inazuma.jp` sur 5640 personnages) — **PAS** d'une
//! table de texte. `charaSeriesNameTextId` est conservé mais non utilisé pour le nom.

use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, list_values};
use crate::hash::HashId;

/// Une entrée `CHARA_SERIES_INFO` portée.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaSeriesInfo {
    /// `charaSeriesId` — identifiant de série (clé ; lié à `chara_base.series_id`).
    pub series_id: HashId,
    /// `charaSeriesType` — type de série (`1..=9`, clé des noms codés en dur).
    pub series_type: i64,
    /// `charaSeriesNameTextId` — hash de texte (conservé ; non utilisé pour le nom).
    pub name_text_id: HashId,
}

/// Nom **français** d'un type de série (`1..=9`), ou `None` hors plage.
///
/// Port de `SERIES_NAMES_BY_TYPE` (champ `fr`).
#[must_use]
pub fn series_name_fr(series_type: i64) -> Option<&'static str> {
    Some(match series_type {
        1 => "Inazuma Eleven",
        2 => "Inazuma Eleven 2",
        3 => "Inazuma Eleven 3",
        4 => "Inazuma Eleven GO",
        5 => "Chrono Stone",
        6 => "Galaxy",
        7 => "Ares",
        8 => "Orion",
        9 => "Victory Road",
        _ => return None,
    })
}

/// Nom **anglais** d'un type de série (`1..=9`), ou `None` hors plage (port de `SERIES_NAMES_BY_TYPE.en`).
#[must_use]
pub fn series_name_en(series_type: i64) -> Option<&'static str> {
    Some(match series_type {
        1 => "Inazuma Eleven",
        2 => "Inazuma Eleven 2",
        3 => "Inazuma Eleven 3",
        4 => "Inazuma Eleven GO",
        5 => "Chrono Stone",
        6 => "Galaxy",
        7 => "Ares",
        8 => "Orion",
        9 => "Victory Road",
        _ => return None,
    })
}

/// Parse la liste `m_charaSeriesInfoList` d'un `chara_series_config.cfg.bin.json` désérialisé.
///
/// Port de `loadCharaSeriesInfo` (lecture brute `data.lists[0].values`).
#[must_use]
pub fn parse_chara_series_config(root: &Value) -> alloc::vec::Vec<CharaSeriesInfo> {
    let mut out = alloc::vec::Vec::new();
    if let Some(values) = list_values(root, "m_charaSeriesInfoList") {
        for v in values {
            out.push(CharaSeriesInfo {
                series_id: field_hash(v, "charaSeriesId"),
                series_type: field_i64(v, "charaSeriesType").unwrap_or(0),
                name_text_id: field_hash(v, "charaSeriesNameTextId"),
            });
        }
    }
    out
}

/// Recherche une série par `series_id` (clé de jointure depuis `chara_base.series_id`).
#[must_use]
pub fn find_by_id(series: &[CharaSeriesInfo], series_id: HashId) -> Option<&CharaSeriesInfo> {
    series.iter().find(|s| s.series_id == series_id)
}
