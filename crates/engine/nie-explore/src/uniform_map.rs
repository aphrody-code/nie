//! Portable uniform mesh inventory used by CLI generators and model consumers.

use nie_formats::vfs::Vfs;
use serde::Serialize;

/// One model component addressable through the game's filename CRC.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct UniformModelEntry {
    pub crc: u32,
    pub crc_hex: String,
    pub path: String,
    pub cpk: String,
}

fn from_path(path: &str, cpk: &str) -> Option<UniformModelEntry> {
    let lower = path.to_ascii_lowercase();
    if !lower.ends_with(".g4md") && !lower.ends_with(".g4mg") {
        return None;
    }
    let stem = path.rsplit('/').next().unwrap_or(path);
    let stem = stem.rfind('.').map_or(stem, |index| &stem[..index]);
    let crc = nie_formats::cpk::crc32_nie(stem.as_bytes());
    Some(UniformModelEntry {
        crc,
        crc_hex: format!("0x{crc:08X}"),
        path: path.to_owned(),
        cpk: cpk.to_owned(),
    })
}

/// Builds the deterministic CRC-to-component inventory from an initialized VFS.
#[must_use]
pub fn build(vfs: &Vfs) -> Vec<UniformModelEntry> {
    vfs.iter()
        .filter_map(|(path, entry)| from_path(path, &entry.cpk_filename))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_mesh_components_and_hashes_the_basename_without_extension() {
        let md = from_path("data/chr/uniform/unf001.g4md", "models.cpk").expect("g4md");
        let mg = from_path("data/chr/uniform/unf001.g4mg", "models.cpk").expect("g4mg");
        assert_eq!(md.crc, nie_formats::cpk::crc32_nie(b"unf001"));
        assert_eq!(md.crc, mg.crc);
        assert_eq!(md.crc_hex, format!("0x{:08X}", md.crc));
        assert_eq!(md.path, "data/chr/uniform/unf001.g4md");
        assert!(from_path("data/chr/uniform/unf001.g4tx", "models.cpk").is_none());
    }
}
