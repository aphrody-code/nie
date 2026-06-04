//! Tests golden `aura` — noeud réel `AURA_CMD_INFO_0` tiré de :
//! `/home/ubuntu/data/common/gamedata/skill/aura_skill_config_1.04.09.00.cfg.bin.json`.
//!
//! Valeurs (19 vars) : `[2037965306, "wks00020", 493403631, -1653680409, 30, 60, 260858381,
//! -1368456794, 3, 8, 0, 1, -1124324279, 0, 0, 0, 1, 0, 0]`.
//! → auraId=0x7978E1FA, assetCode=wks00020, skillId1(var6)=0x0F8C620D, element(var8)=3.
//!
//! Résolution hissatsu : dans CE dump, skillId1 ne résout vers aucun skill_config v4/v5
//! → `None` (pas d'invention). On teste aussi la résolution POSITIVE avec une carte construite.

use nie_data::aura::{
    build_skill_map, determine_sub_type, parse_all_aura_cmds, resolve_aura_hissatsu, AuraCmd,
    AuraSubType,
};
use nie_data::hash::HashId;
use nie_data::skill::{SkillCategory, SkillElement, SkillInfo};
use serde_json::json;

fn aura_node_fixture() -> serde_json::Value {
    let raw: [(&str, &str); 19] = [
        ("Int", "2037965306"),
        ("String", "wks00020"),
        ("Int", "493403631"),
        ("Int", "-1653680409"),
        ("Int", "30"),
        ("Int", "60"),
        ("Int", "260858381"),
        ("Int", "-1368456794"),
        ("Int", "3"),
        ("Int", "8"),
        ("Int", "0"),
        ("Int", "1"),
        ("Int", "-1124324279"),
        ("Int", "0"),
        ("Int", "0"),
        ("Int", "0"),
        ("Int", "1"),
        ("Int", "0"),
        ("Int", "0"),
    ];
    let variables: Vec<_> = raw
        .iter()
        .map(|(t, v)| json!({ "type": t, "value": v }))
        .collect();
    json!({
        "entries": [{
            "name": "AURA_CMD_INFO_0",
            "variables": variables,
            "children": []
        }]
    })
}

#[test]
fn aura_cmd_info_0_champs() {
    let auras = parse_all_aura_cmds(&aura_node_fixture());
    assert_eq!(auras.len(), 1);
    let a: &AuraCmd = &auras[0];

    assert_eq!(a.aura_id, HashId::from_signed(2037965306));
    assert_eq!(a.aura_id.to_hex(), "0x7978E1FA");
    assert_eq!(a.asset_code, "wks00020");
    assert_eq!(a.name_id, HashId::from_signed(493403631));
    assert_eq!(a.desc_id, HashId::from_signed(-1653680409));
    assert_eq!(a.element, 3); // var8 ∈ [0,4]
    assert_eq!(a.element(), SkillElement::Fire);

    // Sous-type : préfixe wks (pas de "totem"/"soul" dans le nom) → Keshin.
    assert_eq!(a.sub_type, AuraSubType::Keshin);
    assert_eq!(a.sub_type.label_fr(), "Esprit Guerrier");

    // Sous-config.
    assert_eq!(a.config.val4, Some(30));
    assert_eq!(a.config.val5, Some(60));
    assert_eq!(a.config.skill_id1, Some(HashId::from_signed(260858381)));
    assert_eq!(a.config.skill_id1.unwrap().to_hex(), "0x0F8C620D");
    assert_eq!(a.config.skill_id2, Some(HashId::from_signed(-1368456794)));
    assert_eq!(a.config.val9, Some(8));
    assert_eq!(a.config.val11, Some(1));
    assert_eq!(a.config.buff_id, Some(HashId::from_signed(-1124324279)));
    assert_eq!(a.config.rank, Some(1)); // var16
}

#[test]
fn hissatsu_non_resolu_sans_skill_pas_d_invention() {
    let auras = parse_all_aura_cmds(&aura_node_fixture());
    let a = &auras[0];
    // Carte de skills VIDE : skillId1 (0x0F8C620D) introuvable → None (comme le dump réel
    // où aura_skill_config 1.04.09 ne mappe vers aucun skill_config 4/5).
    let empty = build_skill_map(Vec::new());
    assert!(resolve_aura_hissatsu(&a.config, &empty).is_none());
}

#[test]
fn hissatsu_resolu_chaine_skillid1_vers_skill_config() {
    // Résolution POSITIVE : on construit un SkillInfo dont le skillID == skillId1 de l'aura,
    // pour prouver la chaîne config.skillId1 → SkillInfo (name/type/element/power).
    // On réutilise le skill réel whs00010 (Tir/Vent/70-440) mais réindexé sur 0x0F8C620D.
    let skill_value = json!({
        "skillID": "0x0F8C620D",
        "skillIDStr": "whs00010",
        "eventID": "0x00000000", "eventIDName": "",
        "failEventID": "0x00000000", "failEventIDName": "",
        "skillNameId": "0x07ADF4B1", "skillDescId": "0x87AB9FB9",
        "cmdOptIdx": 2, "skillEffectBitFlag": 16,
        "power_min": 70, "power_max": 440,
        "element": 1, "colorIdx": 1, "category": 1, "growthType": 4,
        "foulRate": 0, "consumeTp": 70, "focusBattleEffectId": "0x00000000",
        "recastTime": 90, "partnerType": 2,
        "partner1": "0x00000000", "partner2": "0x00000000", "partner3": "0x00000000",
        "telopInfoId": "0x00000000", "eldorado": false,
        "seriesIdCrc": "0x00000000", "isDisablePlayableUntilNextPatch": false
    });
    let skill = SkillInfo::from_value(&skill_value).unwrap();
    let map = build_skill_map(alloc_vec(skill));

    let auras = parse_all_aura_cmds(&aura_node_fixture());
    let h = resolve_aura_hissatsu(&auras[0].config, &map).expect("skillId1 doit résoudre");

    assert_eq!(h.skill_id, HashId(0x0F8C_620D));
    assert_eq!(h.skill_id_str.as_deref(), Some("whs00010"));
    assert_eq!(h.category, SkillCategory::Shoot);
    assert_eq!(h.element, SkillElement::Wind);
    assert_eq!(h.power, (70, 440));
}

#[test]
fn determine_sub_type_prefixes() {
    assert_eq!(determine_sub_type("wks00020", None), AuraSubType::Keshin);
    assert_eq!(determine_sub_type("wks00240", Some("Totem de feu")), AuraSubType::Soul);
    assert_eq!(determine_sub_type("awakening_001", None), AuraSubType::Awakening);
    assert_eq!(determine_sub_type("mode_change_x", None), AuraSubType::ModeChange);
    assert_eq!(determine_sub_type("wmm00210", None), AuraSubType::Miximax);
    assert_eq!(determine_sub_type("wko00010", None), AuraSubType::Keshin);
    assert_eq!(determine_sub_type("was00010", None), AuraSubType::Keshin);
    assert_eq!(determine_sub_type("xyz00010", None), AuraSubType::Aura);
}

/// Helper de test : Vec à un élément.
fn alloc_vec(s: SkillInfo) -> Vec<SkillInfo> {
    vec![s]
}
