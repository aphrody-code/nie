#![allow(clippy::pedantic)]
//! Tests golden `chara_exp_table` — nœud réel extrait du VFS IEVR :
//! `data/common/gamedata/character/chara_exp_table_config_0.00.00.00.cfg.bin`
//! (RDBN `lists` : `m_charaExpTableList`/`CHARA_EXP_TABLE` **100 entrées**,
//! `m_expRarityRateList`/`EXP_RARITY_RATE` **9 entrées**).
//!
//! Port 1:1 d'inagle `packages/inagle/src/parsers/chara-exp-table.ts`. Valeurs extraites telles
//! quelles du dump (via `nie-game --example probe_rdbn chara_exp_table_config`), aucune inventée.

use nie_data::chara_exp_table::parse_chara_exp_table_config;
use serde_json::{json, Value};

fn fixture() -> Value {
    json!({
        "version": 100,
        "lists": [
            {
                "name": "m_charaExpTableList",
                "typeName": "CHARA_EXP_TABLE",
                "values": [
                    // index 0..1 réels du dump.
                    { "level": 1, "needExp": 124 },
                    { "level": 2, "needExp": 130 }
                ]
            },
            {
                "name": "m_expRarityRateList",
                "typeName": "EXP_RARITY_RATE",
                "values": [
                    { "rarity": 0, "rate": 1 },
                    { "rarity": 1, "rate": 1 }
                ]
            }
        ]
    })
}

#[test]
fn parses_real_chara_exp_table() {
    let cfg = parse_chara_exp_table_config(&fixture());
    assert_eq!(cfg.exp_table.len(), 2);
    assert_eq!(cfg.rarity_rates.len(), 2);

    // Table d'EXP : niveau 1 → 124, niveau 2 → 130 (valeurs réelles du dump).
    assert_eq!(cfg.exp_table[0].level, 1);
    assert_eq!(cfg.exp_table[0].need_exp, 124);
    assert_eq!(cfg.exp_table[1].level, 2);
    assert_eq!(cfg.exp_table[1].need_exp, 130);

    // Taux par rareté.
    assert_eq!(cfg.rarity_rates[0].rarity, 0);
    assert_eq!(cfg.rarity_rates[0].rate, 1);

    // Accesseurs.
    assert_eq!(cfg.need_exp(1), Some(124));
    assert_eq!(cfg.need_exp(2), Some(130));
    assert_eq!(cfg.need_exp(999), None);
    assert_eq!(cfg.rate_for_rarity(1), Some(1));
    assert_eq!(cfg.rate_for_rarity(42), None);
}
