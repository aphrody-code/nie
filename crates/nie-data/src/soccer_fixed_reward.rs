//! `soccer_fixed_reward` — port de `soccer/soccer_fixed_reward_spirit_config_*.cfg.bin`.
//!
//! Récompenses d'**esprits/joueurs fixes** de match (récompenses garanties + coffres de victoire).
//! Famille non couverte ; port direct. Format `lists`, tables `info` à tranche `[offset,count]`
//! indexant les listes `data`.
//!
//! Vérité terrain : `soccer_fixed_reward_spirit_config_*.cfg.bin.json` —
//! `m_soccerFixedRewardSpiritDataList` (42) / `…InfoList` (11) + variantes `m_victoryBoxEmmit…`.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_hash, field_i64, field_pair, list_values};
use crate::hash::HashId;

/// Un esprit/joueur récompensé (entrée `…SpiritDataList`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RewardSpirit {
    /// `charaId` — hash du perso/esprit récompensé.
    pub chara_id: HashId,
    /// `rarity` — rareté.
    pub rarity: i64,
    /// `num` — quantité.
    pub num: i64,
    /// `desableFlagId` — flag de désactivation (`0` = toujours actif).
    pub disable_flag_id: HashId,
}

impl RewardSpirit {
    /// Parse une entrée (infaillible : indexée par tranche, position significative).
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            chara_id: field_hash(v, "charaId"),
            rarity: field_i64(v, "rarity").unwrap_or(0),
            num: field_i64(v, "num").unwrap_or(0),
            disable_flag_id: field_hash(v, "desableFlagId"),
        }
    }
}

/// Une table de récompense (id + tranche `[offset,count]` dans la liste `data`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct RewardInfo {
    /// `id` — hash de la table de récompense.
    pub id: HashId,
    /// `spiritData` — `[offset, count]` indexant la liste `data`.
    pub spirit_data: [i64; 2],
}

impl RewardInfo {
    /// Parse une entrée. `None` si `id` nul ou `spiritData` absent.
    #[must_use]
    pub fn from_value(v: &Value) -> Option<Self> {
        let id = field_hash(v, "id");
        let spirit_data = field_pair(v, "spiritData")?;
        if id.is_zero() {
            return None;
        }
        Some(Self { id, spirit_data })
    }
}

/// Contenu d'un `soccer_fixed_reward_spirit_config_*.cfg.bin`.
#[derive(Debug, Clone, Default, PartialEq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SoccerFixedRewardConfig {
    /// `m_soccerFixedRewardSpiritDataList` — esprits récompensés (indexés par `fixed_infos`).
    pub fixed_data: Vec<RewardSpirit>,
    /// `m_soccerFixedRewardSpiritInfoList` — tables de récompense fixe.
    pub fixed_infos: Vec<RewardInfo>,
    /// `m_victoryBoxEmmitSpiritDataList` — esprits des coffres de victoire (indexés par `box_infos`).
    pub box_data: Vec<RewardSpirit>,
    /// `m_victoryBoxEmmitSpiritInfoList` — tables des coffres de victoire.
    pub box_infos: Vec<RewardInfo>,
}

impl SoccerFixedRewardConfig {
    /// Résout les esprits d'une table de récompense fixe.
    #[must_use]
    pub fn spirits_of_fixed(&self, info: &RewardInfo) -> &[RewardSpirit] {
        slice(&self.fixed_data, info.spirit_data)
    }
}

fn slice<T>(list: &[T], range: [i64; 2]) -> &[T] {
    let n = list.len();
    let start = (range[0].max(0) as usize).min(n);
    let end = start.saturating_add(range[1].max(0) as usize).min(n);
    list.get(start..end).unwrap_or(&[])
}

fn data_list(root: &Value, name: &str) -> Vec<RewardSpirit> {
    let mut out = Vec::new();
    if let Some(values) = list_values(root, name) {
        for v in values {
            out.push(RewardSpirit::from_value(v));
        }
    }
    out
}

fn info_list(root: &Value, name: &str) -> Vec<RewardInfo> {
    let mut out = Vec::new();
    if let Some(values) = list_values(root, name) {
        for v in values {
            if let Some(i) = RewardInfo::from_value(v) {
                out.push(i);
            }
        }
    }
    out
}

/// Parse un `soccer_fixed_reward_spirit_config_*.cfg.bin.json`.
#[must_use]
pub fn parse_soccer_fixed_reward_config(root: &Value) -> SoccerFixedRewardConfig {
    SoccerFixedRewardConfig {
        fixed_data: data_list(root, "m_soccerFixedRewardSpiritDataList"),
        fixed_infos: info_list(root, "m_soccerFixedRewardSpiritInfoList"),
        box_data: data_list(root, "m_victoryBoxEmmitSpiritDataList"),
        box_infos: info_list(root, "m_victoryBoxEmmitSpiritInfoList"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_et_resolution() {
        let root = json!({
            "lists": [
                { "name": "m_soccerFixedRewardSpiritDataList", "values": [
                    { "charaId": "0x99A1C150", "rarity": 3, "num": 3, "desableFlagId": "0x00000000" },
                    { "charaId": "0x12345678", "rarity": 5, "num": 1, "desableFlagId": "0x00000000" }
                ]},
                { "name": "m_soccerFixedRewardSpiritInfoList", "values": [
                    { "id": "0x6184489B", "spiritData": [0, 2] }
                ]}
            ]
        });
        let cfg = parse_soccer_fixed_reward_config(&root);
        assert_eq!(cfg.fixed_data.len(), 2);
        assert_eq!(cfg.fixed_infos.len(), 1);
        assert_eq!(cfg.fixed_data[0].chara_id, HashId(0x99A1_C150));
        assert_eq!(cfg.fixed_data[0].rarity, 3);
        let info = &cfg.fixed_infos[0];
        assert_eq!(info.id, HashId(0x6184_489B));
        let spirits = cfg.spirits_of_fixed(info);
        assert_eq!(spirits.len(), 2);
        assert_eq!(spirits[1].rarity, 5);
    }
}
