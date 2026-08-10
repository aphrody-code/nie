//! CPK archive parser — public API for listing and extracting entries.
//!
//! CPK is a container format by CRI Middleware.  It wraps UTF tables inside
//! 16-byte "container" envelopes.  The top-level file starts with the "CPK "
//! container, which holds metadata including `TocOffset` pointing to the
//! "TOC " container that lists all files.
//!
//! IEVR CPK files are encrypted with a per-file CRC32-derived XOR key.  The
//! key is derived from the filename (with Steam AppID prefix) via
//! `cri_derive_key_with_appid`.  Decryption is streaming: only the regions
//! actually needed (header + TOC) are decrypted during open; individual file
//! data is decrypted lazily in `read_entry`.

use crate::{crypto, utf};
use std::fs::File;
use std::io::{self, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

// ─── Constants ────────────────────────────────────────────────────────────────

/// "CPK " as little-endian u32 (bytes: 0x43 0x50 0x4B 0x20).
const CPK_MAGIC: u32 = 0x204B_5043;
/// "TOC " as little-endian u32.  Kept for documentation; the parser accepts
/// any container magic at TocOffset (C++ impl only warns on mismatch).
#[allow(dead_code)]
const TOC_MAGIC: u32 = 0x2043_4F54;
/// IEVR Steam AppID (used for key derivation prefix).
const IEVR_APP_ID: u32 = 2_799_860;
/// Container envelope size: magic(4) + pad(4) + table_size_le(4) + pad(4).
const CONTAINER_HDR: usize = 16;

// ─── Public types ─────────────────────────────────────────────────────────────

/// Metadata for a single file inside a CPK archive.
#[derive(Debug, Clone)]
pub struct CpkEntry {
    /// Filename component (e.g. "chr001.g4tx").
    pub name: String,
    /// Directory component (e.g. "common/chara").
    pub dir: String,
    /// Absolute byte offset inside the CPK file where the (possibly
    /// compressed) data starts.
    pub offset: u64,
    /// Stored (compressed) size in bytes.
    pub size: u64,
    /// Uncompressed size.  Equal to `size` when uncompressed.
    pub extract_size: u64,
    /// True when `extract_size != size` — caller must handle compression.
    pub compressed: bool,
    /// File ID from the TOC (may be 0xFFFF_FFFF when absent).
    pub id: u32,
}

impl CpkEntry {
    /// Full path combining dir and name (e.g. "common/chara/chr001.g4tx").
    pub fn path(&self) -> String {
        if self.dir.is_empty() {
            self.name.clone()
        } else {
            format!("{}/{}", self.dir, self.name)
        }
    }
}

/// An open CPK archive.  Holds the path and parsed entry list in memory;
/// file data is read on demand via `read_entry`.
pub struct CpkArchive {
    path: PathBuf,
    entries: Vec<CpkEntry>,
    /// XOR key for streaming decrypt (0 = not encrypted).
    file_key: u32,
    encrypted: bool,
}

// ─── Private helpers ─────────────────────────────────────────────────────────

fn read_u32_le(data: &[u8], off: usize) -> Option<u32> {
    let bytes: [u8; 4] = data.get(off..off + 4)?.try_into().ok()?;
    Some(u32::from_le_bytes(bytes))
}

/// Read exactly `count` bytes from `file` at `offset`, decrypt if needed.
fn read_region(
    file: &mut File,
    offset: u64,
    count: usize,
    encrypted: bool,
    key: u32,
) -> io::Result<Vec<u8>> {
    let mut buf = vec![0u8; count];
    file.seek(SeekFrom::Start(offset))?;
    file.read_exact(&mut buf)?;
    if encrypted {
        crypto::cri_decrypt_block(&mut buf, offset, key);
    }
    Ok(buf)
}

/// Parse the 16-byte container envelope + UTF table body at `offset` in `file`.
fn read_table_container(
    file: &mut File,
    offset: u64,
    encrypted: bool,
    key: u32,
) -> io::Result<utf::UtfTable> {
    // Read the 16-byte container header.
    let hdr = read_region(file, offset, CONTAINER_HDR, encrypted, key)?;
    let table_size = read_u32_le(&hdr, 8).unwrap_or(0) as usize;

    // Read the UTF table bytes (immediately after the container header).
    let table_start = offset + CONTAINER_HDR as u64;
    let raw = read_region(file, table_start, table_size, encrypted, key)?;

    utf::parse(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}

// ─── CpkArchive impl ─────────────────────────────────────────────────────────

impl CpkArchive {
    /// Open a CPK file, parse the header and TOC, and cache all entries.
    ///
    /// Supports encrypted CPK files (per-file CRC32-derived XOR key).
    pub fn open(path: &Path) -> io::Result<Self> {
        let mut file = File::open(path)?;

        // Read the first 4 bytes to detect encryption.
        let mut magic_buf = [0u8; 4];
        file.read_exact(&mut magic_buf)?;
        let raw_magic = u32::from_le_bytes(magic_buf);

        let (encrypted, file_key) = if raw_magic == CPK_MAGIC {
            (false, 0u32)
        } else {
            // Try key derivation: AppID-prefixed first, then plain filename.
            let filename = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();

            let key_appid = crypto::cri_derive_key_with_appid(filename, IEVR_APP_ID);
            let key_plain = crypto::cri_derive_key(filename);

            // Test which key reveals the CPK magic.
            let try_key = |k: u32| -> bool {
                let mut test = magic_buf;
                crypto::cri_decrypt_block(&mut test, 0, k);
                u32::from_le_bytes(test) == CPK_MAGIC
            };

            if try_key(key_appid) {
                (true, key_appid)
            } else if try_key(key_plain) {
                (true, key_plain)
            } else {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "Not a CPK file (magic 0x{:08X}, decryption failed)",
                        raw_magic
                    ),
                ));
            }
        };

        // Parse the CPK header container (at offset 0).
        let header_table = read_table_container(&mut file, 0, encrypted, file_key)?;

        if header_table.rows.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "CPK header UTF table has 0 rows",
            ));
        }

        // Extract TocOffset and ContentOffset from row 0.
        let toc_offset = header_table
            .get_i64(0, "TocOffset")
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidData, "TocOffset missing"))?
            as u64;

        let content_offset = header_table
            .get_i64(0, "ContentOffset")
            .map(|v| v as u64)
            .unwrap_or(toc_offset)
            .min(toc_offset); // guard against ContentOffset > TocOffset

        // Parse the TOC container.
        let toc_table = read_table_container(&mut file, toc_offset, encrypted, file_key)?;

        // Build entry list.
        let mut entries: Vec<CpkEntry> = Vec::with_capacity(toc_table.rows.len());
        for i in 0..toc_table.rows.len() {
            let name = toc_table.get_str(i, "FileName").unwrap_or("").to_owned();
            let dir = toc_table.get_str(i, "DirName").unwrap_or("").to_owned();

            let file_offset = toc_table
                .get_i64(i, "FileOffset")
                .unwrap_or(0) as u64;
            let file_size = toc_table.get_i64(i, "FileSize").unwrap_or(0) as u64;
            let extract_size = toc_table.get_i64(i, "ExtractSize").unwrap_or(0) as u64;
            let id = toc_table
                .get(i, "ID")
                .and_then(|v| v.as_u64())
                .unwrap_or(0xFFFF_FFFF) as u32;

            let compressed = extract_size != file_size && file_size > 0;

            entries.push(CpkEntry {
                name,
                dir,
                offset: content_offset + file_offset,
                size: file_size,
                extract_size,
                compressed,
                id,
            });
        }

        Ok(CpkArchive {
            path: path.to_path_buf(),
            entries,
            file_key,
            encrypted,
        })
    }

    /// All entries in the archive (in TOC order).
    pub fn entries(&self) -> &[CpkEntry] {
        &self.entries
    }

    /// Read the raw (possibly compressed) bytes of an entry.
    ///
    /// Note: CRILAYLA decompression is NOT performed here — the returned
    /// buffer may be compressed.  Callers that need decompressed data must
    /// call `read_entry_raw` and decompress themselves, or use the
    /// `crilayla` module (not included in this crate — add as needed).
    pub fn read_entry(&mut self, entry: &CpkEntry) -> io::Result<Vec<u8>> {
        if entry.size == 0 {
            return Ok(vec![]);
        }
        let mut file = File::open(&self.path)?;
        read_region(&mut file, entry.offset, entry.size as usize, self.encrypted, self.file_key)
    }

    /// Find an entry by full path ("dir/name") or just by name.
    pub fn read_entry_by_name(&mut self, name: &str) -> io::Result<Vec<u8>> {
        // Clone entries to avoid borrow conflict.
        let entry = self
            .entries
            .iter()
            .find(|e| e.path() == name || e.name == name)
            .cloned()
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    format!("entry '{}' not found in CPK", name),
                )
            })?;
        self.read_entry(&entry)
    }

    /// Whether the CPK was encrypted on disk.
    pub fn is_encrypted(&self) -> bool {
        self.encrypted
    }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_nonexistent_returns_error() {
        let result = CpkArchive::open(Path::new("C:/does_not_exist.cpk"));
        assert!(result.is_err());
    }

    #[test]
    fn test_invalid_magic_returns_error() {
        // Write a temp file with 64 bytes of zeros (no valid CPK magic).
        use std::io::Write;
        let tmp = std::env::temp_dir().join("cpk_test_invalid.cpk");
        {
            let mut f = File::create(&tmp).unwrap();
            f.write_all(&[0u8; 64]).unwrap();
        }
        let result = CpkArchive::open(&tmp);
        // Should fail because magic is 0x00000000, which can't decrypt to CPK_MAGIC.
        assert!(result.is_err());
        let _ = std::fs::remove_file(&tmp);
    }
}
