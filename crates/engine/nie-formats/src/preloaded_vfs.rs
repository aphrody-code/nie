//! Deterministic, read-only VFS bundle consumed during browser startup.
//!
//! The container stores only caller-supplied game bytes. This crate embeds the format and the
//! startup requirements, never copyrighted resources. A deployment can therefore build the
//! archive from its licensed VFS and publish it as one cacheable object without baking private
//! data into `nie_wasm_bg.wasm` or this repository.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

const MAGIC: &[u8; 8] = b"NIEVFS1\0";
const HEADER_PREFIX_LEN: usize = MAGIC.len() + size_of::<u32>();
const MAX_HEADER_BYTES: usize = 4 * 1024 * 1024;
const MAX_ENTRIES: usize = 16_384;
const MAX_BUNDLE_BYTES: usize = 512 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BundleManifest {
    schema_version: u32,
    kind: String,
    entries: Vec<BundleEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BundleEntry {
    path: String,
    offset: u64,
    length: u64,
    crc32: u32,
}

/// Validated read-only view over one `niers.vfs.bundle/v1` container.
#[derive(Debug, Clone)]
pub struct PreloadedVfsBundle {
    bytes: Vec<u8>,
    payload_offset: usize,
    manifest: BundleManifest,
    by_path: BTreeMap<String, usize>,
}

impl PreloadedVfsBundle {
    /// Parse and fully validate the manifest, entry ranges, ordering and CRC-32 values.
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() > MAX_BUNDLE_BYTES {
            return Err(format!(
                "preloaded VFS bundle exceeds {MAX_BUNDLE_BYTES} bytes"
            ));
        }
        Self::parse_owned(bytes.to_vec())
    }

    /// Validate and retain an owned buffer without cloning the archive allocation.
    pub fn parse_owned(bytes: Vec<u8>) -> Result<Self, String> {
        if bytes.len() > MAX_BUNDLE_BYTES {
            return Err(format!(
                "preloaded VFS bundle exceeds {MAX_BUNDLE_BYTES} bytes"
            ));
        }
        if bytes.len() < HEADER_PREFIX_LEN || bytes.get(..MAGIC.len()) != Some(MAGIC) {
            return Err("invalid preloaded VFS bundle magic".to_owned());
        }
        let header_len = u32::from_le_bytes(
            bytes[MAGIC.len()..HEADER_PREFIX_LEN]
                .try_into()
                .map_err(|_| "invalid preloaded VFS header length")?,
        ) as usize;
        if header_len == 0 || header_len > MAX_HEADER_BYTES {
            return Err(format!(
                "preloaded VFS header length must be in 1..={MAX_HEADER_BYTES}"
            ));
        }
        let payload_offset = HEADER_PREFIX_LEN
            .checked_add(header_len)
            .ok_or("preloaded VFS header offset overflow")?;
        let header = bytes
            .get(HEADER_PREFIX_LEN..payload_offset)
            .ok_or("truncated preloaded VFS header")?;
        let manifest: BundleManifest =
            serde_json::from_slice(header).map_err(|error| error.to_string())?;
        if manifest.schema_version != 1 || manifest.kind != "niers.vfs.bundle/v1" {
            return Err("unsupported preloaded VFS manifest".to_owned());
        }
        if manifest.entries.len() > MAX_ENTRIES {
            return Err(format!(
                "preloaded VFS manifest exceeds {MAX_ENTRIES} entries"
            ));
        }

        let payload_len = bytes.len() - payload_offset;
        let mut by_path = BTreeMap::new();
        let mut expected_offset = 0_usize;
        let mut previous_path: Option<&str> = None;
        for (index, entry) in manifest.entries.iter().enumerate() {
            validate_path(&entry.path)?;
            if previous_path.is_some_and(|previous| previous >= entry.path.as_str()) {
                return Err("preloaded VFS entries must be sorted by unique path".to_owned());
            }
            previous_path = Some(&entry.path);

            let offset = usize::try_from(entry.offset)
                .map_err(|_| format!("entry offset does not fit this host: {}", entry.path))?;
            let length = usize::try_from(entry.length)
                .map_err(|_| format!("entry length does not fit this host: {}", entry.path))?;
            if offset != expected_offset {
                return Err(format!(
                    "entry payload is not compact at {}: expected offset {expected_offset}, got {offset}",
                    entry.path
                ));
            }
            let end = offset
                .checked_add(length)
                .ok_or_else(|| format!("entry range overflow: {}", entry.path))?;
            if end > payload_len {
                return Err(format!("entry exceeds bundle payload: {}", entry.path));
            }
            let content = bytes
                .get(payload_offset + offset..payload_offset + end)
                .ok_or_else(|| format!("entry exceeds bundle payload: {}", entry.path))?;
            let actual_crc32 = crate::cfgbin::crc32(content);
            if actual_crc32 != entry.crc32 {
                return Err(format!(
                    "entry CRC-32 mismatch for {}: expected {:08x}, got {actual_crc32:08x}",
                    entry.path, entry.crc32
                ));
            }
            expected_offset = end;
            by_path.insert(entry.path.clone(), index);
        }
        if expected_offset != payload_len {
            return Err(format!(
                "unindexed preloaded VFS payload bytes: indexed {expected_offset}, payload {payload_len}"
            ));
        }

        Ok(Self {
            bytes,
            payload_offset,
            manifest,
            by_path,
        })
    }

    /// Return one exact VFS file. Paths are case-sensitive and never normalized implicitly.
    #[must_use]
    pub fn read(&self, path: &str) -> Option<&[u8]> {
        let index = *self.by_path.get(path)?;
        let entry = &self.manifest.entries[index];
        let start = self.payload_offset + usize::try_from(entry.offset).ok()?;
        let end = start.checked_add(usize::try_from(entry.length).ok()?)?;
        self.bytes.get(start..end)
    }

    /// Serialize the validated index without copying any resource body into JSON.
    pub fn index_json(&self) -> Result<String, String> {
        serde_json::to_string(&self.manifest).map_err(|error| error.to_string())
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.manifest.entries.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.manifest.entries.is_empty()
    }

    /// Repack a complete, disjoint partition without altering any native file bytes.
    /// Every indexed path must be assigned exactly once; unknown or omitted paths fail closed.
    pub fn partition(
        &self,
        assignments: &BTreeMap<String, String>,
    ) -> Result<BTreeMap<String, Vec<u8>>, String> {
        if assignments.len() != self.len() {
            return Err("partition must assign every VFS entry exactly once".to_owned());
        }
        let mut groups = BTreeMap::<String, Vec<(String, Vec<u8>)>>::new();
        for (path, group) in assignments {
            if group.is_empty()
                || !group
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            {
                return Err(format!("invalid VFS partition name: {group}"));
            }
            let bytes = self
                .read(path)
                .ok_or_else(|| format!("unknown VFS partition path: {path}"))?;
            groups
                .entry(group.clone())
                .or_default()
                .push((path.clone(), bytes.to_vec()));
        }
        groups
            .into_iter()
            .map(|(name, files)| Ok((name, pack(files)?)))
            .collect()
    }
}

fn validate_path(path: &str) -> Result<(), String> {
    if path.is_empty()
        || path.len() > 512
        || path.starts_with('/')
        || path.ends_with('/')
        || path.contains('\\')
        || path
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(format!("invalid canonical VFS path: {path}"));
    }
    if !path.starts_with("data/") {
        return Err(format!("preloaded VFS path must start with data/: {path}"));
    }
    Ok(())
}

/// Exact boot inputs and discovery rules; resource bytes are deliberately absent.
pub fn startup_plan_json(locale: &str) -> Result<String, String> {
    if !matches!(
        locale,
        "de" | "en" | "es" | "fr" | "it" | "ja" | "pt" | "zh_hans" | "zh_hant"
    ) {
        return Err(format!("unsupported shipped game locale: {locale}"));
    }
    serde_json::to_string(&serde_json::json!({
        "schemaVersion": 1,
        "bundleFormat": "niers.vfs.bundle/v1",
        "startupScreen": "main_menu",
        "containsResourceBytes": false,
        "exactPaths": [
            "data/common/gamedata/menu/cfg/main_menu_setting.cfg.bin",
            "data/common/font/font/font_def/font.cfg.bin",
            "data/common/font/font_color.cfg.bin",
            "data/dx11/font/font_def/font.g4tx",
            format!("data/common/text/{locale}/menu_text.cfg.bin"),
        ],
        "discoverFromVfs": [
            {
                "kind": "versionedScript",
                "root": "data/common/script/lua/",
                "logicalName": "main_menu",
                "resolver": "nie_lua::resolve_script_path",
            },
            {
                "kind": "menuCompanionClosure",
                "setting": "data/common/gamedata/menu/cfg/main_menu_setting.cfg.bin",
                "resolver": "nie_formats::menu_screen",
            },
        ],
        "featuredPlayers": [
            { "name": "Byron Love", "internalCode": "c01001900" },
            { "name": "Mark Evans", "internalCode": "c01000010" },
            {
                "name": "Shawn Froste",
                "internalCodes": ["c02023290", "c02023370", "c02023380"],
                "zukanOrder": 508,
                "resolver": "installed chara tables; retain every measured base variant",
            },
        ],
    }))
    .map_err(|error| error.to_string())
}

/// Pack caller-owned files into the deterministic container.
///
/// Input ordering does not affect the result. Paths and bounds are validated by reparsing the
/// completed container before it is returned.
pub fn pack(mut files: Vec<(String, Vec<u8>)>) -> Result<Vec<u8>, String> {
    if files.len() > MAX_ENTRIES {
        return Err(format!("preloaded VFS input exceeds {MAX_ENTRIES} entries"));
    }
    files.sort_by(|left, right| left.0.cmp(&right.0));
    let mut offset = 0_u64;
    let entries: Vec<_> = files
        .iter()
        .map(|(path, bytes)| {
            let entry = BundleEntry {
                path: path.clone(),
                offset,
                length: bytes.len() as u64,
                crc32: crate::cfgbin::crc32(bytes),
            };
            offset += bytes.len() as u64;
            entry
        })
        .collect();
    let header = serde_json::to_vec(&BundleManifest {
        schema_version: 1,
        kind: "niers.vfs.bundle/v1".to_owned(),
        entries,
    })
    .map_err(|error| error.to_string())?;
    let total_len = HEADER_PREFIX_LEN
        .checked_add(header.len())
        .and_then(|prefix| prefix.checked_add(offset as usize))
        .ok_or("preloaded VFS bundle size overflow")?;
    if total_len > MAX_BUNDLE_BYTES {
        return Err(format!(
            "preloaded VFS bundle exceeds {MAX_BUNDLE_BYTES} bytes"
        ));
    }
    let mut bundle = Vec::with_capacity(total_len);
    bundle.extend_from_slice(MAGIC);
    bundle.extend_from_slice(&(header.len() as u32).to_le_bytes());
    bundle.extend_from_slice(&header);
    for (_, bytes) in files {
        bundle.extend_from_slice(&bytes);
    }
    PreloadedVfsBundle::parse(&bundle)?;
    Ok(bundle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deterministic_bundle_round_trips_exact_vfs_paths() {
        let bytes = pack(vec![
            ("data/z.bin".to_owned(), vec![9, 8]),
            ("data/a.bin".to_owned(), vec![1, 2, 3]),
        ])
        .unwrap();
        let reordered = pack(vec![
            ("data/a.bin".to_owned(), vec![1, 2, 3]),
            ("data/z.bin".to_owned(), vec![9, 8]),
        ])
        .unwrap();
        assert_eq!(bytes, reordered);
        let bundle = PreloadedVfsBundle::parse(&bytes).expect("valid bundle");
        assert_eq!(bundle.len(), 2);
        assert!(!bundle.is_empty());
        assert_eq!(bundle.read("data/a.bin"), Some(&[1, 2, 3][..]));
        assert_eq!(bundle.read("data/z.bin"), Some(&[9, 8][..]));
        assert_eq!(bundle.read("data/A.bin"), None);
        let index: serde_json::Value = serde_json::from_str(&bundle.index_json().unwrap()).unwrap();
        assert_eq!(index["entries"][0]["path"], "data/a.bin");
        assert_eq!(index["entries"][1]["offset"], 3);
    }

    #[test]
    fn bundle_rejects_corruption_and_noncanonical_paths() {
        let mut corrupt = pack(vec![("data/a.bin".to_owned(), vec![1, 2, 3])]).unwrap();
        *corrupt.last_mut().unwrap() ^= 0xff;
        assert!(
            PreloadedVfsBundle::parse(&corrupt)
                .unwrap_err()
                .contains("CRC-32 mismatch")
        );

        assert!(
            pack(vec![("data/../secret".to_owned(), vec![1])])
                .unwrap_err()
                .contains("invalid canonical VFS path")
        );
    }

    #[test]
    fn partition_is_complete_disjoint_and_preserves_native_bytes() {
        let bytes = pack(vec![
            ("data/menu".into(), vec![1, 2]),
            ("data/table".into(), vec![3]),
        ])
        .unwrap();
        let bundle = PreloadedVfsBundle::parse(&bytes).unwrap();
        let assignments = BTreeMap::from([
            ("data/menu".into(), "menu".into()),
            ("data/table".into(), "tables".into()),
        ]);
        let groups = bundle.partition(&assignments).unwrap();
        assert_eq!(groups.len(), 2);
        let menu = PreloadedVfsBundle::parse(&groups["menu"]).unwrap();
        assert_eq!(menu.read("data/menu"), Some(&[1, 2][..]));
        assert_eq!(menu.read("data/table"), None);
        let tables = PreloadedVfsBundle::parse(&groups["tables"]).unwrap();
        assert_eq!(tables.read("data/table"), Some(&[3][..]));
        assert_eq!(menu.len() + tables.len(), bundle.len());
        assert_eq!(bundle.partition(&assignments).unwrap(), groups);
        assert!(bundle.partition(&BTreeMap::new()).is_err());
        let unknown = BTreeMap::from([
            ("data/missing".into(), "menu".into()),
            ("data/table".into(), "tables".into()),
        ]);
        assert!(bundle.partition(&unknown).is_err());
        let invalid = BTreeMap::from([
            ("data/menu".into(), "../menu".into()),
            ("data/table".into(), "tables".into()),
        ]);
        assert!(bundle.partition(&invalid).is_err());
    }

    #[test]
    fn startup_plan_names_only_measured_paths_and_stable_identities() {
        let plan: serde_json::Value =
            serde_json::from_str(&startup_plan_json("fr").unwrap()).unwrap();
        assert_eq!(plan["startupScreen"], "main_menu");
        assert_eq!(plan["containsResourceBytes"], false);
        assert!(
            plan["exactPaths"]
                .as_array()
                .unwrap()
                .iter()
                .any(|path| path == "data/common/text/fr/menu_text.cfg.bin")
        );
        assert_eq!(plan["featuredPlayers"][0]["internalCode"], "c01001900");
        assert_eq!(
            plan["featuredPlayers"][2]["internalCodes"],
            serde_json::json!(["c02023290", "c02023370", "c02023380"])
        );
        assert_eq!(plan["featuredPlayers"][2]["zukanOrder"], 508);
        assert!(startup_plan_json("ko").is_err());
    }

    #[test]
    fn oversized_manifest_ranges_fail_without_panicking() {
        for length in [u64::MAX, usize::MAX as u64, MAX_BUNDLE_BYTES as u64] {
            let header = serde_json::to_vec(&BundleManifest {
                schema_version: 1,
                kind: "niers.vfs.bundle/v1".to_owned(),
                entries: vec![BundleEntry {
                    path: "data/overflow.bin".to_owned(),
                    offset: 0,
                    length,
                    crc32: 0,
                }],
            })
            .unwrap();
            let mut bytes = MAGIC.to_vec();
            bytes.extend_from_slice(&(header.len() as u32).to_le_bytes());
            bytes.extend_from_slice(&header);
            let result = std::panic::catch_unwind(|| PreloadedVfsBundle::parse(&bytes));
            assert!(result.is_ok(), "invalid range must not panic: {length}");
            assert!(result.unwrap().is_err(), "invalid range must be rejected");
        }
    }
}
