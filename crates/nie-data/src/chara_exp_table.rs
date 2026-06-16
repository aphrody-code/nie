//! `CharaExpTableConfig` — port Rust de `chara_exp_table_config_*.cfg.bin` (Level-5 IEVR) :
//! la **table d'expérience des personnages** (EXP requise par niveau) + les **taux d'EXP par
//! rareté**.
//!
//! ## Vérité terrain
//!
//! - Parser TS de référence : `packages/inagle/src/parsers/chara-exp-table.ts`.
//! - Dump réel (VFS Steam) :
//!   `data/common/gamedata/character/chara_exp_table_config_0.00.00.00.cfg.bin`
//!   (RDBN, 2 listes).
//!
//! ## Structure (2 listes RDBN)
//!
//! | Liste                 | Type RDBN          | Lignes | Champs            | Sémantique                       |
//! |-----------------------|--------------------|--------|-------------------|-----------------------------------|
//! | `m_charaExpTableList` | `CHARA_EXP_TABLE`  | 100    | `level`, `needExp`| EXP cumulée requise pour `level` |
//! | `m_expRarityRateList` | `EXP_RARITY_RATE`  | 9      | `rarity`, `rate`  | Multiplicateur d'EXP par rareté  |

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::{field_i64, list_values};

/// Entrée `CHARA_EXP_TABLE` — EXP requise pour atteindre un niveau donné.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaExpTableEntry {
    /// `level` — niveau du personnage (1..=100).
    pub level: i64,
    /// `needExp` — EXP requise pour ce niveau.
    pub need_exp: i64,
}

impl CharaExpTableEntry {
    /// Parse une valeur `CHARA_EXP_TABLE`.
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            level: field_i64(v, "level").unwrap_or(0),
            need_exp: field_i64(v, "needExp").unwrap_or(0),
        }
    }
}

/// Entrée `EXP_RARITY_RATE` — multiplicateur d'EXP appliqué selon la rareté.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ExpRarityRate {
    /// `rarity` — index de rareté.
    pub rarity: i64,
    /// `rate` — taux/multiplicateur d'EXP pour cette rareté.
    pub rate: i64,
}

impl ExpRarityRate {
    /// Parse une valeur `EXP_RARITY_RATE`.
    #[must_use]
    pub fn from_value(v: &Value) -> Self {
        Self {
            rarity: field_i64(v, "rarity").unwrap_or(0),
            rate: field_i64(v, "rate").unwrap_or(0),
        }
    }
}

/// Config complète `chara_exp_table` : table d'EXP par niveau + taux par rareté.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct CharaExpTableConfig {
    /// `m_charaExpTableList` — EXP requise par niveau (triée par `level`).
    pub exp_table: Vec<CharaExpTableEntry>,
    /// `m_expRarityRateList` — multiplicateurs d'EXP par rareté.
    pub rarity_rates: Vec<ExpRarityRate>,
}

/// Parse un `chara_exp_table_config` (forme iecode `lists`) en ses 2 listes.
#[must_use]
pub fn parse_chara_exp_table_config(root: &Value) -> CharaExpTableConfig {
    let exp_table = list_values(root, "m_charaExpTableList")
        .map(|vs| vs.iter().map(CharaExpTableEntry::from_value).collect())
        .unwrap_or_default();
    let rarity_rates = list_values(root, "m_expRarityRateList")
        .map(|vs| vs.iter().map(ExpRarityRate::from_value).collect())
        .unwrap_or_default();
    CharaExpTableConfig { exp_table, rarity_rates }
}

impl CharaExpTableConfig {
    /// EXP requise pour un `level` donné, ou `None` si absent de la table.
    #[must_use]
    pub fn need_exp(&self, level: i64) -> Option<i64> {
        self.exp_table.iter().find(|e| e.level == level).map(|e| e.need_exp)
    }

    /// Taux d'EXP pour une `rarity` donnée, ou `None` si absente.
    #[must_use]
    pub fn rate_for_rarity(&self, rarity: i64) -> Option<i64> {
        self.rarity_rates.iter().find(|r| r.rarity == rarity).map(|r| r.rate)
    }
}
