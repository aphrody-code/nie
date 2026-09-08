#![allow(clippy::pedantic)]
//! Golden `soccer_placement` — placement des joueurs sur le terrain, sur le vrai dump.
mod common;

use nie_data::hash::HashId;
use nie_data::soccer_placement::parse_soccer_placement_config;

const PATH: &str = "soccer/soccer_chara_placement_1.01.97.00.cfg.bin.json";

fn load() -> Option<serde_json::Value> {
    let chemin_abs = common::chemin(PATH)?;
    if !chemin_abs.is_file() {
        eprintln!("skip : {} absent du corpus", chemin_abs.display());
        return None;
    }
    Some(serde_json::from_str(&std::fs::read_to_string(&chemin_abs).unwrap()).unwrap())
}

#[test]
fn placements_et_resolution() {
    let Some(root) = load() else { return };
    let cfg = parse_soccer_placement_config(&root);
    assert_eq!(cfg.chara_placements.len(), 2333);
    assert_eq!(cfg.categories.len(), 853);
    assert_eq!(cfg.placements.len(), 407);
    let c0 = &cfg.chara_placements[0];
    assert_eq!(c0.chara_parameter_id, HashId(0xA5F3_2308));
    assert_eq!(c0.pos_x, -10);
    assert_eq!(c0.pos_z, 13);
    assert_eq!(c0.rot_y, 180);
    // résolution 3 niveaux du 1er placement.
    let p = &cfg.placements[0];
    assert_eq!(p.placement_id, HashId(0xA250_0FF1));
    let cats = cfg.categories_of(p);
    assert!(!cats.is_empty());
    assert!(!cfg.charas_of(&cats[0]).is_empty());
    let last = cfg.placements.last().expect("au moins un placement");
    assert_eq!(last.placement_id, HashId(0x7E00_CEC3));
    assert_eq!(last.category_data, [851, 2]);
}

#[cfg(feature = "serde")]
#[test]
fn dispatch_typed() {
    use nie_data::typed::{decode_by_key, family_key};
    let Some(root) = load() else { return };
    assert_eq!(
        family_key(
            "soccer_chara_placement_1.01.97.00.cfg.bin.json"
                .strip_suffix(".json")
                .unwrap()
        ),
        "soccer_chara_placement"
    );
    let (label, json) = decode_by_key("soccer_chara_placement", &root).expect("câblé");
    assert_eq!(label, "soccer_placement");
    assert_eq!(
        json["chara_placements"].as_array().map(Vec::len),
        Some(2333)
    );
}
