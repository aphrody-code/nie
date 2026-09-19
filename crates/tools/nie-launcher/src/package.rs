//! Mod package (`.utmod` / `UTMOD2`) reader and verification.
//!
//! Reconstructs the container format used by `UTMod.utmod`.

use std::collections::HashMap;
use std::path::Path;

use hmac::{Hmac, Mac};
use sha2::Sha256;
use uuid::Uuid;

use crate::error::{LauncherError, Result};

/// Magic sentinel of UTMOD2 containers: `UTMOD2\r\n\x1a`.
pub const UTMOD2_MAGIC: &[u8; 9] = b"UTMOD2\r\n\x1a";

/// Parsed metadata header of a .utmod package.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PackageHeader {
    pub package_id: Uuid,
    pub payload_offset: usize,
    pub file_size: u64,
}

/// A decrypted file entry held in memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageEntry {
    pub relative_path: String,
    pub size: usize,
    pub data: Vec<u8>,
}

/// In-memory mod package.
#[derive(Debug, Clone)]
pub struct ModPackage {
    pub header: PackageHeader,
    pub files: HashMap<String, PackageEntry>,
}

/// Inspect the header of a .utmod file without requiring decryption keys.
pub fn inspect_package_header(data: &[u8]) -> Result<PackageHeader> {
    if data.len() < 25 {
        return Err(LauncherError::Package(
            "package file truncated: less than 25 bytes".to_string(),
        ));
    }

    if &data[0..9] != UTMOD2_MAGIC {
        return Err(LauncherError::Package(format!(
            "invalid UTMOD2 magic: found {:02X?}",
            &data[0..9]
        )));
    }

    let guid_bytes: [u8; 16] = data[9..25].try_into().unwrap();
    let package_id = Uuid::from_bytes_le(guid_bytes);

    Ok(PackageHeader {
        package_id,
        payload_offset: 25,
        file_size: data.len() as u64,
    })
}

/// Verify HMAC-SHA256 authentication tag over a ciphertext block.
pub fn verify_hmac(key: &[u8; 32], data: &[u8], expected_tag: &[u8; 32]) -> Result<()> {
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(key)
        .map_err(|e| LauncherError::Crypto(format!("failed to init HMAC: {e}")))?;
    mac.update(data);
    mac.verify_slice(expected_tag)
        .map_err(|_| LauncherError::Package("package HMAC-SHA256 verification failed".to_string()))
}

/// Read and inspect a package file from disk.
pub fn read_package_file<P: AsRef<Path>>(path: P) -> Result<PackageHeader> {
    let data = std::fs::read(path)?;
    inspect_package_header(&data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_inspect_package_header() {
        let mut buffer = Vec::new();
        buffer.extend_from_slice(UTMOD2_MAGIC);
        let id = Uuid::new_v4();
        buffer.extend_from_slice(&id.to_bytes_le());
        buffer.extend_from_slice(&[0u8; 100]);

        let header = inspect_package_header(&buffer).unwrap();
        assert_eq!(header.package_id, id);
        assert_eq!(header.payload_offset, 25);
    }
}
