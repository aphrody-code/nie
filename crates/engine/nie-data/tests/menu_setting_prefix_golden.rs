#![allow(clippy::pedantic)]
//! Golden : dispatch typé par SUFFIXE des ~304 écrans `*_menu_setting` (mode driver de menu),
//! sur un vrai écran non-`main` (skip silencieux si absent) :
//!
//! - `data/common/gamedata/menu/cfg/info_bookmark_menu_setting.cfg.bin.json`

use nie_data::hash::HashId;
use nie_data::menu_setting::parse;

const PATH: &str =
    "/home/ubuntu/niers/data/common/gamedata/menu/cfg/info_bookmark_menu_setting.cfg.bin.json";

fn load() -> Option<serde_json::Value> {
    if !std::path::Path::new(PATH).exists() {
        return None;
    }
    let c = std::fs::read_to_string(PATH).unwrap_or_else(|e| panic!("lecture {PATH}: {e}"));
    Some(serde_json::from_str(&c).unwrap_or_else(|e| panic!("JSON {PATH}: {e}")))
}

#[test]
fn ecran_non_main_parse_byte_exact() {
    let Some(root) = load() else { return };
    let m = parse(&root);
    assert_eq!(m.layers.len(), 16, "16 MENU_LAYER_INFO");
    assert_eq!(m.commands.len(), 9, "9 MENU_CMD_INFO");
    assert_eq!(m.resources.len(), 1, "1 MENU_RES");
    assert_eq!(m.layer_groups.len(), 16, "16 MENU_LAYER_GROUP_BASE");
    assert_eq!(m.layers[0].layer_id, HashId(0x074C_8B3F)); // 122456895
}

#[cfg(feature = "serde")]
#[test]
fn dispatch_typed_par_suffixe_atteint_azalee() {
    use nie_data::typed::{decode_by_key, family_key};
    let Some(root) = load() else { return };
    let key = family_key("info_bookmark_menu_setting.cfg.bin");
    assert!(key.ends_with("_menu_setting"), "clé = {key}");
    let (label, jsonv) = decode_by_key(&key, &root).expect("dispatch par suffixe câblé");
    assert_eq!(label, "menu_setting");
    assert_eq!(jsonv["layers"].as_array().map(Vec::len), Some(16));
}
