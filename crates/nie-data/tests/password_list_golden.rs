#![allow(clippy::pedantic)]
//! Tests golden `post::password_list` — valeurs réelles tirées de :
//! `/home/ubuntu/niers/data/common/gamedata/post/password_list_config.cfg.bin.json`
//!
//! Layout `lists` : 2 listes `m_Codes` (`PASSWARD_CODES`, typo Level-5) et `info`
//! (`PASSWARD_DATA`). Les codes y sont **hashés** (9 langues, même hash sur le dump réel),
//! contrairement à `delivery_config` où ce sont des chaînes littérales. La clé `"french "`
//! porte un espace final (typo Level-5).

use nie_data::hash::HashId;
use nie_data::post::{parse_password_list_config, PasswordListConfig};

const REAL_PATH: &str =
    "/home/ubuntu/niers/data/common/gamedata/post/password_list_config.cfg.bin.json";

fn load_real() -> Option<PasswordListConfig> {
    if !std::path::Path::new(REAL_PATH).exists() {
        return None;
    }
    let content = std::fs::read_to_string(REAL_PATH)
        .unwrap_or_else(|e| panic!("Impossible de lire {REAL_PATH}: {e}"));
    let root: serde_json::Value =
        serde_json::from_str(&content).unwrap_or_else(|e| panic!("JSON invalide: {e}"));
    Some(parse_password_list_config(&root))
}

#[test]
fn comptes_listes() {
    let Some(cfg) = load_real() else { return };
    assert_eq!(cfg.codes.len(), 1, "m_Codes");
    assert_eq!(cfg.data.len(), 1, "info");
}

#[test]
fn codes_toutes_langues_meme_hash() {
    let Some(cfg) = load_real() else { return };
    let c = &cfg.codes[0];
    let h = HashId(0xD853_DAB8);
    assert_eq!(c.japanese, h);
    assert_eq!(c.english, h);
    assert_eq!(c.portuguese, h);
    // clé "french " avec espace final (typo Level-5)
    assert_eq!(c.french, h);
    assert_eq!(c.italian, h);
    assert_eq!(c.german, h);
    assert_eq!(c.spanish, h);
    assert_eq!(c.traditional_chinese, h);
    assert_eq!(c.simplified_chinese, h);
}

#[test]
fn data_entree0() {
    let Some(cfg) = load_real() else { return };
    let d = &cfg.data[0];
    assert_eq!(d.id, HashId(0xC4FD_CF84));
    assert_eq!(d.text_id, HashId(0xC4FD_CF84));
    assert_eq!(d.flag_id, HashId(0xC4FD_CF84));
    assert_eq!(d.conditions, "AAAAAA8FNbkZNtoAAQAyAAAAAHg=");
    assert_eq!(d.codes_offset, 0);
    assert_eq!(d.codes_count, 1);
}
