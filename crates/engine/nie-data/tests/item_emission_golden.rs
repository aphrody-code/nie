#![allow(clippy::pedantic)]
//! Tests golden `item_emission` — noeud réel des deux listes jointes tiré de :
//! `data/common/gamedata/item/item_emission_rarity_table_config_0.00.00.cfg.bin`
//! (RDBN `lists`, 746 octets, le plus petit cfg.bin du jeu ; extrait du VFS via
//! `cfgbin_to_iecode_root`, identique au dump iecode/inagle).
//!
//! Port 1:1 d'inagle `packages/inagle/src/parsers/drop-rates.ts` `loadItemEmissionRates`
//! (l.85-116) : jointure `m_itemEmissionRarityTableConfigList.tableInfo` `[offset, count]`
//! → `m_itemEmissionRarityTableConfigInfoList`. Une ligne = un couple (item, emitRarity)→poids.
//!
//! Vérité terrain : 4 items, 10 entrées info, toutes consommées (offsets 0..9) → 10 lignes.

use nie_data::hash::HashId;
use nie_data::item_emission::{
    parse_item_emission_info_list, parse_item_emission_rates, parse_item_emission_table_list,
};
use serde_json::json;

/// Noeud réel `item_emission_rarity_table_config_0.00.00.cfg.bin` (forme iecode `lists`).
/// Valeurs copiées octet pour octet du dump VFS.
fn node_fixture() -> serde_json::Value {
    json!({
        "lists": [
            {
                "name": "m_itemEmissionRarityTableConfigInfoList",
                "typeName": "ITEM_EMISSION_RARITY_TABLE_CONFING_IFNO",
                "values": [
                    { "emitRarity": 5, "tableId": "0xF0940E72", "weight": 1 },
                    { "emitRarity": 5, "tableId": "0xF0940E72", "weight": 1 },
                    { "emitRarity": 4, "tableId": "0x032D7F3A", "weight": 3 },
                    { "emitRarity": 3, "tableId": "0x9A242E80", "weight": 6 },
                    { "emitRarity": 4, "tableId": "0x032D7F3A", "weight": 1 },
                    { "emitRarity": 3, "tableId": "0x9A242E80", "weight": 3 },
                    { "emitRarity": 2, "tableId": "0xED231E16", "weight": 6 },
                    { "emitRarity": 3, "tableId": "0x9A242E80", "weight": 1 },
                    { "emitRarity": 2, "tableId": "0xED231E16", "weight": 3 },
                    { "emitRarity": 1, "tableId": "0x73478BB5", "weight": 6 }
                ]
            },
            {
                "name": "m_itemEmissionRarityTableConfigList",
                "typeName": "ITEM_EMISSION_RARITY_TABLE_CONFING",
                "values": [
                    { "itemId": "0x745A378E", "tableInfo": [0, 1] },
                    { "itemId": "0x035D0718", "tableInfo": [1, 3] },
                    { "itemId": "0x93E21A89", "tableInfo": [4, 3] },
                    { "itemId": "0xE4E52A1F", "tableInfo": [7, 3] }
                ]
            }
        ]
    })
}

#[test]
fn listes_brutes_comptes() {
    let fix = node_fixture();
    let info = parse_item_emission_info_list(&fix);
    let items = parse_item_emission_table_list(&fix);
    assert_eq!(info.len(), 10, "10 entrées info dans le dump réel");
    assert_eq!(items.len(), 4, "4 items dans le dump réel");

    // info[0] — première entrée (emitRarity 5, weight 1, table 0xF0940E72).
    assert_eq!(info[0].table_id, HashId(0xF094_0E72));
    assert_eq!(info[0].emit_rarity, 5);
    assert_eq!(info[0].weight, 1);
    // info[9] — dernière (emitRarity 1, weight 6, table 0x73478BB5).
    assert_eq!(info[9].table_id, HashId(0x7347_8BB5));
    assert_eq!(info[9].emit_rarity, 1);
    assert_eq!(info[9].weight, 6);

    // item[1] — itemId 0x035D0718, tableInfo [1, 3].
    assert_eq!(items[1].item_id, HashId(0x035D_0718));
    assert_eq!(items[1].table_info, [1, 3]);
    // item[3] — dernier, tableInfo [7, 3].
    assert_eq!(items[3].item_id, HashId(0xE4E5_2A1F));
    assert_eq!(items[3].table_info, [7, 3]);
}

#[test]
fn jointure_dix_lignes_exactes() {
    let rates = parse_item_emission_rates(&node_fixture());

    // 4 items × (1+3+3+3) entrées = 10 lignes ; les 10 entrées info consommées une fois.
    assert_eq!(rates.len(), 10, "10 lignes de taux jointes");

    // Vérité terrain golden : (item_id, table_id, emit_rarity, weight) par ordinal.
    let expected: [(u32, u32, i64, i64); 10] = [
        (0x745A_378E, 0xF094_0E72, 5, 1), // ord 0 — item[0] tableInfo[0,1] → info[0]
        (0x035D_0718, 0xF094_0E72, 5, 1), // ord 1 — item[1] tableInfo[1,3] → info[1]
        (0x035D_0718, 0x032D_7F3A, 4, 3), // ord 2 — info[2]
        (0x035D_0718, 0x9A24_2E80, 3, 6), // ord 3 — info[3]
        (0x93E2_1A89, 0x032D_7F3A, 4, 1), // ord 4 — item[2] tableInfo[4,3] → info[4]
        (0x93E2_1A89, 0x9A24_2E80, 3, 3), // ord 5 — info[5]
        (0x93E2_1A89, 0xED23_1E16, 2, 6), // ord 6 — info[6]
        (0xE4E5_2A1F, 0x9A24_2E80, 3, 1), // ord 7 — item[3] tableInfo[7,3] → info[7]
        (0xE4E5_2A1F, 0xED23_1E16, 2, 3), // ord 8 — info[8]
        (0xE4E5_2A1F, 0x7347_8BB5, 1, 6), // ord 9 — info[9]
    ];

    for (i, (item, table, rarity, weight)) in expected.iter().enumerate() {
        let r = &rates[i];
        assert_eq!(r.ordinal, i, "ordinal séquentiel ligne {i}");
        assert_eq!(r.item_id, HashId(*item), "item_id ligne {i}");
        assert_eq!(r.table_id, HashId(*table), "table_id ligne {i}");
        assert_eq!(r.emit_rarity, *rarity, "emit_rarity ligne {i}");
        assert_eq!(r.weight, *weight, "weight ligne {i}");
        assert_eq!(r.id(), alloc_id(i), "id stable ligne {i}");
    }
}

#[test]
fn raretes_couvrent_un_a_cinq() {
    // Les 10 lignes couvrent toutes les raretés d'émission 1..=5 (vérité terrain).
    let rates = parse_item_emission_rates(&node_fixture());
    let mut seen = [false; 6];
    for r in &rates {
        assert!((1..=5).contains(&r.emit_rarity), "emitRarity ∈ 1..=5");
        seen[r.emit_rarity as usize] = true;
    }
    for (rarity, present) in seen.iter().enumerate().skip(1) {
        assert!(present, "rareté {rarity} présente dans le dump réel");
    }
}

/// Reproduit le format d'identifiant inagle `item_emission:<ordinal>` côté test.
fn alloc_id(ordinal: usize) -> String {
    format!("item_emission:{ordinal}")
}
