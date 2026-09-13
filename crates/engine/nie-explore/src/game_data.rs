//! Shared VFS loading and cfg.bin-to-data adapters.

use std::collections::HashMap;

use nie_formats::cfgbin::CfgEntry;
use nie_formats::vfs::Vfs;
use serde_json::{Value, json};

use crate::bridge::t2b_value_to_json;

/// Return the alphabetically first VFS path accepted by `predicate`.
pub fn find_path(vfs: &Vfs, predicate: impl Fn(&str) -> bool) -> Option<String> {
    vfs.iter()
        .map(|(path, _)| path.to_string())
        .filter(|path| predicate(path))
        .min()
}

/// Return the final component of a normalized VFS path.
#[must_use]
pub fn base_name(path: &str) -> &str {
    path.rsplit('/').next().unwrap_or(path)
}

/// Load and bridge the first matching RDBN cfg.bin.
pub fn load_rdbn(
    vfs: &Vfs,
    predicate: impl Fn(&str) -> bool,
    description: &str,
) -> Result<Value, String> {
    let path = find_path(vfs, predicate)
        .ok_or_else(|| format!("{description} introuvable dans le VFS monté"))?;
    let bytes = vfs.read(&path).map_err(|error| error.to_string())?;
    let parsed = nie_formats::cfgbin::parse(&bytes)
        .map_err(|error| format!("parse RDBN {path} : {error}"))?;
    Ok(crate::bridge::rdbn_to_json(
        &nie_formats::cfgbin::read_values(&parsed, &bytes),
    ))
}

/// Convert sibling T2B entries to the indexed JSON shape expected by `nie-data`.
#[must_use]
pub fn indexed_entries_json(siblings: &[CfgEntry]) -> Vec<Value> {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    siblings
        .iter()
        .map(|entry| {
            let index = counts.entry(entry.name.as_str()).or_insert(0);
            let name = format!("{}_{}", entry.name, *index);
            *index += 1;
            json!({
                "name": name,
                "variables": entry.variables.iter().map(t2b_value_to_json).collect::<Vec<_>>(),
                "children": indexed_entries_json(&entry.children),
            })
        })
        .collect()
}

/// Load and bridge the first matching T2B cfg.bin using indexed sibling names.
pub fn load_t2b(
    vfs: &Vfs,
    predicate: impl Fn(&str) -> bool,
    description: &str,
) -> Result<Value, String> {
    let path = find_path(vfs, predicate)
        .ok_or_else(|| format!("{description} introuvable dans le VFS monté"))?;
    let bytes = vfs.read(&path).map_err(|error| error.to_string())?;
    let parsed = nie_formats::cfgbin::parse_t2b(&bytes)
        .map_err(|error| format!("parse T2B {path} : {error}"))?;
    Ok(json!({ "entries": indexed_entries_json(&parsed.entries) }))
}

/// Decode one cfg.bin path already mounted in `vfs`.
///
/// The result preserves the canonical bridge shape used by the typed `nie-data`
/// parsers: RDBN files become `{ "lists": [...] }`, while T2B files become
/// `{ "entries": [...] }`.  Hosts may expose this value through their own IPC
/// or HTTP transport, but format detection and error context belong here so
/// every caller reads exactly the same VFS bytes.
pub fn decode_cfgbin(vfs: &Vfs, path: &str) -> Result<Value, String> {
    let bytes = vfs.read(path).map_err(|error| error.to_string())?;
    if nie_formats::cfgbin::is_rdbn(&bytes) {
        let parsed = nie_formats::cfgbin::parse(&bytes)
            .map_err(|error| format!("parse RDBN {path}: {error}"))?;
        Ok(crate::bridge::rdbn_to_json(
            &nie_formats::cfgbin::read_values(&parsed, &bytes),
        ))
    } else {
        let parsed = nie_formats::cfgbin::parse_t2b(&bytes)
            .map_err(|error| format!("parse T2B {path}: {error}"))?;
        Ok(crate::bridge::t2b_to_json(&parsed))
    }
}

/// Encode an edited cfg.bin bridge value for one path already mounted in `vfs`.
///
/// T2B documents carry an `entries` root and can be rebuilt from the edited JSON alone. RDBN
/// documents carry a `lists` root; their JSON representation does not retain each column's wire
/// type, so the original VFS bytes remain the required schema template. Keeping that dispatch and
/// template handling here prevents native hosts from growing their own format writer.
pub fn encode_cfgbin(vfs: &Vfs, path: &str, edited: &Value) -> Result<Vec<u8>, String> {
    if edited.get("lists").is_some() {
        let raw = vfs.read(path).map_err(|error| error.to_string())?;
        let rdbn = nie_formats::cfgbin::parse(&raw)
            .map_err(|error| format!("parse RDBN {path} : {error}"))?;
        let original = nie_formats::cfgbin::read_values(&rdbn, &raw);
        let lists = crate::bridge::json_to_rdbn_lists(&original, edited)?;
        nie_formats::cfgbin::encode_rdbn(&lists)
    } else {
        let entries = crate::bridge::json_to_t2b_entries(edited)?;
        Ok(nie_formats::cfgbin::encode_t2b(&entries))
    }
}

/// Load one localized text family as indexed JSON.
pub fn load_text_json_lang(vfs: &Vfs, text_type: &str, language: &str) -> Result<Value, String> {
    let stem = nie_data::text::text_file_name(text_type).ok_or_else(|| {
        format!("type de texte inconnu : {text_type} (cf. nie_data::text::TEXT_FILES)")
    })?;
    let file = format!("{stem}.cfg.bin");
    let directory = format!("/text/{language}/");
    load_t2b(
        vfs,
        |path| path.contains(&directory) && base_name(path) == file,
        &format!("{file} {language}"),
    )
}

/// Load the French text table for one data family.
pub fn load_text_json(vfs: &Vfs, text_type: &str) -> Result<Value, String> {
    load_text_json_lang(vfs, text_type, "fr")
}

/// Load and parse the French `(hash, text)` rows for one data family.
pub fn load_text(vfs: &Vfs, text_type: &str) -> Result<Vec<(nie_data::HashId, String)>, String> {
    Ok(nie_data::text::parse_text_file(&load_text_json(
        vfs, text_type,
    )?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use nie_formats::cfgbin::Value as CfgValue;

    fn unique_temp_file(label: &str) -> std::path::PathBuf {
        let stamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "nie-explore-{label}-{}-{stamp}.cfg.bin",
            std::process::id()
        ))
    }

    fn overlay(bytes: &[u8], logical_path: &str) -> (Vfs, std::path::PathBuf) {
        let disk_path = unique_temp_file("cfgbin-encode");
        std::fs::write(&disk_path, bytes).expect("write cfg.bin fixture");
        let mut vfs = Vfs::new();
        vfs.add_overlay_file(
            logical_path.to_owned(),
            disk_path.clone(),
            u32::try_from(bytes.len()).expect("small fixture"),
        );
        (vfs, disk_path)
    }

    #[test]
    fn duplicate_siblings_and_children_receive_stable_indices() {
        let entries = vec![
            CfgEntry {
                name: "TEXT_INFO".to_owned(),
                variables: vec![CfgValue::Int(7)],
                children: vec![CfgEntry {
                    name: "NODE".to_owned(),
                    variables: vec![],
                    children: vec![],
                }],
            },
            CfgEntry {
                name: "TEXT_INFO".to_owned(),
                variables: vec![CfgValue::String("value".to_owned())],
                children: vec![],
            },
        ];
        let json = indexed_entries_json(&entries);
        assert_eq!(json[0]["name"], "TEXT_INFO_0");
        assert_eq!(json[1]["name"], "TEXT_INFO_1");
        assert_eq!(json[0]["children"][0]["name"], "NODE_0");
        assert_eq!(json[0]["variables"][0]["type"], "Int");
        assert_eq!(json[0]["variables"][0]["value"], "7");
    }

    #[test]
    fn base_names_are_transport_neutral() {
        assert_eq!(
            base_name("data/common/text/fr/item_text.cfg.bin"),
            "item_text.cfg.bin"
        );
        assert_eq!(base_name("item_text.cfg.bin"), "item_text.cfg.bin");
    }

    #[test]
    fn encode_cfgbin_owns_t2b_dispatch_and_round_trip() {
        let original = vec![CfgEntry {
            name: "ROOT_BEGIN".to_owned(),
            variables: vec![CfgValue::Int(7)],
            children: vec![],
        }];
        let bytes = nie_formats::cfgbin::encode_t2b(&original);
        let logical_path = "data/common/gamedata/test_config.cfg.bin";
        let (vfs, disk_path) = overlay(&bytes, logical_path);
        let edited = decode_cfgbin(&vfs, logical_path).expect("decode T2B fixture");

        let encoded = encode_cfgbin(&vfs, logical_path, &edited).expect("encode T2B fixture");
        let reparsed = nie_formats::cfgbin::parse_t2b(&encoded).expect("reparse T2B fixture");
        assert_eq!(reparsed.entries, original);

        std::fs::remove_file(disk_path).expect("remove T2B fixture");
    }

    #[test]
    fn encode_cfgbin_owns_rdbn_template_dispatch() {
        let bytes = nie_formats::cfgbin::encode_rdbn(&[]).expect("encode empty RDBN fixture");
        let logical_path = "data/common/gamedata/empty_config.cfg.bin";
        let (vfs, disk_path) = overlay(&bytes, logical_path);
        let edited = decode_cfgbin(&vfs, logical_path).expect("decode RDBN fixture");

        let encoded = encode_cfgbin(&vfs, logical_path, &edited).expect("encode RDBN fixture");
        assert!(nie_formats::cfgbin::is_rdbn(&encoded));
        let reparsed = nie_formats::cfgbin::parse(&encoded).expect("reparse RDBN fixture");
        assert!(nie_formats::cfgbin::read_values(&reparsed, &encoded).is_empty());

        std::fs::remove_file(disk_path).expect("remove RDBN fixture");
    }
}
