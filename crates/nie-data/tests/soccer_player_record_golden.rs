#![allow(clippy::pedantic)]
//! Golden `soccer_player_record` — flags de record joueur, sur le vrai dump.
use nie_data::hash::HashId;
use nie_data::soccer_player_record::parse_soccer_player_record_config;
const PATH: &str = "/home/ubuntu/niers/data/common/gamedata/soccer/soccer_player_record_config.cfg.bin.json";
fn load() -> Option<serde_json::Value> {
    if !std::path::Path::new(PATH).exists() { return None; }
    Some(serde_json::from_str(&std::fs::read_to_string(PATH).unwrap()).unwrap())
}
#[test]
fn records_byte_exact() {
    let Some(root) = load() else { return };
    let cfg = parse_soccer_player_record_config(&root);
    assert_eq!(cfg.records.len(), 20);
    let r = &cfg.records[0];
    assert_eq!(r.id, HashId(0xB358_708B));
    assert_eq!(r.flag_cpu_difficulty[0], HashId(0x235B_5ED4));
}
#[cfg(feature = "serde")]
#[test]
fn dispatch_typed() {
    use nie_data::typed::{decode_by_key, family_key};
    let Some(root) = load() else { return };
    assert_eq!(family_key("soccer_player_record_config.cfg.bin.json".strip_suffix(".json").unwrap()), "soccer_player_record_config");
    let (label, _j) = decode_by_key("soccer_player_record_config", &root).expect("câblé");
    assert_eq!(label, "soccer_player_record");
}
