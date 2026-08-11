//! `cpk-reader` — read-only CPK (CRI Package) archive reader in pure safe Rust.
//!
//! Supports IEVR-style per-file encrypted CPKs (CRC32-derived XOR key with
//! Steam AppID prefix) and plain (unencrypted) CPKs.
//!
//! # Quick start
//! ```no_run
//! use cpk_reader::CpkArchive;
//! use std::path::Path;
//!
//! let mut archive = CpkArchive::open(Path::new("data/packs/file.cpk")).unwrap();
//! for entry in archive.entries() {
//!     println!("{} ({} bytes)", entry.path(), entry.size);
//! }
//! let data = archive.read_entry_by_name("common/chara/chr001.g4tx").unwrap();
//! ```

#![forbid(unsafe_code)]

pub mod cpk;
pub mod crypto;
pub mod utf;

// Re-export the primary public surface.
pub use cpk::{CpkArchive, CpkEntry};
