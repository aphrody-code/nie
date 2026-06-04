//! Tests golden `chara_param` — noeud réel `CHARA_PARAM_INFO_1` tiré de :
//! `/home/ubuntu/data/common/gamedata/character/chara_param_1.03.66.00.cfg.bin.json`.
//!
//! Extraction des techniques **LEVEL-FIRST @10**, port 1:1 d'inagle
//! `packages/inagle/src/parsers/chara-param.ts` (l.102-118) : `(niveau@10, hash@11)…`,
//! validée niveau ∈ [0,99], slots invalides sautés. Vérité terrain = la sortie d'inagle.

use nie_data::chara_param::{
    element_id_to_names, parse_all_chara_params, position_id_to_code, CharaParam,
};
use nie_data::hash::HashId;
use serde_json::json;

/// Les 43 valeurs Int exactes de CHARA_PARAM_INFO_1 (dump réel).
const RAW: &[i64] = &[
    -357386801, 1128709053, 4, 2, 4, 1, 11, 1, 0, 3, 0, 604761586, 1, 598373713, 13, 1591574804,
    20, 724843777, 30, 1988803013, 38, -1508771477, 43, 724843777, 30, -1325922806, 38, 1210030151,
    43, 2, 0, -1, 2, 1, -2, -2, 1, 0, 0, 0, 743008281, 0, 200626314,
];

fn node_fixture() -> serde_json::Value {
    let variables: Vec<_> = RAW
        .iter()
        .map(|v| json!({ "type": "Int", "value": v.to_string() }))
        .collect();
    json!({
        "entries": [{
            "name": "CHARA_PARAM_INFO_1",
            "variables": variables,
            "children": []
        }]
    })
}

#[test]
fn chara_param_info_1_champs_de_base() {
    let parsed = parse_all_chara_params(&node_fixture());
    assert_eq!(parsed.len(), 1);
    let p: &CharaParam = &parsed[0];

    // var0/var1 (hash, signé→non-signé).
    assert_eq!(p.chara_param_id, HashId::from_signed(-357386801));
    assert_eq!(p.chara_param_id, HashId(0xEAB2_B5CF));
    assert_eq!(p.chara_base_id, HashId::from_signed(1128709053));

    // var2 = element = 4 (Montagne), var3 = mainPosition = 2 (FW).
    assert_eq!(p.element, 4);
    assert_eq!(p.main_position, 2);
    assert_eq!(p.sub_position, 4);
    assert_eq!(p.growth_pattern, 0); // var8

    assert_eq!(element_id_to_names(p.element), Some(("Montagne", "Mountain", "山")));
    assert_eq!(position_id_to_code(p.main_position), Some("FW"));
}

#[test]
fn chara_param_info_1_techniques_level_first_at_10() {
    let parsed = parse_all_chara_params(&node_fixture());
    let p = &parsed[0];

    // 9 slots LEVEL-FIRST @10 : (niveau@10, hash@11)… Sortie identique à inagle
    // (`chara-param.ts` l.102-118). Hashes aux index impairs 11..27 ; niveaux aux pairs 10..26.
    let expected: [(HashId, u8); 9] = [
        (HashId::from_signed(604761586), 0),     // 0x240BEDF2  niveau@10=0
        (HashId::from_signed(598373713), 1),     // 0x23AA7551  niveau@12=1
        (HashId::from_signed(1591574804), 13),   // 0x5EDD8114  niveau@14=13
        (HashId::from_signed(724843777), 20),    // 0x2B343D01  niveau@16=20
        (HashId::from_signed(1988803013), 30),   // 0x768AB9C5  niveau@18=30
        (HashId::from_signed(-1508771477), 38),  // 0xA611F96B  niveau@20=38
        (HashId::from_signed(724843777), 43),    // 0x2B343D01  niveau@22=43 (doublon réel)
        (HashId::from_signed(-1325922806), 30),  // 0xB0F8060A  niveau@24=30
        (HashId::from_signed(1210030151), 38),   // 0x481F9847  niveau@26=38
    ];
    assert_eq!(p.skills.len(), 9, "exactement 9 slots techniques");
    for (i, (hash, lvl)) in expected.iter().enumerate() {
        assert_eq!(p.skills[i].skill_id, *hash, "slot {i} hash");
        assert_eq!(p.skills[i].learn_level, *lvl, "slot {i} niveau");
    }
    assert_eq!(p.skills[0].skill_id.to_hex(), "0x240BEDF2");
    assert_eq!(p.skills[2].skill_id.to_hex(), "0x5EDD8114");
}

#[test]
fn niveau_first_slot_est_zero_comme_inagle() {
    // Garde anti-régression : LEVEL-first @10 → le slot 0 a le niveau@10 = 0 (et NON
    // le niveau@12 = 1 qu'aurait donné une lecture hash-first @11 décalée). Conforme inagle.
    let parsed = parse_all_chara_params(&node_fixture());
    let p = &parsed[0];
    assert_eq!(p.skills[0].learn_level, 0, "level-first @10 → niveau du slot 0 = 0");
}
