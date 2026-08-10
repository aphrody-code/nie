//! Table d'XP par niveau + multiplicateur de rareté (progression de niveau).
//!
//! Brique manquante pour passer de « stats à un niveau » à « progression
//! jouable » : gagner de l'XP → monter de niveau → recalcul des stats
//! (via [`crate::growth`]).
//!
//! # Source de vérité
//!
//! - Logique : `packages/inagle/src/parsers/chara-exp-table.ts`
//!   (`parseContent` L53-70, `getCumulativeExp` L109-116, `getRarityRate` L108).
//! - Données réelles : `common/gamedata/character/chara_exp_table_config_0.00.00.00.cfg.bin.json`
//!   — vérifié : `m_charaExpTableList`=100 entrées (niveaux 1..100),
//!   `m_expRarityRateList`=9 entrées.
//!   `needExp` lv1=124, lv2=130, lv3=146, lv99=120541, lv100=124072.
//!   `rate` : raretés 0-3 → 1, raretés 4-8 → 3.

/// Table d'XP : besoin par niveau + multiplicateur par rang de rareté.
#[derive(Debug, Clone, Default)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct ExpTable {
    /// XP nécessaire indexée par niveau : `need_exp[0]` = besoin du niveau 1.
    ///
    /// Source : `m_charaExpTableList` (100 entrées, niveaux 1..100).
    pub need_exp: Vec<u32>,
    /// Multiplicateur d'XP par rang de rareté : `rarity_rate[rank]`.
    ///
    /// Source : `m_expRarityRateList` (9 entrées, index = `growthRank` 0-8).
    pub rarity_rate: Vec<u8>,
}

impl ExpTable {
    /// XP nécessaire pour le niveau `level` (1-indexé).
    ///
    /// Retourne `None` si le niveau est hors de la table.
    ///
    /// Source : `getExpForLevel` (chara-exp-table.ts L107).
    #[must_use]
    pub fn exp_for_level(&self, level: u32) -> Option<u32> {
        if level == 0 {
            return None;
        }
        self.need_exp.get((level - 1) as usize).copied()
    }

    /// XP cumulée pour ATTEINDRE `target_level` depuis le niveau 1.
    ///
    /// Reproduit EXACTEMENT `getCumulativeExp` (chara-exp-table.ts L109-116) :
    /// somme des `needExp` de tous les niveaux strictement inférieurs à la cible.
    /// Donc `cumulative_exp(1) == 0`.
    ///
    /// Source : la boucle TS `if (entry.level >= targetLevel) break; total += …`.
    #[must_use]
    pub fn cumulative_exp(&self, target_level: u32) -> u32 {
        if target_level <= 1 {
            return 0;
        }
        // Niveaux 1..target_level-1 (indices 0..target_level-1 dans need_exp).
        let upper = ((target_level - 1) as usize).min(self.need_exp.len());
        self.need_exp[..upper].iter().sum()
    }

    /// Multiplicateur d'XP pour un `growth_rank` (0-8).
    ///
    /// Raretés 0-3 → ×1, raretés 4-8 → ×3. Retourne 1 si le rang est hors table
    /// (parité avec `getRarityRate` : `?? 1`).
    ///
    /// Source : `getRarityRate` (chara-exp-table.ts L108).
    #[must_use]
    pub fn rarity_rate(&self, growth_rank: u8) -> u8 {
        self.rarity_rate
            .get(growth_rank as usize)
            .copied()
            .unwrap_or(1)
    }
}

#[cfg(feature = "data")]
mod loader {
    //! Chargement de la vraie table d'XP embarquée (`data/exp_table.json`).

    use super::ExpTable;

    /// JSON projeté de la table d'XP, embarqué à la compilation.
    const EXP_JSON: &str = include_str!("../data/exp_table.json");

    #[derive(serde::Deserialize)]
    struct RawExp {
        need_exp: Vec<u32>,
        rarity_rate: Vec<[u8; 2]>,
    }

    impl ExpTable {
        /// Charge la vraie table d'XP IEVR embarquée.
        ///
        /// # Panics
        ///
        /// Panique si le JSON embarqué est corrompu (figé à la compilation).
        #[must_use]
        pub fn load_embedded() -> Self {
            let raw: RawExp =
                serde_json::from_str(EXP_JSON).expect("exp_table.json embarqué valide");

            // rarity_rate est stocké [rarity, rate] trié par rarity (0..8) :
            // on l'indexe directement par rarity.
            let max_rarity = raw
                .rarity_rate
                .iter()
                .map(|r| r[0] as usize)
                .max()
                .unwrap_or(0);
            let mut rate = vec![1u8; max_rarity + 1];
            for r in &raw.rarity_rate {
                rate[r[0] as usize] = r[1];
            }

            Self {
                need_exp: raw.need_exp,
                rarity_rate: rate,
            }
        }
    }
}

#[cfg(all(test, feature = "data"))]
mod tests {
    use super::*;

    #[test]
    fn embedded_counts_match_real_data() {
        let t = ExpTable::load_embedded();
        assert_eq!(t.need_exp.len(), 100, "m_charaExpTableList = 100");
        // m_expRarityRateList couvre les raretés 0..8 → 9 entrées.
        assert_eq!(t.rarity_rate.len(), 9, "rarity 0..8 = 9 entrées");
    }

    /// Golden : `needExp` par niveau (vérifié au bit près sur le cfg.bin.json).
    #[test]
    fn golden_exp_for_level() {
        let t = ExpTable::load_embedded();
        assert_eq!(t.exp_for_level(1), Some(124));
        assert_eq!(t.exp_for_level(2), Some(130));
        assert_eq!(t.exp_for_level(3), Some(146));
        assert_eq!(t.exp_for_level(99), Some(120541));
        assert_eq!(t.exp_for_level(100), Some(124072));
        assert_eq!(t.exp_for_level(101), None);
        assert_eq!(t.exp_for_level(0), None);
    }

    /// Golden : XP cumulée (sommes vérifiées via inagle).
    #[test]
    fn golden_cumulative_exp() {
        let t = ExpTable::load_embedded();
        // Atteindre le lv1 = 0 XP.
        assert_eq!(t.cumulative_exp(1), 0);
        assert_eq!(t.cumulative_exp(0), 0);
        // Atteindre lv2 = besoin du lv1 = 124.
        assert_eq!(t.cumulative_exp(2), 124);
        // Atteindre lv3 = 124 + 130 = 254.
        assert_eq!(t.cumulative_exp(3), 254);
        // Atteindre lv5 = somme lv1..4 = 565 (vérifié inagle).
        assert_eq!(t.cumulative_exp(5), 565);
        // Atteindre lv10 = somme lv1..9 = 1973 (vérifié inagle).
        assert_eq!(t.cumulative_exp(10), 1973);
    }

    /// Golden : multiplicateur par rang de rareté.
    #[test]
    fn golden_rarity_rate() {
        let t = ExpTable::load_embedded();
        // Raretés 0-3 → ×1.
        for rank in 0u8..=3 {
            assert_eq!(t.rarity_rate(rank), 1, "rareté {rank} → ×1");
        }
        // Raretés 4-8 → ×3.
        for rank in 4u8..=8 {
            assert_eq!(t.rarity_rate(rank), 3, "rareté {rank} → ×3");
        }
        // Hors table → 1 (parité `?? 1`).
        assert_eq!(t.rarity_rate(99), 1);
    }
}
