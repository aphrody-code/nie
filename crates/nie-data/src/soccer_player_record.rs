//! `soccer_player_record` — port de `soccer/soccer_player_record_config_*.cfg.bin`.
//!
//! Mappe un enregistrement de joueur (`id`) aux **flags de record** par difficulté CPU (1-4) et
//! par mode (rank/room/enjoy). Famille non couverte ; port direct (tous champs = hash).
//!
//! Vérité terrain : `m_soccerPlayerRecordInfoList` (20 entrées).

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, list_values};
use crate::hash::HashId;

/// Une entrée d'enregistrement de joueur (flags de record).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct PlayerRecordInfo {
    /// `id` — hash de l'enregistrement.
    pub id: HashId,
    /// `flag_cpu_difficulty_1..4` — flags par difficulté CPU.
    pub flag_cpu_difficulty: [HashId; 4],
    /// `flag_rank_match` — flag du mode classé.
    pub flag_rank_match: HashId,
    /// `flag_room_match` — flag du mode salon.
    pub flag_room_match: HashId,
    /// `flag_enjoy_match` — flag du mode détente.
    pub flag_enjoy_match: HashId,
}

impl PlayerRecordInfo {
    /// Parse une entrée. `None` si `id` nul.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let id = field_hash(v, "id");
        if id.is_zero() {
            return None;
        }
        Some(Self {
            id,
            flag_cpu_difficulty: [
                field_hash(v, "flag_cpu_difficulty_1"),
                field_hash(v, "flag_cpu_difficulty_2"),
                field_hash(v, "flag_cpu_difficulty_3"),
                field_hash(v, "flag_cpu_difficulty_4"),
            ],
            flag_rank_match: field_hash(v, "flag_rank_match"),
            flag_room_match: field_hash(v, "flag_room_match"),
            flag_enjoy_match: field_hash(v, "flag_enjoy_match"),
        })
    }
}

/// Contenu d'un `soccer_player_record_config_*.cfg.bin`.
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SoccerPlayerRecordConfig {
    /// `m_soccerPlayerRecordInfoList` — les enregistrements.
    pub records: Vec<PlayerRecordInfo>,
}

/// Parse un `soccer_player_record_config_*.cfg.bin.json`.
#[must_use]
pub fn parse_soccer_player_record_config(root: &Value) -> SoccerPlayerRecordConfig {
    let mut records = Vec::new();
    if let Some(values) = list_values(root, "m_soccerPlayerRecordInfoList") {
        for v in values {
            if let Some(r) = PlayerRecordInfo::from_value(v) {
                records.push(r);
            }
        }
    }
    SoccerPlayerRecordConfig { records }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_records() {
        let root = json!({
            "lists": [{ "name": "m_soccerPlayerRecordInfoList", "values": [
                { "id": "0xB358708B", "flag_cpu_difficulty_1": "0x235B5ED4",
                  "flag_cpu_difficulty_2": "0xBA520F6E", "flag_cpu_difficulty_3": "0xCD553FF8",
                  "flag_cpu_difficulty_4": "0x11111111", "flag_rank_match": "0x22222222",
                  "flag_room_match": "0x33333333", "flag_enjoy_match": "0x44444444" }
            ]}]
        });
        let cfg = parse_soccer_player_record_config(&root);
        assert_eq!(cfg.records.len(), 1);
        let r = &cfg.records[0];
        assert_eq!(r.id, HashId(0xB358_708B));
        assert_eq!(r.flag_cpu_difficulty[0], HashId(0x235B_5ED4));
        assert_eq!(r.flag_enjoy_match, HashId(0x4444_4444));
    }
}
