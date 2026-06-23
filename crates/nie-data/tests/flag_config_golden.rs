#![allow(clippy::pedantic)]
//! Tests golden `flag_config` — registre des types de flags de progression, sur le vrai dump
//! (skip silencieux si absent — fragment copyright Level-5 non committé) :
//!
//! - `data/common/gamedata/system/flag_config_1.03.92.00.cfg.bin.json`
//!
//! Port direct depuis la structure du dump ; valeurs assérées copiées octet pour octet.

use nie_data::flag_config::parse_flag_config;

const PATH: &str = "/home/ubuntu/niers/data/common/gamedata/system/flag_config_1.03.92.00.cfg.bin.json";

fn load() -> Option<serde_json::Value> {
    if !std::path::Path::new(PATH).exists() {
        return None;
    }
    let content = std::fs::read_to_string(PATH).unwrap_or_else(|e| panic!("lecture {PATH}: {e}"));
    Some(serde_json::from_str(&content).unwrap_or_else(|e| panic!("JSON {PATH}: {e}")))
}

#[test]
fn categories_byte_exact() {
    let Some(root) = load() else { return };
    let cfg = parse_flag_config(&root);
    assert_eq!(cfg.flag_info, [0, 1, 2, 17, 19, 22, 5, 6, 7, 8, 16, 20, 21, 12, 11]);
    assert_eq!(cfg.tbox_info, [3]);
    assert_eq!(cfg.tbox_repop_info, [13]);
    assert_eq!(cfg.map_door_info, [4]);
}

#[cfg(feature = "serde")]
#[test]
fn dispatch_typed_atteint_azalee() {
    use nie_data::typed::{decode_by_key, family_key};
    let Some(root) = load() else { return };
    assert_eq!(family_key("flag_config_1.03.92.00.cfg.bin"), "flag_config");
    let (label, json) = decode_by_key("flag_config", &root).expect("famille typée câblée");
    assert_eq!(label, "flag_config");
    assert_eq!(json["flag_info"].as_array().map(Vec::len), Some(15));
}
