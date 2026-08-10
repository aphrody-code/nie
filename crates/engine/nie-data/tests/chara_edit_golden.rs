#![allow(clippy::pedantic)]
//! Tests golden `chara_edit` (éditeur d'avatar) — valeurs réelles tirées de :
//! `data/common/gamedata/character/chara_edit_parts_type_config_1.03.75.00.cfg.bin.json`.
//!
//! Format `lists` (champs nommés). 4 listes : 42 parts de visage, 6 types de visage,
//! 24 parts de corps, 1 type de parts de corps.

extern crate std;

use nie_data::chara_edit::{parse_chara_edit_parts_type_config, BODY_TYPES};
use nie_data::hash::HashId;
use serde_json::json;

const REAL: &str =
    "/home/ubuntu/niers/data/common/gamedata/character/chara_edit_parts_type_config_1.03.75.00.cfg.bin.json";

fn load_json(path: &str) -> Option<serde_json::Value> {
    if !std::path::Path::new(path).exists() {
        return None;
    }
    let content =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("Impossible de lire {path}: {e}"));
    Some(serde_json::from_str(&content).unwrap_or_else(|e| panic!("JSON invalide {path}: {e}")))
}

fn fixture() -> serde_json::Value {
    json!({
        "version": "1.03.75.00",
        "lists": [
            { "name": "m_CharaEditFaceTypeDataList", "typeName": "x", "values": [
                { "noseType": "nose_type_01", "noseTypeCrc": "0xD64E1016",
                  "facePatternID_male": "0x84A3AD8D", "facePatternID_female": "0x84A3AD8D",
                  "facePatternID_small": "0xC686AAF0", "facePatternID_smallfat": "0xC686AAF0",
                  "facePatternID_tall": "0x00E9A377", "facePatternID_tallmuscle": "0x00E9A377",
                  "facePatternID_muscle": "0x8E66A494", "facePatternID_big": "0x8E66A494",
                  "resource_male": "face51_nose01", "resource_female": "face51_nose01",
                  "resource_small": "face53_nose01", "resource_smallfat": "face53_nose01",
                  "resource_tall": "face55_nose01", "resource_tallmuscle": "face55_nose01",
                  "resource_muscle": "face56_nose01", "resource_big": "face56_nose01" }
            ]},
            { "name": "m_CharaEditFaceTypeInfoList", "typeName": "x", "values": [
                { "faceType": "face_mdl_type_01", "faceTypeCrc": "0x8D64CB9B", "faceTypeData": [0, 7] }
            ]},
            { "name": "m_CharaEditPartsBodyTypeDataList", "typeName": "x", "values": [
                { "presetID": "0x6A03969D", "resource_male": "accessory001", "resource_female": "accessory001",
                  "resource_small": "accessory001", "resource_smallfat": "accessory001",
                  "resource_tall": "accessory001", "resource_tallmuscle": "accessory001",
                  "resource_muscle": "accessory001_07", "resource_big": "accessory001_07" }
            ]},
            { "name": "m_CharaEditPartsBodyTypeInfoList", "typeName": "x", "values": [
                { "partsType": 14, "partsTypeData": [0, 24] }
            ]}
        ]
    })
}

#[test]
fn fixture_parts_avatar() {
    let c = parse_chara_edit_parts_type_config(&fixture());
    assert_eq!(BODY_TYPES.len(), 8);
    // Visage.
    assert_eq!(c.face_data.len(), 1);
    let f = &c.face_data[0];
    assert_eq!(f.nose_type, "nose_type_01");
    assert_eq!(f.nose_type_crc, HashId::parse("0xD64E1016").unwrap());
    assert_eq!(f.resource[0], "face51_nose01"); // male
    assert_eq!(f.resource[7], "face56_nose01"); // big
    assert_eq!(f.face_pattern_id[0], HashId::parse("0x84A3AD8D").unwrap());
    // Type de visage + plage.
    assert_eq!(c.face_info.len(), 1);
    assert_eq!(c.face_info[0].face_type, "face_mdl_type_01");
    assert_eq!((c.face_info[0].data_offset, c.face_info[0].data_count), (0, 7));
    // Corps.
    assert_eq!(c.body_data.len(), 1);
    assert_eq!(c.body_data[0].resource[7], "accessory001_07"); // big diffère du male
    assert_eq!(c.body_info.len(), 1);
    assert_eq!(c.body_info[0].parts_type, 14);
    assert_eq!((c.body_info[0].data_offset, c.body_info[0].data_count), (0, 24));
}

#[test]
fn golden_dump_reel() {
    let Some(root) = load_json(REAL) else {
        eprintln!("dump chara_edit absent — test data-gated ignoré");
        return;
    };
    let c = parse_chara_edit_parts_type_config(&root);
    assert_eq!(c.face_data.len(), 42, "42 parts de visage");
    assert_eq!(c.face_info.len(), 6, "6 types de visage");
    assert_eq!(c.body_data.len(), 24, "24 parts de corps");
    assert_eq!(c.body_info.len(), 1, "1 type de parts de corps");
    // Entrée 0 = nose_type_01.
    assert_eq!(c.face_data[0].nose_type, "nose_type_01");
    assert_eq!(c.face_data[0].resource[0], "face51_nose01");
    // Les plages des Info indexent la data list (offset+count ≤ taille).
    for fi in &c.face_info {
        assert!((fi.data_offset + fi.data_count) as usize <= c.face_data.len(), "plage face hors data");
    }
    assert!((c.body_info[0].data_offset + c.body_info[0].data_count) as usize <= c.body_data.len());
}
