//! `FlagConfig` — port Rust de `system/flag_config_*.cfg.bin` (Level-5 IEVR).
//!
//! **Registre des types de flags de progression** : classe les identifiants de type de flag par
//! catégorie (flags généraux, coffres, repop de coffres, portes de map). Famille game-data **non
//! couverte** ; **pas de parseur inagle** → port direct (les valeurs sont des **identifiants de
//! type** entiers ; leur sémantique individuelle n'est pas inventée — anti-hallucination).
//!
//! ## Vérité terrain
//!
//! - Dump réel : `data/common/gamedata/system/flag_config_1.03.92.00.cfg.bin.json`
//!   (format `entries`/arbre, 4 racines `*_LIST_BEG_0`, enfants à **1 variable Int**).
//! - `FLAG_INFO_LIST_BEG_0` → 15 ids ; `FLAG_TBOX_INFO` / `FLAG_TBOX_REPOP_INFO` /
//!   `FLAG_MAP_DOOR_INFO` → 1 id chacun.

use alloc::vec::Vec;
use serde_json::Value;

use crate::cfgbin::Node;

/// Les 4 catégories de types de flags d'un `flag_config_*.cfg.bin`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FlagConfig {
    /// `FLAG_INFO_LIST_BEG_0` — types de flags généraux.
    pub flag_info: Vec<i64>,
    /// `FLAG_TBOX_INFO_LIST_BEG_0` — types de flags de coffres au trésor.
    pub tbox_info: Vec<i64>,
    /// `FLAG_TBOX_REPOP_INFO_LIST_BEG_0` — types de flags de réapparition de coffres.
    pub tbox_repop_info: Vec<i64>,
    /// `FLAG_MAP_DOOR_INFO_LIST_BEG_0` — types de flags de portes de map.
    pub map_door_info: Vec<i64>,
}

/// Collecte les variables `Int` (index 0) des enfants de la racine dont le nom débute par `prefix`.
fn collect_ids(root: &Value, prefix: &str) -> Vec<i64> {
    let mut out = Vec::new();
    if let Some(entries) = root.get("entries").and_then(Value::as_array) {
        for e in entries {
            let node = Node::new(e);
            if !node.name().starts_with(prefix) {
                continue;
            }
            for child in node.children() {
                out.push(child.int(0));
            }
        }
    }
    out
}

/// Parse un `flag_config_*.cfg.bin.json` (les 4 catégories de types de flags).
#[must_use]
pub fn parse_flag_config(root: &Value) -> FlagConfig {
    FlagConfig {
        flag_info: collect_ids(root, "FLAG_INFO_LIST_BEG"),
        tbox_info: collect_ids(root, "FLAG_TBOX_INFO_LIST_BEG"),
        tbox_repop_info: collect_ids(root, "FLAG_TBOX_REPOP_INFO_LIST_BEG"),
        map_door_info: collect_ids(root, "FLAG_MAP_DOOR_INFO_LIST_BEG"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture() -> Value {
        json!({
            "entries": [
                { "name": "FLAG_INFO_LIST_BEG_0", "variables": [{ "type": "Int", "value": "15" }],
                  "children": [
                      { "name": "FLAG_INFO_0", "variables": [{ "type": "Int", "value": "0" }] },
                      { "name": "FLAG_INFO_1", "variables": [{ "type": "Int", "value": "1" }] }
                  ]},
                { "name": "FLAG_TBOX_INFO_LIST_BEG_0", "variables": [{ "type": "Int", "value": "1" }],
                  "children": [{ "name": "FLAG_TBOX_INFO_0", "variables": [{ "type": "Int", "value": "3" }] }] },
                { "name": "FLAG_MAP_DOOR_INFO_LIST_BEG_0", "variables": [{ "type": "Int", "value": "1" }],
                  "children": [{ "name": "FLAG_MAP_DOOR_INFO_0", "variables": [{ "type": "Int", "value": "4" }] }] }
            ]
        })
    }

    #[test]
    fn parse_categories() {
        let cfg = parse_flag_config(&fixture());
        assert_eq!(cfg.flag_info, [0, 1]);
        assert_eq!(cfg.tbox_info, [3]);
        assert!(cfg.tbox_repop_info.is_empty()); // absente de la fixture
        assert_eq!(cfg.map_door_info, [4]);
    }
}
