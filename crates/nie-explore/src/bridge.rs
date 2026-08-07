//! Pont générique T2B/RDBN → JSON, dans la forme exacte des dumps `cfg.bin.json` produits par
//! inagle (`{"entries":[...]}` pour le T2B arborescent, `{"lists":[{"name","typeName","values"}]}`
//! pour le RDBN à listes) — cf. `crates/nie-data/src/cfgbin.rs`.
//!
//! Débloque, sans dump externe, **tous** les parseurs spécialisés de `nie-data`
//! (`chara_base`, `chara_text`, `skill`, `skill_technic`, `growth`, `item`, `aura`… — une
//! centaine de modules) contre des octets lus en direct du VFS : ils consomment tous la même
//! forme `&serde_json::Value`, produite ici une fois pour toutes plutôt que par module.

use nie_formats::cfgbin::{CfgBinFile, CfgEntry, RdbnList, RdbnRow, RdbnValue, Value as T2bValue};
use serde_json::{json, Map, Value};

fn t2b_value_to_json(v: &T2bValue) -> Value {
    match v {
        T2bValue::String(s) => json!({ "type": "String", "value": s }),
        // `value` est TOUJOURS une chaîne dans la forme inagle (cf. nie_data::cfgbin) — les
        // helpers `Var::as_i64`/`as_f64` re-parsent cette chaîne.
        T2bValue::Int(i) => json!({ "type": "Int", "value": i.to_string() }),
        T2bValue::Float(f) => json!({ "type": "Float", "value": f.to_string() }),
    }
}

fn t2b_entry_to_json(e: &CfgEntry) -> Value {
    json!({
        "name": e.name,
        "variables": e.variables.iter().map(t2b_value_to_json).collect::<Vec<_>>(),
        "children": e.children.iter().map(t2b_entry_to_json).collect::<Vec<_>>(),
    })
}

/// Convertit un `CfgBinFile` T2B (`nie_formats::cfgbin::cfgbin_parse`) en JSON forme inagle
/// `{"entries": [...]}`, consommable par `walk_named`/`Node` de `nie-data`.
#[must_use]
pub fn t2b_to_json(cfg: &CfgBinFile) -> Value {
    json!({ "entries": cfg.entries.iter().map(t2b_entry_to_json).collect::<Vec<_>>() })
}

fn rdbn_value_to_json(v: &RdbnValue) -> Value {
    match v {
        RdbnValue::Bool(b) => json!(*b),
        RdbnValue::Byte(b) => json!(*b as i64),
        RdbnValue::Short(s) => json!(*s as i64),
        RdbnValue::Int(i) => json!(*i as i64),
        RdbnValue::ActType(s) => json!(*s as i64),
        RdbnValue::Flag(i) => json!(*i as i64),
        RdbnValue::Float(f) => json!(*f as f64),
        // Hash en chaîne hex — même convention que les dumps `*_config` inagle (cf. commentaire
        // `field_hash` de nie-data : "les *_config mettent les hash en hex").
        RdbnValue::Hash(h) => json!(format!("0x{h:08X}")),
        RdbnValue::Rates(r) => json!(r.to_vec()),
        RdbnValue::Position(p) => json!(p.to_vec()),
        RdbnValue::Condition(s) => json!(s),
        RdbnValue::ShortTuple(t) => json!(t.to_vec()),
        // Types agrégats (AbilityData/EnhanceData/StatusRate) : structure interne non modélisée
        // ici, aucun champ ne serait fiable à fabriquer → `null` plutôt que deviner un layout.
        RdbnValue::Blob(_) | RdbnValue::Invalid => Value::Null,
    }
}

fn rdbn_row_to_json(row: &RdbnRow) -> Value {
    let mut map = Map::with_capacity(row.fields.len());
    for (name, value) in &row.fields {
        map.insert(name.clone(), rdbn_value_to_json(value));
    }
    Value::Object(map)
}

/// Convertit les listes RDBN décodées (`nie_formats::cfgbin::read_values`) en JSON forme inagle
/// `{"lists": [{"name","typeName","values":[{champ: valeur, ...}]}]}`, consommable par
/// `list_values`/`field_*` de `nie-data`.
#[must_use]
pub fn rdbn_to_json(lists: &[RdbnList]) -> Value {
    json!({
        "lists": lists
            .iter()
            .map(|l| json!({
                "name": l.name,
                "typeName": l.type_name,
                "values": l.rows.iter().map(rdbn_row_to_json).collect::<Vec<_>>(),
            }))
            .collect::<Vec<_>>()
    })
}
